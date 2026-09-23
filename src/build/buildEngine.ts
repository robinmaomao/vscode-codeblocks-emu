/**
 * 构建引擎 —— 对应 compilergcc/directcommands.cpp + 进程派生
 *
 * 直接生成编译/链接命令并派生进程执行，不依赖 tasks.json。
 * 核心：构建图遍历（按文件 → 目标链接）+ 并行编译 + 输出捕获。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { Project, BuildTarget, ProjectFile, TargetType, CommandType, CompilerLineType } from '../model/types';
import { FileType, fileTypeOf, isCompilableFileType, isLinkableFileType, isCppSource, isClangdIndexable } from '../model/fileTypes';
import { Compiler } from '../compiler/compiler';
import { CommandGenerator } from '../compiler/commandGenerator';
import { OutputParser } from './outputParser';
import { runScriptCommands, buildMacroVars } from './scriptRunner';
import { decodeText } from '../tools/encoding';

/** 结构化的诊断信息（供 Build Log 视图展示，文件为绝对路径） */
export interface StructuredDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface BuildOptions {
  rebuild?: boolean;
  clean?: boolean;
  /** 原始编译输出行；severity 由解析器判定（error/warning/info） */
  onLine?: (line: string, severity?: 'error' | 'warning' | 'info') => void;
  onDiagnostic?: (diag: vscode.Diagnostic, fileUri?: vscode.Uri) => void;
  /** 结构化诊断回调（Build Log 视图收集错误/警告） */
  onStructuredDiagnostic?: (d: StructuredDiagnostic) => void;
}

/** 单次构建目标级统计（供 Build Log 视图展示） */
export interface BuildTargetStats {
  success: boolean;       // 本目标构建是否成功（含编译/链接/脚本）
  compiledCount: number;  // 本次实际编译的文件数
  skippedCount: number;   // 增量跳过数
  failedCount: number;    // 编译失败文件数
  linkSuccess: boolean;
  linkSkipped: boolean;   // static lib 无链接步骤
  outputFilename?: string;
}

/** 编译单元：一个文件的一条编译命令 */
interface CompileUnit {
  target: BuildTarget;
  file: ProjectFile;
  command: string;
  cwd: string;
}

export class BuildEngine {
  private parser: OutputParser;
  /** 最近一次 build() 的累计统计（供 Build Log 视图读取） */
  lastStats: BuildTargetStats | undefined;

  constructor(
    private project: Project,
    private compiler: Compiler,
    private output: vscode.LogOutputChannel,
  ) {
    // 使用编译器 XML 加载的正则；若为空则回退内置正则
    this.parser = new OutputParser(compiler.regexes.length ? compiler.regexes : undefined);
  }

  /** 构建主循环 —— 对应 GetCompileCommands + GetTargetLinkCommands */
  async build(targetTitle?: string, options: BuildOptions = {}): Promise<boolean> {
    const targets = targetTitle
      ? this.project.buildTargets.filter((t) => t.title === targetTitle)
      : this.project.buildTargets;

    if (targets.length === 0) {
      vscode.window.showWarningMessage('没有可构建的目标');
      return false;
    }

    // 累计各目标的统计结果（供 Build Log 视图）
    let compiledCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let linkSuccess = true;
    let linkSkipped = true;
    let outputFilename: string | undefined;

    let ok = true;
    for (const target of targets) {
      const result = await this.buildTarget(target, options);
      // 无论成功失败都累加统计（失败时统计已累计的部分）
      compiledCount += result.compiledCount;
      skippedCount += result.skippedCount;
      failedCount += result.failedCount;
      linkSuccess = linkSuccess && result.linkSuccess;
      linkSkipped = linkSkipped && result.linkSkipped;
      if (result.outputFilename) outputFilename = result.outputFilename;
      if (!result.success) {
        ok = false;
        break;
      }
    }

    this.lastStats = { success: ok, compiledCount, skippedCount, failedCount, linkSuccess, linkSkipped, outputFilename };
    return ok;
  }

  /**
   * 收集所有目标的编译单元命令（不执行、不做增量判断），
   * 供 clangd / cpptools 的 compile_commands.json 使用。
   * 返回标准 LSP compile_commands 条目：{ directory, command, file }。
   */
  collectCompileCommands(targetTitle?: string): { directory: string; command: string; file: string }[] {
    const targets = targetTitle
      ? this.project.buildTargets.filter((t) => t.title === targetTitle)
      : this.project.buildTargets;

    const generator = new CommandGenerator(this.project, this.compiler);
    const entries: { directory: string; command: string; file: string }[] = [];

    for (const target of targets) {
      const files = target.files.length ? target.files : this.project.files;
      const hasCpp = files.some((f) => isCppSource(f.relativeFilename));

      for (const file of files) {
        // 跳过不参与编译的文件（<Option compile="0"/>）
        if (file.compile === false) continue;

        const custom = file.customBuildCommands?.[target.compilerId];
        const isCustom = custom !== undefined && custom.use;
        // 自定义 buildCommand 文件（ram.ld/app.xm 等链接脚本/资源）不是 C/C++ 源文件，
        // clangd 无法解析，compile_commands.json 里跳过（构建仍照常处理它们）。
        if (isCustom) continue;
        // 只收集 clangd 可索引的 C/C++ 源文件（.rc 资源脚本 clangd 无法解析）
        if (!isClangdIndexable(file.relativeFilename)) continue;

        const objectRel = this.objectPathRelative(target, file);

        const command = generator.generate(CommandType.CompileObjectCmd, {
          target,
          pf: file,
          file: file.absolutePath,
          object: objectRel,
          flatObject: objectRel,
          deps: this.depsPathFor(target, file),
          hasCppFilesToLink: hasCpp,
        });
        if (command) {
          entries.push({ directory: this.project.basePath, command, file: file.absolutePath });
        }
      }
    }
    return entries;
  }

  /** 构建单个目标（始终返回统计对象，用 success 标记成败） */
  private async buildTarget(target: BuildTarget, options: BuildOptions): Promise<BuildTargetStats> {
    const macroVars = buildMacroVars(this.project.basePath, target.outputFilename, target.title, target.objectOutput, this.project.title, this.project.filename);

    if (target.targetType === TargetType.CommandsOnly) {
      // 仅执行 pre/post build 命令（项目级 + 目标级）
      const cmds = [
        ...this.project.commandsBeforeBuild, ...target.commandsBeforeBuild,
        ...this.project.commandsAfterBuild, ...target.commandsAfterBuild,
      ];
      const ok = await runScriptCommands(
        cmds,
        this.project.basePath,
        macroVars,
        (l) => this.output.info(l),
        this.compilerBinPath(),
      );
      if (!ok) {
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, outputFilename: target.outputFilename };
      }
      return { success: true, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: true, linkSkipped: true };
    }

    const generator = new CommandGenerator(this.project, this.compiler);

    // 全量编译（rebuild）对齐 CodeBlocks Rebuild：先删除对象输出目录，再全量编译
    if (options.rebuild) {
      this.cleanTarget(target);
    }

    // 项目级 + 目标级 pre-build 脚本（项目级先执行）
    const preCommands = [...this.project.commandsBeforeBuild, ...target.commandsBeforeBuild];
    const postCommands = [...this.project.commandsAfterBuild, ...target.commandsAfterBuild];

    // 0. pre-build 脚本
    if (preCommands.length) {
      this.output.info(`[Code::Blocks] 执行 pre-build 脚本 (${target.title})...`);
      const preOk = await runScriptCommands(preCommands, this.project.basePath, macroVars, (l) => this.output.info(l), this.compilerBinPath());
      if (!preOk) {
        this.output.error(`[Code::Blocks] 目标 "${target.title}" pre-build 脚本失败`);
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: target.targetType === TargetType.StaticLib, outputFilename: target.outputFilename };
      }
    }

    // 1. 编译所有文件（增量：跳过未变更文件）
    const units: CompileUnit[] = [];
    const files = target.files.length ? target.files : this.project.files;
    const hasCpp = files.some((f) => isCppSource(f.relativeFilename));

    // 头文件依赖扫描（增量编译）：收集 include 搜索目录与依赖 mtime 缓存（跨文件复用）
    const includeDirs = this.getIncludeDirs(target);
    const depsCache = new Map<string, number>();

    // 1a. 链接对象集合（独立于编译，对应 GetTargetLinkCommands：link=true 且可链接类型；
    //     自定义 buildCommand 文件如 ram.ld/app.xm 是链接脚本/资源，不参与链接）
    const linkFiles: ProjectFile[] = [];
    for (const file of files) {
      const custom = file.customBuildCommands?.[target.compilerId];
      if (custom !== undefined && custom.use) continue;
      if (file.link === false) continue;
      if (!isLinkableFileType(fileTypeOf(file.relativeFilename))) continue;
      linkFiles.push(file);
    }

    // 1b. 编译单元（对应 GetCompileFileCommand：compile=true 且可编译类型或自定义命令）
    let skippedCount = 0;
    for (const file of files) {
      // 跳过不参与编译的文件（<Option compile="0"/>）
      if (file.compile === false) continue;

      const custom = file.customBuildCommands?.[target.compilerId];
      const isCustom = custom !== undefined && custom.use;
      const ft = fileTypeOf(file.relativeFilename);
      // 自定义命令文件（ram.ld/app.xm 等）或可编译类型（源文件/资源文件）才编译
      if (!isCustom && !isCompilableFileType(ft)) continue;

      // 绝对对象路径用于增量判断，相对对象路径用于命令行（避免含空格路径）
      const object = this.objectPathFor(target, file);
      const objectRel = this.objectPathRelative(target, file);
      const deps = this.depsPathFor(target, file);

      // 增量编译：源/头文件未变更且对象文件存在时跳过（rebuild 强制重编译）
      // （Code::Blocks 对自定义 buildCommand 文件同样执行 IsObjectOutdated 判断）
      if (!options.rebuild && this.isUpToDate(file.absolutePath, object, includeDirs, depsCache)) {
        skippedCount++;
        this.output.debug(`[Skipping] ${file.relativeFilename} (up to date)`);
        continue;
      }

      let command: string;
      if (isCustom) {
        // 自定义编译命令：直接展开 $compiler/$file 等内置宏 + $(...) 变量
        command = this.expandCustomCommand(custom.command, generator, target, file, objectRel);
      } else {
        // 资源文件走 CompileResourceCmd（windres），其余走 CompileObjectCmd（对齐 GetCompileFileCommand）
        const cmdType = ft === FileType.Resource ? CommandType.CompileResourceCmd : CommandType.CompileObjectCmd;
        command = generator.generate(cmdType, {
          target,
          pf: file,
          file: file.absolutePath,
          object: objectRel,
          flatObject: objectRel,
          deps,
          hasCppFilesToLink: hasCpp,
        });
      }
      // 对齐 AddCommandsToArray：展开后为空/纯空白的命令（如 buildCommand=" " 的 no-op）不执行
      if (command && command.trim() !== '') {
        units.push({ target, file, command, cwd: this.project.basePath });
      }
    }

    // 创建所有对象文件的父目录（对应 CodeBlocks 的 CreateDirRecursively）
    // 否则 GCC 无法创建 Output\obj\plugin\xxx.o 等子目录下的对象文件
    this.ensureObjectDirs(units);

    // 无需要编译的文件（且输出已存在）→ 跳过
    if (units.length === 0) {
      const outAbs = this.resolveOutputFile(target);
      if (fs.existsSync(outAbs)) {
        this.output.info(`[Code::Blocks] 目标 "${target.title}" 已是最新`);
        return {
          success: true, compiledCount: 0, skippedCount, failedCount: 0,
          linkSuccess: true, linkSkipped: target.targetType === TargetType.StaticLib,
          outputFilename: target.outputFilename,
        };
      }
      // 输出缺失但无新编译：仍尝试链接（对象可能已存在）
    }

    // 并行编译（受配置限制）
    const maxJobs = this.maxJobs();
    const results = await this.runInParallel(units, maxJobs, options);

    const failedCount = results.filter((r) => !r).length;
    if (failedCount > 0) {
      this.output.error(`[Code::Blocks] 目标 "${target.title}" 编译失败`);
      return {
        success: false,
        compiledCount: units.length - failedCount, // 编译成功的文件数
        skippedCount,
        failedCount,
        linkSuccess: false,
        linkSkipped: target.targetType === TargetType.StaticLib,
        outputFilename: target.outputFilename,
      };
    }

    // 2. 链接（非 static lib 需要链接步骤；CommandsOnly 已在上面 return）
    let linkSuccess = true;
    if (target.targetType !== TargetType.StaticLib) {
      // 链接对象 = 所有参与链接的标准源文件对象（不论本次是否重编译）
      // （ram.ld → ram.o 是链接脚本、app.xm → appxm.o 是资源，均不参与链接）
      const linkObjects = linkFiles.map((f) => this.objectPathRelative(target, f));
      const linkObjectsAbs = linkFiles.map((f) => this.objectPathFor(target, f));

      // 增量：输出已存在且比所有链接对象新 → 跳过链接（对应 GetTargetLinkCommands 时间戳检查）
      const outputAbs = this.resolveOutputFile(target);
      if (options.rebuild || !this.linkObjectsUpToDate(outputAbs, linkObjectsAbs)) {
        // 创建输出目录（如 Output\bin），否则链接器无法写 app.rv32
        this.ensureDir(path.join(this.project.basePath, path.dirname(target.outputFilename)));

        const linkCommand = generator.generate(this.linkCommandType(target), {
          target,
          pf: null,
          file: '',
          object: linkObjects.join(this.compiler.switches.objectSeparator),
          flatObject: linkObjects.join(this.compiler.switches.objectSeparator),
          deps: '',
          hasCppFilesToLink: hasCpp,
        });
        if (linkCommand) {
          this.output.info(linkCommand);
          this.output.info(`[Linking] → ${target.outputFilename}`);
          const linkOk = await this.runCommand(linkCommand, this.project.basePath, options);
          if (!linkOk) {
            this.output.error(`[Code::Blocks] 目标 "${target.title}" 链接失败`);
            return {
              success: false,
              compiledCount: units.length,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: false,
              outputFilename: target.outputFilename,
            };
          }
        }
      } else {
        this.output.info(`[Code::Blocks] 目标 "${target.title}" 链接已是最新，跳过链接`);
      }
    } else if (target.targetType === TargetType.StaticLib) {
      // 静态库用 ar 打包（用所有参与链接的对象，而非仅本次编译的）
      const objects = linkFiles.map((f) => this.objectPathRelative(target, f));
      const staticOut = path.join(
        path.dirname(target.outputFilename),
        path.parse(target.outputFilename).name + '.' + this.compiler.switches.libExtension,
      );
      const staticOutAbs = path.join(this.project.basePath, staticOut);
      const linkObjectsAbs = linkFiles.map((f) => this.objectPathFor(target, f));
      // 增量：静态库已存在且比所有对象新 → 跳过打包
      if (options.rebuild || !this.linkObjectsUpToDate(staticOutAbs, linkObjectsAbs)) {
        const arCmd = `${this.compiler.programs.LIB} -r -s ${staticOut} ${objects.join(' ')}`;
        this.output.info(arCmd);
        this.output.info(`[Archiving] → ${staticOut}`);
        const ok = await this.runCommand(arCmd, this.project.basePath, options);
        if (!ok) {
          return {
            success: false,
            compiledCount: units.length,
            skippedCount,
            failedCount: 0,
            linkSuccess: false,
            linkSkipped: true,
            outputFilename: target.outputFilename,
          };
        }
      } else {
        this.output.info(`[Code::Blocks] 目标 "${target.title}" 静态库已是最新，跳过打包`);
      }
    }

    // 3. post-build 脚本
    if (postCommands.length) {
      this.output.info(`[Code::Blocks] 执行 post-build 脚本 (${target.title})...`);
      const postOk = await runScriptCommands(postCommands, this.project.basePath, macroVars, (l) => this.output.info(l), this.compilerBinPath());
      if (!postOk) {
        this.output.error(`[Code::Blocks] 目标 "${target.title}" post-build 脚本失败`);
        return {
          success: false,
          compiledCount: units.length,
          skippedCount,
          failedCount: 0,
          linkSuccess,
          linkSkipped: target.targetType === TargetType.StaticLib,
          outputFilename: target.outputFilename,
        };
      }
    }

    return {
      success: true,
      compiledCount: units.length,
      skippedCount,
      failedCount: 0,
      linkSuccess,
      linkSkipped: target.targetType === TargetType.StaticLib,
      outputFilename: target.outputFilename,
    };
  }

  private linkCommandType(target: BuildTarget): CommandType {
    switch (target.targetType) {
      case TargetType.ConsoleOnly: return CommandType.LinkConsoleExeCmd;
      case TargetType.DynamicLib: return CommandType.LinkDynamicCmd;
      case TargetType.Native: return CommandType.LinkNativeCmd;
      default: return CommandType.LinkExeCmd;
    }
  }

  /** 编译器 bin 目录（用于把交叉编译器工具加入脚本执行的 PATH） */
  private compilerBinPath(): string {
    // 优先从完整程序路径推导（如 .../RV32-V2/bin/riscv32-elf-gcc.exe → .../RV32-V2/bin）
    const c = this.compiler.programs.C;
    if (c && (c.includes('/') || c.includes('\\'))) {
      return path.dirname(c);
    }
    // 回退：masterPath + bin
    if (this.compiler.masterPath) {
      return path.join(this.compiler.masterPath, 'bin');
    }
    return '';
  }

  /** 展开自定义编译命令（ram.ld/app.xm 等 <Option buildCommand>） */
  private expandCustomCommand(
    cmd: string,
    generator: CommandGenerator,
    target: BuildTarget,
    file: ProjectFile,
    object: string,
  ): string {
    return generator.generateFromTemplate(cmd, {
      target,
      pf: file,
      file: file.absolutePath,
      object,
      flatObject: object,
      deps: this.depsPathFor(target, file),
      hasCppFilesToLink: false,
    });
  }

  /**
   * 增量编译判断 —— 对应 CodeBlocks DirectCommands::IsObjectOutdated：
   * 源文件 mtime 与 #include 依赖头文件 mtime 均不晚于对象文件，才认为无需重编译。
   */
  private isUpToDate(
    sourceFile: string,
    objectFile: string,
    includeDirs: string[],
    depsCache: Map<string, number>,
  ): boolean {
    try {
      const srcStat = fs.statSync(sourceFile);
      const objStat = fs.statSync(objectFile);
      if (objStat.mtimeMs < srcStat.mtimeMs) return false; // 源文件比对象新 → 需编译
      // 扫描 #include 依赖，头文件更新也触发重编译（对应 depsScanForHeaders + depsGetNewest）
      const newestDep = this.depsNewestMtime(sourceFile, includeDirs, depsCache);
      return newestDep <= objStat.mtimeMs;
    } catch {
      // 对象文件不存在 → 需要编译
      return false;
    }
  }

  /**
   * 解析目标实际输出文件路径。
   * Windows 下 MinGW 链接器会为无扩展名的 `-o` 输出自动追加 `.exe`
   * （如 .cbp 的 output="bin/Debug/hello"，实际产出 bin/Debug/hello.exe），
   * 因此时间戳判断需先解析出真实存在的文件。
   */
  private resolveOutputFile(target: BuildTarget): string {
    const out = path.join(this.project.basePath, target.outputFilename);
    if (fs.existsSync(out)) return out;
    if (process.platform === 'win32') {
      const isExeType =
        target.targetType === TargetType.ConsoleOnly ||
        target.targetType === TargetType.Executable ||
        target.targetType === TargetType.Native;
      if (isExeType && fs.existsSync(out + '.exe')) return out + '.exe';
    }
    return out;
  }

  /**
   * 链接增量判断 —— 对应 CodeBlocks DirectCommands::GetTargetLinkCommands 的时间戳检查：
   * 输出文件存在且 mtime 不早于所有链接对象，才认为无需重新链接。
   */
  private linkObjectsUpToDate(outputAbs: string, objectPaths: string[]): boolean {
    try {
      const outStat = fs.statSync(outputAbs);
      for (const o of objectPaths) {
        const objStat = fs.statSync(o);
        if (objStat.mtimeMs > outStat.mtimeMs) return false; // 对象比输出新 → 需链接
      }
      return true;
    } catch {
      // 输出或任一对象不存在 → 需要链接
      return false;
    }
  }

  /** 收集目标的 include 搜索目录（项目级 + 目标级，默认 Append 关系） */
  private getIncludeDirs(target: BuildTarget): string[] {
    return [...this.project.includeDirs, ...target.includeDirs];
  }

  /** 递归扫描 #include "..." 依赖树，返回依赖头文件的最大 mtime（毫秒，不含文件自身） */
  private depsNewestMtime(
    fileAbs: string,
    includeDirs: string[],
    cache: Map<string, number>,
    inProgress?: Set<string>,
  ): number {
    const key = path.resolve(fileAbs);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const inProg = inProgress ?? new Set<string>();
    if (inProg.has(key)) return 0; // 循环 include，中断递归
    inProg.add(key);

    let newest = 0;
    try {
      const content = fs.readFileSync(key, 'utf-8');
      // 同时匹配双引号与尖括号 include
      const re = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const quoted = m[1];
        const angled = m[2];
        const resolved = this.resolveInclude(quoted ?? angled, key, includeDirs, quoted === undefined);
        if (!resolved) continue;
        try {
          newest = Math.max(newest, fs.statSync(resolved).mtimeMs);
        } catch {
          continue;
        }
        newest = Math.max(newest, this.depsNewestMtime(resolved, includeDirs, cache, inProg));
      }
    } catch {
      // 文件读取失败（如二进制/无权限），忽略其依赖
    }
    inProg.delete(key);
    cache.set(key, newest);
    return newest;
  }

  /** 解析 #include 头文件的实际路径：双引号先查源文件目录再查 include 目录；尖括号只查 include 目录 */
  private resolveInclude(inc: string, fromFile: string, includeDirs: string[], angleBracket = false): string | undefined {
    // 1. 双引号：相对当前源文件所在目录（C 编译器默认行为）
    if (!angleBracket) {
      const cand = path.resolve(path.dirname(fromFile), inc);
      if (fs.existsSync(cand)) return cand;
    }
    // 2. 相对项目 include 目录（相对路径基于项目根目录解析）
    for (const dir of includeDirs) {
      const base = path.isAbsolute(dir) ? dir : path.join(this.project.basePath, dir);
      const cand = path.resolve(base, inc);
      if (fs.existsSync(cand)) return cand;
    }
    return undefined;
  }

  /** 删除目标的对象输出目录（对应 Clean，供 rebuild 对齐「先 Clean 再 Build」） */
  private cleanTarget(target: BuildTarget): void {
    const objDir = path.join(this.project.basePath, target.objectOutput || 'obj');
    if (!objDir || !fs.existsSync(objDir)) return;
    try {
      fs.rmSync(objDir, { recursive: true, force: true });
      this.output.info(`[Code::Blocks] 清理对象目录: ${objDir}`);
    } catch (e) {
      this.output.error(`[Code::Blocks] 清理对象目录失败: ${(e as Error).message}`);
    }
  }

  private objectPathFor(target: BuildTarget, file: ProjectFile): string {
    const objDir = target.objectOutput || 'obj';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    const name = path.parse(rel).name;
    return path.join(this.project.basePath, objDir, path.dirname(rel), name + '.' + this.compiler.switches.objectExtension);
  }

  /** 相对项目根的对象路径（用于命令行，与 CodeBlocks 一致，避免绝对路径含空格） */
  private objectPathRelative(target: BuildTarget, file: ProjectFile): string {
    const objDir = target.objectOutput || 'obj';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    const name = path.parse(rel).name;
    return path.join(objDir, path.dirname(rel), name + '.' + this.compiler.switches.objectExtension);
  }

  /** 为所有待编译单元递归创建对象目录（对应 CreateDirRecursively） */
  private ensureObjectDirs(units: CompileUnit[]): void {
    const dirs = new Set<string>();
    for (const u of units) {
      const objDir = path.dirname(this.objectPathFor(u.target, u.file));
      dirs.add(objDir);
    }
    for (const dir of dirs) {
      this.ensureDir(dir);
    }
  }

  /** 递归创建目录（静默失败） */
  private ensureDir(dir: string): void {
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      this.output.error(`[Code::Blocks] 无法创建目录 ${dir}: ${(e as Error).message}`);
    }
  }

  private depsPathFor(target: BuildTarget, file: ProjectFile): string {
    const objDir = target.objectOutput || 'obj';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    const name = path.parse(rel).name;
    // 与对象路径一致（含目录），避免不同目录同名文件（a/foo.c、b/foo.c）的 .d 互相覆盖
    return path.join(this.project.basePath, objDir, path.dirname(rel), name + '.d');
  }

  private maxJobs(): number {
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    const n = cfg.get<number>('parallelJobs', 0);
    if (n && n > 0) return n;
    return Math.max(1, Math.min(8, (os.cpus().length || 2)));
  }

  private async runInParallel(units: CompileUnit[], maxJobs: number, options: BuildOptions): Promise<boolean[]> {
    const results: boolean[] = new Array(units.length).fill(false);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(maxJobs, units.length) }, async () => {
      while (cursor < units.length) {
        const idx = cursor++;
        const u = units[idx];
        this.output.info(`[Compiling] ${u.file.relativeFilename}`);
        this.output.debug(u.command);
        results[idx] = await this.runCommand(u.command, u.cwd, options);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async runCommand(command: string, cwd: string, options: BuildOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn(command, {
        cwd,
        shell: true,
      });
      const parser = this.parser;

      // 累积原始字节，命令结束时统一解码（UTF-8 严格优先，回退 GBK），
      // 避免流式分块在「UTF-8 / GBK 多字节字符跨 chunk 边界」时误判编码。
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const processLines = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          const parsed = parser.parseLine(line);
          const severity = parsed?.type === CompilerLineType.Error
            ? 'error' as const
            : parsed?.type === CompilerLineType.Warning ? 'warning' as const : 'info' as const;
          options.onLine?.(line, severity);
          const diag = parser.toDiagnostic(line, cwd);
          if (diag) {
            options.onDiagnostic?.(diag, parser.resolveFileUri(line, cwd));
            this.emitStructuredDiagnostic(line, cwd, options);
          }
        }
      };

      proc.stdout?.on('data', (data: Buffer) => stdoutChunks.push(data));
      proc.stderr?.on('data', (data: Buffer) => stderrChunks.push(data));

      proc.on('close', (code) => {
        if (stdoutChunks.length) processLines(decodeText(Buffer.concat(stdoutChunks)));
        if (stderrChunks.length) processLines(decodeText(Buffer.concat(stderrChunks)));
        const success = code !== null && code <= this.compiler.switches.statusSuccess;
        resolve(success);
      });
      proc.on('error', (err) => {
        this.output.error(`[Code::Blocks] 无法执行: ${err.message}`);
        resolve(false);
      });
    });
  }

  /** 解析一行输出，若为 error/warning 则通过 onStructuredDiagnostic 上报（文件解析为绝对路径） */
  private emitStructuredDiagnostic(line: string, cwd: string, options: BuildOptions): void {
    if (!options.onStructuredDiagnostic) return;
    const parsed = this.parser.parseLine(line);
    if (!parsed) return;
    if (parsed.type !== CompilerLineType.Error && parsed.type !== CompilerLineType.Warning) return;

    // 去掉 message 前缀（error:/warning:/note:/fatal error:），图标已表达严重级别，前缀冗余
    const message = stripMessagePrefix(parsed.message);
    // note 行（如 "note: candidate function"）是错误上下文说明，不作为可导航的独立错误
    if (/^note\b/i.test(message)) return;

    let absFile: string | undefined;
    if (parsed.file) {
      absFile = path.isAbsolute(parsed.file) ? parsed.file : path.join(cwd, parsed.file);
    }
    options.onStructuredDiagnostic({
      severity: parsed.type === CompilerLineType.Error ? 'error' : 'warning',
      message,
      file: absFile,
      line: parsed.line,
      column: parsed.column,
    });
  }

  private async runCommands(commands: string[], cwd: string): Promise<boolean> {
    let ok = true;
    for (const cmd of commands) {
      this.output.info(cmd);
      const r = await this.runCommand(cmd, cwd, {});
      if (!r) ok = false;
    }
    return ok;
  }
}

/** 去掉诊断消息开头的严重级别前缀（error:/warning:/note:/fatal error: 等），图标已表达级别 */
function stripMessagePrefix(message: string): string {
  return message
    .replace(/^error:\s*/i, '')
    .replace(/^warning:\s*/i, '')
    .replace(/^note:\s*/i, '')
    .replace(/^fatal error:\s*/i, '')
    .trim();
}
