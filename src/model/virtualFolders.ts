/**
 * 虚拟文件夹模型操作（对齐 Code::Blocks `cbproject.cpp:1051-1097`）
 *
 * - `RemoveVirtualFolders(folder)`：列表移除（含子级）+ 所有文件 `virtual_path` 前缀匹配**清空**
 *   （文件回根，**绝不删除磁盘文件**）+ `SetModified(true)`；
 * - `ReplaceVirtualFolder(old, new)`：列表与文件 `virtual_path` **前缀替换**（保留子路径）。
 *
 * 保护性差异：CB 用裸 `StartsWith` 前缀匹配（删除 `a` 会误伤 `ab`），本实现用**精确前缀**
 * （等于自身或 `prefix + '/'` 前缀），已在报告 §5 记录。
 */
import { Project, ProjectFile } from './types';

/** 操作结果（供 UI 提示与测试断言） */
export interface VFChangeResult {
  ok: boolean;
  /** 失败原因（ok=false 时有值） */
  reason?: string;
  /** 受影响文件数 */
  affectedFiles: number;
  /** 受影响虚拟文件夹条目数 */
  changedFolders: number;
}

/** 路径是否等于前缀本身或位于其下（精确前缀语义；空前缀 = 根） */
export function isUnderVirtualFolder(name: string, prefix: string): boolean {
  if (!prefix) return true;
  return name === prefix || name.startsWith(`${prefix}/`);
}

/** 前缀替换（保留子路径）：`old` → `n`，`old/sub` → `n/sub`，其余原样 */
export function remapVirtualFolder(name: string, oldName: string, newName: string): string {
  if (name === oldName) return newName;
  if (name.startsWith(`${oldName}/`)) return newName + name.slice(oldName.length);
  return name;
}

/**
 * 校验虚拟文件夹路径。
 * @param allowSlash 是否允许多级路径（新增/改名允许 `a/b`；单名场景传 false）
 */
export function validateVirtualFolderPath(path: string, allowSlash: boolean): string | undefined {
  const p = path.trim();
  if (!p) return '名称不能为空';
  if (p.includes(';')) return '名称不能包含 “;”';
  if (p.includes('\\')) return '名称不能包含 “\\”';
  if (!allowSlash && p.includes('/')) return '名称不能包含 “/”';
  if (p.startsWith('/') || p.endsWith('/')) return '名称不能以 “/” 开头或结尾';
  const segs = p.split('/');
  if (segs.some((s) => s === '')) return '不能出现连续的 “/”';
  if (segs.some((s) => s === '.' || s === '..')) return '不能包含 “.” 或 “..”';
  return undefined;
}

/** 新增虚拟文件夹（多级路径，如 `a/b`；已存在则拒绝） */
export function addVirtualFolder(project: Project, path: string): VFChangeResult {
  const p = path.trim();
  const err = validateVirtualFolderPath(p, true);
  if (err) return { ok: false, reason: err, affectedFiles: 0, changedFolders: 0 };
  if (project.virtualFolders.some((v) => v === p)) {
    return { ok: false, reason: '该虚拟文件夹已存在', affectedFiles: 0, changedFolders: 0 };
  }
  project.virtualFolders.push(p);
  return { ok: true, affectedFiles: 0, changedFolders: 1 };
}

/** 重命名虚拟文件夹（列表与文件 virtual_path 前缀替换，保留子路径；改名后去重） */
export function renameVirtualFolder(project: Project, oldName: string, newName: string): VFChangeResult {
  const n = newName.trim();
  const err = validateVirtualFolderPath(n, true);
  if (err) return { ok: false, reason: err, affectedFiles: 0, changedFolders: 0 };
  if (n === oldName) return { ok: false, reason: '名称未变化', affectedFiles: 0, changedFolders: 0 };

  let changedFolders = 0;
  project.virtualFolders = project.virtualFolders.map((v) => {
    const nv = remapVirtualFolder(v, oldName, n);
    if (nv !== v) changedFolders++;
    return nv;
  });
  // 改名可能与既有条目重名：保留首个
  const seen = new Set<string>();
  project.virtualFolders = project.virtualFolders.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });

  let affectedFiles = 0;
  for (const f of project.files) {
    const nv = remapVirtualFolder(f.virtualFolder, oldName, n);
    if (nv !== f.virtualFolder) {
      f.virtualFolder = nv;
      affectedFiles++;
    }
  }
  return { ok: true, affectedFiles, changedFolders };
}

/** 删除虚拟文件夹（含子级；文件回根，绝不删磁盘文件） */
export function deleteVirtualFolder(project: Project, folder: string): VFChangeResult {
  if (!folder) return { ok: false, reason: '不能删除根目录', affectedFiles: 0, changedFolders: 0 };
  const before = project.virtualFolders.length;
  project.virtualFolders = project.virtualFolders.filter((v) => !isUnderVirtualFolder(v, folder));
  let affectedFiles = 0;
  for (const f of project.files) {
    if (isUnderVirtualFolder(f.virtualFolder, folder)) {
      f.virtualFolder = '';
      affectedFiles++;
    }
  }
  return { ok: true, affectedFiles, changedFolders: before - project.virtualFolders.length };
}

/** 某虚拟文件夹（含子级）下的文件数（删除确认提示用） */
export function countFilesUnderVirtualFolder(project: Project, folder: string): number {
  return project.files.filter((f) => isUnderVirtualFolder(f.virtualFolder, folder)).length;
}

/** 把文件归入虚拟文件夹（`''` = 回根）；仅改模型，磁盘文件不动（对齐 ProjectVirtualFolderDragged） */
export function assignFileToVirtualFolder(file: ProjectFile, folder: string): void {
  file.virtualFolder = folder;
}
