/**
 * AStyle 格式化 —— 对应 astyleplugin.cpp
 *
 * 调用外部 AStyle 可执行文件（或回退到简单缩进规范化）。
 * 移植自 codeblocks-src/src/plugins/astyle（GPL v3，逻辑独立重写）。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

/** 定位 astyle 可执行文件 */
export function locateAstyle(): string | null {
  const win = process.platform === 'win32';
  const name = win ? 'astyle.exe' : 'astyle';
  const pathVar = process.env.PATH ?? '';
  const sep = win ? ';' : ':';
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * 用 AStyle 格式化文件。
 * @returns 格式化后的文本，失败返回 null
 */
export function formatWithAstyle(source: string, options: string[] = ['--style=allman', '--indent=spaces=4']): string | null {
  const astyle = locateAstyle();
  if (!astyle) return null;

  const r = spawnSync(astyle, options, {
    input: source,
    encoding: 'utf8',
  });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout;
}

/**
 * 格式化当前编辑器文档。
 * 优先用 AStyle，回退到 VS Code 内置格式化。
 */
export async function formatActiveDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
  const source = doc.getText();
  const astyleOptions = vscode.workspace.getConfiguration('codeblocks').get<string[]>('astyleOptions', ['--style=allman', '--indent=spaces=4']);

  const formatted = formatWithAstyle(source, astyleOptions);
  if (formatted !== null && formatted !== source) {
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(source.length),
    );
    await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, formatted);
    });
    vscode.window.showInformationMessage('已用 AStyle 格式化');
  } else if (formatted === null) {
    // 回退：VS Code 内置格式化
    try {
      await vscode.commands.executeCommand('editor.action.formatDocument');
    } catch {
      vscode.window.showWarningMessage('未找到 AStyle，且内置格式化不可用');
    }
  }
}
