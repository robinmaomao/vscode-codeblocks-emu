/**
 * AutoVersioning —— 对齐 Code::Blocks AutoVersioning 插件
 * （plugins/contrib/AutoVersioning/AutoVersioning.cpp、avConfig.h、avHeader.cpp）。
 *
 * 覆盖 .cbp `<Extensions><AutoVersioning>` 配置读写、version.h 解析/生成，
 * 以及构建计数与版本递增规则；构建钩子由 extension.ts 负责调用。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '../model/types';
import { writeFileAtomicSync } from '../model/atomicWrite';

export interface AutoVersioningScheme {
  minorMax: number;
  buildMax: number;
  revisionMax: number;
  revisionRandMax: number;
  buildTimesToIncrementMinor: number;
}

export interface AutoVersioningSettings {
  autoincrement: boolean;
  dateDeclarations: boolean;
  useDefine: boolean;
  updateManifest: boolean;
  doAutoIncrement: boolean;
  askToIncrement: boolean;
  language: 'C' | 'C++' | string;
  svn: boolean;
  svnDirectory: string;
  headerPath: string;
}

export interface AutoVersioningCode {
  headerGuard: string;
  namespace: string;
  prefix: string;
}

export interface AutoVersioningChangesLog {
  showChangesEditor: boolean;
  appTitle: string;
  changesLogPath: string;
}

export interface AutoVersioningConfig {
  scheme: AutoVersioningScheme;
  settings: AutoVersioningSettings;
  code: AutoVersioningCode;
  changesLog: AutoVersioningChangesLog;
}

export interface AutoVersioningValues {
  major: number;
  minor: number;
  build: number;
  revision: number;
  buildCount: number;
}

export interface AutoVersioningStatus {
  softwareStatus: string;
  abbreviation: string;
}

export interface AutoVersioningState {
  values: AutoVersioningValues;
  status: AutoVersioningStatus;
  buildHistory: number;
}

export interface AutoVersioningSvnInfo {
  revision: string;
  date: string;
}

export function defaultAutoVersioningConfig(): AutoVersioningConfig {
  return {
    scheme: {
      minorMax: 10,
      buildMax: 0,
      revisionMax: 0,
      revisionRandMax: 10,
      buildTimesToIncrementMinor: 100,
    },
    settings: {
      autoincrement: true,
      dateDeclarations: true,
      useDefine: false,
      updateManifest: false,
      doAutoIncrement: false,
      askToIncrement: false,
      language: 'C++',
      svn: false,
      svnDirectory: '',
      headerPath: 'version.h',
    },
    code: { headerGuard: '', namespace: 'AutoVersion', prefix: '' },
    changesLog: { showChangesEditor: false, appTitle: 'released version %M.%m.%b of %p', changesLogPath: 'ChangesLog.txt' },
  };
}

export function defaultAutoVersioningState(): AutoVersioningState {
  return {
    values: { major: 1, minor: 0, build: 0, revision: 0, buildCount: 1 },
    status: { softwareStatus: 'Alpha', abbreviation: 'a' },
    buildHistory: 0,
  };
}

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | undefined {
  const node = Array.isArray(value) ? value[0] : value;
  return node && typeof node === 'object' ? node as XmlNode : undefined;
}

function extensionsNode(project: Project): XmlNode {
  const current = project.extensions;
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    project.extensions = {};
  }
  return project.extensions as XmlNode;
}

function attr(node: XmlNode | undefined, name: string): unknown {
  return node?.[`@_${name}`];
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function str(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value);
}

/** 读取 `<Extensions><AutoVersioning>`；未配置返回 null。 */
export function readAutoVersioningConfig(project: Project): AutoVersioningConfig | null {
  const node = asNode(extensionsNode(project).AutoVersioning);
  if (!node) return null;
  const d = defaultAutoVersioningConfig();
  const scheme = asNode(node.Scheme);
  const settings = asNode(node.Settings);
  const code = asNode(node.Code);
  const changes = asNode(node.Changes_Log);
  return {
    scheme: {
      minorMax: num(attr(scheme, 'minor_max'), d.scheme.minorMax),
      buildMax: num(attr(scheme, 'build_max'), d.scheme.buildMax),
      revisionMax: num(attr(scheme, 'rev_max'), d.scheme.revisionMax),
      revisionRandMax: num(attr(scheme, 'rev_rand_max'), d.scheme.revisionRandMax),
      buildTimesToIncrementMinor: num(attr(scheme, 'build_times_to_increment_minor'), d.scheme.buildTimesToIncrementMinor),
    },
    settings: {
      autoincrement: bool(attr(settings, 'autoincrement'), d.settings.autoincrement),
      dateDeclarations: bool(attr(settings, 'date_declarations'), d.settings.dateDeclarations),
      useDefine: bool(attr(settings, 'use_define'), d.settings.useDefine),
      updateManifest: bool(attr(settings, 'update_manifest'), d.settings.updateManifest),
      doAutoIncrement: bool(attr(settings, 'do_auto_increment'), d.settings.doAutoIncrement),
      askToIncrement: bool(attr(settings, 'ask_to_increment'), d.settings.askToIncrement),
      language: str(attr(settings, 'language'), d.settings.language),
      svn: bool(attr(settings, 'svn'), d.settings.svn),
      svnDirectory: str(attr(settings, 'svn_directory'), d.settings.svnDirectory),
      headerPath: str(attr(settings, 'header_path'), d.settings.headerPath) || d.settings.headerPath,
    },
    code: {
      headerGuard: str(attr(code, 'header_guard'), d.code.headerGuard),
      namespace: str(attr(code, 'namespace'), d.code.namespace),
      prefix: str(attr(code, 'prefix'), d.code.prefix),
    },
    changesLog: {
      showChangesEditor: bool(attr(changes, 'show_changes_editor'), d.changesLog.showChangesEditor),
      appTitle: str(attr(changes, 'app_title'), d.changesLog.appTitle),
      changesLogPath: str(attr(changes, 'changeslog_path'), d.changesLog.changesLogPath),
    },
  };
}

/** 写入 `<Extensions><AutoVersioning>`（保留插件节点中的未知子元素/属性）。 */
export function writeAutoVersioningConfig(project: Project, config: AutoVersioningConfig): void {
  const ext = extensionsNode(project);
  const previous = asNode(ext.AutoVersioning) ?? {};
  const scheme = asNode(previous.Scheme) ?? {};
  const settings = asNode(previous.Settings) ?? {};
  const code = asNode(previous.Code) ?? {};
  const changes = asNode(previous.Changes_Log) ?? {};
  ext.AutoVersioning = {
    ...previous,
    Scheme: {
      ...scheme,
      '@_minor_max': config.scheme.minorMax,
      '@_build_max': config.scheme.buildMax,
      '@_rev_max': config.scheme.revisionMax,
      '@_rev_rand_max': config.scheme.revisionRandMax,
      '@_build_times_to_increment_minor': config.scheme.buildTimesToIncrementMinor,
    },
    Settings: {
      ...settings,
      '@_autoincrement': config.settings.autoincrement ? 1 : 0,
      '@_date_declarations': config.settings.dateDeclarations ? 1 : 0,
      '@_use_define': config.settings.useDefine ? 1 : 0,
      '@_update_manifest': config.settings.updateManifest ? 1 : 0,
      '@_do_auto_increment': config.settings.doAutoIncrement ? 1 : 0,
      '@_ask_to_increment': config.settings.askToIncrement ? 1 : 0,
      '@_language': config.settings.language,
      '@_svn': config.settings.svn ? 1 : 0,
      '@_svn_directory': config.settings.svnDirectory,
      '@_header_path': config.settings.headerPath,
    },
    Code: {
      ...code,
      '@_header_guard': config.code.headerGuard,
      '@_namespace': config.code.namespace,
      '@_prefix': config.code.prefix,
    },
    Changes_Log: {
      ...changes,
      '@_show_changes_editor': config.changesLog.showChangesEditor ? 1 : 0,
      '@_app_title': config.changesLog.appTitle,
      '@_changeslog_path': config.changesLog.changesLogPath,
    },
  };
}

/** version.h 绝对路径（相对于工程根目录）。 */
export function versionHeaderPath(project: Project, config: AutoVersioningConfig): string {
  return path.resolve(project.basePath, config.settings.headerPath || 'version.h');
}

export interface VersionHeaderWriteResult {
  file: string;
  written: boolean;
}

/**
 * 写入 version.h，但内容完全相同时跳过，避免仅因 mtime 变化触发全量重编译。
 */
export function writeVersionHeaderIfChanged(file: string, text: string): VersionHeaderWriteResult {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === text) {
      return { file, written: false };
    }
  } catch {
    // 读失败按需要写入处理
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomicSync(file, text);
  return { file, written: true };
}

function numericValue(text: string, name: string): number | undefined {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:[A-Za-z_][A-Za-z0-9_]*_)?${name}\\b[^\\S\\r\\n]*(?:=[^\\S\\r\\n]*)?(-?\\d+)`, 'm');
  const m = re.exec(text);
  return m ? Number(m[1]) : undefined;
}

function stringValue(text: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:[A-Za-z_][A-Za-z0-9_]*_)?${name}\\b[^\\r\\n]*?"([^"]*)"`, 'm');
  const m = re.exec(text);
  return m ? m[1] : undefined;
}

/** 从已有 version.h 解析版本状态（字段缺失回退默认值）。 */
export function parseVersionHeader(text: string): AutoVersioningState {
  const d = defaultAutoVersioningState();
  return {
    values: {
      major: numericValue(text, 'MAJOR') ?? d.values.major,
      minor: numericValue(text, 'MINOR') ?? d.values.minor,
      build: numericValue(text, 'BUILD') ?? d.values.build,
      revision: numericValue(text, 'REVISION') ?? d.values.revision,
      buildCount: numericValue(text, 'BUILDS_COUNT') ?? d.values.buildCount,
    },
    status: {
      softwareStatus: stringValue(text, 'STATUS') ?? d.status.softwareStatus,
      abbreviation: stringValue(text, 'STATUS_SHORT') ?? d.status.abbreviation,
    },
    buildHistory: numericValue(text, 'BUILD_HISTORY') ?? d.buildHistory,
  };
}

function escapeCString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function headerGuard(config: AutoVersioningConfig): string {
  if (config.code.headerGuard.trim()) return config.code.headerGuard.trim();
  return path.basename(config.settings.headerPath || 'version.h').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase() + '_H';
}

/** 生成 Code::Blocks 兼容的 version.h 文本。 */
export function generateVersionHeader(
  config: AutoVersioningConfig,
  state: AutoVersioningState,
  now: Date = new Date(),
  svn?: AutoVersioningSvnInfo,
): string {
  const guard = headerGuard(config);
  const prefix = config.code.prefix ? `${config.code.prefix}_` : '';
  const define = config.settings.useDefine;
  const charDecl = define ? '#define ' : 'static const char ';
  const longDecl = define ? '#define ' : 'static const long ';
  const equal = define ? ' ' : ' = ';
  const array = define ? '' : '[]';
  const end = define ? '' : ';';
  const v = state.values;
  const quote = (s: string): string => `"${escapeCString(s)}"`;
  const L: string[] = [];
  L.push(`#ifndef ${guard}`);
  L.push(`#define ${guard}`);
  L.push('');
  if (config.settings.language === 'C++') {
    L.push(`namespace ${config.code.namespace || 'AutoVersion'}{`);
    L.push('');
  }
  if (config.settings.dateDeclarations) {
    const year = String(now.getFullYear());
    L.push('\t//Date Version Types');
    L.push(`\t${charDecl}${prefix}DATE${array}${equal}${quote(pad2(now.getDate()))}${end}`);
    L.push(`\t${charDecl}${prefix}MONTH${array}${equal}${quote(pad2(now.getMonth() + 1))}${end}`);
    L.push(`\t${charDecl}${prefix}YEAR${array}${equal}${quote(year)}${end}`);
    L.push(`\t${charDecl}${prefix}UBUNTU_VERSION_STYLE${array}${equal}${quote(`${year.slice(-2)}.${pad2(now.getMonth() + 1)}`)}${end}`);
    L.push('');
  }
  L.push('\t//Software Status');
  L.push(`\t${charDecl}${prefix}STATUS${array}${equal}${quote(state.status.softwareStatus)}${end}`);
  L.push(`\t${charDecl}${prefix}STATUS_SHORT${array}${equal}${quote(state.status.abbreviation)}${end}`);
  L.push('');
  L.push('\t//Standard Version Type');
  L.push(`\t${longDecl}${prefix}MAJOR${equal}${v.major}${end}`);
  L.push(`\t${longDecl}${prefix}MINOR${equal}${v.minor}${end}`);
  L.push(`\t${longDecl}${prefix}BUILD${equal}${v.build}${end}`);
  L.push(`\t${longDecl}${prefix}REVISION${equal}${v.revision}${end}`);
  L.push('');
  L.push('\t//Miscellaneous Version Types');
  L.push(`\t${longDecl}${prefix}BUILDS_COUNT${equal}${v.buildCount}${end}`);
  L.push(`\t#define ${prefix}RC_FILEVERSION ${v.major},${v.minor},${v.build},${v.revision}`);
  L.push(`\t#define ${prefix}RC_FILEVERSION_STRING "${v.major}, ${v.minor}, ${v.build}, ${v.revision}\\0"`);
  L.push(`\t${charDecl}${prefix}FULLVERSION_STRING${array}${equal}${quote(`${v.major}.${v.minor}.${v.build}.${v.revision}`)}${end}`);
  if (config.settings.svn) {
    L.push('');
    L.push('\t//SVN Version');
    L.push(`\t${charDecl}${prefix}SVN_REVISION${array}${equal}${quote(svn?.revision ?? '')}${end}`);
    L.push(`\t${charDecl}${prefix}SVN_DATE${array}${equal}${quote(svn?.date ?? '')}${end}`);
  }
  L.push('');
  L.push("\t//These values are to keep track of your versioning state, don't modify them.");
  L.push(`\t${longDecl}${prefix}BUILD_HISTORY${equal}${state.buildHistory}${end}`);
  L.push('');
  if (config.settings.language === 'C++') L.push('}');
  L.push(`#endif //${guard}`);
  L.push('');
  return L.join('\n');
}

/**
 * 按 CB CommitChanges 规则递增版本（revision 随机增量、build 上限、minor/major 进位）。
 * `random` 可注入以便测试。
 */
export function incrementVersion(
  state: AutoVersioningState,
  config: AutoVersioningConfig,
  random: () => number = Math.random,
): AutoVersioningState {
  const next: AutoVersioningState = {
    values: { ...state.values },
    status: { ...state.status },
    buildHistory: state.buildHistory,
  };
  const v = next.values;
  const s = config.scheme;
  v.revision += 1 + Math.floor(random() * Math.max(1, s.revisionRandMax));
  if (s.revisionMax !== 0 && v.revision > s.revisionMax) v.revision = 0;
  if (s.buildMax === 0) v.build += 1;
  else if (v.build >= s.buildMax) v.build = 0;
  else v.build += 1;
  if (config.settings.autoincrement) {
    next.buildHistory += 1;
    if (next.buildHistory >= s.buildTimesToIncrementMinor) {
      next.buildHistory = 0;
      v.minor += 1;
    }
    if (v.minor > s.minorMax) {
      v.minor = 0;
      v.major += 1;
    }
  }
  return next;
}

/** 成功构建后递增 build count（CB OnCompilerFinished）。 */
export function bumpBuildCount(state: AutoVersioningState): AutoVersioningState {
  return {
    values: { ...state.values, buildCount: state.values.buildCount + 1 },
    status: { ...state.status },
    buildHistory: state.buildHistory,
  };
}

/** 解析 `1.2.3.4` 形式的版本值（供 AutoVersioning 命令输入）。 */
export function parseVersionValue(text: string): AutoVersioningValues | null {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)\.(\d+)\s*$/.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), build: Number(m[3]), revision: Number(m[4]), buildCount: 1 };
}
