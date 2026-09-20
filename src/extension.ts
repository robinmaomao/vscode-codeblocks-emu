/**
 * 扩展入口 —— 注册命令、管理项目/构建生命周期
 *
 * 对应 Code::Blocks 的 pluginmanager / compilergcc 插件入口角色。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectParser, WorkspaceParser } from './model/parser';
import { Project, BuildTarget } from './model/types';
import { Compiler } from './compiler/compiler';
import { CompilerOptionsLoader } from './compiler/optionsLoader';
import { detectAllCompilers } from './compiler/detector';
import { CompilerOptionsPanel } from './ui/compilerOptionsPanel';
import { ProjectTreeProvider } from './ui/projectTreeProvider';
import { BuildEngine } from './build/buildEngine';
import { OutputParser } from './build/outputParser';
import { GdbDebugAdapter } from './debug/gdbDebugAdapter';
import { scanTodos } from './tools/todoScanner';
import { countFiles, isSourceFile } from './tools/codeStats';
import { formatActiveDocument } from './tools/astyle';

let currentProject: Project | undefined;
let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let compilerLoader: CompilerOptionsLoader | undefined;
let projectTreeProvider: ProjectTreeProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Code::Blocks');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('codeblocks');

  // 初始化编译器选项加载器（resources/compilers 目录）
  const resourcesDir = path.join(context.extensionPath, 'resources', 'compilers');
  compilerLoader = new CompilerOptionsLoader(resourcesDir);

  // 注册 DAP 调试器（内联实现，直接驱动 GDB）
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('codeblocks', {
      createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new GdbDebugAdapter()),
    }),
  );

  // 注册项目树视图
  projectTreeProvider = new ProjectTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codeblocks.projectTree', projectTreeProvider),
  );

  // 打开项目
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.openProject', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: {
          'Code::Blocks 项目': ['cbp'],
          'Code::Blocks 工作区': ['workspace'],
        },
      });
      if (!uris || uris.length === 0) return;
      await openProject(uris[0].fsPath);
    }),
  );

  // 构建
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.build', async () => {
      await build(false);
    }),
  );

  // 重新构建
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.rebuild', async () => {
      await build(true);
    }),
  );

  // 构建并运行（F9）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildAndRun', async () => {
      const ok = await build(false);
      if (ok) await run();
    }),
  );

  // 清理
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.clean', async () => {
      await clean();
    }),
  );

  // 运行
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.run', async () => {
      await run();
    }),
  );

  // 调试
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.debug', async () => {
      await debug();
    }),
  );

  // 选择目标
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.selectTarget', async () => {
      await selectTarget();
    }),
  );

  // 探测编译器
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.detectCompilers', async () => {
      await detectCompilers();
    }),
  );

  // 编译选项面板
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.compilerOptions', async () => {
      const project = requireProject();
      if (!project) return;
      const targetTitle = await selectTarget();
      const target = targetTitle ? project.buildTargets.find((t) => t.title === targetTitle) : undefined;
      CompilerOptionsPanel.show(getCompiler(), project, target, context.extensionUri);
    }),
  );

  // 代码统计
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.codeStats', async () => {
      await showCodeStats();
    }),
  );

  // TODO 列表
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.todoList', async () => {
      await showTodoList();
    }),
  );

  // AStyle 格式化
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.format', async () => {
      await formatActiveDocument();
    }),
  );

  // 自动打开工作区中的 .cbp
  const cbpFiles = vscode.workspace.workspaceFolders
    ? await findCbpFiles(vscode.workspace.workspaceFolders.map((f) => f.uri.fsPath))
    : [];
  if (cbpFiles.length === 1) {
    await openProject(cbpFiles[0]);
  }
  return;
}

async function findCbpFiles(folders: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const folder of folders) {
    results.push(...(await vscode.workspace.findFiles('**/*.cbp', '**/node_modules/**', 5))
      .map((u) => u.fsPath));
  }
  return results;
}

async function openProject(filename: string): Promise<void> {
  try {
    if (filename.endsWith('.workspace')) {
      const ws = new WorkspaceParser().parse(filename);
      const active = ws.activeProject ?? ws.projectPaths[0];
      if (active) {
        await openProject(path.join(ws.basePath, active));
      }
      return;
    }

    const project = new ProjectParser().parse(filename);
    currentProject = project;
    outputChannel.appendLine(`[Code::Blocks] 已打开项目: ${project.title}`);
    outputChannel.appendLine(`  目标: ${project.buildTargets.map((t) => t.title).join(', ')}`);

    // 刷新项目树
    projectTreeProvider?.setProject(project);
    vscode.window.showInformationMessage(`已打开 Code::Blocks 项目: ${project.title}`);
  } catch (err) {
    vscode.window.showErrorMessage(`打开项目失败: ${(err as Error).message}`);
  }
}

function requireProject(): Project | undefined {
  if (!currentProject) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return undefined;
  }
  return currentProject;
}

function getCompiler(): Compiler {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const compilerId = cfg.get<string>('compilerId', 'gcc');
  const masterPath = cfg.get<string>('masterPath', '');
  if (compilerLoader) {
    const compiler = compilerLoader.load(compilerId);
    compiler.masterPath = masterPath;
    return compiler;
  }
  // 回退：内置 GCC
  const { createGccCompiler } = require('./compiler/compiler');
  return createGccCompiler(process.platform, masterPath);
}

async function detectCompilers(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const masterPath = cfg.get<string>('masterPath', '');
  const detected = detectAllCompilers(masterPath);

  if (detected.length === 0) {
    vscode.window.showWarningMessage('未探测到可用的编译器（GCC/Clang/MSVC）');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    detected.map((d) => ({
      label: d.name,
      description: d.version ?? d.masterPath,
      detail: d.cCompilerPath,
      compiler: d,
    })),
    { placeHolder: '选择要使用的编译器' },
  );

  if (picked) {
    await cfg.update('compilerId', picked.compiler.id, vscode.ConfigurationTarget.Global);
    if (picked.compiler.masterPath) {
      await cfg.update('masterPath', picked.compiler.masterPath, vscode.ConfigurationTarget.Global);
    }
    vscode.window.showInformationMessage(`已选择编译器: ${picked.compiler.name}`);
  }
}

async function showCodeStats(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  const files = project.files
    .map((f) => f.absolutePath)
    .filter((p) => isSourceFile(p));

  if (files.length === 0) {
    vscode.window.showWarningMessage('项目没有可统计的源文件');
    return;
  }

  const { perFile, aggregate } = countFiles(files);

  outputChannel.clear();
  outputChannel.appendLine('=== 代码统计 ===');
  outputChannel.appendLine(`文件数: ${aggregate.files}`);
  outputChannel.appendLine(`总行数: ${aggregate.total}`);
  outputChannel.appendLine(`代码行: ${aggregate.code}`);
  outputChannel.appendLine(`注释行: ${aggregate.comment}`);
  outputChannel.appendLine(`空行:   ${aggregate.blank}`);
  outputChannel.appendLine('');
  outputChannel.appendLine('--- 各文件明细 ---');
  for (const s of perFile) {
    outputChannel.appendLine(
      `${s.filename}\t总${s.total} 码${s.code} 注${s.comment} 空${s.blank}`,
    );
  }
  outputChannel.show(true);
}

async function showTodoList(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  const files = project.files.map((f) => f.absolutePath);
  const todos = scanTodos(files);

  if (todos.length === 0) {
    vscode.window.showInformationMessage('项目中没有 TODO/FIXME/NOTE 标记');
    return;
  }

  outputChannel.clear();
  outputChannel.appendLine(`=== TODO 列表 (${todos.length} 项) ===`);
  for (const t of todos) {
    const loc = `${path.basename(t.filename)}:${t.line}`;
    const user = t.user ? ` [${t.user}]` : '';
    outputChannel.appendLine(`${t.type}${user} ${loc}: ${t.text}`);
  }
  outputChannel.show(true);
}

async function selectTarget(): Promise<string | undefined> {
  const project = requireProject();
  if (!project) return undefined;
  const titles = project.buildTargets.map((t) => t.title);
  if (titles.length === 0) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return undefined;
  }
  return vscode.window.showQuickPick(titles, { placeHolder: '选择构建目标' });
}

async function build(rebuild: boolean): Promise<boolean> {
  const project = requireProject();
  if (!project) return false;

  const targetTitle = await selectTarget();
  if (targetTitle === undefined) return false;

  diagnosticCollection.clear();
  outputChannel.clear();
  outputChannel.show(true);

  const engine = new BuildEngine(project, getCompiler(), outputChannel);
  outputChannel.appendLine(`[Code::Blocks] 开始构建 ${rebuild ? '(重新构建)' : ''}...`);

  const ok = await engine.build(targetTitle, {
    rebuild,
    onLine: (line) => outputChannel.appendLine(line),
    onDiagnostic: (diag) => {
      const diags = diagnosticCollection.get(vscode.Uri.file('')) ?? [];
      diagnosticCollection.set(vscode.Uri.file(project!.basePath), [...diags, diag]);
    },
  });

  if (ok) {
    outputChannel.appendLine('[Code::Blocks] 构建成功');
    vscode.window.showInformationMessage('构建成功');
  } else {
    outputChannel.appendLine('[Code::Blocks] 构建失败');
    vscode.window.showErrorMessage('构建失败，请查看输出');
  }
  return ok;
}

async function clean(): Promise<void> {
  const project = requireProject();
  if (!project) return;
  // 简化清理：删除对象输出目录
  for (const target of project.buildTargets) {
    const objDir = target.objectOutput ? path.join(project.basePath, target.objectOutput) : '';
    if (objDir && fs.existsSync(objDir)) {
      fs.rmSync(objDir, { recursive: true, force: true });
    }
  }
  outputChannel.appendLine('[Code::Blocks] 清理完成');
}

async function run(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  const selectedTitle = await selectTarget();
  const target = project.buildTargets.find((t) => t.title === selectedTitle);
  if (!target) return;

  const exePath = path.join(project.basePath, target.outputFilename);
  if (!fs.existsSync(exePath)) {
    vscode.window.showErrorMessage('可执行文件不存在，请先构建');
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `Run: ${target.title}`,
    cwd: project.basePath,
  });
  terminal.show();
  terminal.sendText(`"${exePath}"`);
}

async function debug(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  const selectedTitle = await selectTarget();
  const target = project.buildTargets.find((t) => t.title === selectedTitle);
  if (!target) return;

  const exePath = path.join(project.basePath, target.outputFilename);
  if (!fs.existsSync(exePath)) {
    vscode.window.showErrorMessage('可执行文件不存在，请先构建');
    return;
  }

  // 定位 GDB
  const gdbPath = await locateGdb();
  if (!gdbPath) {
    vscode.window.showErrorMessage('未找到 GDB 调试器，请确认已安装 MinGW/gdb');
    return;
  }

  const started = await vscode.debug.startDebugging(undefined, {
    type: 'codeblocks',
    name: `Debug: ${target.title}`,
    request: 'launch',
    program: exePath,
    cwd: project.basePath,
    gdbPath,
  });

  if (!started) {
    vscode.window.showErrorMessage('调试启动失败');
  }
}

/** 定位 GDB 可执行文件 */
async function locateGdb(): Promise<string | undefined> {
  const win = process.platform === 'win32';
  const gdbName = win ? 'gdb.exe' : 'gdb';
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const masterPath = cfg.get<string>('masterPath', '');
  if (masterPath) {
    const gdb = path.join(masterPath, 'bin', gdbName);
    if (fs.existsSync(gdb)) return gdb;
  }
  // PATH 中查找
  const pathVar = process.env.PATH ?? '';
  const sep = win ? ';' : ':';
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    const full = path.join(dir, gdbName);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

export function deactivate(): void {
  if (outputChannel) outputChannel.dispose();
  if (diagnosticCollection) diagnosticCollection.dispose();
}
