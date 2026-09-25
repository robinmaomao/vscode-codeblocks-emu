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
import { Project, BuildTarget, ProjectFile, TargetType, CommandType, CompilerLineType, supportsCurrentPlatform } from '../model/types';
import { FileType, fileTypeOf, isCompilableFileType, isLinkableFileType, isCppSource, isClangdIndexable } from '../model/fileTypes';
import { Compiler } from '../compiler/compiler';
import { CommandGenerator, computeStaticOutput, quoteIfNeeded, clearBackticksCache } from '../compiler/commandGenerator';
import { OutputParser } from './outputParser';
import { runScriptCommands } from './scriptRunner';
import { replaceCbMacros, cbBuiltinVars } from '../compiler/cbMacros';
import { BuildCancelHandle } from './cancelToken';
import { decodeText } from '../tools/encoding';
import { applyResponseFile, compareFilesByWeight } from './commandLine';
import { upperDrive, shortPathWin } from '../tools/pathCase';
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
  /** 取消句柄（null 时不支持取消；提供后各检查点查询 + 活动子进程注册强杀） */
  cancel?: BuildCancelHandle;
}

/** 单次构建目标级统计（供 Build Log 视图展示） */
export interface BuildTargetStats {
  success: boolean;       // 本目标构建是否成功（含编译/链接/脚本）
  compiledCount: number;  // 本次实际编译的文件数
  skippedCount: number;   // 增量跳过数
  failedCount: number;    // 编译失败文件数
  linkSuccess: boolean;
  linkSkipped: boolean;   // static lib 无链接步骤
  /** 构建是否被用户取消（取消 ≠ 失败：failedCount 不计被强杀的编译进程） */
  cancelled?: boolean;
  /** 本目标是否产生了实际命令（编译/链接/打包；对齐状态机 bsTargetBuild 的 hasCommands，门控项目 post-build） */
  hadCommands: boolean;
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
  /** 响应文件基础路径（对齐 CheckForToLongCommandLine 命名：对象目录/源文件名） */
  respBase?: string;
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
    private resolveCompiler?: (id: string) => Compiler | undefined,
  ) {
    // 使用编译器 XML 加载的正则；若为空则回退内置正则
    this.parser = new OutputParser(compiler.regexes.length ? compiler.regexes : undefined);
  }

  /**
   * 切换到目标声明编译器 —— 对齐 directcommands 各处 CompilerFactory::GetCompiler(target->GetCompilerID())
   * （593/634/722/965/1011/1167：模板/开关/程序/错误正则全套按目标切换）
   */
  private switchCompiler(target: BuildTarget): void {
    if (!this.resolveCompiler) return;
    const c = this.resolveCompiler(target.compilerId || this.project.compilerId);
    if (!c || c === this.compiler) return;
    this.compiler = c;
    // 错误/警告正则随编译器切换（对齐 CB 按 job 编译器 ParseOutput）
    this.parser = new OutputParser(c.regexes.length ? c.regexes : undefined);
  }

  /** 编译器是否可用 —— 对齐 Compiler::IsValid（compiler.cpp:191-231）：masterPath 设置时检查 C 程序存在性（bin/ 或根目录），未设置视为 PATH 查找 */
  private isCompilerUsable(c: Compiler): boolean {
    if (!c.programs.C) return false;
    if (!c.masterPath) return true;
    if (path.isAbsolute(c.programs.C)) return fs.existsSync(c.programs.C);
    return fs.existsSync(path.join(c.masterPath, 'bin', c.programs.C)) || fs.existsSync(path.join(c.masterPath, c.programs.C));
  }

  /** CommandsOnly 目标是否编译其文件（设置 codeblocks.build.compileCommandsOnlyTargets；默认 false 保持扩展原行为，true 对齐 CB 的空存根编译） */
  private compileCommandsOnlyTargets(): boolean {
    try {
      return vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.compileCommandsOnlyTargets', false) === true;
    } catch {
      return false;
    }
  }

  /**
   * 构建/清理 Banner —— 对齐 PrintBanner（compilergcc.cpp:1786-1830）：
   * "-------------- <Action>: <target> in <project> (compiler: <name>)---------------"（左 14 连字符+空格，右 15 连字符）。
   */
  private printBanner(action: 'Build' | 'Clean' | 'Build file', target: BuildTarget): void {
    this.output.info('');
    this.output.info(
      `-------------- ${action}: ${target.title} in ${this.project.title} (compiler: ${this.compiler.name})---------------`,
    );
    this.output.info(`  编译器程序: ${this.compiler.programs.C}`);
  }

  /** 构建主循环 —— 对应 GetCompileCommands + GetTargetLinkCommands；项目级 pre/post 在目标循环外各执行一次（对齐状态机 bsProjectPreBuild/bsProjectPostBuild） */
  async build(targetTitle?: string | string[], options: BuildOptions = {}): Promise<boolean> {
    // 对齐 Build()/Rebuild()/BuildWorkspace()：每轮构建清空反引号缓存（cbClearBackticksCache，Clean 单命令不清）
    clearBackticksCache();

    // 编译/链接子进程 PATH 注入：编译器 bin 目录前置 + 实时系统 PATH（对齐 CodeBlocks Init 的 PATH 重构）
    if (process.platform === 'win32') {
      const extraPath = this.compilerBinPath();
      const merged = [extraPath, getWindowsSystemPath(), process.env.PATH ?? ''].filter(Boolean).join(';');
      this.buildEnv = { ...(process.env as NodeJS.ProcessEnv), PATH: merged };
    }

    // 无目标标题：只构建纳入 All 的目标（对齐 GetCompileCommands(target=null) 的 includeInTargetAll 过滤）
    const titles = targetTitle ? (Array.isArray(targetTitle) ? targetTitle : [targetTitle]) : undefined;
    let targets = titles
      ? this.project.buildTargets.filter((t) => titles.includes(t.title))
      : this.project.buildTargets.filter((t) => t.includeInTargetAll !== false);
    // 没有任何目标纳入 All 时回退构建全部（防御，避免 Build 无动作）
    if (!titles && targets.length === 0) {
      targets = this.project.buildTargets;
    }

    // 平台过滤（对齐 compilergcc.cpp:2749：不支持当前平台的目标不构建）
    targets = targets.filter((t) => supportsCurrentPlatform(t.platforms));

    // 无效编译器过滤（对齐 PreprocessJob:2759-2764 CompilerValid + PrintInvalidCompiler）：
    // 编译器 ID 未注册或 masterPath 指向的编译器程序缺失 → 报错并跳过该目标
    targets = targets.filter((t) => {
      const id = t.compilerId || this.project.compilerId;
      const c = this.resolveCompiler ? this.resolveCompiler(id) : this.compiler;
      if (c === undefined || !this.isCompilerUsable(c)) {
        this.output.error(
          `Project/Target: "${this.project.title} - ${t.title}":\n` +
          `  The compiler's setup (${id || 'unknown'}) is invalid, so Code::Blocks cannot find/run the compiler.\n` +
          `  Skipping...`,
        );
        return false;
      }
      return true;
    });

    if (targets.length === 0) {
      vscode.window.showWarningMessage('没有可构建的目标');
      return false;
    }

    // 项目级 pre-build（bsProjectPreBuild）：目标循环前执行一次；
    // 宏按第一个目标上下文展开（对齐 GetPreBuildCommands(0) 用 GetCurrentlyCompilingTarget()）
    if (this.project.commandsBeforeBuild.length) {
      const first = targets[0];
      this.switchCompiler(first);
      this.output.info('[Code::Blocks] 执行项目 pre-build 脚本...');
      const preOk = await runScriptCommands(
        this.project.commandsBeforeBuild.map((c) => this.expandScriptMacros(first, c)),
        this.project.basePath,
        this.targetMacroVars(first),
        (l) => this.output.info(l),
        this.compilerBinPath(),
        options.cancel,
      );
      if (options.cancel?.isCancelled()) {
        this.lastStats = { success: false, cancelled: true, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false };
        return false;
      }
      if (!preOk) {
        this.output.error('[Code::Blocks] 项目 pre-build 脚本失败');
        this.lastStats = { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false };
        return false;
      }
    }

    // 累计各目标的统计结果（供 Build Log 视图）
    let compiledCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let linkSuccess = true;
    let linkSkipped = true;
    let outputFilename: string | undefined;

    let ok = true;
    let cancelled = false;
    let lastHadCommands = false;
    for (const target of targets) {
      // 取消检查点：目标之间（多目标 / 工作区多项目构建）
      if (options.cancel?.isCancelled()) {
        cancelled = true;
        break;
      }
      // 构建 Banner —— 对齐 PrintBanner（bsTargetPreBuild，每个目标构建前打印；位于项目 pre-build 之后）；
      // 编译器显示名按目标编译器（对齐 GetCompiler(target->GetCompilerID())）
      this.switchCompiler(target);
      this.printBanner('Build', target);
      const result = await this.buildTarget(target, options);
      // 无论成功失败都累加统计（失败时统计已累计的部分）
      lastHadCommands = result.hadCommands;
      compiledCount += result.compiledCount;
      skippedCount += result.skippedCount;
      failedCount += result.failedCount;
      linkSuccess = linkSuccess && result.linkSuccess;
      linkSkipped = linkSkipped && result.linkSkipped;
      if (result.outputFilename) outputFilename = result.outputFilename;
      if (result.cancelled) {
        cancelled = true;
        break;
      }
      if (!result.success) {
        ok = false;
        break;
      }
    }

    // 项目级 post-build（bsProjectPostBuild）：全部目标成功后执行一次（最后一个目标上下文展开）；
    // 门控对齐状态机：m_RunProjectPostBuild = 最后一个目标 hasCommands，除非项目级 alwaysRunPostBuildSteps
    if (ok && !cancelled && this.project.commandsAfterBuild.length && (lastHadCommands || this.project.alwaysRunPostBuildSteps)) {
      const last = targets[targets.length - 1];
      this.switchCompiler(last);
      this.output.info('[Code::Blocks] 执行项目 post-build 脚本...');
      const postOk = await runScriptCommands(
        this.project.commandsAfterBuild.map((c) => this.expandScriptMacros(last, c)),
        this.project.basePath,
        this.targetMacroVars(last),
        (l) => this.output.info(l),
        this.compilerBinPath(),
        options.cancel,
      );
      if (options.cancel?.isCancelled()) {
        cancelled = true;
      } else if (!postOk) {
        this.output.error('[Code::Blocks] 项目 post-build 脚本失败');
        ok = false;
      }
    }

    this.lastStats = { success: ok, cancelled, compiledCount, skippedCount, failedCount, linkSuccess, linkSkipped, hadCommands: lastHadCommands, outputFilename };
    return ok;
  }

  /** 目标宏变量（内置全集 + 项目自定义变量，对齐 macrosmanager RecalcVars + cbProject SetVariable） */
  private targetMacroVars(target: BuildTarget): Record<string, string> {
    const vars = cbBuiltinVars(this.project.basePath, target.outputFilename, target.title, target.objectOutput, this.project.title, this.project.filename, this.compiler.masterPath);
    return { ...vars, ...this.project.customVariables };
  }

  /** 展开 pre/post 命令中的编译宏（$compiler/$options/$includes 等），对齐 GenerateCommandLine */
  private expandScriptMacros(target: BuildTarget, cmd: string): string {
    const generator = new CommandGenerator(this.project, this.compiler);
    return generator.generateFromTemplate(cmd, { target, pf: null, file: '', object: '', flatObject: '', deps: '' });
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

    const entries: { directory: string; command: string; file: string }[] = [];

    for (const target of targets) {
      // 平台过滤（对齐 GenerateCommandLine:238：目标不支持当前平台 → 不生成编译命令）
      if (!supportsCurrentPlatform(target.platforms)) continue;
      // CommandsOnly 目标默认不编译（开关关闭时同样不生成 clangd 条目）
      if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) continue;
      // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())）
      this.switchCompiler(target);
      const generator = new CommandGenerator(this.project, this.compiler);
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
          flatObject: this.objectPathRelativeFlat(target, file),
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

  /**
   * 构造单个文件的编译单元 —— 对齐 GetCompileFileCommand（directcommands.cpp:262）。
   * 整目标构建（1b 循环）与单文件编译（compileFile）复用本方法，保证两条路径产出的命令字节级一致。
   * - compile=false / compilerVar 为空由调用方先行过滤；
   * - not-compilable：非自定义命令、非可编译类型、非 PCH 头文件、非生成器文件；
   * - no-command：命令展开后为空/纯空白（工具未匹配/程序缺失）。
   */
  private makeCompileUnit(
    target: BuildTarget,
    file: ProjectFile,
    generator: CommandGenerator,
    hasCpp: boolean,
  ): { unit?: CompileUnit; reason: 'ok' | 'not-compilable' | 'no-command' } {
    const custom = file.customBuildCommands?.[target.compilerId];
    const isCustom = custom !== undefined && custom.use;
    const ft = fileTypeOf(file.relativeFilename);
    const isHeader = ft === FileType.Header;
    const hasGenerated = (file.generatedFiles?.length ?? 0) > 0;
    // 自定义命令文件（ram.ld/app.xm 等）或可编译类型（源文件/资源文件）才编译；
    // 头文件在编译器 supportsPCH 时也编译为 .gch（对齐 GetCompileFileCommand 的 is_header && supportsPCH）；
    // 生成器文件（编译器工具 gen 属性声明生成文件）也编译（对齐 AddFile localCompile 的 !GenFilesHackMap.empty()）
    if (!isCustom && !isCompilableFileType(ft) && !(isHeader && this.compiler.switches.supportsPCH) && !hasGenerated) {
      return { reason: 'not-compilable' };
    }

    // 绝对对象路径用于增量判断/响应文件基础名，相对对象路径用于命令行（避免含空格路径）
    const objectRel = this.objectPathRelative(target, file);
    const object = this.objectPathFor(target, file);
    const deps = this.depsPathFor(target, file);

    let command: string;
    if (isCustom) {
      // 自定义编译命令：直接展开 $compiler/$file 等内置宏 + $(...) 变量
      command = this.expandCustomCommand(custom.command, generator, target, file, objectRel);
    } else {
      // 源文件路径（对齐 GetCompileFileCommand：UseFullSourcePaths 时绝对路径（资源文件再转短路径），否则相对路径）
      const srcFile = this.compiler.switches.useFullSourcePaths
        ? (ft === FileType.Resource && process.platform === 'win32'
            ? shortPathWin(file.absolutePath)
            : file.absolutePath)
        : file.relativeFilename;
      // 资源文件走 CompileResourceCmd（windres），其余走 CompileObjectCmd（对齐 GetCompileFileCommand）
      const cmdType = ft === FileType.Resource ? CommandType.CompileResourceCmd : CommandType.CompileObjectCmd;
      command = generator.generate(cmdType, {
        target,
        pf: file,
        file: srcFile,
        object: objectRel,
        // flatObject 恒为扁平命名（对齐 pfd.object_file_flat，与 useFlatObjects 无关）
        flatObject: this.objectPathRelativeFlat(target, file),
        deps,
        hasCppFilesToLink: hasCpp,
      });
    }
    // PCH 头文件：编译前删除旧 .gch（对齐 directcommands.cpp 的 wxRemoveFile，避免陈旧产物）
    if (isHeader) {
      command = `cmd /c if exist "${objectRel}" del "${objectRel}"\n${command}`;
    }
    // 对齐 AddCommandsToArray：展开后为空/纯空白的命令（如 buildCommand=" " 的 no-op）不执行
    if (!command || command.trim() === '') {
      return { reason: 'no-command' };
    }
    return {
      reason: 'ok',
      unit: {
        target,
        file,
        command,
        cwd: this.project.basePath,
        isPch: isHeader,
        // 响应文件基础名对齐 CheckForToLongCommandLine：对象目录 + 源文件名（含扩展）→ <对象目录>/<源文件名>.respFile
        respBase: path.join(path.dirname(object), path.basename(file.relativeFilename)),
      },
    };
  }

  /**
   * 单文件编译 —— 对齐 directcommands.cpp CompileFile：只编译指定源文件
   * （自定义 buildCommand 文件同样支持；增量判断与整目标构建一致）。返回是否成功。
   */
  async compileFile(targetTitle: string, fileRel: string, options: BuildOptions): Promise<boolean> {
    const target = this.project.buildTargets.find((t) => t.title === targetTitle);
    if (!target) {
      this.output.error(`[Code::Blocks] 未找到构建目标: ${targetTitle}`);
      return false;
    }
    // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())）
    this.switchCompiler(target);
    const files = target.files.length ? target.files : this.project.files;
    const file = files.find((f) => f.relativeFilename === fileRel);
    if (!file) {
      this.output.error(`[Code::Blocks] 文件不在目标 "${targetTitle}" 中: ${fileRel}`);
      return false;
    }
    // 对齐 GetBuildTargetForFile（compilergcc.cpp:3119-3145）：文件未归属当前目标（或未归属任何目标）→ 拒绝
    if (!file.buildTargets.includes(targetTitle)) {
      this.output.error(`[Code::Blocks] error: Cannot find target for file: ${fileRel}`);
      return false;
    }
    // CommandsOnly 目标默认不编译文件（对齐扩展默认行为；开启 codeblocks.build.compileCommandsOnlyTargets 时按 CB 空存根编译）
    if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) {
      this.output.warn(`[Code::Blocks] CommandsOnly 目标 "${targetTitle}" 默认不编译文件（可开启设置 codeblocks.build.compileCommandsOnlyTargets 对齐 CB）`);
      return false;
    }
    // 单文件编译 Banner —— 对齐 PrintBanner(baBuildFile)（CompileFile:3156）
    this.printBanner('Build file', target);
    if (file.compile === false) {
      this.output.warn(`[Code::Blocks] 文件被排除编译（compile="0"），跳过: ${fileRel}`);
      return false;
    }
    if (!file.compilerVar) {
      this.output.warn(`[Code::Blocks] Cannot resolve compiler var for project file: ${fileRel}`);
      return false;
    }

    const generator = new CommandGenerator(this.project, this.compiler);
    const hasCpp = files.some((f) => isCppSource(f.relativeFilename));
    const made = this.makeCompileUnit(target, file, generator, hasCpp);
    if (made.reason === 'not-compilable') {
      this.output.info(`[Code::Blocks] 跳过（非可编译文件）: ${fileRel}`);
      return false;
    }
    if (made.reason === 'no-command') {
      this.output.warn(`[Code::Blocks] Skipping file (no compiler program set): ${fileRel}`);
      return false;
    }
    const unit = made.unit!;

    // 增量判断（对齐 CompileFile 的 IsObjectOutdated 前置检查；deps 目录用关系合并后的有序目录，对齐 DepsSearchStart）
    const object = this.objectPathFor(target, file);
    if (!options.rebuild && this.isUpToDate(file.absolutePath, object, this.getIncludeDirs(target, generator), new Map())) {
      this.output.info(`[Code::Blocks] ${fileRel} 已是最新`);
      return true;
    }

    // 对象父目录缺失则创建（对齐 CompileFile 的 CreateDirRecursively）
    const objectDir = path.dirname(object);
    if (objectDir && !this.ensureDir(objectDir, 'debug')) {
      this.output.error(`[Code::Blocks] 创建对象目录失败: ${objectDir}`);
      return false;
    }

    this.output.info(`[Code::Blocks] 编译文件: ${fileRel}`);
    if (this.verboseOutput()) {
      this.output.info(unit.command);
    }
    return this.runSingleCommand(unit.command, unit.cwd, options, unit.respBase);
  }

  /**
   * 单文件清理 —— 对齐 CB 25.03 OnCleanFile（compilergcc.cpp:3275-3312）：只删除对象文件。
   * （GetCleanSingleFileCommand 在 25.03 中无调用方；.depend 仅全量 Clean 删除）
   */
  cleanFile(targetTitle: string, fileRel: string): void {
    const target = this.project.buildTargets.find((t) => t.title === targetTitle);
    if (!target) return;
    // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())）
    this.switchCompiler(target);
    const files = target.files.length ? target.files : this.project.files;
    const file = files.find((f) => f.relativeFilename === fileRel);
    if (!file) return;
    // 对齐 GetBuildTargetForFile：文件未归属当前目标（或未归属任何目标）→ 静默跳过
    if (!file.buildTargets.includes(targetTitle)) return;
    if (!file.compilerVar) {
      this.output.warn(`[Code::Blocks] Cannot resolve compiler var for project file: ${fileRel}`);
      return;
    }
    const objectRel = this.objectPathRelative(target, file);
    if (objectRel && objectRel !== fileRel) {
      const objAbs = this.objectPathFor(target, file);
      if (this.removeFileIfExists(objAbs)) {
        this.output.info(`[Code::Blocks] Deleted: ${objectRel}`);
      } else {
        this.output.debug(`[Code::Blocks] 无对象文件可清理: ${fileRel}`);
      }
    } else {
      this.output.debug(`[Code::Blocks] 无对象文件可清理: ${fileRel}`);
    }
  }

  /**
   * 构造「已取消」统计对象 —— 取消不是失败：
   * failedCount 不计被强杀的编译进程，success=false 但 cancelled=true 供上层区分。
   */
  private cancelledStats(target: BuildTarget, compiledCount: number, skippedCount: number): BuildTargetStats {
    return {
      success: false,
      cancelled: true,
      compiledCount,
      skippedCount,
      failedCount: 0,
      linkSuccess: false,
      linkSkipped: target.targetType === TargetType.StaticLib,
      hadCommands: compiledCount > 0,
      outputFilename: target.outputFilename,
    };
  }

  /** 构建单个目标（始终返回统计对象，用 success 标记成败） */
  private async buildTarget(target: BuildTarget, options: BuildOptions): Promise<BuildTargetStats> {
    // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())；banner 已在 build() 切换，此处幂等）
    this.switchCompiler(target);
    // 本次目标构建的耗时记录（提前 return 路径也要清空，避免汇总显示上次构建的 Top3）
    this.compileTimings = [];
    this.lastCompileTimings = [];
    const macroVars = this.targetMacroVars(target);
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

    if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) {
      // 默认行为：仅执行目标级 pre/post build 命令（项目级在 build() 层各执行一次，对齐状态机 bsProjectPreBuild/bsProjectPostBuild）
      // （开启 codeblocks.build.compileCommandsOnlyTargets 时对齐 CB：照常编译文件，命令不带选项/include）
      const runAndCheck = async (cmds: string[], phase: 'pre' | 'post'): Promise<boolean | undefined> => {
        if (!cmds.length) return true;
        this.output.info(`[Code::Blocks] 执行目标 ${phase}-build 脚本 (${target.title})...`);
        const r = await runScriptCommands(cmds, this.project.basePath, macroVars, (l) => this.output.info(l), this.compilerBinPath(), options.cancel);
        if (r) return true;
        if (options.cancel?.isCancelled()) return undefined;
        this.output.error(`[Code::Blocks] 目标 "${target.title}" ${phase}-build 脚本失败`);
        return false;
      };
      const pre = target.commandsBeforeBuild.map(expandScriptMacros);
      const post = target.commandsAfterBuild.map(expandScriptMacros);
      const preR = await runAndCheck(pre, 'pre');
      if (preR === undefined) return this.cancelledStats(target, 0, 0);
      if (preR === false) {
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false, outputFilename: target.outputFilename };
      }
      const postR = await runAndCheck(post, 'post');
      if (postR === undefined) return this.cancelledStats(target, 0, 0);
      if (postR === false) {
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false, outputFilename: target.outputFilename };
      }
      // CommandsOnly 目标的「命令」= 目标级 post 命令（对齐 GetTargetLinkCommands ttCommandsOnly 分支把 post 命令作为链接命令产出）
      return { success: true, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: true, linkSkipped: true, hadCommands: target.commandsAfterBuild.length > 0 };
    }

    // 全量编译（rebuild）对齐 CodeBlocks Rebuild：先删除对象输出目录，再全量编译
    if (options.rebuild) {
      this.cleanTarget(target);
    }

    // 目标级 pre-build 脚本（项目级在 build() 层执行一次，对齐状态机）
    const preCommands = [...target.commandsBeforeBuild].map(expandScriptMacros);

    // 0. pre-build 脚本
    if (preCommands.length) {
      this.output.info(`[Code::Blocks] 执行目标 pre-build 脚本 (${target.title})...`);
      const preOk = await runScriptCommands(preCommands, this.project.basePath, macroVars, (l) => this.output.info(l), this.compilerBinPath(), options.cancel);
      if (!preOk) {
        // 取消优先判定（被强杀的脚本进程返回失败，但语义是取消）
        if (options.cancel?.isCancelled()) {
          return this.cancelledStats(target, 0, 0);
        }
        this.output.error(`[Code::Blocks] 目标 "${target.title}" pre-build 脚本失败`);
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: target.targetType === TargetType.StaticLib, hadCommands: false, outputFilename: target.outputFilename };
      }
    }

    // 1. 编译所有文件（增量：跳过未变更文件）
    const units: CompileUnit[] = [];
    const files = target.files.length ? target.files : this.project.files;
    // 按 weight 排序（对齐 GetProjectFilesSortedByWeight：weight 升序，同 weight 按文件名）
    const sortedFiles = [...files].sort(compareFilesByWeight);
    const hasCpp = sortedFiles.some((f) => isCppSource(f.relativeFilename));

    // 头文件依赖扫描（增量编译）：目录集 = 关系合并后的有序 include 目录 + 反引号派生目录（对齐 DepsSearchStart），
    // 再逐个展开宏（含项目自定义变量，对齐 depsAddSearchDir 前的 ReplaceMacros）
    const includeDirs = this.getIncludeDirs(target, generator).map((d) =>
      replaceCbMacros(d, { vars: macroVars, customVars: this.project.customVariables ?? {} }),
    );
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
      const ftL = fileTypeOf(file.relativeFilename);
      if (!isLinkableFileType(ftL)) continue;
      // 对齐 GetTargetLinkCommands：$compiler 宏为空（对应文件编译器程序缺失）→ 跳过并提示
      const prog = ftL === FileType.Resource
        ? this.compiler.programs.WINDRES
        : file.compilerVar === 'CPP' ? this.compiler.programs.CPP : this.compiler.programs.C;
      if (!prog) {
        this.output.debug(`[Code::Blocks] Skipping file (no compiler program set): ${file.relativeFilename}`);
        continue;
      }
      if (ftL === FileType.Resource) {
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
      // 对齐 GetCompileFileCommand：compilerVar 为空 → 跳过（Cannot resolve compiler var）
      if (!file.compilerVar) {
        this.output.debug(`[Code::Blocks] Cannot resolve compiler var for project file: ${file.relativeFilename}`);
        continue;
      }

      const isHeader = fileTypeOf(file.relativeFilename) === FileType.Header;
      const made = this.makeCompileUnit(target, file, generator, hasCpp);
      if (made.reason === 'not-compilable') continue;
      if (made.reason === 'no-command') {
        if (!isHeader) {
          // 对齐 GetCompileFileCommand：命令为空（工具未匹配/程序缺失）→ 跳过日志（头文件除外）
          this.output.debug(`[Code::Blocks] Skipping file (no compiler program set): ${file.relativeFilename}`);
        }
        continue;
      }
      const unit = made.unit!;

      // 绝对对象路径用于增量判断，相对对象路径用于命令行（避免含空格路径）
      const object = this.objectPathFor(target, file);

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

      // 生成文件延后到所有常规编译之后（保证生成器已产出源文件）
      if (file.autoGeneratedBy) deferredUnits.push(unit);
      else units.push(unit);
    }

    // 创建所有对象文件的父目录（对应 CodeBlocks 的 CreateDirRecursively）
    // 否则 GCC 无法创建 Output\obj\plugin\xxx.o 等子目录下的对象文件
    this.ensureObjectDirs([...units, ...deferredUnits]);

    // 无需要编译的文件（且输出已存在）→ 目标已最新；但外部依赖更新仍需重链接（对齐 GetTargetLinkCommands：AreExternalDepsOutdated 先于 !force 返回）
    if (units.length === 0 && deferredUnits.length === 0) {
      const outAbs = this.resolveOutputFile(target);
      if (fs.existsSync(outAbs)) {
        // CommandsOnly 已在上方 return，此处目标必为可链接类型
        const externalForce = this.areExternalDepsOutdated(target, outAbs, []);
        if (!externalForce) {
          this.output.info(`[Code::Blocks] 目标 "${target.title}" 已是最新`);
          // 目标已最新（hasCommands=false）：仅当 alwaysRunPostBuildSteps 为真时才执行 post-build（对齐 CodeBlocks）
          if (!(await this.runPostBuild(target, macroVars, expandScriptMacros, false, options))) {
            if (options.cancel?.isCancelled()) {
              return this.cancelledStats(target, 0, skippedCount);
            }
            return {
              success: false, compiledCount: 0, skippedCount, failedCount: 0,
              linkSuccess: false, linkSkipped: target.targetType === TargetType.StaticLib,
              hadCommands: false, outputFilename: target.outputFilename,
            };
          }
          return {
            success: true, compiledCount: 0, skippedCount, failedCount: 0,
            linkSuccess: true, linkSkipped: target.targetType === TargetType.StaticLib,
            hadCommands: false, outputFilename: target.outputFilename,
          };
        }
        // 外部依赖更新：继续执行链接/打包阶段（重新检查会输出 WARNING）
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

    // 取消检查点：被强杀的编译进程 close 返回失败，但语义是取消而非失败（failedCount 不计）
    if (options.cancel?.isCancelled()) {
      return this.cancelledStats(target, results.filter((r) => r).length, skippedCount);
    }

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
        hadCommands: totalUnits > 0,
        outputFilename: target.outputFilename,
      };
    }
    // 编译阶段完成耗时（对齐 Code::Blocks 阶段化日志）
    this.output.info(`[Code::Blocks] 编译完成 ${totalUnits} 个文件 (${compileSec}s)`);

    // 2. 链接（CommandsOnly/static lib 不链接；CommandsOnly 已在上面 return 或按开关跳过链接）
    let linkSuccess = true;
    let linkExecuted = false;
    let archiveExecuted = false;
    if (target.targetType !== TargetType.StaticLib && target.targetType !== TargetType.CommandsOnly) {
      // 对齐 GetTargetLinkCommands：无可链接对象文件 → 跳过链接阶段（即使输出缺失也不链接）
      if (linkFiles.length === 0 && resFiles.length === 0) {
        this.output.info('[Code::Blocks] Linking stage skipped (build target has no object files to link)');
      } else {
        // 链接对象 = 所有参与链接的标准源文件对象（不论本次是否重编译）
        // （ram.ld → ram.o 是链接脚本、app.xm → appxm.o 是资源，均不参与链接）
        // 逐对象加引号（对齐 pfDetails::Update:579-583 QuoteStringIfNeeded + GetTargetLinkCommands objectSeparator 拼接）
        const isOw = (target.compilerId || '').toLowerCase() === 'ow';
        const linkObjects = linkFiles.map((f) => quoteIfNeeded(this.linkObjectRelative(target, f)));
        const resObjects = resFiles.map((f) => quoteIfNeeded(this.objectPathRelative(target, f)));
        // 扁平对象列表（对齐 GetTargetLinkCommands 的 FlatLinkFiles：恒为扁平命名，与 useFlatObjects 无关）
        const linkObjectsFlat = linkFiles.map((f) => quoteIfNeeded(this.linkObjectRelativeFlat(target, f)));
        // OpenWatcom 特例（对齐 GetTargetLinkCommands:752-753/785-788）：链接对象前加 "file "、资源对象改 "option resource="、空格拼接
        const linkObjectStr = isOw
          ? (linkObjects.length ? 'file ' : '') + linkObjects.join(' ')
          : linkObjects.join(this.compiler.switches.objectSeparator);
        const resObjectStr = isOw
          ? resObjects.map((o) => 'option resource=' + o).join(' ')
          : resObjects.join(this.compiler.switches.objectSeparator);
        const linkObjectsAbs = linkFiles.map((f) => this.linkObjectAbs(target, f));
        // 资源对象同样参与增量判断（对齐 GetTargetLinkCommands 的时间戳检查遍历所有对象）
        const allObjectsAbs = [...linkObjectsAbs, ...resFiles.map((f) => this.objectPathFor(target, f))];

        // 增量：输出已存在且比所有链接对象新 → 跳过链接（对应 GetTargetLinkCommands 时间戳检查）；
        // 外部依赖检查（对齐 AreExternalDepsOutdated：库/外部依赖/附加输出更新 → 强制重链接）
        const outputAbs = this.resolveOutputFile(target);
        let forceLink = options.rebuild || !this.linkObjectsUpToDate(outputAbs, allObjectsAbs);
        const missing: string[] = [];
        if (this.areExternalDepsOutdated(target, outputAbs, missing)) forceLink = true;
        if (missing.length) {
          this.output.warn(`WARNING: Target '${this.project.title}/${target.title}': Unable to resolve ${missing.length} external dependency/ies:`);
          for (const m of missing) this.output.debug(`        ${m}`);
        }
        if (forceLink) {
          // 创建输出目录（如 Output\bin），否则链接器无法写 app.rv32；失败则中止本目标（对齐 GetTargetLinkCommands 的目录错误提示，用日志替代阻塞弹窗）
          if (!this.ensureDir(path.dirname(outputAbs))) {
            this.output.error(`[Code::Blocks] 无法创建输出目录，目标 "${target.title}" 中止`);
            return {
              success: false,
              compiledCount: totalUnits,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: false,
              hadCommands: true,
              outputFilename: target.outputFilename,
            };
          }

          const linkCommand = generator.generate(this.linkCommandType(target), {
            target,
            pf: null,
            file: '',
            object: linkObjectStr,
            flatObject: linkObjectsFlat.join(isOw ? ' ' : this.compiler.switches.objectSeparator),
            deps: resObjectStr,
            hasCppFilesToLink: hasCpp,
          });
          if (linkCommand) {
            this.output.info(linkCommand);
            this.output.info(`[Linking] → ${path.relative(this.project.basePath, outputAbs)}`);
            const linkStartMs = Date.now();
            linkExecuted = true;
            // 链接响应文件基础名对齐 CheckForToLongCommandLine：对象输出目录 + <title>_link.respFile
            const respBase = path.join(this.project.basePath, target.objectOutput, `${target.title}_link`);
            const linkOk = await this.runCommand(linkCommand, this.project.basePath, options, respBase);
            const linkSec = ((Date.now() - linkStartMs) / 1000).toFixed(1);
            if (!linkOk) {
              // 取消优先判定（被强杀的链接器返回失败，但语义是取消）
              if (options.cancel?.isCancelled()) {
                return this.cancelledStats(target, totalUnits, skippedCount);
              }
              this.output.error(`[Code::Blocks] 目标 "${target.title}" 链接失败`);
              return {
                success: false,
                compiledCount: totalUnits,
                skippedCount,
                failedCount: 0,
                linkSuccess: false,
                linkSkipped: false,
                hadCommands: true,
                outputFilename: target.outputFilename,
              };
            }
            this.output.info(`✓ [Linked] ${path.relative(this.project.basePath, outputAbs)} (${linkSec}s)`);
          } else {
            // 对齐 GetTargetLinkCommands：无链接器程序时提示跳过
            this.output.debug(`[Code::Blocks] Skipping linking (no linker program set): ${outputAbs}`);
          }
        } else {
          this.output.info(`[Code::Blocks] 目标 "${target.title}" 链接已是最新，跳过链接`);
        }
      }
    } else if (target.targetType === TargetType.StaticLib) {
      // 对齐 GetTargetLinkCommands：无可链接对象文件 → 跳过打包阶段
      if (linkFiles.length === 0 && resFiles.length === 0) {
        this.output.info('[Code::Blocks] Linking stage skipped (build target has no object files to link)');
      } else {
        // 静态库用 ar 打包（对齐 Code::Blocks LinkStatic 模板，含 $lib_linker 引号与多行命令拆分）
        // 逐对象加引号（同链接阶段，对齐 pfDetails::Update 的 QuoteStringIfNeeded）；
        // $±link_objects prependHack（对齐 GetTargetLinkCommands:724-742）：bcc/dmc 等模板要求对象前加 -/+；
        // OpenWatcom 特例：空格拼接（对齐 GetTargetLinkCommands:795-804）
        const isOw = (target.compilerId || '').toLowerCase() === 'ow';
        const hack = generator.linkObjectsPrependHack();
        const objects = linkFiles.map((f) => hack + quoteIfNeeded(this.linkObjectRelative(target, f)));
        const objectsFlat = linkFiles.map((f) => hack + quoteIfNeeded(this.linkObjectRelativeFlat(target, f)));
        const objectSep = isOw ? ' ' : this.compiler.switches.objectSeparator;
        const staticOut = computeStaticOutput(
          this.expandedOutputFilename(target),
          this.compiler.switches,
          target.prefixAuto,
          target.extensionAuto,
        );
        const staticOutAbs = path.join(this.project.basePath, staticOut);
        const linkObjectsAbs = linkFiles.map((f) => this.linkObjectAbs(target, f));
        // 增量：静态库已存在且比所有对象新 → 跳过打包；外部依赖更新 → 强制重新打包
        let forceArchive = options.rebuild || !this.linkObjectsUpToDate(staticOutAbs, linkObjectsAbs);
        const missing: string[] = [];
        if (this.areExternalDepsOutdated(target, staticOutAbs, missing)) forceArchive = true;
        if (missing.length) {
          this.output.warn(`WARNING: Target '${this.project.title}/${target.title}': Unable to resolve ${missing.length} external dependency/ies:`);
          for (const m of missing) this.output.debug(`        ${m}`);
        }
        if (forceArchive) {
          // 创建静态库输出目录（如 bin\Debug），否则 ar 无法写 libdep_lib.a；失败则中止本目标
          if (!this.ensureDir(path.dirname(staticOutAbs))) {
            this.output.error(`[Code::Blocks] 无法创建输出目录，目标 "${target.title}" 中止`);
            return {
              success: false,
              compiledCount: totalUnits,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: true,
              hadCommands: true,
              outputFilename: target.outputFilename,
            };
          }
          const arCmd = generator.generate(CommandType.LinkStaticCmd, {
            target,
            pf: null,
            file: '',
            object: objects.join(objectSep),
            flatObject: objectsFlat.join(objectSep),
            deps: '',
            hasCppFilesToLink: false,
          });
          if (arCmd) {
            this.output.info(arCmd);
            this.output.info(`[Archiving] → ${staticOut}`);
            const arStartMs = Date.now();
            archiveExecuted = true;
            const respBase = path.join(this.project.basePath, target.objectOutput, `${target.title}_link`);
            const ok = await this.runCommand(arCmd, this.project.basePath, options, respBase);
            const arSec = ((Date.now() - arStartMs) / 1000).toFixed(1);
            if (!ok) {
              // 取消优先判定（被强杀的 ar 返回失败，但语义是取消）
              if (options.cancel?.isCancelled()) {
                return this.cancelledStats(target, totalUnits, skippedCount);
              }
              return {
                success: false,
                compiledCount: totalUnits,
                skippedCount,
                failedCount: 0,
                linkSuccess: false,
                linkSkipped: true,
                hadCommands: true,
                outputFilename: target.outputFilename,
              };
            }
            this.output.info(`✓ [Archived] ${staticOut} (${arSec}s)`);
          } else {
            // 对齐 GetTargetLinkCommands：无打包程序时提示跳过
            this.output.debug(`[Code::Blocks] Skipping linking (no linker program set): ${staticOutAbs}`);
          }
        } else {
          this.output.info(`[Code::Blocks] 目标 "${target.title}" 静态库已是最新，跳过打包`);
        }
      }
    }

    // 3. 目标级 post-build 脚本（对齐 CodeBlocks 状态机 bsTargetPostBuild；项目级在 build() 层执行）
    if (!(await this.runPostBuild(target, macroVars, expandScriptMacros, true, options))) {
      if (options.cancel?.isCancelled()) {
        return this.cancelledStats(target, totalUnits, skippedCount);
      }
      return {
        success: false,
        compiledCount: totalUnits,
        skippedCount,
        failedCount: 0,
        linkSuccess,
        linkSkipped: target.targetType === TargetType.StaticLib,
        hadCommands: totalUnits > 0 || linkExecuted || archiveExecuted,
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
      hadCommands: totalUnits > 0 || linkExecuted || archiveExecuted,
      outputFilename: target.outputFilename,
    };
  }

  /**
   * 执行目标级 post-build 步骤 —— 对齐 CodeBlocks 状态机 bsTargetPostBuild：
   * 条件：hasCommands（有编译/链接动作）或 alwaysRunPostBuildSteps 标志为真时才执行。
   * 项目级 post-build 在 build() 层执行（bsProjectPostBuild，每次构建一次）。
   */
  private async runPostBuild(
    target: BuildTarget,
    macroVars: Record<string, string>,
    expandScriptMacros: (cmd: string) => string,
    hasCommands: boolean,
    options: BuildOptions,
  ): Promise<boolean> {
    const targetPost = [...target.commandsAfterBuild].map(expandScriptMacros);
    const extraPath = this.compilerBinPath();

    if (targetPost.length && (hasCommands || target.alwaysRunPostBuildSteps)) {
      this.output.info(`[Code::Blocks] 执行目标 post-build 脚本 (${target.title})...`);
      const ok = await runScriptCommands(targetPost, this.project.basePath, macroVars, (l) => this.output.info(l), extraPath, options.cancel);
      if (!ok) {
        if (options.cancel?.isCancelled()) return false;
        this.output.error(`[Code::Blocks] 目标 "${target.title}" post-build 脚本失败`);
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
      // 对齐 GetCompileFileCommand 的源文件路径选择：UseFullSourcePaths 时绝对路径，否则相对路径
      file: this.compiler.switches.useFullSourcePaths ? file.absolutePath : file.relativeFilename,
      object,
      // flatObject 恒为扁平命名（对齐 pfd.object_file_flat）
      flatObject: this.objectPathRelativeFlat(target, file),
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
      // 对齐 IsObjectOutdated：源文件不存在 → 不编译并输出 WARNING；存在但时间戳读取失败 → 回退编译
      if (!fs.existsSync(sourceFile)) {
        this.output.warn(`WARNING: Can't read file's timestamp: ${sourceFile}`);
        return true;
      }
      return false;
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
    // 输出文件名宏展开（对齐 GetTargetLinkCommands/GetTargetCleanCommands 的 ReplaceMacros）
    const output = this.expandedOutputFilename(target);
    // 静态库实际输出带 lib 前缀 + .a（computeStaticOutput），而非原始 outputFilename
    if (target.targetType === TargetType.StaticLib) {
      return path.join(
        this.project.basePath,
        computeStaticOutput(output, this.compiler.switches, target.prefixAuto, target.extensionAuto),
      );
    }
    const out = path.join(this.project.basePath, output);
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

  /** 输出文件名宏展开（对齐 ReplaceMacros(target->GetOutputFilename(), target)） */
  private expandedOutputFilename(target: BuildTarget): string {
    return replaceCbMacros(target.outputFilename, {
      vars: this.targetMacroVars(target),
      customVars: this.project.customVariables ?? {},
    });
  }

  /** 文件 mtime（毫秒，失败返回 0，对齐 depsTimeStamp 语义） */
  private fileMtime(p: string): number {
    if (!p) return 0;
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * 外部依赖过期检查 —— 对齐 AreExternalDepsOutdated（directcommands.cpp:1007）：
   * 1. 输出存在时：链接库（目标+项目+编译器全局）在库目录中找到的 .a/.lib 比输出新 → 强制重链接；
   * 2. external_deps 比 additional_output 或输出新 → 强制重链接；缺失依赖计入 filesMissing（WARNING）。
   */
  private areExternalDepsOutdated(target: BuildTarget, buildOutput: string, filesMissing: string[]): boolean {
    // CB 构建时 CWD 已切到项目目录；扩展在宿主进程做时间戳检查，相对路径须以项目根为基准
    const absFromProject = (p: string): string => (path.isAbsolute(p) ? p : path.join(this.project.basePath, p));
    let timeOutput = 0;
    if (buildOutput) {
      timeOutput = this.fileMtime(buildOutput);
      if (timeOutput > 0) {
        // 库列表：目标 + 项目 + 编译器全局（对齐 AppendArray 顺序）
        const libs = [...target.linkLibs, ...this.project.linkLibs, ...(this.compiler.linkLibs ?? [])];
        const libDirs = [...target.libDirs, ...this.project.libDirs, ...(this.compiler.libDirs ?? [])];
        const macros = this.targetMacroVars(target);
        for (let lib of libs) {
          if (!lib) continue;
          // 用户直接指向带路径的库：不经过库目录直接检查（ReplaceMacros + UnixFilename）
          if (lib.includes('/') || lib.includes('\\')) {
            lib = replaceCbMacros(lib, { vars: macros, customVars: this.project.customVariables ?? {} }).replace(/\\/g, '/');
            if (this.fileMtime(absFromProject(lib)) > timeOutput) return true;
            continue;
          }
          if (!lib.startsWith(this.compiler.switches.libPrefix)) lib = this.compiler.switches.libPrefix + lib;
          if (!lib.endsWith('.' + this.compiler.switches.libExtension)) lib += '.' + this.compiler.switches.libExtension;
          for (const dir of libDirs) {
            const cand = replaceCbMacros(path.join(absFromProject(dir), lib), {
              vars: macros,
              customVars: this.project.customVariables ?? {},
            }).replace(/\\/g, '/');
            if (this.fileMtime(cand) > timeOutput) return true;
          }
        }
      }
    }

    // 外部依赖 / 附加输出（cbp 中为分号分隔列表）
    const macros = this.targetMacroVars(target);
    for (const dep of target.externalDeps) {
      if (!dep) continue;
      const depExp = absFromProject(replaceCbMacros(dep, { vars: macros, customVars: this.project.customVariables ?? {} }));
      const timeExtDep = this.fileMtime(depExp);
      // 依赖缺失：不需重链接，但记录 WARNING
      if (timeExtDep <= 0) {
        filesMissing.push(depExp);
        continue;
      }
      // 检查附加输出文件
      for (const add of target.additionalOutput) {
        if (!add) continue;
        const addExp = absFromProject(replaceCbMacros(add, { vars: macros, customVars: this.project.customVariables ?? {} }));
        const timeAdd = this.fileMtime(addExp);
        if (timeAdd <= 0) {
          filesMissing.push(addExp);
          continue;
        }
        if (timeExtDep > timeAdd) return true;
      }
      // 无输出（commands-only）时继续检查其它依赖
      if (!buildOutput) continue;
      // 输出不存在 → 重链接
      if (timeOutput <= 0) return true;
      // 外部依赖比输出新 → 重链接
      if (timeExtDep > timeOutput) return true;
    }
    return false;
  }

  /** 收集目标的 include 搜索目录（关系合并后的有序目录 + 反引号派生目录；对齐 DepsSearchStart 的 GetCompilerSearchDirs） */
  private getIncludeDirs(target: BuildTarget, generator?: CommandGenerator): string[] {
    if (generator) return generator.getCompilerSearchDirs(target.title);
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
    // 无效编译器目标：跳过对象清理（对齐 GetTargetCleanCommands:966 的 compiler==null 分支与
    // PrintBanner:1788 的 CompilerValid 早退）；输出文件删除在 compiler 检查之外（对齐 981-988）
    const id = target.compilerId || this.project.compilerId;
    const resolved = this.resolveCompiler ? this.resolveCompiler(id) : this.compiler;
    const invalid = !resolved || !this.isCompilerUsable(resolved);
    if (invalid) {
      this.output.debug(`[Code::Blocks] 目标 "${target.title}" 编译器无效，跳过对象清理`);
    } else {
      // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())，needDependencies 随目标编译器取）
      this.switchCompiler(target);
      // Clean Banner —— 对齐状态机 bsTargetClean 的 PrintBanner(baClean)
      this.printBanner('Clean', target);
    }
    let removed = 0;
    if (!invalid) {
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
        // distclean：同时删除 deps 依赖文件（对齐 GetTargetCleanCommands 的 ret.Add(pfd.dep_file_absolute_native)；
        // Clean 与 Rebuild 均以 distclean=true 执行，compilergcc.cpp bsTargetClean → GetCleanCommands(bt, true)）
        const depAbs = this.depsPathFor(target, file);
        if (this.removeFileIfExists(depAbs)) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, depAbs)}`);
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
    }
    // 输出文件（含 Windows 无扩展名输出自动追加的 .exe 变体；CommandsOnly 无输出，对齐 GetTargetCleanCommands）
    if (target.targetType !== TargetType.CommandsOnly && target.outputFilename) {
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
      // 动态库：同时删除 import 库（对齐 GetTargetCleanCommands ttDynamicLib → GetStaticLibFilename；
      // import 库默认基础名 = 输出去扩展名（GetDynamicLibImportFilename 的 $(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)），
      // 强制平台默认前缀/扩展且大小写不敏感，对齐 SetupOutputFilenames）
      if (target.targetType === TargetType.DynamicLib) {
        const out = this.expandedOutputFilename(target);
        const outP = path.parse(out);
        const impBase = target.impLib || path.join(outP.dir, outP.name);
        const imp = path.join(
          this.project.basePath,
          computeStaticOutput(impBase, this.compiler.switches, true, true, true),
        );
        if (this.removeFileIfExists(imp)) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, imp)}`);
          }
        }
      }
    }
    this.output.info(`[Code::Blocks] Cleaned "${this.project.title} - ${target.title}": 删除 ${removed} 个文件`);
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
    const objDir = target.objectOutput || '.objs';
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
    // pchObjectDir（默认）：对象输出目录 + <原名>.gch（如 include/all.h.gch）
    const objDir = target.objectOutput || '.objs';
    const rel = toUnix(file.relativeToCommonTopLevelPath || file.relativeFilename);
    return path.join(objDir, rel + '.' + gch);
  }

  /** 链接对象相对路径：项目内直接加入的 .o/.a 用原路径（对齐 pfDetails::Update ftObject/ftStaticLib） */
  private linkObjectRelative(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) return file.relativeFilename;
    return this.objectPathRelative(target, file);
  }

  /** 扁平对象路径 —— 对齐 pfd.object_file_flat（GetObjName useFlatObjects 强制扁平：对象目录 + 纯文件名，忽略源目录层级） */
  private objectPathRelativeFlat(target: BuildTarget, file: ProjectFile): string {
    // 生成器文件的对象 = 第一个生成文件的对象（与 objectPathRelative 同规则）
    if ((file.generatedFiles?.length ?? 0) > 0) {
      const first = this.project.files.find((f) => f.relativeFilename === file.generatedFiles[0]);
      if (first) return this.objectPathRelativeFlat(target, first);
    }
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Header && this.compiler.switches.supportsPCH) {
      return this.pchObjectRelative(target, file);
    }
    const objDir = target.objectOutput || '.objs';
    const ext = ft === FileType.Resource ? 'res' : this.compiler.switches.objectExtension;
    const name = this.project.extendedObjNames
      ? path.basename(file.relativeFilename) + '.' + ext
      : path.parse(file.relativeFilename).name + '.' + ext;
    return path.join(objDir, name);
  }

  /** 链接对象扁平路径（.o/.a 原路径，其余扁平命名；对齐 GetTargetLinkCommands 的 FlatLinkFiles） */
  private linkObjectRelativeFlat(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) return file.relativeFilename;
    return this.objectPathRelativeFlat(target, file);
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
      // 对象目录失败：debug 日志 + 继续（对齐 GetCompileFileCommand 的 DebugLog，让编译器报真实错误）
      this.ensureDir(dir, 'debug');
    }
  }

  /** 递归创建目录，返回是否成功（失败按级别记录：error = 构建中止点，debug = 对齐 CB DebugLog 继续执行） */
  private ensureDir(dir: string, logLevel: 'debug' | 'error' = 'error'): boolean {
    if (!dir) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (e) {
      const msg = `[Code::Blocks] 无法创建目录 ${dir}: ${(e as Error).message}`;
      if (logLevel === 'error') this.output.error(msg);
      else this.output.debug(msg);
      return false;
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
        // 取消检查点：不再启动新的编译单元（已启动的由 cancel() 强杀整棵进程树）
        if (options.cancel?.isCancelled()) break;
        const pos = cursor++;
        const li = localIdx[pos];
        const u = group[li];
        const startMs = Date.now();
        const ok = await this.runCommand(u.command, u.cwd, options, u.respBase);
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
        } else if (options.cancel?.isCancelled()) {
          // 取消导致的失败不是错误：不打印红色 Failed，不参与最慢 Top3 统计
          this.output.warn(`⚠ [Interrupted] ${idx}-${totalCount} ${u.file.relativeFilename}`);
        } else {
          this.output.error(`✗ [Failed] ${idx}-${totalCount} ${u.file.relativeFilename} (${elapsedSec}s)`);
        }
        if (ok) {
          this.compileTimings.push({ file: u.file.relativeFilename, ms: elapsedMs });
        }
        results[baseGlobalIdx + li] = ok;
      }
    });
    await Promise.all(workers);
  }

  private async runCommand(command: string, cwd: string, options: BuildOptions, respBase?: string): Promise<boolean> {
    // 多行命令（模板含 \n）逐条执行，对齐 Code::Blocks AddCommandsToArray
    const lines = command.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return this.runSingleCommand(command, cwd, options, respBase);
    }
    let ok = true;
    for (const line of lines) {
      // 取消检查点：多行命令逐行之间
      if (options.cancel?.isCancelled()) {
        ok = false;
        break;
      }
      if (!(await this.runSingleCommand(line, cwd, options, respBase))) ok = false;
    }
    return ok;
  }

  private async runSingleCommand(command: string, cwd: string, options: BuildOptions, respBase?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // 取消检查点：spawn 前（已取消则不再派生新进程）
      if (options.cancel?.isCancelled()) {
        resolve(false);
        return;
      }
      const resp = applyResponseFile(command, respBase);
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
      // 注册进取消源：cancel() 时强杀整棵进程树（Windows taskkill /T /F，覆盖 cmd.exe→gcc→cc1/as）
      options.cancel?.register(proc);
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
        options.cancel?.unregister(proc);
        if (stdoutChunks.length) processLines(decodeText(Buffer.concat(stdoutChunks)));
        if (stderrChunks.length) processLines(decodeText(Buffer.concat(stderrChunks)));
        const success = code !== null && code <= this.compiler.switches.statusSuccess;
        resolve(success);
      });
      proc.on('error', (err) => {
        options.cancel?.unregister(proc);
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
