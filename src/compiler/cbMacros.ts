/**
 * Code::Blocks 宏展开 —— 对齐 macrosmanager.cpp ReplaceMacros（macrosmanager.cpp:659-750）：
 * - `$(#var)` / `$(#var.member)`：全局编译器变量（uservarmanager，值经 UnixFilename 规范化）
 * - 内置日期/时间（NOW/NOW_L/TODAY/TDAY/WEEKDAY 及 _UTC 变体）、COIN/RANDOM
 * - 未命中宏回退环境变量（wxGetEnv 语义；仍无 → 空替换，CB 同）
 * - `$$` → `$`、`%%` → `%` 反转义（CB 非子请求时）
 */
import * as path from 'path';
import { CodeBlocksConfig } from './codeblocksConfig';
import { shortPathWin } from '../tools/pathCase';

/** 懒加载 vscode（无宿主环境时返回 undefined，保证无头测试/脚本可用） */
let vscodeCache: any = null;
function getVscode(): any {
  if (vscodeCache === null) {
    try {
      vscodeCache = require('vscode');
    } catch {
      vscodeCache = false;
    }
  }
  return vscodeCache || undefined;
}

let cachedGcv: Record<string, Record<string, string>> | undefined;

/** 全局编译器变量（懒加载 default.conf + 缓存；无 default.conf 时为空） */
export function globalVariables(): Record<string, Record<string, string>> {
  if (!cachedGcv) {
    const cfg = new CodeBlocksConfig();
    cfg.load();
    cachedGcv = cfg.globalVariables();
  }
  return cachedGcv;
}

/** 清空全局变量缓存（测试用） */
export function resetGlobalVariables(): void {
  cachedGcv = undefined;
}

function dateVars(d: Date): Record<string, string> {
  const p = (n: number): string => String(n).padStart(2, '0');
  const fmt = (utc: boolean): Record<string, string> => {
    const y = utc ? d.getUTCFullYear() : d.getFullYear();
    const mo = utc ? d.getUTCMonth() + 1 : d.getMonth() + 1;
    const day = utc ? d.getUTCDate() : d.getDate();
    const h = utc ? d.getUTCHours() : d.getHours();
    const mi = utc ? d.getUTCMinutes() : d.getMinutes();
    const s = utc ? d.getUTCSeconds() : d.getSeconds();
    const wd = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: utc ? 'UTC' : undefined }).format(d);
    const suffix = utc ? '_UTC' : '';
    return {
      ['TDAY' + suffix]: `${y}${p(mo)}${p(day)}`,
      ['TODAY' + suffix]: `${y}-${p(mo)}-${p(day)}`,
      ['NOW' + suffix]: `${y}-${p(mo)}-${p(day)}-${p(h)}.${p(mi)}`,
      ['NOW_L' + suffix]: `${y}-${p(mo)}-${p(day)}-${p(h)}.${p(mi)}.${p(s)}`,
      ['WEEKDAY' + suffix]: wd,
    };
  };
  return { ...fmt(false), ...fmt(true) };
}

/**
 * 构造内置构建宏（对齐 macrosmanager.cpp:129-459 的构建相关宏 + 应用/工作区/编辑器宏）。
 * 与 scriptRunner.buildMacroVars 同语义（TARGET_OUTPUT_* / PROJECT_*），
 * 额外含 WORKSPACE_*、ACTIVE_EDITOR_*、CODEBLOCKS/APP_PATH/APP-PATH/APPPATH/DATA_PATH。
 */
export function cbBuiltinVars(
  basePath: string,
  outputFilename: string,
  targetTitle: string,
  objectOutput: string,
  projectTitle: string,
  projectFilename: string,
  compilerDir = '',
): Record<string, string> {
  const win = process.platform === 'win32';
  const toNative = (s: string): string => (win ? s.replace(/\//g, '\\') : s);
  const out = toNative(outputFilename);
  const sepIdx = Math.max(out.lastIndexOf('/'), out.lastIndexOf('\\'));
  const outDir = sepIdx >= 0 ? out.slice(0, sepIdx + 1) : '';
  const baseName = sepIdx >= 0 ? out.slice(sepIdx + 1) : out;
  const stem = baseName.replace(/\.[^.]+$/, '');
  const projDir = (win ? basePath.toUpperCase().charAt(0) + basePath.slice(1) : basePath)
    .replace(/[\\/]$/, '') + (win ? '\\' : '/');

  // 工作区目录：多根时取第一个（VS Code 无「当前工作区目录」概念，取首个文件夹回退工程目录）
  let workspaceDir = '';
  let workspaceFilename = '';
  let workspaceName = '';
  let appPath = '';
  let dataPath = '';
  let active: { filename: string; dirname: string; stem: string; ext: string; line: string; column: string } = {
    filename: '', dirname: '', stem: '', ext: '', line: '', column: '',
  };
  try {
    const vs = getVscode();
    const wf = vs?.workspace?.workspaceFolders;
    const wsFile = vs?.workspace?.workspaceFile?.fsPath;
    if (wsFile) {
      workspaceFilename = toNative(String(wsFile));
      workspaceName = path.basename(workspaceFilename, path.extname(workspaceFilename));
    }
    // WORKSPACE_DIR：优先 .code-workspace 文件所在目录（对齐 CB 单一 .workspace 语义），次首个工作区文件夹，回退工程目录
    const wsRoot = wsFile
      ? path.dirname(String(wsFile))
      : wf && wf.length ? String(wf[0].uri.fsPath) : basePath;
    workspaceDir = wsRoot.replace(/[\\/]$/, '') + (win ? '\\' : '/');
    appPath = String(vs?.env?.appRoot ?? '');
    dataPath = String(vs?.env?.globalStorageUri?.fsPath ?? '');
    const editor = vs?.window?.activeTextEditor;
    if (editor) {
      const fsPath = editor.document.uri.fsPath;
      const sep = Math.max(fsPath.lastIndexOf('/'), fsPath.lastIndexOf('\\'));
      active = {
        filename: fsPath,
        dirname: sep >= 0 ? fsPath.slice(0, sep + 1) : '',
        stem: fsPath.slice(sep + 1).replace(/\.[^.]+$/, ''),
        ext: fsPath.slice(sep + 1).match(/\.([^.]+)$/)?.[1] ?? '',
        line: String(editor.selection.active.line + 1),
        column: String(editor.selection.active.character + 1),
      };
    }
  } catch {
    // 无 vscode 宿主（无头测试）：应用/工作区/编辑器宏留空
  }

  return {
    // 目标相关（macrosmanager.cpp:405-409）
    TARGET_OUTPUT_FILE: out,
    TARGET_OUTPUT_FILENAME: baseName,
    TARGET_OUTPUT_BASENAME: stem,
    TARGET_OUTPUT_DIR: outDir,
    TARGET_NAME: targetTitle,
    TARGET_OBJECT_DIR: win
      ? toNative(objectOutput || '.objs/')
      : (objectOutput || '.objs/').replace(/\\/g, '/'),
    // 项目相关（对齐 cbProject::GetTitle / GetFilename 语义）
    PROJECT_DIR: projDir,
    PROJECT_DIRECTORY: projDir,
    PROJECT_NAME: projectTitle,
    PROJECTNAME: projectTitle,
    PROJECT_FILENAME: projectFilename,
    // 目标编译器目录（macrosmanager.cpp:396 MasterPath.GetPathWithSep）
    TARGET_COMPILER_DIR: compilerDir ? toNative(compilerDir.replace(/[\\/]$/, '') + (win ? '\\' : '/')) : '',
    // 工作区（macrosmanager.cpp:180-187）
    WORKSPACE_FILE: workspaceFilename,
    WORKSPACE_FILENAME: workspaceFilename,
    WORKSPACE_FILE_NAME: workspaceFilename,
    WORKSPACEFILE: workspaceFilename,
    WORKSPACEFILENAME: workspaceFilename,
    WORKSPACE_NAME: workspaceName,
    // 工作区（macrosmanager.cpp:187-188）
    WORKSPACE_DIR: toNative(workspaceDir),
    WORKSPACE_DIRECTORY: toNative(workspaceDir),
    // 应用路径（macrosmanager.cpp:129-133）
    CODEBLOCKS: toNative(appPath),
    APP_PATH: toNative(appPath),
    'APP-PATH': toNative(appPath),
    APPPATH: toNative(appPath),
    DATA_PATH: toNative(dataPath),
    'DATA-PATH': toNative(dataPath),
    DATAPATH: toNative(dataPath),
    PLUGINS: appPath ? toNative(path.join(appPath, 'plugins')) : '',
    // 静态宏（macrosmanager.cpp:128-163 ClearProjectKeys）
    AMP: '&',
    PLATFORM: win ? 'msw' : 'unix',
    CMD_NULL: win ? 'NUL' : '/dev/null',
    CMD_CP: win ? 'cmd /c copy' : 'cp --preserve=timestamps',
    CMD_RM: win ? 'cmd /c del' : 'rm',
    CMD_MV: win ? 'cmd /c move' : 'mv',
    CMD_MKDIR: win ? 'cmd /c md' : 'mkdir -p',
    CMD_RMDIR: win ? 'cmd /c rd' : 'rmdir',
    LANGUAGE: (() => { try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ''; } })(),
    ENCODING: win ? ((() => { try { return Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh') ? 'GBK' : 'windows-1252'; } catch { return 'windows-1252'; } })()) : 'UTF-8',
    // 活动编辑器（macrosmanager.cpp:411-426）
    ACTIVE_EDITOR_FILENAME: toNative(active.filename),
    ACTIVE_EDITOR_DIRNAME: toNative(active.dirname),
    ACTIVE_EDITOR_STEM: active.stem,
    ACTIVE_EDITOR_EXT: active.ext,
    ACTIVE_EDITOR_LINE: active.line,
    ACTIVE_EDITOR_LINE_0: String(Math.max(0, Number(active.line) - 1)),
    ACTIVE_EDITOR_COLUMN: active.column,
    ACTIVE_EDITOR_COLUMN_0: String(Math.max(0, Number(active.column) - 1)),
  };
}

/**
 * 展开命令中的 Code::Blocks 宏（对齐 macrosmanager ReplaceMacros 语义）。
 * @param vars 预构造的内置宏（cbBuiltinVars 输出）
 * @param customVars 项目自定义变量（codeblocks_project_custom_variables）
 * @param gcv 全局编译器变量（缺省读 default.conf）
 */
export function replaceCbMacros(
  cmd: string,
  opts: { vars?: Record<string, string>; customVars?: Record<string, string>; gcv?: Record<string, Record<string, string>>; basePath?: string },
): string {
  const vars = opts.vars ?? {};
  const customVars = opts.customVars ?? {};
  const gcv = opts.gcv ?? globalVariables();
  const basePath = opts.basePath ?? process.cwd();
  const dyn = dateVars(new Date());

  const lookup = (raw: string): string => {
    const name = raw.slice(1); // 去 '#'
    if (name.includes('.')) {
      const idx = name.indexOf('.');
      const v = gcv[name.slice(0, idx)];
      if (!v) return '';
      // 对齐 ReplaceMacros：gcv 值经 UnixFilename 规范化（正斜杠）
      return (v[name.slice(idx + 1)] ?? '').replace(/\\/g, '/');
    }
    const v = gcv[name];
    return v ? (v['base'] ?? '').replace(/\\/g, '/') : '';
  };

  const resolve = (name: string): string => {
    if (name.startsWith('#')) return lookup(name);
    if (name === 'COIN') return Math.random() < 0.5 ? '1' : '0';
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 0x10000));
    if (dyn[name] !== undefined) return dyn[name];
    if (vars[name] !== undefined) return vars[name];
    if (customVars[name] !== undefined) return customVars[name];
    // 未命中 → 环境变量回退（CB wxGetEnv）；仍无 → 空替换（CB 同，宏被移除）
    return process.env[name] ?? '';
  };

  let cur = cmd.replace(/\$\$/g, '\u0001CBDOLLAR\u0001');
  // 函数式宏（macrosmanager.cpp:610-628/655-667）在变量替换之前处理（CB 顺序，否则 $TO_... 会被变量正则吞掉）：
  // $TO_ABSOLUTE_PATH{} / $TO_83_PATH{} / $REMOVE_QUOTES{}
  if (cur.includes('$TO_ABSOLUTE_PATH{')) {
    cur = cur.replace(/\$TO_ABSOLUTE_PATH\{([^}]*)\}/g, (_m, p: string) => path.resolve(basePath, p.trim()));
  }
  if (cur.includes('$TO_83_PATH{')) {
    cur = cur.replace(/\$TO_83_PATH\{([^}]*)\}/g, (_m, p: string) => {
      const abs = path.resolve(basePath, p.trim());
      return process.platform === 'win32' ? shortPathWin(abs) : abs;
    });
  }
  if (cur.includes('$REMOVE_QUOTES{')) {
    let guard = 0;
    while (guard++ < 8 && cur.includes('$REMOVE_QUOTES{')) {
      cur = cur.replace(/\$REMOVE_QUOTES\{([^}]*)\}/g, (_m, p: string) => {
        let content = p.trim();
        // 对齐 CB：内容以 $ 开头时先做一次完整宏展开（659-660）
        if (content.startsWith('$')) content = replaceCbMacros(content, opts);
        // 仅当首尾均为引号时剥除（661-664）
        if (content.length > 2 && content.startsWith('"') && content.endsWith('"')) return content.slice(1, -1);
        return content;
      });
    }
  }
  for (let i = 0; i < 5; i++) {
    const next = cur
      .replace(/\$\(([#]?[A-Za-z_][A-Za-z0-9_.]*)\)/g, (_m: string, n: string) => resolve(n))
      .replace(/\$([#]?[A-Za-z_][A-Za-z0-9_.]*)(?![A-Za-z0-9_])/g, (_m: string, n: string) => resolve(n));
    if (next === cur) break;
    cur = next;
  }
  // 反转义（CB 非子请求时：$$→$、%%→%）
  return cur.replace(/\u0001CBDOLLAR\u0001/g, '$').replace(/%%/g, '%');
}
