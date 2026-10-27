/**
 * clangd 集成 —— 检测 clangd 是否安装、生成 clangd 用户配置（config.yaml）。
 *
 * 扩展负责产出准确的 compile_commands.json（与 Code::Blocks 对齐的编译命令），
 * clangd 负责补全 / 跳转 / 悬停 / 重命名等 IntelliSense 能力。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { LruCache } from './lru';
import * as i18n from '../i18n';

const EXE = process.platform === 'win32' ? 'clangd.exe' : 'clangd';

/** 编译器 include 查询缓存（key = compilerPath|lang；LRU 128 防长会话无界增长/重复同步 spawn 阻塞主线程） */
const includesCache = new LruCache<string, string[]>(128);
/** 编译器目标三元组缓存（key = compilerPath；LRU 64） */
const targetCache = new LruCache<string, string | undefined>(64);

/** 通过 PATH 查找 clangd（Windows 用 where，其它用 which） */
function findOnPath(): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    // 超时保护：扩展宿主主线程被同步子进程阻塞会冻结全部扩展能力（where/which 正常 <50ms）
    const r = spawnSync(cmd, ['clangd'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/)[0].trim();
      if (first) return first;
    }
  } catch {
    // 忽略：找不到命令工具时走常见目录
  }
  return undefined;
}

/** 递归在指定目录下查找 clangd 可执行文件（限制深度，避免过深扫描） */
function findClangdUnder(dir: string, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findClangdUnder(p, depth + 1);
      if (found) return found;
    } else if (e.name === EXE) {
      return p;
    }
  }
  return undefined;
}

/** 是否为普通文件（目录/不存在 → false） */
function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** VS Code 家族的用户级目录（桌面版 + 远程 server），用于定位 clangd 扩展下载的二进制 */
function vscodeUserRoots(): string[] {
  const roots: string[] = [];
  const push = (base: string | undefined): void => {
    if (base) roots.push(base);
  };
  const apps = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor'];
  const servers = ['.vscode-server', '.vscode-server-insiders', '.vscodium-server', '.cursor-server'];
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    for (const app of apps) push(appData && path.join(appData, app, 'User'));
    const profile = process.env['USERPROFILE'];
    for (const server of servers) push(profile && path.join(profile, server, 'data', 'User'));
  } else {
    const home = process.env['HOME'];
    if (process.platform === 'darwin') {
      const appSupport = home && path.join(home, 'Library', 'Application Support');
      for (const app of apps) push(appSupport && path.join(appSupport, app, 'User'));
    } else {
      const xdg = process.env['XDG_CONFIG_HOME'] || (home && path.join(home, '.config'));
      for (const app of apps) push(xdg && path.join(xdg, app, 'User'));
    }
    for (const server of servers) push(home && path.join(home, server, 'data', 'User'));
  }
  return roots;
}

/** 常见安装目录（含 VS Code clangd 扩展自行下载的安装位置） */
function commonLocations(): string[] {
  const locs: string[] = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'];
    const localAppData = process.env['LOCALAPPDATA'];
    if (pf) locs.push(path.join(pf, 'LLVM', 'bin', EXE));
    if (localAppData) locs.push(path.join(localAppData, 'Programs', 'LLVM', 'bin', EXE));
  } else {
    locs.push('/usr/bin/clangd', '/usr/local/bin/clangd', '/opt/homebrew/bin/clangd');
  }
  // clangd 扩展下载目录：<User>/globalStorage/llvm-vs-code-extensions.vscode-clangd/install/<ver>/clangd_<ver>/bin/clangd[.exe]
  // <User> 随发行版（Code / Insiders / VSCodium / Cursor）与远程 server 布局不同，逐一尝试。
  for (const userRoot of vscodeUserRoots()) {
    const found = findClangdUnder(path.join(userRoot, 'globalStorage', 'llvm-vs-code-extensions.vscode-clangd', 'install'));
    if (found) locs.push(found);
  }
  if (process.platform !== 'win32') {
    const home = process.env['HOME'];
    if (home) {
      // 旧版本/手工放置的候选目录
      for (const c of [path.join(home, '.config', 'clangd'), path.join(home, '.clangd'), path.join(home, '.local', 'share', 'clangd')]) {
        const found = findClangdUnder(c);
        if (found) locs.push(found);
      }
    }
  }
  return locs;
}

/** 检测结果缓存（P7：避免每次生成 compile_commands 都 spawnSync where + 递归目录扫描；含负结果） */
let detectClangdCache: { value: string | undefined; at: number } | undefined;
const DETECT_CLANGD_CACHE_TTL_MS = 5 * 60 * 1000;
/** 负结果（未找到）缓存更短：运行中通过 clangd 扩展下载/安装后能更快被检测到 */
const DETECT_CLANGD_NEGATIVE_TTL_MS = 30 * 1000;

/** 清除 clangd 检测缓存（clangd.path 配置变化 / 扩展安装状态变化 / 手动生成 / 测试场景） */
export function clearClangdDetectionCache(): void {
  detectClangdCache = undefined;
}

/** 检测 clangd 可执行文件路径（未找到返回 undefined；结果带 TTL 缓存，含负结果） */
export function detectClangd(): string | undefined {
  if (detectClangdCache) {
    const ttl = detectClangdCache.value ? DETECT_CLANGD_CACHE_TTL_MS : DETECT_CLANGD_NEGATIVE_TTL_MS;
    if (Date.now() - detectClangdCache.at < ttl) return detectClangdCache.value;
  }
  const value = detectClangdUncached();
  detectClangdCache = { value, at: Date.now() };
  return value;
}

/** 实际探测（无缓存；异常路径同样返回 undefined 并被上层负缓存） */
function detectClangdUncached(): string | undefined {
  // 优先：clangd 扩展的 clangd.path 设置（用户手动指定的 clangd 路径，含 ${userHome} 变量展开）
  try {
    const configured = vscode.workspace.getConfiguration('clangd').get<string>('path', '');
    if (configured) {
      const expanded = configured.trim().replace(/\$\{userHome\}/gi, os.homedir());
      // 必须是文件：配置成目录时不能当成 clangd 可执行文件
      if (expanded && isFile(expanded)) return expanded;
    }
  } catch {
    // 忽略：配置读取失败时回退到 PATH / 常见目录
  }
  const onPath = findOnPath();
  if (onPath) return onPath;
  for (const p of commonLocations()) {
    if (isFile(p)) return p;
  }
  return undefined;
}

/** 是否为 GCC/Clang 风格编译器（按程序名判断，跳过 cl.exe 等 MSVC） */
function isGccLike(compilerPath: string): boolean {
  if (!compilerPath) return false;
  const base = path.basename(compilerPath).toLowerCase();
  return /gcc|g\+\+|clang|(^|[^a-z])cc([^a-z]|$)/.test(base);
}

/**
 * 查询 GCC/Clang 风格编译器的默认 include 搜索路径。
 * 通过 `<compiler> -E -x <lang> - -v` 的 stderr 输出解析
 * 「#include <...> search starts here:」到「End of search list.」之间的目录。
 */
export function queryCompilerIncludes(compilerPath: string, lang: 'c' | 'c++', extraFlags: string[] = []): string[] {
  if (!isGccLike(compilerPath)) return [];
  const key = `${compilerPath}|${lang}|${extraFlags.join('\u0000')}`;
  const cached = includesCache.get(key);
  if (cached) return cached;

  let r: ReturnType<typeof spawnSync>;
  try {
    // extraFlags（如 -march=...）用于让 GCC 选择正确的 multilib 系统头目录。
    // 超时保护：编译器路径错误/网络盘/包装脚本挂起时，同步 spawn 会冻结扩展宿主。
    r = spawnSync(compilerPath, ['-E', '-x', lang, '-', '-v', ...extraFlags], {
      encoding: 'utf8', input: '', timeout: 5000, windowsHide: true,
    });
  } catch {
    includesCache.set(key, []);
    return [];
  }
  // GCC/Clang 把 include 搜索列表打印到 stderr（-v 与 -E 组合）
  const stderr = String(r.stderr ?? '') + String(r.stdout ?? '');
  const m = stderr.match(/#include <\.\.\.> search starts here:\r?\n([\s\S]*?)\r?\nEnd of search list\./);
  if (!m) {
    includesCache.set(key, []);
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const d = raw.trim();
    if (!d) continue;
    // 归一化为绝对路径（GCC 输出含 ../ 相对段，避免 clangd cwd 不同导致解析不一致）
    const abs = path.resolve(d);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  includesCache.set(key, out);
  return out;
}

/** 查询 C + C++ 两个前端并合并去重，返回编译器系统 include 路径（extraFlags 用于选择正确 multilib） */
export function queryCompilerSystemIncludes(cPath?: string, cppPath?: string, extraFlags: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [p, lang] of [[cPath, 'c'], [cppPath, 'c++']] as const) {
    if (!p) continue;
    for (const d of queryCompilerIncludes(p, lang, extraFlags)) {
      const norm = path.normalize(d);
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(d);
    }
  }
  return out;
}

/** 查询编译器目标三元组（`<compiler> -dumpmachine`，如 riscv32-elf），失败返回 undefined */
export function queryCompilerTarget(compilerPath: string): string | undefined {
  if (!isGccLike(compilerPath)) return undefined;
  if (targetCache.has(compilerPath)) return targetCache.get(compilerPath);

  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(compilerPath, ['-dumpmachine'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  } catch {
    targetCache.set(compilerPath, undefined);
    return undefined;
  }
  const triple = String(r.stdout ?? '').trim() || undefined;
  targetCache.set(compilerPath, triple);
  return triple;
}

/**
 * 解析编译器可执行文件：裸程序名（如 `gcc.exe`）且配置了 masterPath 时，
 * 优先用 `<masterPath>/bin/<program>`（与构建期 PATH 注入口径一致；也兼容 masterPath 直接指向 bin）。
 *
 * 背景：queryCompilerIncludes / queryCompilerTarget 用 spawnSync 直接启动编译器，而扩展宿主
 * 的 PATH 通常不含工具链 bin —— 只配 masterPath（未把工具链加入系统 PATH）时探测会静默失败，
 * clangd 就缺少 `-isystem` / `--target`。已是路径的 program 原样返回。
 */
export function resolveCompilerProgram(program: string, masterPath?: string): string {
  const p = (program || '').trim();
  if (!p) return '';
  if (p.includes('/') || p.includes('\\')) return p;
  const mp = (masterPath || '').trim();
  if (!mp) return p;
  for (const dir of [path.join(mp, 'bin'), mp]) {
    const candidate = path.join(dir, p);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 该候选不存在 → 试下一个
    }
  }
  return p; // 未命中 masterPath → 仍按裸名交给 PATH
}

/** 转义正则特殊字符（用于 If.PathMatch） */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 用 YAML 单引号包裹（内部单引号双写）；单引号不解释反斜杠，可保留正则转义，且避免 #/&/冒号破坏解析 */
function yamlSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** 每个作用域用带 hash 的独立标记，避免多个工作区同时写同一 config.yaml 时互相覆盖 */
function scopeMarker(dir: string): { begin: string; end: string } {
  // 归一化（正斜杠 + 去尾斜杠 + 小写）保证同一作用域 hash 稳定
  const norm = dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const h = crypto.createHash('md5').update(norm).digest('hex').slice(0, 12);
  return {
    begin: `# >>> codeblocks-vscode ${h} begin <<<`,
    end: `# <<< codeblocks-vscode ${h} end <<<`,
  };
}

/** 旧版本（无 hash 标记）的片段标记，用于升级时清理遗留 */
const LEGACY_BEGIN = '# >>> codeblocks-vscode begin <<<';
const LEGACY_END = '# <<< codeblocks-vscode end <<<';

/** 从文本中移除指定标记包裹的片段（不含标记本身，保留其它内容） */
function removeBlock(text: string, beginMark: string, endMark: string): string {
  const begin = text.indexOf(beginMark);
  if (begin === -1) return text;
  const end = text.indexOf(endMark, begin);
  if (end === -1) return text;
  return text.slice(0, begin) + text.slice(end + endMark.length);
}

/**
 * 清理移除片段后残留的孤立 --- 分隔符：只合并**连续**的分隔符（中间只有空行）并去掉首尾。
 *
 * 注意：用户自有的单个 `---` 必须保留 —— clangd 用 `---` 分隔不同 `If` 条件的片段，
 * 删掉会把两篇文档合并（`If` 条件丢失，甚至出现重复键让 clangd 丢弃整个 config.yaml）。
 * 旧实现「前一行是空行就删」会误删这种分隔符（用户内容被改写）。
 */
function sanitizeRemainder(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      // 向前跳过空行找上一个非空行
      let prev = out.length - 1;
      while (prev >= 0 && out[prev].trim() === '') prev--;
      if (prev < 0) continue; // 文件开头（前面只有空行）→ 悬空分隔符
      if (out[prev].trim() === '---') continue; // 与上一个分隔符连续（删片段留下的空文档）→ 合并
    }
    out.push(line);
  }
  // 去首尾空行与 ---
  while (out.length && (out[0].trim() === '' || out[0].trim() === '---')) out.shift();
  while (out.length && (out[out.length - 1].trim() === '' || out[out.length - 1].trim() === '---')) out.pop();
  return out.join('\n').trim();
}

/** 用户级 clangd 配置路径（Windows %LocalAppData%\clangd\config.yaml，其它 ~/.config/clangd/config.yaml） */
export function clangdUserConfigPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'];
    const base = localAppData || path.join(process.env['USERPROFILE'] || '', 'AppData', 'Local');
    return path.join(base, 'clangd', 'config.yaml');
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg || path.join(process.env['HOME'] || '', '.config');
  return path.join(base, 'clangd', 'config.yaml');
}

/** 每个工程树作用域的 clangd 配置 */
export interface ClangdScopeConfig {
  /** 工程树根目录（If.PathMatch 作用域） */
  dir: string;
  /** compile_commands.json 所在目录 */
  databaseDir: string;
  /** 头文件（无编译命令）的回退编译 flag：-I / -isystem / --target 等独立 argv 元素 */
  headerFlags?: string[];
  /** 需要压制的诊断（-W 组名或 clangd 诊断名，如 -Wunused-function / redefinition_different_typedef，写入主片段 Diagnostics.Suppress） */
  suppressedWarnings?: string[];
  /** 是否在头文件中压制全部诊断（SDK 头文件不自包含，单独分析必然产生大量误报） */
  suppressHeaderDiagnostics?: boolean;
  /**
   * 以下键一律「有值才写」：`undefined` = 不写该键，交由 clangd 默认值或用户自有配置决定
   * （扩展写的是**用户级** config.yaml，优先级高于项目 `.clangd`，不写才是真正的「让位」）。
   * 默认值（设置项默认）与历史硬编码值一致，保证默认产物不变。
   */
  /** Diagnostics.UnusedIncludes */
  unusedIncludes?: 'None' | 'Strict';
  /** Completion.HeaderInsertion */
  headerInsertion?: 'Never' | 'IWYU';
  /** CompileFlags.BuiltinHeaders（queryDriver = 用交叉编译器提取的内建头） */
  builtinHeaders?: 'Clangd' | 'QueryDriver';
  /** Index.StandardLibrary */
  indexStandardLibrary?: boolean;
  /** Index.Background */
  indexBackground?: 'Build' | 'Skip';
  /** Diagnostics.ClangTidy.Remove: ['*']（关闭 clang-tidy 诊断） */
  clangTidyOff?: boolean;
  /** Completion.AllScopes */
  completionAllScopes?: boolean;
  /** InlayHints.Enabled */
  inlayHintsEnabled?: boolean;
  /** Documentation.CommentFormat */
  documentationCommentFormat?: 'Plaintext' | 'Markdown' | 'Doxygen';
  /** If.PathExclude：相对作用域根目录名列表（生成 '<scopeRe>/(d1|d2)/.*'，让 obj/bin 等不进配置作用域） */
  excludeDirs?: string[];
  /** 用户自由 YAML：作为**带作用域 If 的后置片段**注入，可覆盖扩展写入的键（空 = 不注入） */
  extraConfig?: string;
}

/** 正斜杠归一化 + 去尾斜杠（片段中的路径一律用正斜杠） */
function normSlash(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 用户自由 YAML 的轻量校验（不阻断写入，仅提示）：
 * 非法 YAML 会让 clangd **丢弃整个配置文件**（含扩展片段），所以对最常见的两类破坏做出提示。
 */
export function extraConfigWarnings(text: string): string[] {
  const out: string[] = [];
  if (!text || !text.trim()) return out;
  if (/^\t/m.test(text) || /^ +\t/m.test(text)) out.push(i18n.t('Contains tab characters (tabs are not allowed for YAML indentation)'));
  if (/^---\s*$/m.test(text)) out.push(i18n.t('Contains a document separator line --- (it breaks the extension snippet structure; remove it)'));
  if (/^If:/m.test(text)) out.push(i18n.t('Contains a top-level If: (the extension already injects a scoped If; a duplicate would create a duplicate YAML key)'));
  return out;
}

/**
 * 字符串数组键防御：非数组（设置被手改成字符串/数字等）或含非字符串项一律丢弃。
 * 否则 `for (const x of value)` 在字符串上会**按字符**迭代，把片段写成单字符压制项等垃圾内容。
 */
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}

/** 构造单个作用域的 YAML 片段（只写「有值」的键；undefined/空 = 该键交给 clangd 默认值或用户自有配置） */
function buildScopeFragment(s: ClangdScopeConfig, marker: { begin: string; end: string }): string {
  const dirRe = escapeRegex(normSlash(s.dir));
  const lines = [
    marker.begin,
    'If:',
    `  PathMatch: ${yamlSingleQuote(`${dirRe}/.*`)}`,
  ];
  const excluded = asStringArray(s.excludeDirs).map((d) => normSlash(d).replace(/^\/+/, '')).filter(Boolean);
  if (excluded.length) {
    lines.push(`  PathExclude: ${yamlSingleQuote(`${dirRe}/(${excluded.map(escapeRegex).join('|')})/.*`)}`);
  }
  lines.push('CompileFlags:');
  lines.push(`  CompilationDatabase: ${yamlSingleQuote(normSlash(s.databaseDir))}`);
  if (s.builtinHeaders) {
    lines.push(`  BuiltinHeaders: ${s.builtinHeaders}`);
  }
  const diag: string[] = [];
  if (s.unusedIncludes) diag.push(`  UnusedIncludes: ${s.unusedIncludes}`);
  const suppressions = asStringArray(s.suppressedWarnings);
  if (suppressions.length) {
    diag.push('  Suppress:');
    for (const w of suppressions) {
      diag.push(`    - ${w}`);
    }
  }
  if (s.clangTidyOff) {
    diag.push('  ClangTidy:');
    diag.push("    Remove: ['*']");
  }
  if (diag.length) {
    lines.push('Diagnostics:');
    lines.push(...diag);
  }
  // 补全不自动插入 #include：clangd 默认 HeaderInsertion=IWYU（接受补全时插入所属头文件），
  // 与「按工程编译命令补全」的预期不符（嵌入式/裸机工程常无标准头可插）⇒ 扩展默认写 Never。
  // 主片段 PathMatch 覆盖工程树下全部文件（含头文件），故头文件子片段无需重复声明。
  const completion: string[] = [];
  if (s.headerInsertion) completion.push(`  HeaderInsertion: ${s.headerInsertion}`);
  if (s.completionAllScopes !== undefined) completion.push(`  AllScopes: ${s.completionAllScopes ? 'Yes' : 'No'}`);
  if (completion.length) {
    lines.push('Completion:');
    lines.push(...completion);
  }
  if (s.indexStandardLibrary !== undefined || s.indexBackground) {
    lines.push('Index:');
    if (s.indexBackground) lines.push(`  Background: ${s.indexBackground}`);
    if (s.indexStandardLibrary !== undefined) lines.push(`  StandardLibrary: ${s.indexStandardLibrary}`);
  }
  if (s.inlayHintsEnabled !== undefined) {
    lines.push('InlayHints:');
    lines.push(`  Enabled: ${s.inlayHintsEnabled}`);
  }
  if (s.documentationCommentFormat) {
    lines.push('Documentation:');
    lines.push(`  CommentFormat: ${s.documentationCommentFormat}`);
  }
  const headerFlags = asStringArray(s.headerFlags);
  if (headerFlags.length) {
    lines.push('---');
    lines.push('If:');
    lines.push(`  PathMatch: ${yamlSingleQuote(`${dirRe}/.*\\.(h|hpp|hh|hxx|inl)$`)}`);
    lines.push('CompileFlags:');
    lines.push('  Add:');
    for (const f of headerFlags) {
      lines.push(`    - ${f}`);
    }
    if (s.suppressHeaderDiagnostics) {
      lines.push('Diagnostics:');
      lines.push("  Suppress: '*'");
    }
  }
  // 用户自由 YAML：后置片段（同一作用域），因此可覆盖上面扩展写入的任意键
  const extra = (s.extraConfig ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (extra.trim()) {
    lines.push('---');
    lines.push('If:');
    lines.push(`  PathMatch: ${yamlSingleQuote(`${dirRe}/.*`)}`);
    lines.push(...extra.split('\n'));
  }
  lines.push(marker.end);
  return lines.join('\n');
}

/** 扩展写入的片段（按 hash 标记识别） */
export interface ManagedClangdFragment {
  /** 标记中的作用域 hash */
  hash: string;
  /** 片段完整文本（含首尾标记行） */
  block: string;
  /** 作用域根目录（由 If.PathMatch 的 '<re>/.*' 反解） */
  scopeDir: string;
  /** CompilationDatabase 指向的目录（无则空串） */
  databaseDir: string;
}

/** 反解 escapeRegex + yamlSingleQuote 生成的路径（先去掉单引号包裹，再去掉正则转义） */
function unquoteRegexPath(s: string): string {
  let v = s.trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
}

/** 列出配置文本中所有扩展写入的片段（用户自有内容不受影响） */
export function listManagedFragments(text: string): ManagedClangdFragment[] {
  const out: ManagedClangdFragment[] = [];
  const beginRe = /^# >>> codeblocks-vscode ([0-9a-f]{12}) begin <<<$/gm;
  let m: RegExpExecArray | null;
  while ((m = beginRe.exec(text)) !== null) {
    const hash = m[1];
    const endMark = `# <<< codeblocks-vscode ${hash} end <<<`;
    const end = text.indexOf(endMark, m.index);
    if (end === -1) continue;
    const block = text.slice(m.index, end + endMark.length);
    const body = text.slice(m.index, end);
    const pk = body.match(/^\s*PathMatch:\s*(.+)$/m);
    const db = body.match(/^\s*CompilationDatabase:\s*(.+)$/m);
    // 主片段 PathMatch 形如 '<scopeRe>/.*'（头文件子片段为 '...\.(h|hpp...)$'）；取第一个即可
    const rawPath = pk ? unquoteRegexPath(pk[1]) : '';
    const scopeDir = normSlash(rawPath.replace(/\/\.\*.*$/, '').replace(/\/\\\.\(.*$/, ''));
    out.push({ hash, block, scopeDir, databaseDir: db ? normSlash(unquoteRegexPath(db[1])) : '' });
  }
  return out;
}

/** 失效原因（'' = 有效/需保留） */
export type StaleReason = '' | 'scope-missing' | 'database-missing';

/**
 * 判断片段是否失效。
 * 安全规则：卷不可用（网络盘未映射 / U 盘未插）与 UNC 路径一律视为「不确定」，**不清理**——
 * 作用域可能只是暂时不可见（项目在移动硬盘/网络盘上是常态）。
 */
export function staleReasonOf(f: ManagedClangdFragment): StaleReason {
  const dir = f.scopeDir;
  if (!dir || dir === '.' || dir === '/') return '';
  // UNC（//server/share/...）不上手
  if (dir.startsWith('//')) return '';
  const rootMatch = dir.match(/^([a-zA-Z]:)\//);
  if (rootMatch && !fs.existsSync(`${rootMatch[1]}/`)) return ''; // 卷未挂载
  const exists = (p: string): boolean => {
    try {
      return fs.existsSync(p);
    } catch {
      return true; // 访问异常 → 保守起见按「存在」处理
    }
  };
  if (!exists(dir)) return 'scope-missing';
  if (f.databaseDir && !exists(f.databaseDir)) return 'database-missing';
  return '';
}

/** 待清理片段（含原因，供日志/预览） */
export interface StaleClangdFragment extends ManagedClangdFragment {
  hash: string;
  reason: Exclude<StaleReason, ''>;
}

/** 扫描配置文本中的失效片段（只读，可用于预览） */
export function findStaleClangdFragments(text: string): StaleClangdFragment[] {
  const out: StaleClangdFragment[] = [];
  for (const f of listManagedFragments(text)) {
    const reason = staleReasonOf(f);
    if (reason) out.push({ ...f, reason });
  }
  return out;
}

/** 按标记块清理指定片段（返回新文本与清理数） */
export function pruneStaleClangdFragments(text: string): { text: string; removed: StaleClangdFragment[] } {
  const removed = findStaleClangdFragments(text);
  let out = text;
  for (const f of removed) {
    const beginMark = `# >>> codeblocks-vscode ${f.hash} begin <<<`;
    const endMark = `# <<< codeblocks-vscode ${f.hash} end <<<`;
    out = removeBlock(out, beginMark, endMark);
  }
  if (removed.length) out = sanitizeRemainder(out);
  return { text: out, removed };
}

/**
 * 原子写文件（临时文件 + 重命名）：clangd 会监听 config.yaml / compile_commands.json，
 * 直接覆盖存在「读到半截内容」的窗口（大文件/慢盘上尤其明显），可能让 clangd 短暂丢弃配置或索引。
 */
export function writeFileAtomic(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // 个别文件系统/杀毒软件会拒绝「覆盖式重命名」→ 回退直接写（至少保证最终内容正确）
    try {
      fs.writeFileSync(file, content, 'utf-8');
    } finally {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // 清理失败不影响主流程
      }
    }
  }
}

/** 读取用户级 clangd 配置文本（不存在/不可读 → 空串） */
export function readClangdUserConfigText(): string {
  try {
    return fs.readFileSync(clangdUserConfigPath(), 'utf-8');
  } catch {
    return '';
  }
}

/** 写入用户级 clangd 配置的文本（内容未变时不写；返回是否实际写入） */
export function writeClangdUserConfig(out: string): boolean {
  const cfgPath = clangdUserConfigPath();
  let old = '';
  try {
    old = fs.readFileSync(cfgPath, 'utf-8');
  } catch {
    old = '';
  }
  if (old === out) return false; // 内容未变则跳过写入，避免 clangd 无谓地重新加载配置
  writeFileAtomic(cfgPath, out);
  return true;
}

/**
 * 只保留 clangd 来源的诊断（clangd 发布时 `source` 为 `clang` / `clang-tidy` / `clangd`）。
 * 该文件没有任何 clangd 来源时保留全部（clangd 尚未分析 / 老版本未设置 source），避免 Build Log 变空。
 */
export function preferClangdSource<T extends { source?: string }>(diags: readonly T[]): T[] {
  const isClangd = (d: T): boolean => (d.source ?? '').toLowerCase().startsWith('clang');
  return diags.some(isClangd) ? diags.filter(isClangd) : [...diags];
}

/**
 * 更新用户级 clangd 配置：按作用域各自的 hash 标记替换，不碰用户自有内容，
 * 也不影响其它工作区写入的片段（多工作区共存）。
 *
 * 每个作用域写：① 全部文件 → If.PathMatch（+ 可选 PathExclude）+ CompileFlags.CompilationDatabase
 * （+ 可选 BuiltinHeaders）+ Diagnostics（未使用头文件提示、压制列表、可选关闭 clang-tidy）+
 * Completion（HeaderInsertion / AllScopes）+ Index / InlayHints / Documentation（**仅写有值的键**）；
 * ②（有头文件回退 flag 时）头文件子片段 → CompileFlags.Add 回退 flag（头文件在编译数据库里没有条目，
 * 否则会报 unknown type name 等）；③（用户填了 extraConfig 时）同作用域的后置片段，可覆盖以上任意键。
 *
 * 顺带**自动清理失效片段**（作用域目录/编译数据库已不存在的历史残留）⇒ 返回值里带回明细，
 * 调用方据此在输出通道留痕。卷不可用 / UNC 路径一律跳过（见 staleReasonOf）。
 */
export function updateClangdUserConfig(scopes: ClangdScopeConfig[]): {
  written: boolean;
  removed: StaleClangdFragment[];
} {
  let existing = readClangdUserConfigText();

  // 清理旧版本（无 hash 标记）的遗留片段
  existing = removeBlock(existing, LEGACY_BEGIN, LEGACY_END);

  // 清理本轮生成之外的历史残留（作用域目录/编译数据库已不存在）
  const pruned = pruneStaleClangdFragments(existing);
  existing = pruned.text;

  // 逐个作用域移除旧片段（按 hash 标记），互不干扰
  const newFrags: string[] = [];
  for (const s of scopes) {
    const marker = scopeMarker(s.dir);
    existing = removeBlock(existing, marker.begin, marker.end);
    newFrags.push(buildScopeFragment(s, marker));
  }

  // 清理移除片段后残留的孤立 --- 分隔符（避免空 YAML 文档报错）
  existing = sanitizeRemainder(existing);

  // 多片段之间用单个 --- 分隔（YAML 文档分隔符），每个片段内部已含头文件子片段
  const ours = newFrags.join('\n---\n');
  // 空作用域（清理场景）时不留悬空 ---
  const out = !ours ? existing + '\n' : (existing ? existing + '\n---\n' + ours + '\n' : ours + '\n');
  const written = writeClangdUserConfig(out);
  return { written, removed: pruned.removed };
}

/**
 * 显式清理：只清理失效片段（不新增/不重写任何作用域片段），用于「清理 clangd 遗留配置」命令。
 * 返回清理明细与实际是否发生写入。
 */
export function cleanStaleClangdFragments(): { removed: StaleClangdFragment[]; written: boolean } {
  const existing = readClangdUserConfigText();
  const pruned = pruneStaleClangdFragments(existing);
  if (!pruned.removed.length) return { removed: [], written: false };
  const written = writeClangdUserConfig(pruned.text + '\n');
  return { removed: pruned.removed, written };
}

