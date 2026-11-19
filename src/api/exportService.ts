/**
 * 导出服务（无 vscode 依赖）：Makefile / compile_commands.json / 编译命令清单。
 */
import * as fs from 'fs';
import * as path from 'path';
import { BuildEngine } from '../build/buildEngine';
import { generateMakefile } from '../build/makefileExporter';
import { collectClangdEntries, writeClangdDatabase } from '../build/compileCommands';
import { loadProject, writeTextAtomic } from './projectStore';
import { selectBuildTarget } from './buildService';
import { fail } from './types';
import type { CompilerProvider } from './compilerService';
import type { CbOutput } from '../build/cbChannel';

export const EXPORT_KINDS = ['makefile', 'compile_commands', 'commands'] as const;
export type ExportKind = typeof EXPORT_KINDS[number];

export interface ExportRequest {
  cbp: string;
  kind: ExportKind;
  target?: string;
  /** makefile: 输出文件；compile_commands: 输出目录；commands: 忽略 */
  out?: string;
}

export interface ExportServiceDeps {
  compiler: CompilerProvider;
  output: CbOutput;
  /**
   * 编译器系统 include 路径（可选；扩展提供，与 UI 的「生成 compile_commands」同源）。
   * 未提供时 compile_commands.json 不含 `-isystem`（CLI/MCP 的旧行为）。
   */
  systemIncludes?: (project: ReturnType<typeof loadProject>, compiler: ReturnType<CompilerProvider['getCompiler']>) => string[];
}

export interface ExportOutcome {
  kind: ExportKind;
  /** 写出的文件（commands 为空） */
  files: string[];
  /** commands 类型的文本内容 */
  text?: string;
  count?: number;
}

/** 导出 */
export function exportProject(req: ExportRequest, deps: ExportServiceDeps): ExportOutcome {
  if (typeof req.kind !== 'string' || !(EXPORT_KINDS as readonly string[]).includes(req.kind)) {
    fail('invalid-input', `Unknown export kind: ${String(req.kind)}`, { allowed: [...EXPORT_KINDS] });
  }
  const project = loadProject(req.cbp);
  const target = selectBuildTarget(project, req.target);

  // out 必须留在工程目录内：Agent/MCP 不应对工作区外任意路径写文件
  const resolveOut = (raw: string | undefined, fallback: string): string => {
    const base = path.resolve(project.basePath);
    const out = raw ? path.resolve(base, raw) : fallback;
    const rel = path.relative(base, out);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      fail('invalid-input', `out must stay inside the project directory: ${out}`, { projectDir: base });
    }
    return out;
  };

  if (req.kind === 'makefile') {
    // 默认导出到 Makefile.cb（与 UI 的 Export Makefile 一致）：绝不覆盖工程里真正的 Makefile
    // ——自定义 Makefile 工程的 <Option makefile="…"> 指向用户手写文件，覆盖即数据丢失。
    const out = resolveOut(req.out, path.join(project.basePath, 'Makefile.cb'));
    // 显式 out 也拦：命中工程声明的 Makefile 时拒绝（R2-01 的默认保证延伸到显式路径）。
    // 先判路径再生成内容：被拒绝的调用不该白跑一遍 makefile 生成。
    const configuredMakefile = project.makefile ? path.resolve(project.basePath, project.makefile) : undefined;
    const samePath = (a: string, b: string): boolean => (process.platform === 'win32'
      ? a.toLowerCase() === b.toLowerCase()
      : a === b);
    if (configuredMakefile && samePath(path.resolve(out), configuredMakefile)) {
      fail('invalid-input', `Refusing to overwrite the project's Makefile: ${out}`, {
        hint: 'Choose another out path (e.g. Makefile.cb), or edit the generated file manually.',
      });
    }
    const compiler = deps.compiler.getCompiler(project.compilerId);
    const engine = new BuildEngine(project, compiler, deps.output, (id) => deps.compiler.resolveTargetCompiler(id));
    const targets = engine.collectMakefileData(req.target);
    const text = generateMakefile({
      projectTitle: project.title,
      projectFile: path.basename(project.filename),
      basePath: project.basePath,
      generatedAt: new Date().toISOString(),
      targets,
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // 原子写：避免中断时留下半个 Makefile
    writeTextAtomic(out, text, 'utf-8');
    return { kind: 'makefile', files: [out], count: targets.length };
  }

  if (req.kind === 'compile_commands') {
    const compiler = deps.compiler.getCompiler(project.compilerId);
    const systemIncludes = deps.systemIncludes?.(project, compiler) ?? [];
    const entries = collectClangdEntries(project, compiler, deps.output, systemIncludes);
    // 相对 out 按工程目录解析（扩展宿主的 process.cwd() 不可靠，可能是 System32）
    const outDir = resolveOut(req.out, path.join(project.basePath, '.cb-tools', 'compile_commands'));
    const written = writeClangdDatabase(entries, outDir);
    return { kind: 'compile_commands', files: [written.outPath], count: written.count };
  }

  // commands：只打印，不写盘
  const compiler = deps.compiler.getCompiler(project.compilerId);
  const engine = new BuildEngine(project, compiler, deps.output, (id) => deps.compiler.resolveTargetCompiler(id));
  const entries = engine.collectCompileCommands(target);
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`[${e.targetTitle}] ${e.file}`);
    lines.push(`  cd ${e.directory}`);
    lines.push(`  ${e.command}`);
  }
  return { kind: 'commands', files: [], text: lines.join('\n'), count: entries.length };
}
