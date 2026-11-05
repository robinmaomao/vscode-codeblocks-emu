/**
 * 工程文件读写（无 vscode 依赖）：编码保持 + 原子写 + 外部修改保护。
 */
import * as fs from 'fs';
import * as path from 'path';
import { Project } from '../model/types';
import type { Workspace } from '../model/types';
import { ProjectParser, WorkspaceParser } from '../model/parser';
import { serializeProject } from '../model/projectWriter';
import { setProjectDependencies } from '../model/workspaceWriter';
import { decodeTextWithEncoding, encodeText, TextEncoding } from '../tools/encoding';
import { readFileSignature } from '../project/projectChangeTracker';
import { fail } from './types';

export type { Workspace };

export interface ProjectText {
  text: string;
  encoding: TextEncoding;
}

/** 校验并规范化 .cbp 路径（必须已存在且是文件） */
export function requireCbpPath(cbp: string | undefined): string {
  if (!cbp || !String(cbp).trim()) fail('invalid-input', 'A .cbp path is required');
  const abs = path.resolve(String(cbp).trim());
  let st: fs.Stats | undefined;
  try {
    st = fs.statSync(abs);
  } catch {
    fail('project-not-found', `Project file not found: ${abs}`);
  }
  if (!st || !st.isFile()) fail('project-not-found', `Not a file: ${abs}`);
  if (path.extname(abs).toLowerCase() !== '.cbp') fail('invalid-input', `Not a .cbp file: ${abs}`);
  return abs;
}

/** 校验 .workspace 路径 */
export function requireWorkspacePath(workspace: string | undefined): string {
  if (!workspace || !String(workspace).trim()) fail('invalid-input', 'A .workspace path is required');
  const abs = path.resolve(String(workspace).trim());
  let st: fs.Stats | undefined;
  try {
    st = fs.statSync(abs);
  } catch {
    fail('workspace-not-found', `Workspace file not found: ${abs}`);
  }
  if (!st || !st.isFile()) fail('workspace-not-found', `Not a file: ${abs}`);
  if (path.extname(abs).toLowerCase() !== '.workspace') fail('invalid-input', `Not a .workspace file: ${abs}`);
  return abs;
}

/** 读取工程文本并识别原编码（GBK 工程写回后不会变成 UTF-8） */
export function readProjectText(file: string): ProjectText {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    fail('io-error', `Failed to read ${file}: ${(err as Error).message}`);
  }
  const decoded = decodeTextWithEncoding(buf);
  return { text: decoded.text, encoding: decoded.encoding };
}

/** 原子写：同目录临时文件 + rename（避免 watcher 读到半个文件） */
export function writeTextAtomic(file: string, text: string, encoding: TextEncoding): void {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, encodeText(text, encoding));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* 清理失败不掩盖原始错误 */ }
    fail('io-error', `Failed to write ${file}: ${(err as Error).message}`);
  }
}

/** 解析 .cbp */
export function loadProject(cbp: string): Project {
  const abs = requireCbpPath(cbp);
  try {
    return new ProjectParser().parse(abs);
  } catch (err) {
    fail('invalid-input', `Failed to parse ${abs}: ${(err as Error).message}`);
  }
}

/** 解析 .workspace */
export function loadWorkspace(file: string): Workspace {
  const abs = requireWorkspacePath(file);
  try {
    return new WorkspaceParser().parse(abs);
  } catch (err) {
    fail('invalid-input', `Failed to parse ${abs}: ${(err as Error).message}`);
  }
}

export interface SaveProjectOptions {
  /** 写前保护：返回 true 表示磁盘已被外部改写，拒绝覆盖 */
  isExternallyModified?: (file: string) => boolean;
  /** 跳过外部修改保护 */
  force?: boolean;
}

/** 规范化序列化并写回 .cbp（编码沿用原文件） */
export function saveProject(project: Project, opts: SaveProjectOptions = {}): void {
  const file = project.filename;
  if (!opts.force && opts.isExternallyModified?.(file)) {
    fail('external-modified', `The project file was modified outside the editor: ${file}`, {
      hint: 'Re-open the project in VS Code, or pass force: true to overwrite.',
    });
  }
  const { encoding } = readProjectText(file);
  writeTextAtomic(file, serializeProject(project), encoding);
}

export interface WriteGuard {
  /** 读取命令开始时的签名（用于检测命令执行期间被外部改写） */
  signature?: ReturnType<typeof readFileSignature>;
}

/** 采集签名（CLI 写前保护用） */
export function captureSignature(file: string): WriteGuard {
  return { signature: readFileSignature(file) };
}

/** 与采集时相比是否已变化 */
export function signatureChanged(file: string, guard: WriteGuard): boolean {
  const now = readFileSignature(file);
  if (!guard.signature || !now) return false;
  return now.mtimeMs !== guard.signature.mtimeMs || now.size !== guard.signature.size;
}

/** 修改 .workspace 的工程依赖（定点改写，保留原格式） */
export function updateWorkspaceDependencies(file: string, projectFilename: string, deps: string[]): boolean {
  const abs = requireWorkspacePath(file);
  const { text, encoding } = readProjectText(abs);
  const next = setProjectDependencies(text, projectFilename, deps);
  if (next === null) return false;
  if (next !== text) writeTextAtomic(abs, next, encoding);
  return true;
}
