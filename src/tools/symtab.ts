/**
 * 跨库符号搜索 —— 对齐 Code::Blocks SymTab 插件
 * （plugins/contrib/symtab/symtabexec.cpp:64-542、symtabconfig.cpp:188-343）。
 *
 * 输入工程链接的静态库/导入库，执行 `nm -C -A`，解析 `library: address type name`
 * 行并按符号过滤。只做只读查询，不修改工程。
 */
export interface SymbolRow {
  library: string;
  address: string;
  type: string;
  name: string;
}

/**
 * 解析 `nm -A -C` 输出。
 * 兼容：`lib.a:0000000000000000 T foo`、`lib.a:                 U bar`、
 * `0000000000000000 T foo`（无 -A 时 library 为空）。
 */
export function parseNmOutput(output: string, fallbackLibrary = ''): SymbolRow[] {
  const rows: SymbolRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // 贪婪匹配库路径：Windows 盘符 `C:\...\lib.a:...` 中也有冒号
    const withLib = /^(.*):([0-9a-fA-F]*)\s+([A-Za-z?])\s+(.+?)\s*$/.exec(line);
    if (withLib) {
      rows.push({
        library: withLib[1] || fallbackLibrary,
        address: withLib[2],
        type: withLib[3],
        name: withLib[4],
      });
      continue;
    }
    const noLib = /^\s*([0-9a-fA-F]*)\s+([A-Za-z?])\s+(.+?)\s*$/.exec(line);
    if (noLib) {
      rows.push({
        library: fallbackLibrary,
        address: noLib[1],
        type: noLib[2],
        name: noLib[3],
      });
    }
  }
  return rows;
}

/** 按符号名过滤（大小写不敏感；空查询返回全部） */
export function filterSymbols(rows: SymbolRow[], query: string): SymbolRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}
