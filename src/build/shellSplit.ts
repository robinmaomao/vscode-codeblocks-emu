/**
 * 命令行拆分 —— 让编译/链接命令可以不经 `shell: true` 直接派生。
 *
 * 背景（性能）：`child_process.spawn(cmd, { shell: true })` 在 Windows 上会先起
 * `cmd.exe /d /s /c "…"`，再由它启动编译器；编译器自身还会派生 `cc1`/`as`。
 * 即一条 GCC 编译命令 = `cmd.exe → gcc → cc1 → as` 四个进程。去 shell 后每单元少一个进程，
 * CPU/句柄/线程数同步下降，并顺带摆脱 cmd 的 8191 字符命令行限制。
 *
 * 安全边界（宁慢不乱）：只要命令行出现 **cmd 解释的元字符**（`| & < > ^ ` % !`）、
 * 引号内转义引号（`\"`）、未闭合引号，或程序本身是 shell（`cmd`/`powershell`/`sh`…），
 * 就返回 `undefined`，由调用方回退 `shell: true` 的旧路径。
 */

export interface SplitCommand {
  program: string;
  args: string[];
}

/** cmd 元字符（引号外才有意义）+ 变量展开字符（引号内同样会被 cmd 展开） */
const SHELL_META = /[|&<>^`]/;
/** cmd 的变量 / 延迟展开字符：即使位于引号内也会被解释，出现即回退 shell */
const CMD_EXPANSION = /[%!]/;

/** 程序名本身是 shell（例如 PCH 的 `cmd /c if exist … del …`）→ 必须保留 shell 语义 */
const SHELL_PROGRAM = /^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|sh|sh\.exe|bash|bash\.exe)$/i;

/**
 * cmd.exe 内建命令（无独立可执行文件）—— 裸名字命中时必须回退 shell，
 * 例如 `echo ...` / `copy /Y ...` / `del ...`；自定义 buildCommand 里常见这类写法。
 */
const CMD_BUILTINS = new Set([
  'assoc', 'break', 'call', 'cd', 'chdir', 'cls', 'color', 'copy', 'date', 'del', 'dir',
  'dpath', 'echo', 'endlocal', 'erase', 'exit', 'for', 'ftype', 'goto', 'if', 'keys',
  'md', 'mkdir', 'mklink', 'mode', 'more', 'move', 'path', 'pause', 'popd', 'prompt',
  'pushd', 'rd', 'rem', 'ren', 'rename', 'rmdir', 'set', 'setlocal', 'shift', 'start',
  'time', 'title', 'type', 'ver', 'verify', 'vol', 'waitfor', 'command', 'ctty',
]);

/** 去掉引号内的内容（用于只检查「shell 会解释的部分」是否含元字符） */
function stripQuoted(text: string): string {
  let out = '';
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) out += ch;
  }
  return out;
}

/**
 * 把命令行拆成 `{ program, args }`；不适合直接派生时返回 `undefined`。
 *
 * 支持的常见形态：`"C:\Program Files\gcc.exe" -c "src\main.c" -o obj\main.o`、
 * `gcc -DNAME="a b" -I"C:/sdk/include" -c x.c`。
 */
export function splitCommandLine(command: string): SplitCommand | undefined {
  if (typeof command !== 'string') return undefined;
  const text = command.trim();
  if (!text) return undefined;
  // 引号内的转义引号交给 shell（MSVCRT 反斜杠连写规则与 cmd 的二次解析不一致，拆分易失真）
  if (text.includes('\\"')) return undefined;
  // `%VAR%` / `!VAR!` 在引号内也会被 cmd 展开 → 必须保留 shell，否则宏值差异
  if (CMD_EXPANSION.test(text)) return undefined;
  if (SHELL_META.test(stripQuoted(text))) return undefined;

  const tokens: string[] = [];
  let cur = '';
  let hasToken = false;
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasToken = true; // "" 表示空参数
      continue;
    }
    if (!inQuotes && (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n')) {
      if (hasToken) {
        tokens.push(cur);
        cur = '';
        hasToken = false;
      }
      continue;
    }
    cur += ch;
    hasToken = true;
  }
  if (inQuotes) return undefined; // 未闭合引号：交回 shell（保持旧行为）
  if (hasToken) tokens.push(cur);
  if (tokens.length === 0) return undefined;
  const program = tokens[0];
  if (program.startsWith('@')) return undefined; // `@echo off` 之类：shell 语法
  if (SHELL_PROGRAM.test(program)) return undefined;
  // 批处理/脚本包装器（.bat/.cmd/.ps1）只能由 shell 解释；Node ≥18 对 .bat/.cmd 直接 spawn 会 EINVAL
  if (/\.(bat|cmd|ps1)$/i.test(program)) return undefined;
  // 裸名字命中 cmd 内建命令 → 没有可执行文件可直接派生，必须回退 shell
  if (!/[\\/]/.test(program)) {
    const bare = program.toLowerCase().replace(/\.(exe|com)$/, '');
    if (CMD_BUILTINS.has(bare)) return undefined;
  }
  // Windows 的 CreateProcess 对正斜杠路径支持不一致（部分工具链 force_fwd_slashes 会产出 C:/…/gcc.exe）；
  // 程序名统一转反斜杠，参数保持原样（参数里的 / 由编译器自己解释）。
  const exe = process.platform === 'win32' && /[\\/]/.test(program) ? program.replace(/\//g, '\\') : program;
  return { program: exe, args: tokens.slice(1) };
}
