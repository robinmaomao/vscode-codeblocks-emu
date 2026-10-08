// X3 回归：contributes.debuggers 配置 schema（configurationAttributes / initialConfigurations /
// configurationSnippets）与调试适配器实际读取字段一一对应，防止声明漂移。
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dbg = (pkg.contributes.debuggers || [])[0] || {};
const adapterSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'debug', 'gdbDebugAdapter.ts'), 'utf-8');
const remoteSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'model', 'projectDebuggerExtensions.ts'), 'utf-8');

check('A1 调试器类型为 codeblocks（内置 F8 路径依赖）', dbg.type === 'codeblocks', dbg.type, 'codeblocks');
check('A2 configurationAttributes 含 launch/attach', !!dbg.configurationAttributes?.launch && !!dbg.configurationAttributes?.attach, Object.keys(dbg.configurationAttributes || {}), ['launch', 'attach']);
check('A3 launch 必填 program', JSON.stringify(dbg.configurationAttributes?.launch?.required) === JSON.stringify(['program']), dbg.configurationAttributes?.launch?.required, ['program']);
check('A4 attach 必填 pid', JSON.stringify(dbg.configurationAttributes?.attach?.required) === JSON.stringify(['pid']), dbg.configurationAttributes?.attach?.required, ['pid']);

// B. launch/attach 声明的属性必须被适配器读取（args.<name>），防「声明了但适配器不认」
const launchProps = Object.keys(dbg.configurationAttributes?.launch?.properties || {});
const attachProps = Object.keys(dbg.configurationAttributes?.attach?.properties || {});
let unmapped = [];
for (const p of new Set([...launchProps, ...attachProps])) {
  if (!adapterSrc.includes(`args.${p}`)) unmapped.push(p);
}
check('B1 全部声明属性均在适配器中有对应读取（args.<name>）', unmapped.length === 0, unmapped, []);

// C. remoteDebugging 子字段与 RemoteDebuggingOptions 接口一致（防 schema 漂移）
const rdProps = Object.keys(dbg.configurationAttributes?.launch?.properties?.remoteDebugging?.properties || {});
const rdMissing = rdProps.filter((p) => !remoteSrc.includes(p));
check('C1 remoteDebugging 子字段均存在于 RemoteDebuggingOptions 接口', rdProps.length >= 12 && rdMissing.length === 0, { count: rdProps.length, missing: rdMissing }, { count: '>=12', missing: [] });
check('C2 remoteDebugging.connType 枚举 0/1/2（TCP/UDP/Serial）', JSON.stringify(dbg.configurationAttributes?.launch?.properties?.remoteDebugging?.properties?.connType?.enum) === JSON.stringify([0, 1, 2]), dbg.configurationAttributes?.launch?.properties?.remoteDebugging?.properties?.connType?.enum, [0, 1, 2]);

// D. initialConfigurations / configurationSnippets 可用于 launch.json「添加配置」
const initCfg = (dbg.initialConfigurations || [])[0] || {};
check('D1 initialConfigurations[0] 类型/请求正确', initCfg.type === 'codeblocks' && initCfg.request === 'launch' && !!initCfg.name, initCfg, { type: 'codeblocks', request: 'launch', name: '…' });
check('D2 initialConfigurations[0] 引用 program 占位', typeof initCfg.program === 'string' && initCfg.program.includes('${workspaceFolder}'), initCfg.program, '${workspaceFolder}…');

const snippets = dbg.configurationSnippets || [];
check('D3 configurationSnippets 含 launch + attach 两条', snippets.length === 2 && snippets.every((s) => s.body?.type === 'codeblocks' && !!s.label && !!s.description), snippets.map((s) => s.label), ['launch', 'attach']);
const attachSnippet = snippets.find((s) => s.body?.request === 'attach');
check('D4 attach snippet 带 pid 占位符', !!attachSnippet && typeof attachSnippet.body.pid === 'string' && attachSnippet.body.pid.includes('${1:'), attachSnippet?.body?.pid, '${1:…}');
check('D5 launch snippet 带 program 占位符', typeof snippets[0]?.body?.program === 'string' && snippets[0].body.program.includes('${1:'), snippets[0]?.body?.program, '${1:…}');

console.log(`\ndebugger-schema 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
