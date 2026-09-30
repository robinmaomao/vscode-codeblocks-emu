/**
 * Tidy 注释（tidycmt 插件移植，第一波 D3）
 *
 * 纯函数：对选中的注释块
 *  1) 对齐所有行首 `*` 到首行列（块首 `斜杠+星号` 或 `*` 所在列）；
 *  2) 规范 `*` 后空格（`*text` → `* text`；空行归一为 `*`）；
 *  3) 闭合行（星号+斜杠）对齐同一列；
 *  4) ASCII 内容超宽（默认 80）按空格贪心换行。
 * 非注释块原样返回；算法幂等（重复执行结果不变）。
 */

export function tidyCommentBlock(text: string, width = 80): string {
  if (!text) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingEol = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (hadTrailingEol) lines.pop();

  // 定位块首与 `*` 列（`*` 对齐到 `/*` 的星号下方 = 缩进+1；裸 `*` 行则用其自身缩进）
  const first = lines[0] ?? '';
  let starCol = -1;
  const openM = first.match(/^(\s*)\/\*+/);
  if (openM) starCol = openM[1].length + 1;
  else {
    const starM = first.match(/^(\s*)\*/);
    if (starM) starCol = starM[1].length;
  }
  if (starCol < 0) return text;

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0 && /^\s*\*+\/\s*$/.test(line)) {
      out.push(' '.repeat(starCol) + '*/');
      continue;
    }
    const m = line.match(/^\s*\*+\s?(.*)$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const content = m[1].trim();
    out.push(content ? ' '.repeat(starCol) + '* ' + content : ' '.repeat(starCol) + '*');
  }

  // ASCII 长行贪心换行（CJK 内容不换行，避免宽度误判）
  const prefix = ' '.repeat(starCol) + '* ';
  const limit = Math.max(20, width - prefix.length);
  const wrapped: string[] = [];
  for (const line of out) {
    if (!line.startsWith(prefix)) {
      wrapped.push(line);
      continue;
    }
    const content = line.slice(prefix.length);
    if (content.length <= limit || !/^[\x00-\x7F]+$/.test(content)) {
      wrapped.push(line);
      continue;
    }
    const words = content.split(' ').filter(Boolean);
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > limit) {
        wrapped.push(prefix + cur);
        cur = w;
      } else {
        cur = cur ? cur + ' ' + w : w;
      }
    }
    if (cur) wrapped.push(prefix + cur);
  }

  return wrapped.join(eol) + (hadTrailingEol ? eol : '');
}
