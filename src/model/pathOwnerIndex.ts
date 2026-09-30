/**
 * 路径属主索引（P3）——把「活动工程跟随编辑器 / 共享文件判定」的热路径扫描
 * 移出编辑器切换事件：一次性构建 归一化路径 → 工程列表 的映射后，
 * 每次切换只做 O(1) 查表。
 *
 * 语义与旧实现一致：
 *  - 只统计每个工程的 `project.files`（不含目标文件列表）；
 *  - 归一化 = 反斜杠转正斜杠 + 小写（Windows 大小写不敏感）；
 *  - 「唯一属主」= 恰好一个工程拥有该路径（同一工程重复收录仍算一个）。
 *
 * 纯模块（无 vscode 依赖），便于单测。
 */
import { Project } from './types';

/** 路径归一化（正斜杠 + 小写；与 extension.ts 旧 normPath 相同） */
export function normFilePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export interface PathOwnerIndex {
  /** 归一化绝对路径 → 拥有该文件的工程列表（去重、保持 openProjects 顺序） */
  byPath: Map<string, Project[]>;
  /** 是否存在被多个工程共享的文件（供 hasSharedFiles 直接复用） */
  hasShared: boolean;
}

/** 构建属主索引（O(项目×文件)，仅在工程结构变化后重建一次） */
export function buildPathOwnerIndex(projects: Project[]): PathOwnerIndex {
  const byPath = new Map<string, Project[]>();
  let hasShared = false;
  for (const p of projects) {
    for (const f of p.files ?? []) {
      const key = normFilePath(f.absolutePath || f.relativeFilename);
      const owners = byPath.get(key);
      if (owners) {
        if (!owners.includes(p)) {
          owners.push(p);
          hasShared = true;
        }
      } else {
        byPath.set(key, [p]);
      }
    }
  }
  return { byPath, hasShared };
}

/** 唯一属主查询：恰好一个工程拥有该文件时返回之，否则 undefined（对齐旧 filter(...).length === 1 语义） */
export function findSoleOwner(index: PathOwnerIndex, fsPath: string): Project | undefined {
  const owners = index.byPath.get(normFilePath(fsPath));
  return owners && owners.length === 1 ? owners[0] : undefined;
}
