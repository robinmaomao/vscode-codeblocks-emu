/**
 * 路径大小写工具 —— 对齐 Code::Blocks 在 Windows 生成命令行时的路径形态。
 *
 * VS Code 工作区 URI / findFiles 返回的路径盘符为小写（如 d:\...），
 * 而 Code::Blocks（从 Explorer 打开）拿到的是大写盘符（D:\...），
 * 二者都会被 GCC 原样写进调试信息（DW_AT_comp_dir / .debug_line），
 * 导致 .a / .o 的 debug 段字节不一致。此处只归一化盘符首字母，不碰其余路径大小写。
 */

/** 盘符首字母大写（仅 win32 且形如 x: 开头；相对路径 / UNC 路径不变） */
export function upperDrive(p: string): string {
  if (process.platform === 'win32' && /^[a-z]:/.test(p)) {
    return p[0].toUpperCase() + p.slice(1);
  }
  return p;
}
