/**
 * gprof Profiler —— 对齐 Code::Blocks profiler 插件
 * （plugins/contrib/profiler/cbprofiler.cpp:83-255、cbprofilerexec.cpp:44-426）。
 *
 * 实现 gprof 核心链路：运行目标 → 定位 gmon.out → 执行 gprof → flat profile +
 * call graph；`gprof -A` 源码注解与 CSV/HTML 导出由 extension.ts 接线。
 */
import { spawn } from 'child_process';
import { OutputLineDecoder } from './encoding';

export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/** gmon.out 是否比运行前更新（新生成或内容变化）。 */
export function isFreshGmon(before: FileStamp | undefined, after: FileStamp): boolean {
  return !before || before.mtimeMs !== after.mtimeMs || before.size !== after.size;
}

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

export interface GprofCallGraphEdge {
  selfSeconds: number;
  childrenSeconds: number;
  calls: string;
  name: string;
  index: number;
}

export interface GprofCallGraphEntry {
  index: number;
  percent: number;
  selfSeconds: number;
  childrenSeconds: number;
  called: string;
  name: string;
  callers: GprofCallGraphEdge[];
}

/**
 * 解析 gprof call graph。调用者边位于被调用函数条目的前面，
 * 因此按顺序累积后挂到下一个 `[n]` 条目上。
 */
export function parseGprofCallGraph(text: string): GprofCallGraphEntry[] {
  const entries: GprofCallGraphEntry[] = [];
  let pending: GprofCallGraphEdge[] = [];
  const entryRe = /^\s*\[(\d+)\]\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(?:([\d+/+-]+)\s+)?(.+?)\s+\[(\d+)\]\s*$/;
  const edgeRe = /^\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([\d+/+-]+|-)\s+(.+?)\s+\[(\d+)\]\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const entry = entryRe.exec(line);
    if (entry) {
      entries.push({
        index: Number(entry[1]),
        percent: Number(entry[2]),
        selfSeconds: Number(entry[3]),
        childrenSeconds: Number(entry[4]),
        called: entry[5] ?? '-',
        name: entry[6],
        callers: pending,
      });
      pending = [];
      continue;
    }
    const edge = edgeRe.exec(line);
    if (edge) {
      pending.push({
        selfSeconds: Number(edge[1]),
        childrenSeconds: Number(edge[2]),
        calls: edge[3],
        name: edge[4],
        index: Number(edge[5]),
      });
    }
  }
  return entries;
}

/** 格式化 call graph 为可读文本（每个条目 + 其调用者）。 */
export function formatProfilerCallGraph(entries: GprofCallGraphEntry[]): string {
  if (!entries.length) return '(no call-graph entries)';
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`[${e.index}] ${e.percent.toFixed(1)}% self=${e.selfSeconds.toFixed(2)}s children=${e.childrenSeconds.toFixed(2)}s called=${e.called} ${e.name}`);
    for (const c of e.callers) {
      lines.push(`    <- [${c.index}] ${c.name} self=${c.selfSeconds.toFixed(2)}s children=${c.childrenSeconds.toFixed(2)}s calls=${c.calls}`);
    }
  }
  return lines.join('\n');
}

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出 flat profile 为 CSV（RFC 4180 转义）。 */
export function profilerRowsToCsv(rows: GprofRow[]): string {
  const header = ['percent', 'cumulative_seconds', 'self_seconds', 'calls', 'self_ms_per_call', 'total_ms_per_call', 'name'];
  const body = rows.map((r) => [
    r.percent, r.cumulativeSeconds, r.selfSeconds, r.calls, r.selfMsPerCall, r.totalMsPerCall, r.name,
  ].map(csvCell).join(','));
  return [header.join(','), ...body].join('\r\n') + '\r\n';
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ProfilerReport {
  target: string;
  executable: string;
  rows: GprofRow[];
  callGraph: GprofCallGraphEntry[];
}

/** 生成自包含的 HTML profiler 报告（flat profile + call graph）。 */
export function profilerReportHtml(report: ProfilerReport): string {
  const flatRows = report.rows.map((r) => `<tr><td>${r.percent.toFixed(2)}</td><td>${r.cumulativeSeconds.toFixed(2)}</td><td>${r.selfSeconds.toFixed(2)}</td><td>${r.calls === null ? '-' : r.calls}</td><td>${r.selfMsPerCall.toFixed(2)}</td><td>${r.totalMsPerCall.toFixed(2)}</td><td>${escapeHtmlText(r.name)}</td></tr>`).join('\n');
  const graphRows = report.callGraph.map((e) => {
    const callers = e.callers.map((c) => `${escapeHtmlText(c.name)} [${c.index}] (${c.calls})`).join('<br>');
    return `<tr><td>${e.index}</td><td>${e.percent.toFixed(1)}</td><td>${e.selfSeconds.toFixed(2)}</td><td>${e.childrenSeconds.toFixed(2)}</td><td>${escapeHtmlText(e.called)}</td><td>${escapeHtmlText(e.name)}</td><td>${callers || '-'}</td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>gprof report - ${escapeHtmlText(report.target)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f2328}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #d0d7de;padding:4px 8px;text-align:right}th:nth-child(7),td:nth-child(7){text-align:left}th{background:#f6f8fa}code{font-size:12px}</style></head>
<body><h1>gprof report</h1><p>Target: <strong>${escapeHtmlText(report.target)}</strong><br>Executable: <code>${escapeHtmlText(report.executable)}</code></p>
<h2>Flat profile</h2><table><thead><tr><th>% time</th><th>cum. s</th><th>self s</th><th>calls</th><th>self ms/call</th><th>total ms/call</th><th>name</th></tr></thead><tbody>
${flatRows}
</tbody></table>
<h2>Call graph</h2><table><thead><tr><th>index</th><th>% time</th><th>self s</th><th>children s</th><th>called</th><th>name</th><th>callers</th></tr></thead><tbody>
${graphRows}
</tbody></table></body></html>`;
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
