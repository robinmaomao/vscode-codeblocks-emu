/**
 * `.workspace` 序列化 —— 对齐 Code::Blocks `WorkspaceLoader::Save`
 * （workspaceloader.cpp / cbworkspace.cpp）。
 *
 * 只写扩展模型已知的字段：工程顺序、active、`<Depends>`。路径统一相对
 * `.workspace` 目录、正斜杠分隔；属性值按 XML 转义。
 */
import * as path from 'path';
import { Project } from './types';
import { escapeXmlAttr } from './xml';

export interface WorkspaceProjectEntry {
  /** 相对 .workspace 目录的路径（正斜杠） */
  filename: string;
  active?: boolean;
  /** 相对 .workspace 目录的依赖路径（正斜杠） */
  dependencies?: string[];
}

/** 把绝对路径转为相对 workspace 目录的正斜杠路径 */
export function workspaceRelativePath(basePath: string, file: string): string {
  const rel = path.relative(basePath, file).replace(/\\/g, '/');
  return rel || path.basename(file);
}

/** 由已打开工程 + 依赖图构造 workspace 条目（保持 openProjects 顺序） */
export function buildWorkspaceEntries(
  basePath: string,
  projects: Project[],
  dependencies: Record<string, string[]>,
  activeFilename?: string,
): WorkspaceProjectEntry[] {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const byFile = new Map(projects.map((p) => [norm(p.filename), p]));
  return projects.map((p) => {
    const deps = (dependencies[p.filename] ?? [])
      .filter((d) => byFile.has(norm(d)))
      .map((d) => workspaceRelativePath(basePath, d));
    return {
      filename: workspaceRelativePath(basePath, p.filename),
      active: activeFilename ? norm(activeFilename) === norm(p.filename) : false,
      dependencies: deps.length ? deps : undefined,
    };
  });
}

/** 序列化为完整 `.workspace` XML 文本 */
export function serializeWorkspace(title: string, projects: WorkspaceProjectEntry[]): string {
  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');
  L.push('<CodeBlocks_workspace_file>');
  L.push(`\t<Workspace title="${escapeXmlAttr(title)}">`);
  for (const p of projects) {
    const filename = escapeXmlAttr(p.filename);
    const active = p.active ? ' active="1"' : '';
    if (!p.dependencies?.length) {
      L.push(`\t\t<Project filename="${filename}"${active} />`);
      continue;
    }
    L.push(`\t\t<Project filename="${filename}"${active}>`);
    for (const d of p.dependencies) {
      L.push(`\t\t\t<Depends filename="${escapeXmlAttr(d)}" />`);
    }
    L.push('\t\t</Project>');
  }
  L.push('\t</Workspace>');
  L.push('</CodeBlocks_workspace_file>');
  return L.join('\n') + '\n';
}
