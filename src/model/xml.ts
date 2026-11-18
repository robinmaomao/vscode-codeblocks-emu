/**
 * XML 属性值转义/反转义 —— 与 Code::Blocks（TinyXML）写出行为一致。
 *
 * 文本手术（添加/删除/改名 `<Unit>`、切换 compile/link、工作区依赖）在原始 `.cbp` /
 * `.workspace` 文本上按属性值定位：模型里保存的是**解码后**的路径（`A&B`），
 * 磁盘文本里是**编码后**的 `A&amp;B`。两边混用会导致找不到节点或写出非法 XML。
 */

/** 转义 XML 属性值（与 projectWriter/recursiveAdd 的既有实现一致） */
export function escapeXmlAttr(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 反转义 XML 属性值（仅处理属性值里合法的实体；未知实体原样保留） */
export function unescapeXmlAttr(value: string): string {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
