/**
 * 构建诊断的「文件 + 行」解析（纯模块，无 vscode 依赖，便于单测）。
 *
 * 背景：链接期错误（`ld` / `gcc` 汇总）的行形态与编译错误不同，常被解析成不合理的位置：
 *  - `func_bt.c:(.text.func_bt_warning_discon+0x2e): undefined reference to 'x'`
 *    → 解析器把整串 `func_bt.c:(.text…)` 当作文件名，且没有行号 ⇒ 跳到不存在的文件、无法定位；
 *  - `func_bt.c:12: undefined reference to 'x'` → 文件名吞掉 `:12`。
 * 另外链接命令的 cwd 通常是工程执行目录，`func_bt.c` 相对路径 join 后往往不存在
 * （源文件在 `platform/app` 之类的子目录），于是 Problems / Build Log 都打不开。
 *
 * 本模块做两件事：
 *  1. **定位文件**：绝对路径 → `cwd` → 工程根 → 工程文件表按 basename 唯一匹配（`.o/.obj` 再回退同名源文件）；
 *  2. **补行号**：从段名 `(.text.<函数>+0xNN)` 里取函数名，在该文件中找到定义/引用行（仅当原本没有行号）。
 *
 * IO 全部注入（`exists` / `readFile`），扩展侧可带缓存，测试侧可用内存表。
 */
import * as path from 'path';

/** 工程文件索引（构造一次，供整次构建复用） */
export interface DiagnosticPathIndex {
  /** 工程根目录（相对路径的第二候选） */
  basePath: string;
  /** 全部工程文件绝对路径（去重、原样大小写） */
  files: string[];
  /** 小写正斜杠 → 绝对路径 */
  byAbs: Map<string, string>;
  /** 小写 basename → 绝对路径[] */
  byBase: Map<string, string[]>;
}

/** 诊断定位的 IO 依赖（扩展侧传 fs，测试侧传内存实现） */
export interface DiagnosticPathIo {
  exists(file: string): boolean;
  readFile(file: string): string | undefined;
}

/** 解析结果：`file` 一定有值；`line` 可能由段名启发式补出 */
export interface ResolvedDiagnosticLocation {
  file: string;
  line?: number;
  column?: number;
}

/** 归一化（小写 + 正斜杠）用于大小写不敏感比较 */
export function normPathKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** 构造工程文件索引 */
export function buildDiagnosticPathIndex(files: string[], basePath: string): DiagnosticPathIndex {
  const byAbs = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  const uniq: string[] = [];
  for (const f of files) {
    if (!f) continue;
    const key = normPathKey(f);
    if (byAbs.has(key)) continue;
    byAbs.set(key, f);
    uniq.push(f);
    const base = path.basename(f).toLowerCase();
    const list = byBase.get(base);
    if (list) list.push(f);
    else byBase.set(base, [f]);
  }
  return { basePath, files: uniq, byAbs, byBase };
}

/**
 * 拆解解析器给出的「文件名」：
 *  - `a.c:(.text.f+0x2e)` → file `a.c`、section `.text.f+0x2e`
 *  - `obj/a.o:a.c:(.text+0x9)` → file `a.c`、section `.text+0x9`（MinGW/GNU ld 的 `<目标文件>:<源文件>` 形态）
 *  - `a.c:12` → file `a.c`、line 12
 */
export function splitDiagnosticFileToken(raw: string): { file: string; line?: number; section?: string } {
  let s = String(raw || '').trim().replace(/^"+|"+$/g, '');
  let section: string | undefined;
  const sec = s.match(/^(.*?):\(([^()]*)\)$/);
  if (sec) {
    s = sec[1];
    section = sec[2];
  }
  // 链接器把「目标文件:源文件」拼在一起（`obj\...\a.o:a.c`）——源文件更能定位到人看的代码
  const objSrc = s.match(/^.*\.(?:o|obj):(.+)$/i);
  if (objSrc) s = objSrc[1];
  let line: number | undefined;
  const ln = s.match(/^(.*?):(\d+)$/);
  if (ln) {
    s = ln[1];
    line = Number(ln[2]);
  }
  return { file: s, line, section };
}

/**
 * 在文件文本中找标识符所在行（1-based）。
 * @param mode `any` = 首次出现（用于段名里的函数名 → 通常是定义）；`call` = 优先「调用处」
 *        （前面没有 `extern`/类型关键字的那次出现，用于未定义符号 → 调用语句）
 */
export function findIdentifierLine(text: string, identifier: string, mode: 'any' | 'call' = 'any'): number | undefined {
  if (!text || !identifier) return undefined;
  const esc = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reCall = new RegExp(`\\b${esc}\\b\\s*\\(`, 'g');
  const declPrefix = /\b(?:extern|static|inline|void|char|short|int|long|float|double|bool|struct|union|enum|const|unsigned|signed|size_t|ssize_t|[us]?int(?:8|16|32|64)_t)\b[^;{}]*$/;
  let first;
  let m: RegExpExecArray | null;
  while ((m = reCall.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineNo = text.slice(0, m.index).split('\n').length;
    if (first === undefined) first = lineNo;
    if (mode === 'any') return lineNo;
    // 调用处：标识符前面没有类型 / 存储类关键字（`extern void f(...)` 声明会被跳过）
    const before = text.slice(lineStart, m.index);
    if (!declPrefix.test(before)) return lineNo;
  }
  if (first !== undefined) return first;
  const plain = new RegExp(`\\b${esc}\\b`).exec(text);
  if (!plain) return undefined;
  return text.slice(0, plain.index).split('\n').length;
}

/** 段名 → 候选标识符（`.text.func_bt_warning_discon+0x2e` → `func_bt_warning_discon`） */
function identifiersFromSection(section: string): string[] {
  const out: string[] = [];
  for (const part of section.split('.')) {
    const name = part.replace(/\+0x[0-9a-fA-F]+\b.*$/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
  }
  return out.reverse(); // 最右段最可能是函数名
}

/**
 * 段名里没有函数名时（MinGW ld 只给 `(.text+0x9)`），退回用**未定义符号名**定位：
 * 调用该符号的那一行正是需要修改的地方。
 */
function identifiersFromMessage(message: string | undefined): string[] {
  if (!message) return [];
  const m = message.match(/undefined reference to\s+[`'"]([^`'"]+)[`'"]/i);
  return m ? [m[1].trim()] : [];
}

/** 把解析器给出的文件路径落到一个真实存在的工程文件上（失败返回 undefined） */
function resolveExistingFile(
  rawFile: string,
  cwd: string,
  index: DiagnosticPathIndex,
  io: DiagnosticPathIo,
): string | undefined {
  const file = rawFile.trim();
  if (!file) return undefined;

  if (path.isAbsolute(file)) {
    if (io.exists(file)) return file;
  } else {
    for (const candidate of [path.join(cwd, file), path.join(index.basePath, file)]) {
      if (io.exists(candidate)) return candidate;
    }
  }

  // 工程文件表按 basename 匹配（链接期常见：只看得到 `func_bt.c` / `func_bt.o`）
  const base = path.basename(file).toLowerCase();
  let matches = index.byBase.get(base) ?? [];
  if (!matches.length) {
    const ext = path.extname(base);
    if (ext === '.o' || ext === '.obj') {
      const stem = base.slice(0, -ext.length);
      const sources = ['.c', '.cpp', '.cc', '.cxx'].flatMap((e) => index.byBase.get(stem + e) ?? []);
      matches = sources;
    }
  }
  if (!matches.length) return undefined;
  if (matches.length === 1) return matches[0];

  // 同名多处：优先「绝对路径以原始相对路径结尾」的那个（如 platform/app/func_bt.c）
  const wanted = normPathKey(file);
  const exact = matches.find((m) => normPathKey(m).endsWith(wanted));
  return exact ?? matches[0];
}

/**
 * 解析一条诊断的文件与行号。
 * @param input 解析器结果里的 file / line / column
 * @param cwd 产生该输出的命令的工作目录
 * @returns undefined = 无法改善（调用方保留原有行为）
 */
export function resolveDiagnosticLocation(
  input: { file?: string; line?: number; column?: number; message?: string },
  cwd: string,
  index: DiagnosticPathIndex,
  io: DiagnosticPathIo,
): ResolvedDiagnosticLocation | undefined {
  if (!input.file) return undefined;

  const token = splitDiagnosticFileToken(input.file);
  const file = resolveExistingFile(token.file, cwd, index, io);
  if (!file) return undefined;

  let line = input.line ?? token.line;
  if (!line) {
    const text = io.readFile(file);
    if (text) {
      // 段名给的是「引用方函数」→ 定位到定义；消息给的是「未定义符号」→ 定位到调用处
      const fromSection = identifiersFromSection(token.section ?? '');
      const fromMessage = identifiersFromMessage(input.message);
      for (const id of fromSection) {
        const found = findIdentifierLine(text, id, 'any');
        if (found) { line = found; break; }
      }
      if (!line) {
        for (const id of fromMessage) {
          const found = findIdentifierLine(text, id, 'call');
          if (found) { line = found; break; }
        }
      }
    }
  }

  // 没有任何改善（文件与「直接 join」的结果相同、行号也没补）→ 交给调用方按原逻辑处理
  const naiveFile = path.isAbsolute(token.file) ? token.file : path.join(cwd, token.file);
  const unchanged = normPathKey(file) === normPathKey(naiveFile) && (line ?? 0) === (input.line ?? 0);
  if (unchanged) return undefined;
  return { file, line, column: input.column };
}

/** 带缓存的解析器工厂（供 BuildEngine 的 resolveFile 使用；缓存按文件路径记忆文本读取） */
export function createDiagnosticResolver(
  index: DiagnosticPathIndex,
  io: DiagnosticPathIo,
): (input: { file?: string; line?: number; column?: number; message?: string }, cwd: string) => ResolvedDiagnosticLocation | undefined {
  const textCache = new Map<string, string | undefined>();
  const cachedIo: DiagnosticPathIo = {
    exists: (f) => io.exists(f),
    readFile: (f) => {
      if (!textCache.has(f)) textCache.set(f, io.readFile(f));
      return textCache.get(f);
    },
  };
  return (input, cwd) => resolveDiagnosticLocation(input, cwd, index, cachedIo);
}
