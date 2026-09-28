/**
 * HTML 构建日志 —— 命名 / 时间戳 / 渲染（对齐 Code::Blocks InitBuildLog / SaveBuildLog）
 *
 * CB 取证（compilergcc.cpp）：
 *  - InitBuildLog:3866-3893：文件名 = 工程文件目录 + 工程文件名（去扩展名）+ "_build_log.html"；
 *    工作区构建取 .workspace 文件名；basename 为空时用 "unnamed"；标题 = 工程标题 + " build log"。
 *  - SaveBuildLog:3898-3938：开关 /save_html_build_log（默认 false）关闭时直接返回；
 *    正文含 "Build started on: dd-mm-yyyy at HH:MM.SS" 与 "Build ended on: <同格式>"。
 *  - 保护性差异（记录）：扩展正文为起止时间 + 诊断汇总表（CB 为全量日志文本）；文本做 HTML 转义。
 */
import * as path from 'path';

/** 日志文件名基名：hello-cb.cbp → hello-cb（对齐 wxFileName::GetName()，剥离扩展名） */
export function buildLogBaseName(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

/** CB 时间戳格式 %d-%m-%Y at %H:%M.%S（compilergcc.cpp:3926/3929） */
export function cbTimeStamp(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()} at ${p2(d.getHours())}:${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
}

/** HTML 文本转义（保护性差异：CB 直写） */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 单条诊断（BuildLogDiagnostic 的展示子集） */
export interface HtmlLogDiagnostic {
  severity: string;
  message: string;
  file?: string;
  line?: number;
}

/** 单个工程的日志区块 */
export interface HtmlLogProject {
  projectName: string;
  targetName: string;
  diagnostics: HtmlLogDiagnostic[];
}

/** 渲染 HTML 构建日志（<title> + 起止时间 + 诊断表） */
export function renderHtmlBuildLog(opts: {
  title: string;
  startMs: number;
  endMs: number;
  projects: HtmlLogProject[];
}): string {
  const rows: string[] = [];
  for (const p of opts.projects) {
    rows.push(`<tr><th colspan="4" style="text-align:left">${escapeHtml(p.projectName)} — ${escapeHtml(p.targetName)}</th></tr>`);
    for (const d of p.diagnostics) {
      rows.push(`<tr class="${escapeHtml(d.severity)}"><td>${escapeHtml(d.severity)}</td><td>${escapeHtml(d.file ?? '')}</td><td>${d.line ?? ''}</td><td>${escapeHtml(d.message)}</td></tr>`);
    }
  }
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(opts.title)}</title>`,
    '<style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:2px 6px;font-family:monospace;font-size:12px}.error{color:#c00}.warning{color:#c60}</style>',
    '</head>',
    '<body>',
    '<tt>',
    `Build started on: <u>${cbTimeStamp(opts.startMs)}</u><br />`,
    `Build ended on: <u>${cbTimeStamp(opts.endMs)}</u>`,
    `<table>${rows.join('')}</table>`,
    '</tt>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
