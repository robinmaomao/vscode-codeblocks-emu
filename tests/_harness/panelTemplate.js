// 面板模板工具的共享实现：从 dist 提取 buildHtml() 模板 + 中和未替换的 `${…}` 插值。
//
// 背景：面板模板里的文案可能带 `${i18n.tr('…')}` 之类的插值（见 docs/国际化.md 批次 2），
// 源码级语法检查若不中和这些插值，内层引号会被误判为语法错误。这里用配平扫描（支持嵌套模板 /
// 字符串 / 注释）把未替换的插值统一替换为字面量 0。

/** 从 dist 面板模块里提取 `return \`…\`;` 的模板内容（含 `${…}` 原样） */
function extractTemplate(distSource, startMarker = 'return `', endMarker = '`;') {
  const s = distSource.indexOf(startMarker);
  if (s < 0) return null;
  const tplStart = s + startMarker.length;
  const e = distSource.indexOf(endMarker, tplStart);
  if (e < 0) return null;
  return distSource.slice(tplStart, e);
}

/** idx 指向 '${' 的 '$'，返回配平的 '}' 之后的位置 */
function skipInterpolation(src, idx) {
  let i = idx + 2;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') { i = skipTemplate(src, i); continue; }
    if (ch === "'" || ch === '"') { i = skipString(src, i, ch); continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }
    i++;
  }
  return i;
}

/** idx 指向字符串起始引号，返回结束引号之后的位置 */
function skipString(src, idx, quote) {
  let i = idx + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** idx 指向嵌套模板的反引号，返回其结束反引号之后的位置 */
function skipTemplate(src, idx) {
  let i = idx + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return i + 1;
    if (ch === '$' && src[i + 1] === '{') { i = skipInterpolation(src, i); continue; }
    i++;
  }
  return i;
}

/** 把模板里所有未替换的 `${…}` 中和为 0（\${ 保持原样） */
function neutralizeInterpolations(template) {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === '\\') { out += template.slice(i, i + 2); i += 2; continue; }
    if (ch === '$' && template[i + 1] === '{') { i = skipInterpolation(template, i); out += '0'; continue; }
    out += ch;
    i++;
  }
  return out;
}
module.exports = { extractTemplate, neutralizeInterpolations };
