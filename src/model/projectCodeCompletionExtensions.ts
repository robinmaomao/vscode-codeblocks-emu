/**
 * 工程级 C/C++ 解析器配置 —— `<Project><Extensions><code_completion>`
 *
 * 对齐 Code::Blocks codecompletion 插件：
 * - `search_path add="..."`：工程额外解析搜索目录（parsemanager.cpp:950-1006
 *   ParseProjectSearchDirs / SetProjectSearchDirs）
 *
 * 纯函数（无 vscode 依赖），供工程属性保存与生成编译/补全配置共用。
 */

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** 读取 `<Extensions><code_completion><search_path add>` 列表（按文件顺序、去重） */
export function parseProjectCodeCompletionSearchPaths(extensions: unknown): string[] {
  const out: string[] = [];
  const ext = extensions && typeof extensions === 'object' && !Array.isArray(extensions)
    ? (extensions as Record<string, unknown>)
    : undefined;
  if (!ext) return out;
  const ccNode = asArray(ext['code_completion'] as any)[0];
  if (!ccNode || typeof ccNode !== 'object') return out;
  for (const p of asArray((ccNode as Record<string, unknown>)['search_path'] as any)) {
    const add = str(p?.['@_add']).trim();
    if (add && !out.includes(add)) out.push(add);
  }
  return out;
}

/**
 * 写回搜索目录（保留 code_completion 其它子节点与其它扩展节点）：
 * - search_path 整体重建（对齐 SetProjectSearchDirs 的 Clear + 重写）；
 * - 空列表删除 search_path；
 * - code_completion 节点为空则移除，避免写出空节点。
 */
export function applyProjectCodeCompletionSearchPaths(
  extensions: unknown,
  paths: string[],
): Record<string, unknown> {
  const ext = extensions && typeof extensions === 'object' && !Array.isArray(extensions)
    ? { ...(extensions as Record<string, unknown>) }
    : {};
  const prev = asArray(ext['code_completion'] as any)[0];
  const cc: Record<string, unknown> = prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
  delete cc['search_path'];

  const list = (paths ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (list.length) {
    cc['search_path'] = list.map((p) => ({ '@_add': p }));
  }

  if (Object.keys(cc).length) {
    ext['code_completion'] = cc;
  } else {
    delete ext['code_completion'];
  }
  return ext;
}
