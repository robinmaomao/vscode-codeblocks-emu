/**
 * 内存 dump 格式化（Examine memory）—— 16 字节/行，hex + ASCII 双列。
 * 纯函数，无 vscode 依赖，便于无头单测。
 */
export function formatMemoryDump(address: number, data: Buffer, addressWidth?: number): string {
  const lines: string[] = [];
  const width = addressWidth ?? (process.arch === 'x64' || process.arch === 'arm64' ? 16 : 8);
  for (let off = 0; off < data.length; off += 16) {
    const row = data.subarray(off, off + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(row, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${(address + off).toString(16).padStart(width, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}
