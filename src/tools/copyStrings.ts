/**
 * 提取 C/C++ 双引号字面量 —— 移植 Code::Blocks copystrings 插件
 * （plugins/contrib/copystrings/copystrings.cpp:67-183）。
 *
 * 规则：忽略单引号字符、`//` 与 `/* *\/` 注释；保留双引号与转义序列；
 * 结果去重并按字典序排序（与 CB 的 `map<wxString,bool>` 行为一致）。
 */
export function extractStringLiterals(buffer: string): string[] {
  const found = new Set<string>();
  let mode = 0; // 0 normal, 1 single, 2 double, 3 escaped, 4 single escaped, 5 double escaped, 6 slash, 7 line comment, 8 block comment, 9 block star
  let current = '';
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    switch (mode) {
      case 0:
        if (ch === "'") mode = 1;
        else if (ch === '"') { mode = 2; current = '"'; }
        else if (ch === '\\') mode = 3;
        else if (ch === '/') mode = 6;
        break;
      case 1:
        if (ch === "'") mode = 0;
        else if (ch === '\\') mode = 4;
        break;
      case 2:
        current += ch;
        if (ch === '"') { found.add(current); mode = 0; }
        else if (ch === '\\') mode = 5;
        break;
      case 3:
        mode = 0;
        break;
      case 4:
        mode = 1;
        break;
      case 5:
        current += ch;
        mode = 2;
        break;
      case 6:
        if (ch === '/') mode = 7;
        else if (ch === '*') mode = 8;
        else mode = 0;
        break;
      case 7:
        if (ch === '\n' || ch === '\r') mode = 0;
        break;
      case 8:
        if (ch === '*') mode = 9;
        break;
      case 9:
        if (ch === '/') mode = 0;
        else if (ch === '*') mode = 9;
        else mode = 8;
        break;
      default:
        break;
    }
  }
  return [...found].sort();
}
