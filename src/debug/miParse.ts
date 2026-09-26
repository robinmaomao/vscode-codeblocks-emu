/**
 * GDB MI 输出解析纯函数 —— 调试适配器与寄存器视图共用（无 vscode 依赖，可 node 单测）
 *
 * 覆盖：-data-disassemble / -data-list-register-* / -data-read-memory-bytes /
 * 断点表（catchpoint 识别）/ 进程列表（tasklist / ps）。
 * 对应 debuggergdb 中 GDB 输出解析职责（第四十九轮）。
 */

/** MI 字符串反转义（\" 与 \\） */
function unescapeMi(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** 反汇编指令 */
export interface AsmInsn {
  address: string;       // 0x...
  addressValue: number;  // 数值
  instruction: string;   // 汇编文本
  symbol?: string;       // func-name
  file?: string;         // 源码文件（mode 1 混合模式）
  line?: number;         // 源码行
}

/** 拆分 `{...},{...}` 形式的 MI 元组列表（跳过 child= 等前缀） */
export function splitMiTuples(s: string): string[] {
  const out: string[] = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    if (s[i] === ',' || s[i] === ' ' || s[i] === '\t') { i++; continue; }
    while (i < n && s[i] !== '{') i++;
    if (i >= n) break;
    let depth = 0;
    const start = i;
    while (i < n) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
    out.push(s.slice(start, i));
  }
  return out;
}

/** 解析 -data-disassemble 的 asm_insns（mode 0 直列表 / mode 1 源码交织） */
export function parseDisassemble(asmInsns: string): AsmInsn[] {
  const out: AsmInsn[] = [];
  for (const tu of splitMiTuples(asmInsns)) {
    if (/line_asm_insn=/.test(tu)) {
      const fileM = tu.match(/file="((?:\\.|[^"])*)"/);
      const lineM = tu.match(/(?:^|[,{])line="(\d+)"/);
      const inner = tu.slice(tu.indexOf('line_asm_insn='));
      for (const it of splitMiTuples(inner)) {
        const insn = parseInsnTuple(it, fileM ? unescapeMi(fileM[1]) : undefined, lineM ? Number(lineM[1]) : undefined);
        if (insn) out.push(insn);
      }
    } else {
      const insn = parseInsnTuple(tu);
      if (insn) out.push(insn);
    }
  }
  return out;
}

function parseInsnTuple(tu: string, file?: string, line?: number): AsmInsn | null {
  const addrM = tu.match(/address="(0x[0-9a-fA-F]+)"/);
  if (!addrM) return null;
  const instM = tu.match(/inst="((?:\\.|[^"])*)"/);
  const funcM = tu.match(/func-name="((?:\\.|[^"])*)"/);
  return {
    address: addrM[1],
    addressValue: parseInt(addrM[1], 16),
    instruction: instM ? unescapeMi(instM[1]) : '',
    symbol: funcM ? unescapeMi(funcM[1]) : undefined,
    file,
    line,
  };
}

/** 反汇编窗口选择结果 */
export interface DisasmWindow {
  ok: boolean;
  need: 'none' | 'back' | 'forward';
  list: AsmInsn[];
  startIndex: number;
}

/**
 * 按 DAP 语义在完整指令序列中截取窗口：
 * targetAddr = memoryReference + offset（字节）；instructionOffset 为指令条数偏移（可负）。
 */
export function selectWindow(insns: AsmInsn[], targetAddr: number, instructionOffset: number, want: number): DisasmWindow {
  let idx = insns.findIndex((i) => i.addressValue >= targetAddr);
  if (idx < 0) idx = insns.length;
  const start = idx + instructionOffset;
  if (start < 0) return { ok: false, need: 'back', list: [], startIndex: start };
  if (insns.length - start < want) return { ok: false, need: 'forward', list: [], startIndex: start };
  return { ok: true, need: 'none', list: insns.slice(start, start + want), startIndex: start };
}

/** 解析 "a","b","c" 引号列表（register-names 等） */
export function parseQuotedList(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(unescapeMi(m[1]));
  return out;
}

/** 寄存器编号 → 值 */
export interface RegisterValue { number: number; value: string; }

/** 解析 -data-list-register-values 的 register-values */
export function parseRegisterValues(s: string): RegisterValue[] {
  const out: RegisterValue[] = [];
  const re = /number="(\d+)"[^}]*?value="((?:\\.|[^"])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push({ number: Number(m[1]), value: unescapeMi(m[2]) });
  return out;
}

/** 拼接 -data-read-memory-bytes 各块 contents（hex 串） */
export function parseReadMemory(memoryAttr: string): string {
  const parts: string[] = [];
  const re = /contents="([0-9a-fA-F]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(memoryAttr)) !== null) parts.push(m[1]);
  return parts.join('');
}

/** hex → base64（DAP data 字段） */
export function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

/** base64 → hex（DAP writeMemory 入参） */
export function base64ToHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex');
}

/** 解析 -break-list 中的 catchpoint 编号（异常断点维护用） */
export function parseCatchpointNumbers(breakListBody: string): string[] {
  const out: string[] = [];
  for (const tu of splitMiTuples(breakListBody)) {
    if (/type="catchpoint"/.test(tu)) {
      const m = tu.match(/number="(\d+)"/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

/** 进程列表项 */
export interface ProcessInfo { pid: number; name: string; }

/** 解析 Windows `tasklist /FO CSV /NH`（"name","pid",...） */
export function parseTasklist(csv: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m) out.push({ name: m[1], pid: Number(m[2]) });
  }
  return out;
}

/** 解析 POSIX `ps -eo pid,comm`（自动忽略表头） */
export function parsePsList(text: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (m) out.push({ pid: Number(m[1]), name: m[2] });
  }
  return out;
}

/** 指针值 → DAP memoryReference（非指针/非地址值返回 undefined） */
export function pointerMemoryReference(type: string, value: string): string | undefined {
  if (!type.includes('*')) return undefined;
  const m = value.match(/^0x[0-9a-fA-F]+$/);
  return m ? m[0] : undefined;
}

// ---- 第五十轮：栈帧/线程/停止原因/日志断点（修复惰性可选分组正则缺陷） ----

/** 从 tuple 文本提取一个 MI 字段值（去引号 + 反转义） */
function tupleField(t: string, key: string): string | undefined {
  const m = t.match(new RegExp(key + '="((?:\\\\.|[^"])*)"'));
  return m ? unescapeMi(m[1]) : undefined;
}

/** 调用栈帧（逐 tuple 解析；file 优先 fullname） */
export interface StackFrameInfo {
  level: number;
  func?: string;
  file?: string;
  fullname?: string;
  line?: number;
  addr?: string;
}

/**
 * 解析 -stack-list-frames 的 stack 属性。
 * 注：旧实现用 `[^}]*?(?:file="…")?` 惰性可选分组，匹配在 func 后即完成，file/line 永不捕获（已实证）。
 */
export function parseStackFrameTuples(stackAttr: string): StackFrameInfo[] {
  const out: StackFrameInfo[] = [];
  for (const tu of splitMiTuples(stackAttr)) {
    const level = Number(tupleField(tu, 'level'));
    if (!Number.isFinite(level)) continue;
    out.push({
      level,
      func: tupleField(tu, 'func'),
      file: tupleField(tu, 'file'),
      fullname: tupleField(tu, 'fullname'),
      line: tupleField(tu, 'line') !== undefined ? Number(tupleField(tu, 'line')) : undefined,
      addr: tupleField(tu, 'addr'),
    });
  }
  return out;
}

/** 线程信息 */
export interface ThreadInfo {
  id: number;
  name?: string;
  targetId?: string;
}

/** 解析 -thread-info 的 threads 属性（逐 tuple） */
export function parseThreadTuples(threadsAttr: string): ThreadInfo[] {
  const out: ThreadInfo[] = [];
  for (const tu of splitMiTuples(threadsAttr)) {
    const id = Number(tupleField(tu, 'id'));
    if (!Number.isFinite(id)) continue;
    out.push({ id, name: tupleField(tu, 'name'), targetId: tupleField(tu, 'target-id') });
  }
  return out;
}

/** MI *stopped 原因 → DAP StopReason 映射（对齐 DAP 规范枚举） */
const STOP_REASON_MAP: Record<string, string> = {
  'breakpoint-hit': 'breakpoint',
  'function-finished': 'step',
  'end-stepping-range': 'step',
  'location-reached': 'goto',
  'watchpoint-trigger': 'data breakpoint',
  'read-watchpoint-trigger': 'data breakpoint',
  'access-watchpoint-trigger': 'data breakpoint',
  'exception-received': 'exception',
  'signal-received': 'exception',
};

/** 停止原因映射（SIGINT/SIGTRAP 视为用户中断 → pause） */
export function mapStopReason(miReason: string, signalName?: string): string {
  if (miReason === 'signal-received') {
    const sig = (signalName ?? '').toUpperCase();
    if (sig === 'SIGINT' || sig === 'SIGTRAP') return 'pause';
    return 'exception';
  }
  return STOP_REASON_MAP[miReason] ?? 'breakpoint';
}

/** 是否程序退出类停止（需发 exited + terminated 结束会话） */
export function isExitReason(miReason: string): boolean {
  return miReason === 'exited' || miReason === 'exited-normally' || miReason === 'exited-signalled';
}

/** 提取日志断点消息中的 {表达式} 占位（按出现顺序去重） */
export function logpointExpressions(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{([^{}]+)\}/g)) {
    const e = m[1].trim();
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * 断点位置串（第五十轮修复 3）：`源文件:行号`。
 * 注：旧的 `-break-insert -f <文件> -l <行号>` 为非法 MI 语法（报 Garbage following <location>，断点从未插入）；
 * 位置串形式已实证可正常解析并命中（Windows 盘符/空格经 MI 引号安全）。
 */
export function breakpointLocation(sourcePath: string, line: number): string {
  return `${sourcePath}:${line}`;
}

/** bkpt 元组是否为 pending（源码不在已加载调试信息中，插入成功但不会命中） */
export function isPendingBreakpoint(bkptAttr: string): boolean {
  return /pending="/.test(bkptAttr);
}

/**
 * 条件表达式求值结果 → 布尔（第五十轮修复 9）。
 * 输入为 `-data-evaluate-expression` 的 value 文本（如 "1"/"0"/"true"/"false"/"0x5"）。
 */
export function truthyMiValue(value: string): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  if (/^(true|1)$/i.test(v)) return true;
  if (/^(false|0)$/i.test(v)) return false;
  if (/^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16) !== 0;
  const num = Number(v);
  if (Number.isFinite(num)) return num !== 0;
  return /true/i.test(v) || /0x0*[1-9a-f]/i.test(v);
}

/**
 * 是否为「无 MI 前缀的裸文本」行（第五十轮修复 7）。
 * MinGW GDB 8.1 实测：被测程序 stdout/stderr 会原样写入管道——既不包 @"…" 也不包 ~"…"，
 * 形如 `hello-cb: 2 + 3 = 5`；此前被解析器静默丢弃，导致 Debug Console 看不到程序输出。
 */
export function isUnframedLine(line: string): boolean {
  if (!line.trim()) return false;
  const c = line[0];
  if (c === '~' || c === '@' || c === '&' || c === '*' || c === '=' || c === '+' || c === '^') return false;
  if (line.startsWith('(gdb)')) return false;
  if (/^\d+\^/.test(line)) return false;
  return true;
}
