/**
 * wxRegEx POSIX 正则 → JS 正则转换（共享工具）
 *
 * CB 编译器 XML 与 default.conf 里的错误正则使用 wxRegEx 语法，
 * JS RegExp 不兼容的部分在此转换（原 optionsLoader.convertPosixRegex 提取共享）。
 */

/** 将 wxRegEx POSIX 字符类转换为 JS 正则 */
export function convertPosixRegex(regex: string): string {
  let out = regex;
  // 处理复合字符类中嵌套的 POSIX 类（如 [][{}()[:blank:]...]）
  out = out.replace(/\[:blank:\]/g, ' \\t');
  // wxWidgets 的 [:alnum:] 在非 UTF-8 模式下等同于 ASCII 字母数字，
  // 但为兼容含中文/CJK 的路径，需拓宽到非 ASCII（\u0080-\uFFFF），
  // 否则编译错误行的文件路径会被截断，导致 Build Log 跳转路径错误。
  out = out.replace(/\[:alnum:\]/g, 'A-Za-z0-9\\u0080-\\uFFFF');
  // wxRegEx 中字符类开头的 ']' 是字面字符，JS 需转义为 '\]'
  // 匹配形如 [][]、[]a、[][ 的「闭合方括号紧跟内容」模式
  out = out.replace(/\[\]/g, '[\\]');
  return out;
}
