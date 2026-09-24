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
import { CommandGenerator, computeStaticOutput } from '../compiler/commandGenerator';
import { OutputParser } from './outputParser';
import { runScriptCommands, buildMacroVars } from './scriptRunner';
import { decodeText } from '../tools/encoding';
import { applyResponseFile, compareFilesByWeight } from './commandLine';
import { upperDrive } from '../tools/pathCase';
import { getWindowsSystemPath } from '../tools/windowsPath';
import { LruCache } from '../tools/lru';

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
  /** 是否为 PCH 头文件（需先于同组其它文件编译） */
  isPch: boolean;
}

/** 跨构建持久化的 include 依赖缓存（BuildEngine 每次构建新建实例，故用模块级静态缓存；LRU 上限防无界增长） */
const depsIncludeCache = new LruCache<string, { srcMtimeMs: number; srcSize: number; dirsKey: string; includes: string[] }>(2000);

/** 正斜杠归一化（供 PCH 对象路径等使用） */
function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

export class BuildEngine {
  private parser: OutputParser;
  /** 编译/链接子进程环境（PATH 前置编译器 bin 目录，对齐 CodeBlocks Init 的 PATH 重构） */
  private buildEnv: NodeJS.ProcessEnv | undefined;
  /** 最近一次 build() 的累计统计（供 Build Log 视图读取） */
  lastStats: BuildTargetStats | undefined;
  /** 最近一次构建的单文件编译耗时（供汇总「最慢 Top 3」） */
  lastCompileTimings: { file: string; ms: number }[] = [];
  /** 本次构建的单文件编译耗时（并发 push，JS 单线程安全） */
  private compileTimings: { file: string; ms: number }[] = [];

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
    // 编译/链接子进程 PATH 注入：编译器 bin 目录前置 + 实时系统 PATH（对齐 CodeBlocks Init 的 PATH 重构）
    if (process.platform === 'win32') {
      const extraPath = this.compilerBinPath();
      const merged = [extraPath, getWindowsSystemPath(), process.env.PATH ?? ''].filter(Boolean).join(';');
      this.buildEnv = { ...(process.env as NodeJS.ProcessEnv), PATH: merged };
    }

    // 无目标标题：只构建纳入 All 的目标（对齐 GetCompileCommands(target=null) 的 includeInTargetAll 过滤）
    let targets = targetTitle
      ? this.project.buildTargets.filter((t) => t.title === targetTitle)
      : this.project.buildTargets.filter((t) => t.includeInTargetAll !== false);
    // 没有任何目标纳入 All 时回退构建全部（防御，避免 Build 无动作）
    if (!targetTitle && targets.length === 0) {
      targets = this.project.buildTargets;
    }

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
          nativeSep: false,
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
    // 本次目标构建的耗时记录（提前 return 路径也要清空，避免汇总显示上次构建的 Top3）
    this.compileTimings = [];
    this.lastCompileTimings = [];
    const macroVars = buildMacroVars(this.project.basePath, target.outputFilename, target.title, target.objectOutput, this.project.title, this.project.filename);
    const generator = new CommandGenerator(this.project, this.compiler);

    // 展开 pre/post 命令中的编译宏（$compiler/$options/$includes 等），对齐 Code::Blocks GenerateCommandLine
    // （directcommands.cpp GetPreBuildCommands：GenerateCommandLine(cmd, target, 0, "", ...)）
    const expandScriptMacros = (cmd: string): string =>
      generator.generateFromTemplate(cmd, { target, pf: null, file: '', object: '', flatObject: '', deps: '' });

    // 构建脚本（<Script file>）：Code::Blocks 用 Squirrel 脚本引擎，扩展暂不支持，明确警告跳过
    const buildScripts = [...this.project.buildScripts, ...target.buildScripts];
    for (const s of buildScripts) {
      this.output.warn(`[Code::Blocks] 暂不支持 Squirrel 构建脚本，已跳过: ${s}`);
    }

    if (target.targetType === TargetType.CommandsOnly) {
      // 仅执行 pre/post build 命令（项目级 + 目标级）
      const cmds = [
        ...this.project.commandsBeforeBuild, ...target.commandsBeforeBuild,
        ...target.commandsAfterBuild, ...this.project.commandsAfterBuild,
      ].map(expandScriptMacros);
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

    // 全量编译（rebuild）对齐 CodeBlocks Rebuild：先删除对象输出目录，再全量编译
    if (options.rebuild) {
      this.cleanTarget(target);
    }

    // 项目级 + 目标级 pre-build 脚本（项目级先执行），先展开编译宏再执行
    const preCommands = [...this.project.commandsBeforeBuild, ...target.commandsBeforeBuild].map(expandScriptMacros);

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
    // 按 weight 排序（对齐 GetProjectFilesSortedByWeight：weight 升序，同 weight 按文件名）
    const sortedFiles = [...files].sort(compareFilesByWeight);
    const hasCpp = sortedFiles.some((f) => isCppSource(f.relativeFilename));

    // 头文件依赖扫描（增量编译）：收集 include 搜索目录与依赖 mtime 缓存（跨文件复用）
    const includeDirs = this.getIncludeDirs(target);
    const depsCache = new Map<string, number>();

    // 1a. 链接对象集合（独立于编译，对应 GetTargetLinkCommands：link=true 且可链接类型。
    //     对齐 CodeBlocks GetProjectFilesSortedByWeight(target, false, true) 只过滤 !pf->link，
    //     link 默认值由文件类型决定（.c/.cpp 等可链接，.xm/.ld 等不可链接）——
    //     因此带自定义 buildCommand 的 .c 文件（如 toolkit_effect.c）仍须参与链接，
    //     而 ram.ld/app.xm 因扩展名非可链接类型被 isLinkableFileType 排除；
    //     资源文件（.rc）单独到 resFiles（$link_resobjects），其余到 linkFiles（$link_objects））
    const linkFiles: ProjectFile[] = [];
    const resFiles: ProjectFile[] = [];
    for (const file of sortedFiles) {
      if (file.link === false) continue;
      if (!isLinkableFileType(fileTypeOf(file.relativeFilename))) continue;
      if (fileTypeOf(file.relativeFilename) === FileType.Resource) {
        resFiles.push(file);
      } else {
        linkFiles.push(file);
      }
    }

    // 1b. 编译单元（对应 GetCompileFileCommand：compile=true 且可编译类型或自定义命令）
    let skippedCount = 0;
    // 生成文件单元延后编译（对齐 GetCompileFileCommand 的「生成器命令 → COMPILER_WAIT → 生成文件命令」：
    // 生成器先产出源文件，生成文件才能编译）
    const deferredUnits: CompileUnit[] = [];
    for (const file of sortedFiles) {
      // 跳过不参与编译的文件（<Option compile="0"/>）
      if (file.compile === false) continue;

      const custom = file.customBuildCommands?.[target.compilerId];
      const isCustom = custom !== undefined && custom.use;
      const ft = fileTypeOf(file.relativeFilename);
      const isHeader = ft === FileType.Header;
      const hasGenerated = (file.generatedFiles?.length ?? 0) > 0;
      // 自定义命令文件（ram.ld/app.xm 等）或可编译类型（源文件/资源文件）才编译；
      // 头文件在编译器 supportsPCH 时也编译为 .gch（对齐 GetCompileFileCommand 的 is_header && supportsPCH）；
      // 生成器文件（编译器工具 gen 属性声明生成文件）也编译（对齐 AddFile localCompile 的 !GenFilesHackMap.empty()）
      if (!isCustom && !isCompilableFileType(ft) && !(isHeader && this.compiler.switches.supportsPCH) && !hasGenerated) continue;

      // 绝对对象路径用于增量判断，相对对象路径用于命令行（避免含空格路径）
      const object = this.objectPathFor(target, file);
      const objectRel = this.objectPathRelative(target, file);
      const deps = this.depsPathFor(target, file);

      // 增量编译：源/头文件未变更且对象文件存在时跳过（rebuild 强制重编译）
      // （Code::Blocks 对自定义 buildCommand 文件同样执行 IsObjectOutdated 判断）
      if (!options.rebuild && this.isUpToDate(file.absolutePath, object, includeDirs, depsCache)) {
        skippedCount++;
        if (this.verboseOutput()) {
          this.output.info(`[Skipping] ${file.relativeFilename} (up to date)`);
        } else {
          this.output.debug(`[Skipping] ${file.relativeFilename} (up to date)`);
        }
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
      // PCH 头文件：编译前删除旧 .gch（对齐 directcommands.cpp 的 wxRemoveFile，避免陈旧产物）
      if (isHeader) {
        command = `cmd /c if exist "${objectRel}" del "${objectRel}"\n${command}`;
      }
      // 对齐 AddCommandsToArray：展开后为空/纯空白的命令（如 buildCommand=" " 的 no-op）不执行
      if (command && command.trim() !== '') {
        const unit: CompileUnit = { target, file, command, cwd: this.project.basePath, isPch: isHeader };
        // 生成文件延后到所有常规编译之后（保证生成器已产出源文件）
        if (file.autoGeneratedBy) deferredUnits.push(unit);
        else units.push(unit);
      }
    }

    // 创建所有对象文件的父目录（对应 CodeBlocks 的 CreateDirRecursively）
    // 否则 GCC 无法创建 Output\obj\plugin\xxx.o 等子目录下的对象文件
    this.ensureObjectDirs([...units, ...deferredUnits]);

    // 无需要编译的文件（且输出已存在）→ 跳过
    if (units.length === 0 && deferredUnits.length === 0) {
      const outAbs = this.resolveOutputFile(target);
      if (fs.existsSync(outAbs)) {
        this.output.info(`[Code::Blocks] 目标 "${target.title}" 已是最新`);
        // 目标已最新（hasCommands=false）：仅当 alwaysRunPostBuildSteps 为真时才执行 post-build（对齐 CodeBlocks）
        if (!(await this.runPostBuild(target, macroVars, expandScriptMacros, false))) {
          return {
            success: false, compiledCount: 0, skippedCount, failedCount: 0,
            linkSuccess: false, linkSkipped: target.targetType === TargetType.StaticLib,
            outputFilename: target.outputFilename,
          };
        }
        return {
          success: true, compiledCount: 0, skippedCount, failedCount: 0,
          linkSuccess: true, linkSkipped: target.targetType === TargetType.StaticLib,
          outputFilename: target.outputFilename,
        };
      }
      // 输出缺失但无新编译：仍尝试链接（对象可能已存在）
    }

    // 并行编译（受配置限制）；生成文件在常规编译全部完成后执行
    const totalUnits = units.length + deferredUnits.length;
    const compileStartMs = Date.now();
    const maxJobs = this.maxJobs();
    const results = await this.runInParallel(units, maxJobs, options, totalUnits);
    if (deferredUnits.length) {
      results.push(...(await this.runInParallel(deferredUnits, maxJobs, options, totalUnits)));
    }
    const compileSec = ((Date.now() - compileStartMs) / 1000).toFixed(1);
    this.lastCompileTimings = [...this.compileTimings];

    const failedCount = results.filter((r) => !r).length;
    if (failedCount > 0) {
      this.output.error(`[Code::Blocks] 目标 "${target.title}" 编译失败`);
      return {
        success: false,
        compiledCount: totalUnits - failedCount, // 编译成功的文件数
        skippedCount,
        failedCount,
        linkSuccess: false,
        linkSkipped: target.targetType === TargetType.StaticLib,
        outputFilename: target.outputFilename,
      };
    }
    // 编译阶段完成耗时（对齐 Code::Blocks 阶段化日志）
    this.output.info(`[Code::Blocks] 编译完成 ${totalUnits} 个文件 (${compileSec}s)`);

    // 2. 链接（非 static lib 需要链接步骤；CommandsOnly 已在上面 return）
    let linkSuccess = true;
    if (target.targetType !== TargetType.StaticLib) {
      // 链接对象 = 所有参与链接的标准源文件对象（不论本次是否重编译）
      // （ram.ld → ram.o 是链接脚本、app.xm → appxm.o 是资源，均不参与链接）
      const linkObjects = linkFiles.map((f) => this.linkObjectRelative(target, f));
      const resObjects = resFiles.map((f) => this.objectPathRelative(target, f));
      const linkObjectsAbs = linkFiles.map((f) => this.linkObjectAbs(target, f));
      // 资源对象同样参与增量判断（对齐 GetTargetLinkCommands 的时间戳检查遍历所有对象）
      const allObjectsAbs = [...linkObjectsAbs, ...resFiles.map((f) => this.objectPathFor(target, f))];

      // 增量：输出已存在且比所有链接对象新 → 跳过链接（对应 GetTargetLinkCommands 时间戳检查）
      const outputAbs = this.resolveOutputFile(target);
      if (options.rebuild || !this.linkObjectsUpToDate(outputAbs, allObjectsAbs)) {
        // 创建输出目录（如 Output\bin），否则链接器无法写 app.rv32
        this.ensureDir(path.join(this.project.basePath, path.dirname(target.outputFilename)));

        const linkCommand = generator.generate(this.linkCommandType(target), {
          target,
          pf: null,
          file: '',
          object: linkObjects.join(this.compiler.switches.objectSeparator),
          flatObject: linkObjects.join(this.compiler.switches.objectSeparator),
          deps: resObjects.join(this.compiler.switches.objectSeparator),
          hasCppFilesToLink: hasCpp,
        });
        if (linkCommand) {
          this.output.info(linkCommand);
          this.output.info(`[Linking] → ${target.outputFilename}`);
          const linkStartMs = Date.now();
          const linkOk = await this.runCommand(linkCommand, this.project.basePath, options);
          const linkSec = ((Date.now() - linkStartMs) / 1000).toFixed(1);
          if (!linkOk) {
            this.output.error(`[Code::Blocks] 目标 "${target.title}" 链接失败`);
            return {
              success: false,
              compiledCount: totalUnits,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: false,
              outputFilename: target.outputFilename,
            };
          }
          this.output.info(`✓ [Linked] ${target.outputFilename} (${linkSec}s)`);
        }
      } else {
        this.output.info(`[Code::Blocks] 目标 "${target.title}" 链接已是最新，跳过链接`);
      }
    } else if (target.targetType === TargetType.StaticLib) {
      // 静态库用 ar 打包（对齐 Code::Blocks LinkStatic 模板，含 $lib_linker 引号与多行命令拆分）
      const objects = linkFiles.map((f) => this.linkObjectRelative(target, f));
      const staticOut = computeStaticOutput(target.outputFilename, this.compiler.switches);
      const staticOutAbs = path.join(this.project.basePath, staticOut);
      const linkObjectsAbs = linkFiles.map((f) => this.linkObjectAbs(target, f));
      // 增量：静态库已存在且比所有对象新 → 跳过打包
      if (options.rebuild || !this.linkObjectsUpToDate(staticOutAbs, linkObjectsAbs)) {
        // 创建静态库输出目录（如 bin\Debug），否则 ar 无法写 libdep_lib.a
        this.ensureDir(path.join(this.project.basePath, path.dirname(staticOut)));
        const arCmd = generator.generate(CommandType.LinkStaticCmd, {
          target,
          pf: null,
          file: '',
          object: objects.join(this.compiler.switches.objectSeparator),
          flatObject: objects.join(this.compiler.switches.objectSeparator),
          deps: '',
          hasCppFilesToLink: false,
        });
        if (arCmd) {
          this.output.info(arCmd);
          this.output.info(`[Archiving] → ${staticOut}`);
          const arStartMs = Date.now();
          const ok = await this.runCommand(arCmd, this.project.basePath, options);
          const arSec = ((Date.now() - arStartMs) / 1000).toFixed(1);
          if (!ok) {
            return {
              success: false,
              compiledCount: totalUnits,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: true,
              outputFilename: target.outputFilename,
            };
          }
          this.output.info(`✓ [Archived] ${staticOut} (${arSec}s)`);
        }
      } else {
        this.output.info(`[Code::Blocks] 目标 "${target.title}" 静态库已是最新，跳过打包`);
      }
    }

    // 3. post-build 脚本（对齐 CodeBlocks：目标 post → 项目 post；hasCommands=true 时执行）
    if (!(await this.runPostBuild(target, macroVars, expandScriptMacros, true))) {
      return {
        success: false,
        compiledCount: totalUnits,
        skippedCount,
        failedCount: 0,
        linkSuccess,
        linkSkipped: target.targetType === TargetType.StaticLib,
        outputFilename: target.outputFilename,
      };
    }

    return {
      success: true,
      compiledCount: totalUnits,
      skippedCount,
      failedCount: 0,
      linkSuccess,
      linkSkipped: target.targetType === TargetType.StaticLib,
      outputFilename: target.outputFilename,
    };
  }

  /**
   * 执行 post-build 步骤 —— 对齐 CodeBlocks 状态机（bsTargetPostBuild → bsProjectPostBuild）：
   * 1. 顺序：目标级 post-build 先执行，项目级 post-build 后执行；
   * 2. 条件：hasCommands（有编译/链接动作）或 alwaysRunPostBuildSteps 标志为真时才执行。
   */
  private async runPostBuild(
    target: BuildTarget,
    macroVars: Record<string, string>,
    expandScriptMacros: (cmd: string) => string,
    hasCommands: boolean,
  ): Promise<boolean> {
    const targetPost = [...target.commandsAfterBuild].map(expandScriptMacros);
    const projectPost = [...this.project.commandsAfterBuild].map(expandScriptMacros);
    const extraPath = this.compilerBinPath();

    if (targetPost.length && (hasCommands || target.alwaysRunPostBuildSteps)) {
      this.output.info(`[Code::Blocks] 执行目标 post-build 脚本 (${target.title})...`);
      const ok = await runScriptCommands(targetPost, this.project.basePath, macroVars, (l) => this.output.info(l), extraPath);
      if (!ok) {
        this.output.error(`[Code::Blocks] 目标 "${target.title}" post-build 脚本失败`);
        return false;
      }
    }
    if (projectPost.length && (hasCommands || this.project.alwaysRunPostBuildSteps)) {
      this.output.info('[Code::Blocks] 执行项目 post-build 脚本...');
      const ok = await runScriptCommands(projectPost, this.project.basePath, macroVars, (l) => this.output.info(l), extraPath);
      if (!ok) {
        this.output.error('[Code::Blocks] 项目 post-build 脚本失败');
        return false;
      }
    }
    return true;
  }

  private linkCommandType(target: BuildTarget): CommandType {
    switch (target.targetType) {
      case TargetType.ConsoleOnly: return CommandType.LinkConsoleExeCmd;
      case TargetType.DynamicLib: return CommandType.LinkDynamicCmd;
      case TargetType.Native: return CommandType.LinkNativeCmd;
      case TargetType.StaticLib: return CommandType.LinkStaticCmd;
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
    let srcStat: fs.Stats;
    let objStat: fs.Stats;
    try {
      srcStat = fs.statSync(sourceFile);
    } catch {
      // 源文件不存在：跳过编译（对齐 IsObjectOutdated：!timeSrc 且文件不存在 → 不编译）
      return true;
    }
    try {
      objStat = fs.statSync(objectFile);
    } catch {
      // 对象文件不存在 → 需要编译
      return false;
    }
    if (objStat.mtimeMs < srcStat.mtimeMs) return false; // 源文件比对象新 → 需编译
    // skip_include_deps：跳过 include 依赖扫描（对齐 CodeBlocks /skip_include_deps 设置）
    if (vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.skipIncludeDeps', false)) {
      return true;
    }
    // 扫描 #include 依赖，头文件更新也触发重编译（对应 depsScanForHeaders + depsGetNewest）
    const newestDep = this.depsNewestMtime(sourceFile, includeDirs, depsCache);
    return newestDep <= objStat.mtimeMs;
  }

  /**
   * 解析目标实际输出文件路径。
   * Windows 下 MinGW 链接器会为无扩展名的 `-o` 输出自动追加 `.exe`
   * （如 .cbp 的 output="bin/Debug/hello"，实际产出 bin/Debug/hello.exe），
   * 因此时间戳判断需先解析出真实存在的文件。
   */
  private resolveOutputFile(target: BuildTarget): string {
    // 静态库实际输出带 lib 前缀 + .a（computeStaticOutput），而非原始 outputFilename
    if (target.targetType === TargetType.StaticLib) {
      return path.join(this.project.basePath, computeStaticOutput(target.outputFilename, this.compiler.switches));
    }
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
    // 盘符归一化（e:\ → E:\），让同一文件以不同大小写盘符访问时命中同一缓存条目
    const key = upperDrive(path.resolve(fileAbs));
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const inProg = inProgress ?? new Set<string>();
    if (inProg.has(key)) return 0; // 循环 include，中断递归
    inProg.add(key);

    let newest = 0;
    for (const resolved of this.scanIncludes(key, includeDirs)) {
      try {
        newest = Math.max(newest, fs.statSync(resolved).mtimeMs);
      } catch {
        continue;
      }
      newest = Math.max(newest, this.depsNewestMtime(resolved, includeDirs, cache, inProg));
    }
    inProg.delete(key);
    cache.set(key, newest);
    return newest;
  }

  /**
   * 扫描源文件的 #include 依赖列表。
   * 跨构建持久化缓存：源文件 mtime 与 include 搜索目录均未变时直接复用，避免每次构建重复读文件。
   */
  private scanIncludes(fileAbs: string, includeDirs: string[]): string[] {
    let srcStat: fs.Stats;
    try {
      srcStat = fs.statSync(fileAbs);
    } catch {
      return [];
    }
    const srcMtimeMs = srcStat.mtimeMs;
    const srcSize = srcStat.size;
    const norm = (d: string): string => (process.platform === 'win32' ? d.toLowerCase() : d);
    const dirsKey = includeDirs
      .map((d) => (path.isAbsolute(d) ? path.normalize(d) : path.join(this.project.basePath, d)))
      .map(norm)
      .join('|');
    const entry = depsIncludeCache.get(fileAbs);
    if (entry && entry.srcMtimeMs === srcMtimeMs && entry.srcSize === srcSize && entry.dirsKey === dirsKey) {
      return entry.includes;
    }
    const includes: string[] = [];
    try {
      const raw = fs.readFileSync(fileAbs, 'utf-8');
      // 剥离注释与字符串后再匹配（注释里的 #include 不计依赖；字符串内的 # 不是预处理指令）
      const content = this.stripCommentsAndStrings(raw);
      // 同时匹配双引号与尖括号 include
      const re = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const quoted = m[1];
        const angled = m[2];
        const resolved = this.resolveInclude(quoted ?? angled, fileAbs, includeDirs, quoted === undefined);
        if (resolved) includes.push(resolved);
      }
    } catch {
      // 文件读取失败（如二进制/无权限），忽略其依赖
    }
    depsIncludeCache.set(fileAbs, { srcMtimeMs, srcSize, dirsKey, includes });
    return includes;
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

  /**
   * 剥离 C 源码中的注释与字符串/字符常量，供 #include 扫描使用：
   * 1. 块注释全局剥离（保留换行，跨行）；
   * 2. #include 行原样保留（引号内是头文件名，不能剥字符串）；
   * 3. 其余行先剥字符串/字符常量（避免字符串里的 # 或 // 被误认）再截行注释。
   */
  private stripCommentsAndStrings(src: string): string {
    // 1. 块注释 → 等宽空格（保留换行）
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = noBlock.split('\n');
    const out: string[] = [];
    for (const rawLine of lines) {
      if (/^\s*#\s*include\b/.test(rawLine)) {
        // #include 行：保留（引号内容即头文件名），仅截行注释
        out.push(rawLine.replace(/\/\/.*$/, ''));
        continue;
      }
      // 其它行：先剥字符串/字符常量，再截行注释
      out.push(this.stripStrings(rawLine).replace(/\/\/.*$/, ''));
    }
    return out.join('\n');
  }

  /** 剥离单行中的字符串/字符常量（替换为等宽空格，处理转义引号） */
  private stripStrings(line: string): string {
    let out = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === '"' || c === "'") {
        const q = c;
        out += ' ';
        i++;
        while (i < line.length && line[i] !== q) {
          if (line[i] === '\\') i++; // 跳过转义字符
          i++;
        }
        i++;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  /**
   * 删除目标的构建产物 —— 对齐 GetTargetCleanCommands（directcommands.cpp:955-1000）：
   * 逐个删除对象文件与输出文件（不删目录，避免误删 obj 目录里用户自放的文件）。
   * 供 rebuild（先 Clean 再 Build）与 Clean 命令复用。
   */
  cleanTarget(target: BuildTarget): void {
    let removed = 0;
    const files = target.files.length ? target.files : this.project.files;
    for (const file of files) {
      if (file.compile === false) continue;
      if (!file.buildTargets.includes(target.title) && file.buildTargets.length > 0) continue;
      const objAbs = this.objectPathFor(target, file);
      if (this.removeFileIfExists(objAbs)) {
        removed++;
        // 详细输出：逐文件删除列表（对齐 Code::Blocks Clean 逐条删除命令）
        if (this.verboseOutput()) {
          this.output.info(`[Clean] ${path.relative(this.project.basePath, objAbs)}`);
        }
      }
      // 自动生成文件：同时删除本体（对齐 GetTargetCleanCommands：if (pf->AutoGeneratedBy()) ret.Add(pf->file.GetFullPath())）
      if (file.autoGeneratedBy) {
        if (this.removeFileIfExists(file.absolutePath)) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, file.absolutePath)}`);
          }
        }
      }
    }
    // 输出文件（含 Windows 无扩展名输出自动追加的 .exe 变体）
    if (target.outputFilename) {
      const out = this.resolveOutputFile(target);
      if (this.removeFileIfExists(out)) {
        removed++;
        if (this.verboseOutput()) {
          this.output.info(`[Clean] ${path.relative(this.project.basePath, out)}`);
        }
      }
      if (process.platform === 'win32' && !out.toLowerCase().endsWith('.exe')) {
        if (this.removeFileIfExists(out + '.exe')) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, out + '.exe')}`);
          }
        }
      }
    }
    this.output.info(`[Code::Blocks] 清理完成 目标 "${target.title}": 删除 ${removed} 个文件`);
  }

  /** 删除存在的文件，返回是否真的删除了 */
  private removeFileIfExists(p: string): boolean {
    try {
      if (!p || !fs.existsSync(p)) return false;
      fs.rmSync(p, { force: true });
      return true;
    } catch (e) {
      this.output.error(`[Code::Blocks] 删除失败: ${p}: ${(e as Error).message}`);
      return false;
    }
  }

  /** 详细输出开关（codeblocks.build.verboseOutput，默认 false） */
  private verboseOutput(): boolean {
    return vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.verboseOutput', false);
  }

  /** 对象文件的绝对路径（增量判断用） */
  private objectPathFor(target: BuildTarget, file: ProjectFile): string {
    return path.join(this.project.basePath, this.objectPathRelative(target, file));
  }

  /**
   * 相对项目根的对象路径（命令行用，对齐 pfDetails::Update + GetObjName 命名规则）：
   * - 普通源文件：objDir + <相对路径> + name.o（UseFlatObjects 时只有文件名）
   * - 资源文件 .rc：name.res（FileFilters::RESOURCEBIN_EXT）
   * - PCH 头文件：<原名>.<gch>（保留 .h），pch_mode=2 放源文件旁、否则放 obj 目录
   */
  private objectPathRelative(target: BuildTarget, file: ProjectFile): string {
    // 生成器文件的对象 = 第一个生成文件的对象（对齐 pfDetails::Update:468-472）
    if ((file.generatedFiles?.length ?? 0) > 0) {
      const first = this.project.files.find((f) => f.relativeFilename === file.generatedFiles[0]);
      if (first) return this.objectPathRelative(target, first);
    }
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Header && this.compiler.switches.supportsPCH) {
      return this.pchObjectRelative(target, file);
    }
    const objDir = target.objectOutput || 'obj';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    const parsed = path.parse(rel);
    const ext = ft === FileType.Resource ? 'res' : this.compiler.switches.objectExtension;
    const flat = this.compiler.switches.useFlatObjects;
    // extended_obj_names：保留原扩展名再追加（foo.c → foo.c.o，projectfile.cpp SetObjName）
    const name = this.project.extendedObjNames
      ? path.basename(rel) + '.' + ext
      : parsed.name + '.' + ext;
    return path.join(objDir, flat ? '' : path.dirname(rel), name);
  }

  /** PCH 头文件对象路径（对齐 projectfile.cpp:229-243 GetObjName + 410-459 pfDetails::Update） */
  private pchObjectRelative(target: BuildTarget, file: ProjectFile): string {
    const gch = this.compiler.switches.PCHExtension || 'gch';
    if (this.project.pchMode === 2) {
      // pchSourceFile：源文件旁（项目相对原路径 + .gch），不进 obj 目录
      return toUnix(file.relativeFilename) + '.' + gch;
    }
    if (this.project.pchMode === 0) {
      // pchSourceDir：<源文件目录>/<原名>.<gch>/<target>_<扁平化名字>（projectfile.cpp:414-431）
      const src = toUnix(file.relativeFilename);
      const dir = path.dirname(src);
      const fullName = path.basename(src);
      const inner = (target.title + '_' + (file.relativeToCommonTopLevelPath || file.relativeFilename))
        .replace(/[/\\]/g, '_')
        .replace(/\./g, '_');
      return path.join(dir, fullName + '.' + gch, inner);
    }
    // pchObjectDir（默认）：obj 目录 + <原名>.gch（如 include/all.h.gch）
    const objDir = target.objectOutput || 'obj';
    const rel = toUnix(file.relativeToCommonTopLevelPath || file.relativeFilename);
    return path.join(objDir, rel + '.' + gch);
  }

  /** 链接对象相对路径：项目内直接加入的 .o/.a 用原路径（对齐 pfDetails::Update ftObject/ftStaticLib） */
  private linkObjectRelative(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) return file.relativeFilename;
    return this.objectPathRelative(target, file);
  }

  /** 链接对象绝对路径（增量判断用） */
  private linkObjectAbs(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) {
      return path.isAbsolute(file.relativeFilename)
        ? file.relativeFilename
        : path.join(this.project.basePath, file.relativeFilename);
    }
    return this.objectPathFor(target, file);
  }

  /** 对象扩展名：头文件（PCH）用 .gch，其余用 .o（对齐 projectfile.cpp:245 SetExt(PCHExtension)） */
  private objectExtensionFor(file: ProjectFile): string {
    return fileTypeOf(file.relativeFilename) === FileType.Header
      ? this.compiler.switches.PCHExtension
      : this.compiler.switches.objectExtension;
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
    // 对齐 pfDetails::Update：depsOut（默认 .deps，GetDepsOutput）+ <对象名>.depend
    const depsOut = target.depsOutput || '.deps';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    const name = path.parse(rel).name;
    // 与对象路径一致（含目录），避免不同目录同名文件（a/foo.c、b/foo.c）的 deps 互相覆盖
    return path.join(this.project.basePath, depsOut, path.dirname(rel), name + '.depend');
  }

  private maxJobs(): number {
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    const n = cfg.get<number>('parallelJobs', 0);
    if (n && n > 0) return n;
    // 默认 CPU 数（对齐 CodeBlocks processCount 默认值，无上限）
    return Math.max(1, os.cpus().length || 2);
  }

  private async runInParallel(units: CompileUnit[], maxJobs: number, options: BuildOptions, totalCount: number): Promise<boolean[]> {
    const results: boolean[] = new Array(units.length).fill(false);
    // 按 weight 分组执行：同 weight 并行，跨 weight 串行（对齐 GetCompileCommands 的 COMPILER_WAIT 屏障）
    let groupStart = 0;
    while (groupStart < units.length) {
      let groupEnd = groupStart + 1;
      const w = units[groupStart].file.weight;
      while (groupEnd < units.length && units[groupEnd].file.weight === w) groupEnd++;

      // 组内 PCH 头文件先于其它文件编译（COMPILER_WAIT 屏障语义）
      const group = units.slice(groupStart, groupEnd);
      const pchIdx = group.map((u, i) => (u.isPch ? i : -1)).filter((i) => i >= 0);
      const normalIdx = group.map((u, i) => (!u.isPch ? i : -1)).filter((i) => i >= 0);
      await this.runGroupSubset(group, pchIdx, groupStart, maxJobs, options, results, totalCount);
      await this.runGroupSubset(group, normalIdx, groupStart, maxJobs, options, results, totalCount);

      groupStart = groupEnd;
    }
    return results;
  }

  /** 编译一组单元（按 maxJobs 并行），结果写回全局 results（baseGlobalIdx + 组内下标） */
  private async runGroupSubset(
    group: CompileUnit[], localIdx: number[], baseGlobalIdx: number,
    maxJobs: number, options: BuildOptions, results: boolean[], totalCount: number,
  ): Promise<void> {
    if (!localIdx.length) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(maxJobs, localIdx.length) }, async () => {
      while (cursor < localIdx.length) {
        const pos = cursor++;
        const li = localIdx[pos];
        const u = group[li];
        const startMs = Date.now();
        const ok = await this.runCommand(u.command, u.cwd, options);
        const elapsedMs = Date.now() - startMs;
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        // 详细输出：完整编译命令行（对齐 Code::Blocks clogFull 模式）
        if (this.verboseOutput()) {
          this.output.info(u.command);
        } else {
          this.output.debug(u.command);
        }
        // 单行完成式：无交错、含进度序号与耗时（序号用连字符避免 Output 面板误判为路径链接）
        const idx = baseGlobalIdx + li + 1;
        if (ok) {
          this.output.info(`✓ [Compiled] ${idx}-${totalCount} ${u.file.relativeFilename} (${elapsedSec}s)`);
        } else {
          this.output.error(`✗ [Failed] ${idx}-${totalCount} ${u.file.relativeFilename} (${elapsedSec}s)`);
        }
        this.compileTimings.push({ file: u.file.relativeFilename, ms: elapsedMs });
        results[baseGlobalIdx + li] = ok;
      }
    });
    await Promise.all(workers);
  }

  private async runCommand(command: string, cwd: string, options: BuildOptions): Promise<boolean> {
    // 多行命令（模板含 \n）逐条执行，对齐 Code::Blocks AddCommandsToArray
    const lines = command.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return this.runSingleCommand(command, cwd, options);
    }
    let ok = true;
    for (const line of lines) {
      if (!(await this.runSingleCommand(line, cwd, options))) ok = false;
    }
    return ok;
  }

  private async runSingleCommand(command: string, cwd: string, options: BuildOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const resp = applyResponseFile(command);
      if (resp.respFile) {
        this.output.debug(`[Code::Blocks] 命令行过长，改用响应文件: ${resp.respFile}`);
      }
      command = resp.command;
      const proc = spawn(command, {
        cwd: upperDrive(cwd),
        shell: true,
        // PATH 前置编译器 bin 目录（对齐 CodeBlocks Init 的 PATH 重构），仅 win32 时已由 build() 计算
        env: this.buildEnv,
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
