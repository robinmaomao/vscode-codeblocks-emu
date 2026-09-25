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
 * 函数式宏内容提取：大括号配对（对齐 macrosmanager MatchBrace，支持 {} 嵌套）。
 * @param openBraceIdx '{' 字符下标
 */
function takeBrace(s: string, openBraceIdx: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = openBraceIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { inner: s.slice(openBraceIdx + 1, i), end: i };
    }
  }
  return null;
}

/** 展开命令中的 Code::Blocks 宏（对齐 macrosmanager ReplaceMacros 语义），内部实现带递归深度护栏 */
function replaceCbMacrosInner(
  cmd: string,
  opts: { vars?: Record<string, string>; customVars?: Record<string, string>; gcv?: Record<string, Record<string, string>>; basePath?: string },
  depth: number,
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
  // 函数式宏（macrosmanager.cpp:610-628/655-667）在变量替换之前处理（CB 顺序）：
  // $TO_ABSOLUTE_PATH{} / $TO_83_PATH{} / $REMOVE_QUOTES{}；
  // 大括号配对匹配（MatchBrace），内容递归做完整宏展开（630-653 递归）。
  const applyFunc = (s: string, name: string, fn: (inner: string) => string): string => {
    let out = '';
    let i = 0;
    let guard = 0;
    while (guard++ < 128) {
      const idx = s.indexOf(name + '{', i);
      if (idx === -1) {
        out += s.slice(i);
        break;
      }
      const b = takeBrace(s, idx + name.length);
      if (!b) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, idx);
      const inner = depth < 8 ? replaceCbMacrosInner(b.inner, opts, depth + 1) : b.inner;
      out += fn(inner);
      i = b.end + 1;
    }
    return out;
  };
  cur = applyFunc(cur, '$TO_ABSOLUTE_PATH', (p) => path.resolve(basePath, p.trim()));
  cur = applyFunc(cur, '$TO_83_PATH', (p) => {
    const abs = path.resolve(basePath, p.trim());
    return process.platform === 'win32' ? shortPathWin(abs) : abs;
  });
  cur = applyFunc(cur, '$REMOVE_QUOTES', (content) => {
    const c = content.trim();
    // 仅当首尾均为引号时剥除（661-664）
    if (c.length > 2 && c.startsWith('"') && c.endsWith('"')) return c.slice(1, -1);
    return c;
  });
  // $if 条件块（macrosmanager 条件式）：$if{cond}{then}$else{else}$endif（$else 可选）
  if (cur.includes('$if{')) {
    cur = applyConditional(cur, opts, depth);
  }
  // 变量名内嵌宏：名内的 $(...) 先递归展开（对齐 macrosmanager 变量名内嵌宏）
  const expandName = (rawName: string): string => {
    if (!rawName.includes('$(')) return rawName;
    let nm = rawName;
    let guard = 0;
    while (guard++ < 4 && nm.includes('$(')) {
      const next = nm.replace(/\$\(([#]?[A-Za-z_][A-Za-z0-9_.]*)\)/g, (_m: string, n: string) => resolve(n));
      if (next === nm) break;
      nm = next;
    }
    return nm;
  };
  /** $( 变量扫描（括号配对，名内可含嵌套 $() 宏） */
  const applyVars = (s: string): string => {
    let out = '';
    let i = 0;
    let guard = 0;
    while (guard++ < 256) {
      const idx = s.indexOf('$(', i);
      if (idx === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, idx);
      let depth = 0;
      let close = -1;
      for (let k = idx + 1; k < s.length; k++) {
        const ch = s[k];
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            close = k;
            break;
          }
        }
      }
      if (close === -1) {
        out += s.slice(idx);
        break;
      }
      const rawName = s.slice(idx + 2, close);
      out += resolve(expandName(rawName));
      i = close + 1;
    }
    return out;
  };
  for (let i = 0; i < 5; i++) {
    const next = applyVars(cur)
      .replace(/\$([#]?[A-Za-z_][A-Za-z0-9_.]*)(?![A-Za-z0-9_])/g, (_m: string, n: string) => resolve(n));
    if (next === cur) break;
    cur = next;
  }
  // 反转义（CB 非子请求时：$$→$、%%→%）
  return cur.replace(/\u0001CBDOLLAR\u0001/g, '$').replace(/%%/g, '%');
}

/**
 * $if{cond}{then}$else{else}$endif 条件块处理（$else 可选；条件先完整宏展开，非空且非 '0' 为真）。
 * 嵌套 $if 在 then/else 内递归处理（深度护栏）。
 */
function applyConditional(
  s: string,
  opts: { vars?: Record<string, string>; customVars?: Record<string, string>; gcv?: Record<string, Record<string, string>>; basePath?: string },
  depth: number,
): string {
  let out = '';
  let i = 0;
  let guard = 0;
  while (guard++ < 64) {
    const idx = s.indexOf('$if{', i);
    if (idx === -1) {
      out += s.slice(i);
      break;
    }
    const b = takeBrace(s, idx + 3); // '$if{' → '{' 在 idx+3
    if (!b) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, idx);
    const condExpanded = depth < 8 ? replaceCbMacrosInner(b.inner, opts, depth + 1) : b.inner;
    const condTruthy = condExpanded.trim() !== '' && condExpanded.trim() !== '0';
    const elsePos = s.indexOf('$else{', b.end + 1);
    const endifPos = s.indexOf('$endif', b.end + 1);
    if (endifPos === -1) {
      out += s.slice(idx);
      break;
    }
    let thenPart: string;
    let elsePart = '';
    const after = endifPos + '$endif'.length;
    const tb = takeBrace(s, b.end + 1); // then 块大括号
    thenPart = tb && tb.end < endifPos ? tb.inner : s.slice(b.end + 1, endifPos);
    if (elsePos !== -1 && elsePos < endifPos) {
      const eb = takeBrace(s, elsePos + 5); // '$else{' → '{' 在 elsePos+5
      if (eb && eb.end < endifPos) elsePart = eb.inner;
    }
    const chosen = condTruthy ? thenPart : elsePart;
    out += depth < 8 ? applyConditional(chosen, opts, depth + 1) : chosen;
    i = after;
  }
  return out;
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
  return replaceCbMacrosInner(cmd, opts, 0);
}
