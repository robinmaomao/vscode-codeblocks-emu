/**
 * 导出服务（无 vscode 依赖）：Makefile / compile_commands.json / 编译命令清单。
 */
import * as fs from 'fs';
import * as path from 'path';
import { BuildEngine } from '../build/buildEngine';
import { generateMakefile } from '../build/makefileExporter';
import { collectClangdEntries, writeClangdDatabase } from '../build/compileCommands';
import { loadProject } from './projectStore';
import { selectBuildTarget } from './buildService';
import type { CompilerProvider } from './compilerService';
import type { CbOutput } from '../build/cbChannel';

export type ExportKind = 'makefile' | 'compile_commands' | 'commands';

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
  const project = loadProject(req.cbp);
  const target = selectBuildTarget(project, req.target);

  if (req.kind === 'makefile') {
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
    const out = req.out ? path.resolve(req.out) : path.join(project.basePath, project.makefile || 'Makefile');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text, 'utf-8');
    return { kind: 'makefile', files: [out], count: targets.length };
  }

  if (req.kind === 'compile_commands') {
    const compiler = deps.compiler.getCompiler(project.compilerId);
    const entries = collectClangdEntries(project, compiler, deps.output, []);
    const outDir = req.out ? path.resolve(req.out) : path.join(project.basePath, '.cb-tools', 'compile_commands');
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
