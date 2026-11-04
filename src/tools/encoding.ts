/**
 * 文本解码工具 —— 子进程输出 / 工程文件编码判定。
 *
 * 背景（实测，MinGW GCC 8.1.0 + 中文 Windows）：
 *  - 同一条编译命令的 stderr 里可能**混排**多种编码：文件路径按系统 ANSI 代码页（GBK）
 *    输出，而源码摘录行按源文件的 UTF-8 字节原样输出；
 *  - 子进程输出是**分块**到达的，UTF-8/GBK 多字节字符可能跨块；按块独立解码会产生错字。
 *
 * 因此提供三层能力：
 *  1. `decodeText`             —— 整段解码（UTF-8 严格优先 → GBK 回退），保持既有语义；
 *  2. `decodeOutputLines` /
 *     `OutputLineDecoder`      —— **按完整行**逐行判定编码（流式安全），供构建/脚本/工具输出使用；
 *  3. `decodeTextWithEncoding` /
 *     `encodeText`             —— 读写 `.cbp` 等文本文件时保留原编码（旧 ANSI 工程不被静默转码）。
 */

import { spawnSync } from 'child_process';

/** 文本文件编码（`.cbp` 回写用；只区分扩展实际会遇到的两种） */
export type TextEncoding = 'utf-8' | 'gbk';

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const gbkLoose = new TextDecoder('gbk');

/** 整段解码：UTF-8 严格优先，失败回退 GBK（string 入参原样返回，兼容已解码的调用方/测试桩） */
export function decodeText(buf: Buffer | string): string {
  if (typeof buf === 'string') return buf;
  try {
    return utf8Fatal.decode(buf);
  } catch {
    return gbkLoose.decode(buf);
  }
}

/** 解码单个非 ASCII 行：UTF-8 严格优先，失败回退 GBK（ASCII 行由调用方直通） */
function decodeLineBytes(line: Buffer): string {
  if (!line.length) return '';
  // 纯 ASCII：两种编码等价，直接按 latin1 复制（比 TextDecoder 快）
  let ascii = true;
  for (let i = 0; i < line.length; i++) {
    if (line[i] > 0x7f) {
      ascii = false;
      break;
    }
  }
  const text = ascii ? line.toString('latin1') : decodeText(line);
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

/**
 * 整段输出按**完整行**解码：先尝试整段 UTF-8（快路径，绝大多数构建），
 * 失败则按 `\n` 切分原始字节逐行判定编码 —— 修复同一命令输出 GBK/UTF-8 混排的乱码。
 * `\n` 不会出现在 UTF-8/GBK 多字节序列内部，切分安全。返回行**不含**行尾 `\r`，且不含末尾空项。
 */
export function decodeOutputLines(buf: Buffer): string[] {
  if (!buf.length) return [];
  try {
    const text = utf8Fatal.decode(buf);
    const lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  } catch {
    /* 含非 UTF-8 字节：逐行判定 */
  }
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      if (i === buf.length && start === i) break; // 末尾换行后不再追加空项
      out.push(decodeLineBytes(buf.subarray(start, i)));
      start = i + 1;
    }
  }
  return out;
}

/** 一组已解码的完整输出（`text` 保留换行，供累计日志；`lines` 已去行尾 \r） */
export interface DecodedOutput {
  text: string;
  lines: string[];
}

/** 把一个「以 \n 结尾的完整行块」解码为 text + lines */
function decodeBlock(buf: Buffer): DecodedOutput {
  const lines = decodeOutputLines(buf);
  const text = lines.length ? lines.join('\n') + (buf[buf.length - 1] === 0x0a ? '\n' : '') : '';
  return { text, lines };
}

/**
 * 流式行解码器：喂入任意分块，返回其中已完整的行；未结束的行（含跨块的多字节字符）
 * 保留到下一次 push / flush —— 修复「按块独立解码」把汉字拆成错字的问题。
 */
export class OutputLineDecoder {
  private tail: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): DecodedOutput {
    if (!chunk.length) return { text: '', lines: [] };
    const buf = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk;
    const nl = buf.lastIndexOf(0x0a);
    if (nl < 0) {
      this.tail = buf;
      return { text: '', lines: [] };
    }
    this.tail = buf.subarray(nl + 1);
    return decodeBlock(buf.subarray(0, nl + 1));
  }

  /** 命令结束：取出最后一行（无换行结尾） */
  flush(): DecodedOutput {
    if (!this.tail.length) return { text: '', lines: [] };
    const line = decodeLineBytes(this.tail);
    this.tail = Buffer.alloc(0);
    return line ? { text: line, lines: [line] } : { text: '', lines: [] };
  }
}

/**
 * 读取文本文件并判定编码：UTF-8（含 BOM）严格优先，失败回退 GBK。
 * 用于 `.cbp`/`.workspace`：旧工程可能按 ANSI 保存，直接 utf-8 读会把中文标题/路径读成乱码。
 */
export function decodeTextWithEncoding(buf: Buffer): { text: string; encoding: TextEncoding } {
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = hasBom ? buf.subarray(3) : buf;
  try {
    return { text: utf8Fatal.decode(body), encoding: 'utf-8' };
  } catch {
    return { text: gbkLoose.decode(body), encoding: 'gbk' };
  }
}

/** 惰性加载 iconv-lite（不参与热路径；缺失时安全回退 UTF-8） */
function iconvLib(): typeof import('iconv-lite') | undefined {
  try {
    return require('iconv-lite') as typeof import('iconv-lite');
  } catch {
    return undefined;
  }
}

/** 按指定编码编码文本（非 UTF-8 时用 iconv，失败回退 UTF-8） */
export function encodeText(text: string, encoding: TextEncoding): Buffer {
  if (encoding === 'utf-8') return Buffer.from(text, 'utf-8');
  const iconv = iconvLib();
  if (!iconv) return Buffer.from(text, 'utf-8');
  try {
    return iconv.encode(text, 'gbk');
  } catch {
    return Buffer.from(text, 'utf-8');
  }
}

/** iconv-lite 名称（按 Windows ANSI 代码页，对齐 Code::Blocks 用 locale 写盘的语义） */
function codePageToIconvName(cp: number): string {
  switch (cp) {
    case 936: return 'gbk';
    case 950: return 'big5';
    case 932: return 'cp932';
    case 949: return 'cp949';
    case 874: return 'windows-874';
    case 65001: return 'utf-8';
    case 0: break;
    default:
      if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  }
  // 未知代码页：按 locale 猜测（与 $(ENCODING) 宏同口径）
  try {
    if (Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh')) return 'gbk';
  } catch { /* ignore */ }
  return 'windows-1252';
}

let ansiEncodingCache: string | undefined;

/**
 * Windows 系统 ANSI 代码页（`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage\ACP`）→ iconv 名称。
 * 非 Windows 返回 `utf-8`。结果进程内缓存（首次调用一次 reg 查询，≈几毫秒）。
 */
export function windowsAnsiEncoding(): string {
  if (process.platform !== 'win32') return 'utf-8';
  if (ansiEncodingCache) return ansiEncodingCache;
  let cp = 0;
  try {
    const r = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 3000,
    });
    const m = /ACP\s+REG_SZ\s+(\d+)/.exec(decodeText(r.stdout ?? Buffer.alloc(0)));
    if (m) cp = Number(m[1]);
  } catch { /* 查询失败走 locale 回退 */ }
  ansiEncodingCache = codePageToIconvName(cp);
  return ansiEncodingCache;
}

/**
 * 编码"编译器将要读取的文本文件"（响应文件）：GCC/MinGW 按系统 ANSI 代码页解释，
 * 写 UTF-8 会让含中文路径的参数变成乱码/找不到文件（Code::Blocks 亦按 locale 写盘）。
 * 纯 ASCII 内容各编码等价，直接 UTF-8。
 */
export function encodeForAnsiFile(text: string): Buffer {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      const iconv = iconvLib();
      if (!iconv) return Buffer.from(text, 'utf-8');
      try {
        return iconv.encode(text, windowsAnsiEncoding());
      } catch {
        return Buffer.from(text, 'utf-8');
      }
    }
  }
  return Buffer.from(text, 'utf-8');
}
