import * as fs from 'fs';

/**
 * PE 头部解析（仅取 `DllCharacteristics`）。
 *
 * 用途：`stopOnEntry` 的「程序入口地址兜底」需要事先知道**加载后地址是否等于文件里的地址**。
 * 若镜像置了 `DYNAMICBASE`（ASLR），加载器可能把映像重定位到别的基址 ⇒
 * 「首选 `ImageBase` + 入口 RVA」在运行前是**不可知**的：
 * 该地址断点在 `-exec-run` 时插入失败（实测 GDB 17.1：`Cannot insert breakpoint 1.
 * Cannot access memory at address 0x1400013f0` → `^error,msg="Command aborted."`），
 * 连程序都起不来——比「不首停」更糟，故必须事先排除。
 */

const DOS_MAGIC = 0x5a4d; // 'MZ'
const PE_SIGNATURE = 0x00004550; // 'PE\0\0'
const DOS_HEADER_SIZE = 0x40;
const OPTIONAL_HEADER_DLLCHAR_OFFSET = 70; // PE32 / PE32+ 均在可选头 +70 处
const OPTIONAL_HEADER_PROBE = 24 + OPTIONAL_HEADER_DLLCHAR_OFFSET + 2;

/** 从 DOS 头 + 可选头读出 `DllCharacteristics`（非 PE / 结构不完整 → undefined） */
function readDllCharacteristics(dos: Buffer, readAt: (off: number, len: number) => Buffer | undefined): number | undefined {
  if (dos.length < DOS_HEADER_SIZE || dos.readUInt16LE(0) !== DOS_MAGIC) return undefined;
  const lfanew = dos.readUInt32LE(0x3c);
  if (lfanew < DOS_HEADER_SIZE || lfanew > 0x1000000) return undefined; // 上限防御损坏值
  const pe = readAt(lfanew, OPTIONAL_HEADER_PROBE);
  if (!pe || pe.length < OPTIONAL_HEADER_PROBE) return undefined;
  if (pe.readUInt32LE(0) !== PE_SIGNATURE) return undefined;
  const magic = pe.readUInt16LE(24);
  if (magic !== 0x10b && magic !== 0x20b) return undefined; // PE32 / PE32+
  return pe.readUInt16LE(24 + OPTIONAL_HEADER_DLLCHAR_OFFSET);
}

/**
 * 缓冲区形态的 PE 判断：`true` 表示置了 `DYNAMICBASE`（可重定位基址），
 * `false` 表示固定基址，`undefined` 表示不是 PE（如 ELF）或结构不完整。
 */
export function peDynamicBase(buf: Buffer): boolean | undefined {
  const chars = readDllCharacteristics(buf, (off, len) => buf.subarray(off, Math.min(off + len, buf.length)));
  return chars === undefined ? undefined : (chars & 0x0040) !== 0;
}

/** 文件形态的 PE 判断（只读头部，不把整文件读入内存；不可读/非 PE → undefined） */
export function peDynamicBaseFromFile(file: string): boolean | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const dos = Buffer.alloc(DOS_HEADER_SIZE);
    if (fs.readSync(fd, dos, 0, DOS_HEADER_SIZE, 0) < DOS_HEADER_SIZE) return undefined;
    const chars = readDllCharacteristics(dos, (off, len) => {
      const b = Buffer.alloc(len);
      return fs.readSync(fd!, b, 0, len, off) === len ? b : undefined;
    });
    return chars === undefined ? undefined : (chars & 0x0040) !== 0;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
  }
}
