/**
 * `.cbp` 单元文本手术（保留原文件格式与全部子节点）
 *
 * P3 重命名文件时只需把该 `<Unit>` 的 `filename` 属性值换成新值：
 * 对齐 Code::Blocks `pf->Rename()`（projectmanagerui.cpp:2852-2916 的成功分支），
 * CB 后续保存工程时写入新路径；本扩展采用**最小文本修改**（而非整文件重写），
 * 保证 `<Option>` 子节点、属性顺序、缩进等原样保留。
 */

/** 正则转义 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 `<Unit filename="oldRel" ...>` 的 filename 换成 newRel。
 * 同时覆盖自闭合（`<Unit filename="x" />`）与成对（`<Unit filename="x">…</Unit>`）两种写法——
 * 只改**开标签**中的属性值，子节点与其它属性保持不变。
 * @returns replaced = 是否命中并替换
 */
export function renameUnitInCbpText(raw: string, oldRel: string, newRel: string): { text: string; replaced: boolean } {
  const esc = escapeRegExp(oldRel);
  // 开标签内 filename 之前可能还有其它属性：`<Unit abc="1" filename="old"`
  const re = new RegExp(`<Unit([^>]*?)filename="${esc}"`, 'g');
  let replaced = false;
  const text = raw.replace(re, (_m, pre: string) => {
    replaced = true;
    return `<Unit${pre}filename="${newRel}"`;
  });
  return { text, replaced };
}

/** 统计某 relativeFilename 在 .cbp 中的 `<Unit>` 引用次数（重复参考防护） */
export function countUnitReferences(raw: string, rel: string): number {
  const esc = escapeRegExp(rel);
  const re = new RegExp(`<Unit([^>]*?)filename="${esc}"`, 'g');
  let n = 0;
  while (re.exec(raw)) n++;
  return n;
}
