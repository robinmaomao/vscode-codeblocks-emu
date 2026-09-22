/**
 * 文本解码工具 —— 子进程输出编码判定。
 *
 * Windows 中文区域下 GCC/MinGW/GDB 的报错可能为 GBK，而多数工具（clangd、UTF-8 终端）
 * 输出 UTF-8。统一采用「UTF-8 严格优先，失败回退 GBK」：
 *   - 合法 UTF-8（含纯 ASCII）走 UTF-8；
 *   - 非法 UTF-8 字节序列（GBK 中文字节）自动落到 GBK。
 */

/** 整段解码：UTF-8 严格优先，失败回退 GBK */
export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk', { fatal: false }).decode(buf);
  }
}
