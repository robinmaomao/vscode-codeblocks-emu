// D-10 / D-11 回归（可激活 mock 直调真实处理器）
//  D-10：clangd 二进制存在但 clangd 扩展未安装/被禁用时，构建引擎必须继续写 Problems（不再让出诊断）
//  D-11：codeblocks.openProject 带参直接打开（Find File 流程的调用方式），无参才弹文件对话框
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const CBP = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="d11-demo" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/d11-demo" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-d10d11-'));
  const cbp = path.join(tmp, 'd11-demo.cbp');
  fs.writeFileSync(cbp, CBP, 'utf-8');
  fs.writeFileSync(path.join(tmp, 'main.c'), 'int main(void){return 0;}\n', 'utf-8');

  const app = await activate({ tmpDir: tmp, config: { 'codeblocks.clangd.enabled': false } });
  const out = () => (app.mock.channels.find((c) => c.name === 'Code::Blocks') || { lines: [] }).lines.join('\n');

  // ---- D-11：带参直接打开（Uri 与字符串两种形态），不弹文件对话框 ----
  await app.invoke('codeblocks.openProject', { fsPath: cbp, scheme: 'file' });
  check('D-11：带 Uri 参数直接打开工程（未弹文件对话框）',
    app.records.openDialogs.length === 0 && /已打开项目: d11-demo/.test(out()),
    { dialogs: app.records.openDialogs.length, out: out().split('\n').slice(0, 2) }, '0 次弹框 + 已打开');
  const before = app.records.openDialogs.length;
  await app.invoke('codeblocks.openProject');   // 无参：应弹对话框（脚本未提供 → 取消）
  check('D-11：无参时仍弹文件对话框（保持原行为）',
    app.records.openDialogs.length === before + 1 && app.records.openDialogs[app.records.openDialogs.length - 1].canSelectFiles === true,
    app.records.openDialogs.length, '弹框 1 次');

  // ---- D-10：clangd 扩展未安装 → 诊断不被让出（clangdDiagnosticsEnabled=false） ----
  // 观测点：扩展内部把 clangdDiagnosticsEnabled 传给构建引擎（src/extension.ts 的 gating 表达式）。
  // 此处断言「gating 表达式同时要求 clangd 扩展存在」这一接线（宿主层另有真实 Problems 取证用例）。
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
  const gates = src.match(/clangdDiagnosticsEnabled\s*=[^;]{0,300}?;/g) || [];
  check('D-10：诊断让出需同时满足「检测到 clangd」与「clangd 扩展已安装」',
    gates.some((g) => /detectClangd\(\)|!!clangd/.test(g) && /extensions\.getExtension\(/.test(g) && /vscode-clangd/.test(g)),
    gates.map((g) => g.replace(/\s+/g, ' ').trim().slice(0, 90)), '含 clangd 检测 + getExtension(vscode-clangd)');

  await app.deactivate().catch(() => undefined);
  console.log(`\nD-10/D-11 回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('D-10/D-11 回归异常: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
