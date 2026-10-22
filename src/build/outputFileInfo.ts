/**
 * 构建产物体积文案（对齐 Code::Blocks 链接成功行）：
 *
 * ```
 * Output file is Output\bin\app.rv32 with size 478.53 KB
 * ```
 *
 * CB 的实现在 `plugins/compilergcc/compilergcc.cpp` 的 `CompilerGCC::OnJobEnd`：
 * 链接进程（`cmd->isLink`，即 `GetTargetLinkCommands` 插入的 `COMPILER_WAIT_LINK` 标记）退出码为 0 时，
 * 打开 `target->GetOutputFilename()`（已做宏替换、保持原生分隔符）取长度并按档位格式化：
 *
 * ```cpp
 * if (size < 1024)          units = "bytes";  displaySize = size;
 * else if (size < 1048576)  units = "KB";     displaySize = size / 1024.0;
 * else                      units = "MB";     displaySize = size / 1048576.0;
 * msg.Printf("Output file is %s with size %.2f %s", oFile, displaySize, units);
 * ```
 *
 * 即：三档（**无 GB 档**，≥1MiB 一律 MB）、一律两位小数（不足 1KB 也是 `512.00 bytes`，
 * 单位按 CB 原文为小写 `bytes`）、档位判定用 `<`（1024 字节 ⇒ `1.00 KB`）。
 * 文件打不开（产物缺失）时 CB 什么都不打印 —— 故本模块返回 `undefined` 由调用方降级。
 *
 * 纯逻辑（不依赖 vscode），便于无头单测。
 */
import * as fs from 'fs';

const KIB = 1024;
const MIB = 1024 * 1024;

/**
 * 体积文本（CB 对齐：`bytes` / `KB` / `MB` 三档，均两位小数）。
 * @param bytes 文件字节数
 */
export function formatCbFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0.00 bytes';
  if (bytes < KIB) return `${bytes.toFixed(2)} bytes`;
  if (bytes < MIB) return `${(bytes / KIB).toFixed(2)} KB`;
  return `${(bytes / MIB).toFixed(2)} MB`;
}

/**
 * 读取输出文件体积文本；文件不存在 / 非普通文件 / 读取失败 → `undefined`
 * （CB 在产物缺失时不打印体积行，扩展保持一致，由调用方决定降级方式）。
 * @param absPath 输出文件绝对路径
 */
export function outputFileSizeText(absPath: string): string | undefined {
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return undefined;
    return formatCbFileSize(st.size);
  } catch {
    return undefined;
  }
}
