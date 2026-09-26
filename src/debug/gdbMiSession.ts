/**
 * GDB MI 会话 —— 对应 debuggergdb/gdb_driver.cpp 的 ParseOutput 与命令队列
 *
 * 以 `gdb -i=mi` 机器接口模式启动 GDB 子进程，解析 MI 输出：
 *  - 结果记录：   <token>^done|^error[,attr=value...]
 *  - 异步记录：   *stopped|*running,... （exec/status）
 *  - 通知记录：   =thread-created,... （notify）
 *  - 流记录：     ~"console" / @"target" / &"log"
 *
 * 移植自 codeblocks-src/src/plugins/debuggergdb/gdb_driver.cpp（GPL v3，逻辑独立重写）。
 */
import { spawn, ChildProcess } from 'child_process';
import { decodeText } from '../tools/encoding';
import { isUnframedLine } from './miParse';

export interface MiResult {
  token: number;
  status: 'done' | 'error' | 'running';
  attrs: Record<string, string>;
  raw: string;
}

export interface MiAsync {
  kind: 'exec' | 'status' | 'notify';
  record: string;       // stopped / running / thread-created ...
  attrs: Record<string, string>;
  raw: string;
}

export interface GdbOptions {
  gdbPath: string;
  /** 仅作为信息保留；实际由适配器经 -file-exec-and-symbols 注入（见 start 注释） */
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class GdbMiSession {
  private proc: ChildProcess | null = null;
  private token = 0;
  private pending = new Map<number, { resolve: (r: MiResult) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private stopped = false;
  private readonly timeoutMs: number;

  constructor(timeoutMs = 30000) {
    this.timeoutMs = timeoutMs;
  }

  onAsyncRecord: ((rec: MiAsync) => void) | null = null;
  onConsole: ((text: string) => void) | null = null;
  onLog: ((text: string) => void) | null = null;
  onTargetOutput: ((text: string) => void) | null = null;
  onExit: ((code: number | null) => void) | null = null;

  /** 启动 GDB MI */
  start(opts: GdbOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // 第五十轮修复：程序/参数**不**作为命令行位置参数传入 —— MinGW GDB（已实证）会把含空格的
      // 路径按空格二次切分；改由适配器会话建立后用 MI 注入：-file-exec-and-symbols / -exec-arguments。
      // R5：opts.args = 用户附加参数（对齐 CB debugger settings user arguments）。
      const args = ['-i=mi', '--quiet', ...(opts.args ?? [])];

      this.proc = spawn(opts.gdbPath, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
      });

      this.proc.stdout?.on('data', (d: Buffer) => this.feed(this.decodeChunk(d)));
      this.proc.stderr?.on('data', (d: Buffer) => this.feed(this.decodeChunk(d)));
      this.proc.on('error', (err) => reject(err));
      this.proc.on('exit', (code) => {
        this.onExit?.(code);
        // 拒绝所有 pending
        for (const [, p] of this.pending) p.reject(new Error('GDB 进程已退出'));
        this.pending.clear();
        this.proc = null;
      });

      // 等待 GDB 就绪（发送一个空命令探测）
      this.send('-gdb-version')
        .then(() => resolve())
        .catch(reject);
    });
  }

  /** 发送 MI 命令并等待结果记录 */
  send(command: string, rawArgs: Record<string, string> = {}): Promise<MiResult> {
    if (!this.proc) return Promise.reject(new Error('GDB 未启动'));
    const token = ++this.token;
    const argStr = Object.entries(rawArgs)
      .map(([k, v]) => ` ${k}="${this.escape(v)}"`)
      .join('');
    const line = `${token}${command}${argStr}\n`;
    this.proc.stdin?.write(line);

    return new Promise<MiResult>((resolve, reject) => {
      this.pending.set(token, { resolve, reject });
      // 超时保护
      setTimeout(() => {
        if (this.pending.has(token)) {
          this.pending.delete(token);
          reject(new Error(`GDB 命令超时: ${command}`));
        }
      }, this.timeoutMs);
    });
  }

  /** 发送命令，忽略结果（用于无需等待的场景） */
  sendAsync(command: string): void {
    if (!this.proc) return;
    const token = ++this.token;
    this.proc.stdin?.write(`${token}${command}\n`);
  }

  /** 发送带位置参数的 MI 命令（如 -var-create / -var-list-children） */
  sendPositional(command: string, positionalArgs: string[] = []): Promise<MiResult> {
    if (!this.proc) return Promise.reject(new Error('GDB 未启动'));
    const token = ++this.token;
    const argStr = positionalArgs.map((a) => ` ${this.miQuote(a)}`).join('');
    const line = `${token}${command}${argStr}\n`;
    this.proc.stdin?.write(line);

    return new Promise<MiResult>((resolve, reject) => {
      this.pending.set(token, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(token)) {
          this.pending.delete(token);
          reject(new Error(`GDB 命令超时: ${command}`));
        }
      }, this.timeoutMs);
    });
  }

  /**
   * 发送「选项参数 + 位置参数」混合的 MI 命令。
   * 选项（如 -break-insert 的 -f/-l/-c）序列化为 ` -key value`；
   * 位置参数（如函数名、表达式）序列化为 ` value`。
   */
  sendMi(command: string, options: Record<string, string> = {}, positionalArgs: string[] = []): Promise<MiResult> {
    if (!this.proc) return Promise.reject(new Error('GDB 未启动'));
    const token = ++this.token;
    const optStr = Object.entries(options)
      .map(([k, v]) => ` -${k} ${this.miQuote(v)}`)
      .join('');
    const posStr = positionalArgs.map((a) => ` ${this.miQuote(a)}`).join('');
    const line = `${token}${command}${optStr}${posStr}\n`;
    this.proc.stdin?.write(line);

    return new Promise<MiResult>((resolve, reject) => {
      this.pending.set(token, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(token)) {
          this.pending.delete(token);
          reject(new Error(`GDB 命令超时: ${command}`));
        }
      }, this.timeoutMs);
    });
  }

  /**
   * 原样发送 MI 命令行（调用方自行控制引号/参数，如 `-data-disassemble -s 0x1000 -e 0x1100 -- 1`）。
   * 第四十九轮：反汇编/内存/寄存器/用户命令用。
   */
  sendExact(line: string): Promise<MiResult> {
    if (!this.proc) return Promise.reject(new Error('GDB 未启动'));
    const token = ++this.token;
    this.proc.stdin?.write(`${token}${line}\n`);

    return new Promise<MiResult>((resolve, reject) => {
      this.pending.set(token, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(token)) {
          this.pending.delete(token);
          reject(new Error(`GDB 命令超时: ${line}`));
        }
      }, this.timeoutMs);
    });
  }

  /** MI 字符串引号（表达式/路径用；裸标识符不加引号） */
  quote(s: string): string {
    return this.miQuote(s);
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim()) this.parseLine(line);
    }
  }

  /** 解码子进程输出：UTF-8 严格优先，失败回退 GBK（中文 Windows） */
  private decodeChunk(buf: Buffer): string {
    return decodeText(buf);
  }

  private parseLine(line: string): void {
    // 结果记录：token^...
    const resultMatch = line.match(/^(\d+)\^(\w+)(.*)$/);
    if (resultMatch) {
      const token = Number(resultMatch[1]);
      const status = resultMatch[2] as MiResult['status'];
      const attrs = this.parseAttrs(resultMatch[3]);
      const pending = this.pending.get(token);
      if (pending) {
        this.pending.delete(token);
        if (status === 'error') {
          pending.reject(new Error(attrs['msg'] ?? `GDB 错误: ${line}`));
        } else {
          pending.resolve({ token, status, attrs, raw: line });
        }
      }
      return;
    }

    // 异步记录：*... / =... / +...
    if (line.startsWith('*') || line.startsWith('=') || line.startsWith('+')) {
      const kind: MiAsync['kind'] = line.startsWith('*') ? 'exec' : line.startsWith('=') ? 'notify' : 'status';
      const body = line.slice(1);
      const comma = body.indexOf(',');
      const record = comma >= 0 ? body.slice(0, comma) : body;
      const attrs = comma >= 0 ? this.parseAttrs(body.slice(comma)) : {};
      this.onAsyncRecord?.({ kind, record, attrs, raw: line });
      return;
    }

    // 流记录：~"..."
    if (line.startsWith('~')) {
      this.onConsole?.(this.decodeCString(line.slice(1)));
      return;
    }
    if (line.startsWith('@')) {
      this.onTargetOutput?.(this.decodeCString(line.slice(1)));
      return;
    }
    if (line.startsWith('&')) {
      this.onLog?.(this.decodeCString(line.slice(1)));
      return;
    }

    // GDB 就绪提示 (gdb)
    if (line.startsWith('(gdb)')) return;

    // 无 MI 前缀的裸文本：MinGW GDB 实测会把被测程序 stdout/stderr 原样写入管道
    // （既不包 @"…" 也不包 ~"…"）；此前被静默丢弃 → Debug Console 看不到 printf 输出（修复 7）
    if (isUnframedLine(line)) {
      this.onTargetOutput?.(line);
      return;
    }
  }

  /** 解析 MI 的属性列表：key="value" / key=value / key=[...] / key={...} */
  private parseAttrs(s: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const n = s.length;
    let i = 0;
    while (i < n) {
      const c = s[i];
      if (c === ',' || c === ' ' || c === '\t') { i++; continue; }
      // 读取 key
      const keyStart = i;
      while (i < n && s[i] !== '=') i++;
      if (i >= n) break;
      const key = s.slice(keyStart, i);
      i++; // 跳过 '='
      if (i >= n) break;
      let val: string;
      if (s[i] === '"') {
        // 带引号字符串
        i++;
        let out = '';
        while (i < n && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < n) { out += s[i] + s[i + 1]; i += 2; }
          else { out += s[i]; i++; }
        }
        i++; // 跳过闭合引号
        val = this.decodeCString('"' + out + '"');
      } else if (s[i] === '[' || s[i] === '{') {
        // 嵌套列表/元组，原样捕获
        const open = s[i];
        const close = open === '[' ? ']' : '}';
        let depth = 0;
        const start = i;
        while (i < n) {
          if (s[i] === open) depth++;
          else if (s[i] === close) { depth--; if (depth === 0) { i++; break; } }
          i++;
        }
        val = s.slice(start, i);
      } else {
        // 裸 token
        const start = i;
        while (i < n && s[i] !== ',' && s[i] !== ' ' && s[i] !== '\t') i++;
        val = s.slice(start, i);
      }
      attrs[key] = val;
    }
    return attrs;
  }

  /** 解码 C 字符串字面量（含常见转义与八进制/十六进制转义） */
  private decodeCString(s: string): string {
    if (s.startsWith('"') && s.endsWith('"')) {
      const body = s.slice(1, -1);
      return body.replace(/\\([0-7]{1,3}|x[0-9A-Fa-f]{1,2}|.)/g, (_m, esc: string) => {
        switch (esc) {
          case 'n': return '\n';
          case 't': return '\t';
          case 'r': return '\r';
          case 'b': return '\b';
          case 'f': return '\f';
          case 'v': return '\v';
          case 'a': return '\x07';
          case '0': return '\0';
          case '\\': return '\\';
          case '"': return '"';
          case "'": return "'";
          default:
            if (/^x[0-9A-Fa-f]{1,2}$/.test(esc)) return String.fromCharCode(parseInt(esc.slice(1), 16));
            if (/^[0-7]{1,3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
            return esc; // 未知转义：保留原字符
        }
      });
    }
    return s;
  }

  private escape(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /** MI 值引用：可选变量名用裸标识符，表达式用 "..." 包裹 */
  private miQuote(s: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) return s;
    return `"${this.escape(s)}"`;
  }

  /** 停止 GDB */
  dispose(): void {
    if (this.proc) {
      try { this.proc.stdin?.write('-gdb-exit\n'); } catch { /* ignore */ }
      setTimeout(() => { try { this.proc?.kill(); } catch { /* ignore */ } }, 500);
    }
  }

  isRunning(): boolean {
    return this.proc !== null && !this.stopped;
  }
}
