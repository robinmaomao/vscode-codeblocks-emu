/**
 * CLI / MCP 侧的设置读取（无 vscode 依赖）。
 *
 * 与扩展保持同一份键空间（`codeblocks.*`），来源优先级：
 *   用户 settings.json  <  工作区 .vscode/settings.json  <  CB_* 环境变量
 *
 * VS Code 的 settings.json 是 JSONC（允许注释与尾逗号），因此不能用 JSON.parse 直接读。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CompilerSettingsLike } from '../compiler/compilerFactory';

/** 去掉 JSONC 的注释与尾逗号（字符串内的内容不受影响） */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let quote = '';
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    out += ch;
  }
  // 去尾逗号：,] / ,}
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** 解析 JSONC 文本；失败返回 undefined（不抛，避免坏配置直接阻断 CLI） */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  try {
    const clean = stripJsonComments(text.replace(/^\uFEFF/, ''));
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function readSettingsFile(file: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(file)) return {};
    return parseJsonc(fs.readFileSync(file, 'utf-8')) ?? {};
  } catch {
    return {};
  }
}

/** 用户级 settings.json 的常见位置（按平台） */
export function userSettingsCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    const list = appData
      ? [path.join(appData, 'Code', 'User', 'settings.json'), path.join(appData, 'Code - Insiders', 'User', 'settings.json')]
      : [];
    list.push(path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json'));
    return list;
  }
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json'),
    ];
  }
  return [
    path.join(home, '.config', 'Code', 'User', 'settings.json'),
    path.join(home, '.config', 'Code - Insiders', 'User', 'settings.json'),
  ];
}

/** 从 .cbp 所在目录向上找工作区 .vscode/settings.json */
export function findWorkspaceSettings(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, '.vscode', 'settings.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** CB_* 环境变量 → codeblocks.* 覆盖 */
function envOverrides(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const env = process.env;
  const map: Array<[string, string, (v: string) => unknown]> = [
    ['CB_COMPILER_ID', 'codeblocks.compilerId', (v) => v],
    ['CB_MASTER_PATH', 'codeblocks.masterPath', (v) => v],
    ['CB_MAX_REPORTED_ERRORS', 'codeblocks.maxReportedErrors', (v) => Number(v)],
    ['CB_UI_LANGUAGE', 'codeblocks.ui.language', (v) => v],
    ['CB_COMPILER_PROGRAMS', 'codeblocks.compilerPrograms', (v) => { try { return JSON.parse(v); } catch { return {}; } }],
  ];
  for (const [envKey, settingKey, conv] of map) {
    const raw = env[envKey];
    if (raw !== undefined && raw !== '') out[settingKey] = conv(raw);
  }
  return out;
}

export interface CodeblocksSettings extends CompilerSettingsLike {
  /** 读取 `codeblocks.<key>`，缺省返回 defaultValue */
  get<T>(key: string, defaultValue: T): T;
  /** 实际读到的配置文件（排障用） */
  sources: string[];
  /** 合并后的原始键值（`codeblocks.*` 形式） */
  raw: Record<string, unknown>;
}

export interface LoadSettingsOptions {
  /** .cbp / .workspace 路径；用于定位工作区设置 */
  target?: string;
  /** 覆盖用户设置搜索（测试用） */
  userSettings?: string[];
  /** 关闭环境变量覆盖（测试用） */
  ignoreEnv?: boolean;
}

/** 加载并合并设置 */
export function loadCodeblocksSettings(opts: LoadSettingsOptions = {}): CodeblocksSettings {
  const raw: Record<string, unknown> = {};
  const sources: string[] = [];
  const userFiles = opts.userSettings ?? userSettingsCandidates();
  for (const file of userFiles) {
    const data = readSettingsFile(file);
    if (Object.keys(data).length) { Object.assign(raw, data); sources.push(file); }
  }
  if (opts.target) {
    const ws = findWorkspaceSettings(path.dirname(opts.target));
    if (ws) {
      const data = readSettingsFile(ws);
      Object.assign(raw, data);
      sources.push(ws);
    }
  }
  if (!opts.ignoreEnv) Object.assign(raw, envOverrides());
  return {
    sources,
    raw,
    get<T>(key: string, defaultValue: T): T {
      const full = `codeblocks.${key}`;
      return (full in raw ? raw[full] : defaultValue) as T;
    },
  };
}
