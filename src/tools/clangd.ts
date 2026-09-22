/**
 * clangd 集成 —— 检测 clangd 是否安装、生成 clangd 用户配置（config.yaml）。
 *
 * 扩展负责产出准确的 compile_commands.json（与 Code::Blocks 对齐的编译命令），
 * clangd 负责补全 / 跳转 / 悬停 / 重命名等 IntelliSense 能力。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

const EXE = process.platform === 'win32' ? 'clangd.exe' : 'clangd';

/** 编译器 include 查询缓存（key = compilerPath|lang），避免重复同步 spawn 阻塞主线程 */
const includesCache = new Map<string, string[]>();
/** 编译器目标三元组缓存（key = compilerPath） */
const targetCache = new Map<string, string | undefined>();

/** 通过 PATH 查找 clangd（Windows 用 where，其它用 which） */
function findOnPath(): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(cmd, ['clangd'], { encoding: 'utf8' });
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

/** 常见安装目录（含 VS Code clangd 扩展自行下载的安装位置） */
function commonLocations(): string[] {
  const locs: string[] = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'];
    const localAppData = process.env['LOCALAPPDATA'];
    const appData = process.env['APPDATA'];
    if (pf) locs.push(path.join(pf, 'LLVM', 'bin', EXE));
    if (localAppData) locs.push(path.join(localAppData, 'Programs', 'LLVM', 'bin', EXE));
    if (appData) {
      // clangd 扩展下载目录：%APPDATA%\Code\User\globalStorage\llvm-vs-code-extensions.vscode-clangd\install\<ver>\clangd_<ver>\bin\clangd.exe
      const gs = path.join(appData, 'Code', 'User', 'globalStorage', 'llvm-vs-code-extensions.vscode-clangd', 'install');
      const found = findClangdUnder(gs);
      if (found) locs.push(found);
    }
  } else {
    locs.push('/usr/bin/clangd', '/usr/local/bin/clangd', '/opt/homebrew/bin/clangd');
    const home = process.env['HOME'];
    if (home) {
      // Linux/macOS 下 clangd 扩展下载目录：~/.config/clangd 或 ~/.local/share/... 等
      const candidates = [
        path.join(home, '.config', 'clangd'),
        path.join(home, '.clangd'),
        path.join(home, '.local', 'share', 'clangd'),
      ];
      for (const c of candidates) {
        const found = findClangdUnder(c);
        if (found) {
          locs.push(found);
          break;
        }
      }
    }
  }
  return locs;
}

/** 检测 clangd 可执行文件路径（未找到返回 undefined） */
export function detectClangd(): string | undefined {
  const onPath = findOnPath();
  if (onPath) return onPath;
  for (const p of commonLocations()) {
    if (fs.existsSync(p)) return p;
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
    // extraFlags（如 -march=...）用于让 GCC 选择正确的 multilib 系统头目录
    r = spawnSync(compilerPath, ['-E', '-x', lang, '-', '-v', ...extraFlags], { encoding: 'utf8', input: '' });
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
    r = spawnSync(compilerPath, ['-dumpmachine'], { encoding: 'utf8' });
  } catch {
    targetCache.set(compilerPath, undefined);
    return undefined;
  }
  const triple = String(r.stdout ?? '').trim() || undefined;
  targetCache.set(compilerPath, triple);
  return triple;
}

/** 转义正则特殊字符（用于 If.PathMatch） */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** 清理移除片段后残留的孤立 --- 分隔符（合并连续、去首尾），避免生成空 YAML 文档 */
function sanitizeRemainder(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      // 与前一个 --- 或空行连续时跳过（去重）
      if (out.length) {
        const prev = out[out.length - 1].trim();
        if (prev === '---' || prev === '') continue;
      }
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
  /** 需要压制的警告类别（如 -Wunused-function，写入主片段 Diagnostics.Suppress） */
  suppressedWarnings?: string[];
  /** 是否在头文件中压制全部诊断（SDK 头文件不自包含，单独分析必然产生大量误报） */
  suppressHeaderDiagnostics?: boolean;
}

/** 构造单个作用域的 YAML 片段 */
function buildScopeFragment(s: ClangdScopeConfig, marker: { begin: string; end: string }): string {
  const dirRe = escapeRegex(s.dir.replace(/\\/g, '/').replace(/\/+$/, ''));
  const lines = [
    marker.begin,
    'If:',
    `  PathMatch: ${dirRe}/.*`,
    'CompileFlags:',
    `  CompilationDatabase: ${s.databaseDir.replace(/\\/g, '/')}`,
    'Diagnostics:',
    '  UnusedIncludes: None',
  ];
  if (s.suppressedWarnings && s.suppressedWarnings.length) {
    lines.push('  Suppress:');
    for (const w of s.suppressedWarnings) {
      lines.push(`    - ${w}`);
    }
  }
  if (s.headerFlags && s.headerFlags.length) {
    lines.push('---');
    lines.push('If:');
    lines.push(`  PathMatch: ${dirRe}/.*\\.(h|hpp|hh|hxx|inl)$`);
    lines.push('CompileFlags:');
    lines.push('  Add:');
    for (const f of s.headerFlags) {
      lines.push(`    - ${f}`);
    }
    if (s.suppressHeaderDiagnostics) {
      lines.push('Diagnostics:');
      lines.push("  Suppress: '*'");
    }
  }
  lines.push(marker.end);
  return lines.join('\n');
}

/**
 * 更新用户级 clangd 配置：按作用域各自的 hash 标记替换，不碰用户自有内容，
 * 也不影响其它工作区写入的片段（多工作区共存）。
 * 每个作用域写两个片段：① 全部文件 → CompilationDatabase 指向缓存目录；② 头文件 →
 * CompileFlags.Add 回退 flag（头文件在编译数据库里没有条目，否则会报 unknown type name 等）。
 */
export function updateClangdUserConfig(scopes: ClangdScopeConfig[]): void {
  const cfgPath = clangdUserConfigPath();
  let existing = '';
  try {
    existing = fs.readFileSync(cfgPath, 'utf-8');
  } catch {
    existing = '';
  }

  // 清理旧版本（无 hash 标记）的遗留片段
  existing = removeBlock(existing, LEGACY_BEGIN, LEGACY_END);

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
  const out = existing ? existing + '\n---\n' + ours + '\n' : ours + '\n';

  // 内容未变则跳过写入，避免 clangd 无谓地重新加载配置
  let old = '';
  try {
    old = fs.readFileSync(cfgPath, 'utf-8');
  } catch {
    old = '';
  }
  if (old === out) return;

  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, out, 'utf-8');
}
