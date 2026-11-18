/**
 * gprof Profiler —— 对齐 Code::Blocks profiler 插件
 * （plugins/contrib/profiler/cbprofiler.cpp:83-255、cbprofilerexec.cpp:44-426）。
 *
 * 仅实现核心链路：运行目标 → 定位 gmon.out → 执行 gprof → 解析 flat profile。
 * 源码注解（gprof -A）与 call graph 交互树为后续增强。
 */
import { spawn } from 'child_process';
import { OutputLineDecoder } from './encoding';

export interface GprofRow {
  percent: number;
  cumulativeSeconds: number;
  selfSeconds: number;
  calls: number | null;
  selfMsPerCall: number;
  totalMsPerCall: number;
  name: string;
}

/** 解析 gprof flat profile 表格（忽略表头/说明；无数据返回空数组） */
export function parseGprofFlatProfile(text: string): GprofRow[] {
  const rows: GprofRow[] = [];
  const re = /^\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+|-)\s+(\d+(?:\.\d+)?|-)\s+(\d+(?:\.\d+)?|-)\s+(.+?)\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    rows.push({
      percent: Number(m[1]),
      cumulativeSeconds: Number(m[2]),
      selfSeconds: Number(m[3]),
      calls: m[4] === '-' ? null : Number(m[4]),
      selfMsPerCall: m[5] === '-' ? 0 : Number(m[5]),
      totalMsPerCall: m[6] === '-' ? 0 : Number(m[6]),
      name: m[7],
    });
  }
  return rows;
}

/** 格式化为可读表格（输出通道/日志） */
export function formatProfilerTable(rows: GprofRow[]): string {
  if (!rows.length) return '(no flat-profile rows)';
  const header = ['% time', 'cum. s', 'self s', 'calls', 'self ms/call', 'total ms/call', 'name'];
  const data = rows.map((r) => [
    r.percent.toFixed(2),
    r.cumulativeSeconds.toFixed(2),
    r.selfSeconds.toFixed(2),
    r.calls === null ? '-' : String(r.calls),
    r.selfMsPerCall.toFixed(2),
    r.totalMsPerCall.toFixed(2),
    r.name,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)));
  const fmt = (cells: string[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padStart(widths[i]))).join('  ');
  return [fmt(header), fmt(widths.map((w) => '-'.repeat(w))), ...data.map(fmt)].join('\n');
}

export interface RunCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * 运行进程并逐行解码输出（GBK/UTF-8）。用于 profiler 的目标运行与 gprof。
 * 挂了 timeoutMs 时超时强杀。
 */
export function runCapture(
  program: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<RunCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      shell: false,
    });
    const outDecoder = new OutputLineDecoder();
    const errDecoder = new OutputLineDecoder();
    const out: string[] = [];
    const err: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
          } else {
            child.kill('SIGKILL');
          }
        } catch { /* 已退出 */ }
      }, options.timeoutMs);
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of outDecoder.push(chunk).lines) { out.push(line); onLine?.(line, 'stdout'); }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of errDecoder.push(chunk).lines) { err.push(line); onLine?.(line, 'stderr'); }
    });
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      for (const line of outDecoder.flush().lines) { out.push(line); onLine?.(line, 'stdout'); }
      for (const line of errDecoder.flush().lines) { err.push(line); onLine?.(line, 'stderr'); }
      resolve({ code, signal, stdout: out.join('\n'), stderr: err.join('\n') });
    });
  });
}
