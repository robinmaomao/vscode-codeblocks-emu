// L5 打包与安装冒烟：VSIX 内容核对 + 隔离 user-data-dir/extensions-dir 安装 → 卸载。
//
// 用法：node tests/pack/test-pack.js [--skip-package]
// 前置：dist/ + bundle/ 已构建（npm run compile && npm run bundle）；否则打包会重新触发 vscode:prepublish。
// 产物：VSIX 落 .cb-tools/pack/（gitignore），不污染仓库根目录。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const skipPackage = args.includes('--skip-package');

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
function skipCheck(name, reason) { skip++; console.log(`SKIP ${name}  ${reason}`); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const outDir = path.join(root, '.cb-tools', 'pack');

function run(cmd, cmdArgs, opts = {}) {
  const isScript = /\.(cmd|bat)$/i.test(cmd);
  if (process.platform === 'win32' && isScript) {
    // Windows 下 .cmd/.bat 需经 shell 执行：直接把「已加引号的命令行字符串」交给 shell，
    // 避免 Node 对 argv 再做一层 CRT 转义（会把引号变成 \" 导致 cmd 找不到命令）。
    const q = (s) => (/[\s&^|<>]/.test(String(s)) ? '"' + String(s) + '"' : String(s));
    const cmdline = [q(cmd), ...cmdArgs.map(q)].join(' ');
    return spawnSync(cmdline, { encoding: 'utf-8', cwd: root, windowsHide: true, shell: true, ...opts });
  }
  return spawnSync(cmd, cmdArgs, { encoding: 'utf-8', cwd: root, shell: false, windowsHide: true, ...opts });
}

/** vsce CLI：直接跑 devDependency 里的 JS 入口（避免 .cmd 包装与 npx 依赖） */
function vsce(args, opts = {}) {
  const entry = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
  if (fs.existsSync(entry)) return spawnSync(process.execPath, [entry, ...args], { encoding: 'utf-8', cwd: root, windowsHide: true, ...opts });
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return run(npx, ['--no-install', 'vsce', ...args], opts);
}

function findCodeCli() {
  const candidates = [
    process.env.CB_CODE_CLI,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'bin', 'code.cmd'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const w = run('where.exe', ['code']);
  if (w.status === 0) {
    const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // ---------- P1 打包内容清单（vsce ls，不真正打包） ----------
  const ls = vsce(['ls', '--no-dependencies']);
  if (ls.status !== 0) {
    skipCheck('P1 VSIX 内容清单', `vsce ls 失败（${(ls.stderr || ls.stdout || '').split('\n')[0]}）`);
  } else {
    const files = (ls.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const has = (re) => files.some((f) => re.test(f));
    check('P1 清单包含入口 bundle/extension.js', has(/^bundle[\\/]extension\.js$/), files.filter((f) => f.startsWith('bundle')).slice(0, 3), 'bundle/extension.js');
    check('P1 清单包含语法与语言配置', has(/^syntaxes[\\/].+\.json$/) && has(/^language-configurations[\\/].+\.json$/), null, '两个目录');
    check('P1 清单包含编译器资源 XML', has(/^resources[\\/]compilers[\\/]options_gcc\.xml$/), null, 'options_gcc.xml');
    check('P1 清单包含 NLS 文件', has(/^package\.nls\.json$/) && has(/^package\.nls\.zh-cn\.json$/), null, '两个 NLS');
    check('P1 清单包含 README/LICENSE/CHANGELOG', has(/^README\.md$/) && has(/^LICENSE\.md$/) && has(/^CHANGELOG\.md$/), null, '三份文档');
    check('P1 清单**不含**测试与探针工程', !has(/^tests[\\/]/) && !has(/^test-project[\\/]/), files.filter((f) => /^tests|^test-project/.test(f)), []);
    check('P1 清单**不含**源码与 dist', !has(/^src[\\/]/) && !has(/^dist[\\/]/), files.filter((f) => /^src|^dist/.test(f)), []);
    check('P1 清单**不含** sourcemap', !files.some((f) => /\.map$/.test(f)), files.filter((f) => /\.map$/.test(f)).slice(0, 3), []);
    check('P1 清单包含 fast-xml-parser 归属说明', has(/^THIRD-PARTY-NOTICES\.md$/), null, 'THIRD-PARTY-NOTICES.md');
  }

  // ---------- P2 真正打包 ----------
  let vsixPath = path.join(outDir, `codeblocks-vscode-${pkg.version}.vsix`);
  if (skipPackage) {
    skipCheck('P2 VSIX 打包', '--skip-package');
  } else {
    for (const f of fs.readdirSync(outDir)) if (f.endsWith('.vsix')) fs.rmSync(path.join(outDir, f), { force: true });
    const pack = vsce(['package', '--no-dependencies', '--allow-missing-repository', '-o', vsixPath], { timeout: 10 * 60 * 1000 });
    const ok = pack.status === 0 && fs.existsSync(vsixPath);
    check('P2 VSIX 打包成功且产物存在', ok, ok ? undefined : (pack.stderr || pack.stdout || '').split('\n').slice(-4).join(' | '), 'exit 0 + .vsix');
    if (!ok) {
      console.log(`\npack 打包冒烟: ${pass} pass, ${fail} fail, ${skip} skip`);
      process.exit(1);
    }
    const size = fs.statSync(vsixPath).size;
    check('P2 VSIX 体积合理（< 20MB）', size > 100 * 1024 && size < 20 * 1024 * 1024, size, '100KB–20MB');
  }

  // ---------- P3 隔离目录安装 / 卸载 ----------
  const codeCli = findCodeCli();
  if (!codeCli || !fs.existsSync(vsixPath)) {
    skipCheck('P3 隔离安装冒烟', !codeCli ? '未找到 code CLI（可设 CB_CODE_CLI）' : 'VSIX 不存在');
    console.log(`\npack 打包冒烟: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(fail ? 1 : 0);
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pack-'));
  const userData = path.join(sandbox, 'user-data');
  const extDir = path.join(sandbox, 'extensions');
  const common = [`--user-data-dir=${userData}`, `--extensions-dir=${extDir}`];
  try {
    const inst = run(codeCli, [...common, '--install-extension', vsixPath, '--force'], { timeout: 5 * 60 * 1000 });
    check('P3 隔离目录安装成功（exit 0）', inst.status === 0, (inst.stderr || inst.stdout || '').split('\n').filter(Boolean).slice(-3), 'exit 0');
    const list = run(codeCli, [...common, '--list-extensions', '--show-versions'], { timeout: 2 * 60 * 1000 });
    const installed = (list.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    check('P3 扩展出现在隔离实例的扩展列表中（含版本号）',
      installed.some((e) => /^(robinmaomao\.codeblocks-vscode|codeblocks-vscode)@/.test(e)),
      installed.slice(0, 5), `codeblocks-vscode@${pkg.version}`);
    const uninst = run(codeCli, [...common, '--uninstall-extension', 'robinmaomao.codeblocks-vscode'], { timeout: 2 * 60 * 1000 });
    check('P3 卸载成功（exit 0）', uninst.status === 0, (uninst.stderr || uninst.stdout || '').split('\n').filter(Boolean).slice(-3), 'exit 0');
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\npack 打包冒烟: ${pass} pass, ${fail} fail, ${skip} skip${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('pack 运行异常: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
