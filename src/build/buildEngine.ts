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
import { Project, BuildTarget, ProjectFile, TargetType, CommandType } from '../model/types';
import { Compiler } from '../compiler/compiler';
import { CommandGenerator } from '../compiler/commandGenerator';
import { OutputParser } from './outputParser';
import { runScriptCommands, buildMacroVars } from './scriptRunner';

export interface BuildOptions {
  rebuild?: boolean;
  clean?: boolean;
  onLine?: (line: string) => void;
  onDiagnostic?: (diag: vscode.Diagnostic) => void;
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

  constructor(
    private project: Project,
    private compiler: Compiler,
    private output: vscode.OutputChannel,
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

    let ok = true;
    for (const target of targets) {
      const targetOk = await this.buildTarget(target, options);
      if (!targetOk) ok = false;
    }
    return ok;
  }

  /** 构建单个目标 */
  private async buildTarget(target: BuildTarget, options: BuildOptions): Promise<boolean> {
    const macroVars = buildMacroVars(this.project.basePath, target.outputFilename, target.title, target.objectOutput);

    if (target.targetType === TargetType.CommandsOnly) {
      // 仅执行 pre/post build 命令（项目级 + 目标级）
      const cmds = [
        ...this.project.commandsBeforeBuild, ...target.commandsBeforeBuild,
        ...this.project.commandsAfterBuild, ...target.commandsAfterBuild,
      ];
      return runScriptCommands(
        cmds,
        this.project.basePath,
        macroVars,
        (l) => this.output.appendLine(l),
      );
    }

    const generator = new CommandGenerator(this.project, this.compiler);

    // 项目级 + 目标级 pre-build 脚本（项目级先执行）
    const preCommands = [...this.project.commandsBeforeBuild, ...target.commandsBeforeBuild];
    const postCommands = [...this.project.commandsAfterBuild, ...target.commandsAfterBuild];

    // 0. pre-build 脚本
    if (preCommands.length) {
      this.output.appendLine(`[Code::Blocks] 执行 pre-build 脚本 (${target.title})...`);
      const preOk = await runScriptCommands(preCommands, this.project.basePath, macroVars, (l) => this.output.appendLine(l));
      if (!preOk) {
        this.output.appendLine(`[Code::Blocks] 目标 "${target.title}" pre-build 脚本失败`);
        return false;
      }
    }

    // 1. 编译所有文件（增量：跳过未变更文件）
    const units: CompileUnit[] = [];
    const files = target.files.length ? target.files : this.project.files;
    const hasCpp = files.some((f) => /\.(cpp|cc|cxx|C)$/.test(f.relativeFilename));

    for (const file of files) {
      // 跳过不参与编译的文件（<Option compile="0"/>）
      if (file.compile === false) continue;

      const customCmd = file.customBuildCommands?.[target.compilerId]?.trim();
      const isCustom = customCmd !== undefined && customCmd !== '';
      // 自定义命令文件（ram.ld/app.xm 等）或标准源文件才编译
      if (!isCustom && !this.isCompilable(file.relativeFilename)) continue;

      const object = this.objectPathFor(target, file);
      const deps = this.depsPathFor(target, file);

      // 增量编译：源文件未变更且对象文件存在时跳过（rebuild 强制重编译）
      if (!options.rebuild && !isCustom && this.isUpToDate(file.absolutePath, object)) {
        continue;
      }

      let command: string;
      if (isCustom) {
        // 自定义编译命令：直接展开 $compiler/$file 等内置宏 + $(...) 变量
        command = this.expandCustomCommand(customCmd, generator, target, file, object);
      } else {
        command = generator.generate(CommandType.CompileObjectCmd, {
          target,
          pf: file,
          file: file.absolutePath,
          object,
          flatObject: object,
          deps,
          hasCppFilesToLink: hasCpp,
        });
      }
      if (command) {
        units.push({ target, file, command, cwd: this.project.basePath });
      }
    }

    // 无需要编译的文件
    if (units.length === 0) {
      this.output.appendLine(`[Code::Blocks] 目标 "${target.title}" 已是最新`);
      return true;
    }

    // 并行编译（受配置限制）
    const maxJobs = this.maxJobs();
    const results = await this.runInParallel(units, maxJobs, options);

    if (!results.every(Boolean)) {
      this.output.appendLine(`[Code::Blocks] 目标 "${target.title}" 编译失败`);
      return false;
    }

    // 2. 链接（非 static lib 需要链接步骤；CommandsOnly 已在上面 return）
    if (target.targetType !== TargetType.StaticLib) {
      // 链接对象只含「标准源文件」编译出的对象，排除自定义 buildCommand 文件
      // （ram.ld → ram.o 是链接脚本、app.xm → appxm.o 是资源，均不参与链接）
      const linkUnits = units.filter((u) => !this.isCustomFile(u.file, target));
      const linkObjects = linkUnits.map((u) => this.objectPathFor(u.target, u.file));
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
        this.output.appendLine(linkCommand);
        const linkOk = await this.runCommand(linkCommand, this.project.basePath, options);
        if (!linkOk) {
          this.output.appendLine(`[Code::Blocks] 目标 "${target.title}" 链接失败`);
          return false;
        }
      }
    } else if (target.targetType === TargetType.StaticLib) {
      // 静态库用 ar 打包
      const objects = units.map((u) => this.objectPathFor(u.target, u.file));
      const staticOut = path.join(
        path.dirname(target.outputFilename),
        path.parse(target.outputFilename).name + '.' + this.compiler.switches.libExtension,
      );
      const arCmd = `${this.compiler.programs.LIB} -r -s ${staticOut} ${objects.join(' ')}`;
      this.output.appendLine(arCmd);
      const ok = await this.runCommand(arCmd, this.project.basePath, options);
      if (!ok) return false;
    }

    // 3. post-build 脚本
    if (postCommands.length) {
      this.output.appendLine(`[Code::Blocks] 执行 post-build 脚本 (${target.title})...`);
      const postOk = await runScriptCommands(postCommands, this.project.basePath, macroVars, (l) => this.output.appendLine(l));
      if (!postOk) {
        this.output.appendLine(`[Code::Blocks] 目标 "${target.title}" post-build 脚本失败`);
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
      default: return CommandType.LinkExeCmd;
    }
  }

  private isCompilable(rel: string): boolean {
    return /\.(c|cpp|cc|cxx|C)$/.test(rel) || /\.rc$/.test(rel);
  }

  /** 判断文件是否为自定义 buildCommand 文件（不参与链接） */
  private isCustomFile(file: ProjectFile, target: BuildTarget): boolean {
    const cmd = file.customBuildCommands?.[target.compilerId]?.trim();
    return cmd !== undefined && cmd !== '';
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

  /** 增量编译判断：对象文件存在且 mtime 晚于源文件，则无需重编译 */
  private isUpToDate(sourceFile: string, objectFile: string): boolean {
    try {
      const srcStat = fs.statSync(sourceFile);
      const objStat = fs.statSync(objectFile);
      return objStat.mtimeMs >= srcStat.mtimeMs;
    } catch {
      // 对象文件不存在 → 需要编译
      return false;
    }
  }

  private objectPathFor(target: BuildTarget, file: ProjectFile): string {
    const objDir = target.objectOutput || 'obj';
    const relObj = path.join(objDir, path.dirname(file.relativeFilename));
    const name = path.parse(file.relativeFilename).name;
    return path.join(this.project.basePath, relObj, name + '.' + this.compiler.switches.objectExtension);
  }

  private depsPathFor(target: BuildTarget, file: ProjectFile): string {
    const objDir = target.objectOutput || 'obj';
    const name = path.parse(file.relativeFilename).name;
    return path.join(this.project.basePath, objDir, name + '.d');
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
        this.output.appendLine(u.command);
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

      // 编译器输出解码器：优先 GBK（中文 Windows 下 GCC/MinGW 中文错误信息为 GBK），
      // 失败时回退 UTF-8；使用 { stream: true } 避免多字节字符被 chunk 边界截断。
      const makeDecoder = () => {
        try {
          const td = new TextDecoder('gbk', { fatal: false });
          return {
            push: (buf: Buffer) => td.decode(buf, { stream: true }),
            flush: () => td.decode(),
          };
        } catch {
          const td = new TextDecoder('utf-8', { fatal: false });
          return {
            push: (buf: Buffer) => td.decode(buf, { stream: true }),
            flush: () => td.decode(),
          };
        }
      };

      const stdoutDecoder = makeDecoder();
      const stderrDecoder = makeDecoder();
      // 残留缓冲：保存上次未以换行结尾的部分，与下次拼接，避免行被截断
      let stdoutTail = '';
      let stderrTail = '';

      const handleChunk = (decoder: ReturnType<typeof makeDecoder>, tailRef: { value: string }, data: Buffer, streamName: string) => {
        const text = decoder.push(data);
        const combined = tailRef.value + text;
        const lines = combined.split(/\r?\n/);
        // 最后一段可能是不完整行，保留到 tail
        tailRef.value = lines.pop() ?? '';
        for (const line of lines) {
          if (!line) continue;
          options.onLine?.(line);
          const diag = parser.toDiagnostic(line, cwd);
          if (diag) options.onDiagnostic?.(diag);
        }
      };

      const stdoutTailRef = { value: '' };
      const stderrTailRef = { value: '' };

      proc.stdout?.on('data', (data: Buffer) => handleChunk(stdoutDecoder, stdoutTailRef, data, 'stdout'));
      proc.stderr?.on('data', (data: Buffer) => handleChunk(stderrDecoder, stderrTailRef, data, 'stderr'));

      proc.on('close', (code) => {
        // 刷新残留尾行
        if (stdoutTailRef.value) {
          options.onLine?.(stdoutTailRef.value);
          const diag = parser.toDiagnostic(stdoutTailRef.value, cwd);
          if (diag) options.onDiagnostic?.(diag);
        }
        if (stderrTailRef.value) {
          options.onLine?.(stderrTailRef.value);
          const diag = parser.toDiagnostic(stderrTailRef.value, cwd);
          if (diag) options.onDiagnostic?.(diag);
        }
        const success = code !== null && code <= this.compiler.switches.statusSuccess;
        resolve(success);
      });
      proc.on('error', (err) => {
        this.output.appendLine(`[Code::Blocks] 无法执行: ${err.message}`);
        resolve(false);
      });
    });
  }

  private async runCommands(commands: string[], cwd: string): Promise<boolean> {
    let ok = true;
    for (const cmd of commands) {
      this.output.appendLine(cmd);
      const r = await this.runCommand(cmd, cwd, {});
      if (!r) ok = false;
    }
    return ok;
  }
}
