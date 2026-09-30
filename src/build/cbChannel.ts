/**
 * 构建输出通道抽象 —— 输出清理核查（A/B 方案）
 *
 * 扩展的「Code::Blocks」输出通道原先固定用日志通道（`createOutputChannel(name, { log: true })`），
 * 内容写盘持久化，窗口重载后历史仍在、难以清空。
 * 设置 `codeblocks.build.persistLog`（默认 false）决定通道类型：
 *  - true  → LogOutputChannel（日志文件留存，跨窗口保留历史；写 %APPDATA%\Code\logs 下 CodeBlocks.log）；
 *  - false → 普通 OutputChannel（内容仅驻留内存，窗口重载即空；clear() 彻底清空）。
 * 两种底层通道统一收敛到本接口，调用方（extension / BuildEngine）零感知。
 */
import * as vscode from 'vscode';

/** 输出通道统一方法集（LogOutputChannel 与 OutputChannel 的公共超集） */
export interface CbOutput {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
  debug(line: string): void;
  trace(line: string): void;
  append(text: string): void;
  appendLine(line: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
  /** 底层通道（调试/特殊场景用） */
  readonly raw: vscode.LogOutputChannel | vscode.OutputChannel;
}

/**
 * 创建构建输出通道。
 * @param persistLog true=日志通道（持久化）；false=普通通道（重载即空，默认）
 * @param opts.plainCb 纯 CB 日志模式判定（开启时不加 ⚠/❌ 标记，保持纯文本）
 * @param opts.timestamp 普通通道每行是否输出时间戳（getter 惰性读取；未提供时默认 true，实际默认值由调用方设置决定）
 *   —— G1：改为函数形式，与 plainCb 同款，修改设置即时生效（无需重载窗口）
 */
export function createCbOutput(
  name: string,
  persistLog: boolean,
  opts: { plainCb?: () => boolean; timestamp?: () => boolean } = {},
): CbOutput {
  if (persistLog) {
    const ch = vscode.window.createOutputChannel(name, { log: true });
    return {
      info: (l) => ch.info(l),
      warn: (l) => ch.warn(l),
      error: (l) => ch.error(l),
      debug: (l) => ch.debug(l),
      trace: (l) => ch.trace(l),
      append: (t) => ch.append(t),
      appendLine: (l) => ch.appendLine(l),
      clear: () => ch.clear(),
      show: (p) => ch.show(p),
      hide: () => ch.hide(),
      dispose: () => ch.dispose(),
      raw: ch,
    };
  }
  // 普通通道：无 info/warn/error/debug 分级——info/warn/error 等价 appendLine；
  // debug/trace 在日志通道默认（Info 级）也不可见，此处直接丢弃以保持可见输出集合不变。
  // 输出清理核查后续：普通模式每行可加时间戳（格式 2026-09-29 15:11:20.222，设置 build.outputTimestamp 控制，默认关）；
  // warn/error 行加 ⚠/❌ 标记（VS Code 输出面板不渲染颜色/ANSI，用文本标记实现高亮；纯 CB 日志模式关闭标记）。
  const ch = vscode.window.createOutputChannel(name);
  const wantTs = opts.timestamp;
  const withTs = (): boolean => (wantTs ? wantTs() : true);
  const stamp = (): string => {
    const d = new Date();
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
      + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} `;
  };
  const line = (l: string): string => (withTs() ? stamp() + l : l);
  const mark = (kind: 'warn' | 'error', l: string): string => {
    const bare = l.trimStart();
    // 已有 ⚠️/❌ 前缀（含 [Code::Blocks] ⚠️/❌ …）不重复加标记
    const hasMark = bare.startsWith('⚠') || bare.startsWith('❌')
      || bare.startsWith('[Code::Blocks] ⚠') || bare.startsWith('[Code::Blocks] ❌');
    if (hasMark) return l;
    return `${kind === 'error' ? '❌' : '⚠️'} ${l}`;
  };
  return {
    info: (l) => ch.appendLine(line(l)),
    warn: (l) => ch.appendLine(line(opts.plainCb?.() ? l : mark('warn', l))),
    error: (l) => ch.appendLine(line(opts.plainCb?.() ? l : mark('error', l))),
    debug: () => { /* 非日志通道丢弃 debug 级输出 */ },
    trace: () => { /* 非日志通道丢弃 trace 级输出 */ },
    append: (t) => ch.append(t),
    appendLine: (l) => ch.appendLine(line(l)),
    clear: () => ch.clear(),
    show: (p) => ch.show(p),
    hide: () => ch.hide(),
    dispose: () => ch.dispose(),
    raw: ch,
  };
}
