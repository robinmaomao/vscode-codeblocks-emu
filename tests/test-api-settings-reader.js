// Agent 控制层：settings.json（JSONC）读取与合并
const fs = require('fs');
const path = require('path');
const { stripJsonComments, parseJsonc, loadCodeblocksSettings, findWorkspaceSettings } = require('../dist/api/settingsReader');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-settings');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'proj', '.vscode'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'user'), { recursive: true });

// ---------- JSONC ----------
const jsonc = `{
  // line comment
  "codeblocks.compilerId": "gcc", /* block comment */
  "codeblocks.masterPath": "D:/mingw64/bin",
  "codeblocks.compilerOptions": ["-O2", /* inline */ "-Wall"],
}`;
const stripped = stripJsonComments(jsonc);
check('J1 去注释后无 // 与 /*', !stripped.includes('//') && !stripped.includes('/*'), stripped);
const parsed = parseJsonc(jsonc);
check('J2 JSONC 可解析', !!parsed && parsed['codeblocks.compilerId'] === 'gcc', parsed);
check('J3 尾逗号已处理', !!parsed && Array.isArray(parsed['codeblocks.compilerOptions']));
check('J4 字符串内的 // 不被误删', parseJsonc('{ "a": "http://x" }').a === 'http://x');
check('J5 坏 JSON 返回 undefined', parseJsonc('{ bad }') === undefined);

// ---------- 合并优先级 ----------
const userFile = path.join(TMP, 'user', 'settings.json');
fs.writeFileSync(userFile, JSON.stringify({
  'codeblocks.compilerId': 'user-compiler',
  'codeblocks.masterPath': 'user/path',
  'codeblocks.maxReportedErrors': 10,
}, null, 2));

const wsFile = path.join(TMP, 'proj', '.vscode', 'settings.json');
fs.writeFileSync(wsFile, '{\n  // workspace override\n  "codeblocks.compilerId": "ws-compiler",\n}\n');

const cbp = path.join(TMP, 'proj', 'app.cbp');
fs.writeFileSync(cbp, '<CodeBlocks_project_file />');

const found = findWorkspaceSettings(path.join(TMP, 'proj'));
check('M1 找到工作区 settings.json', found === wsFile, found);

const s = loadCodeblocksSettings({ target: cbp, userSettings: [userFile], ignoreEnv: true });
check('M2 工作区覆盖用户', s.get('compilerId', 'gcc') === 'ws-compiler', s.get('compilerId', 'gcc'));
check('M3 用户键保留', s.get('masterPath', '') === 'user/path', s.get('masterPath', ''));
check('M4 数值键', s.get('maxReportedErrors', 50) === 10, s.get('maxReportedErrors', 50));
check('M5 缺省回退', s.get('ui.language', 'auto') === 'auto');
check('M6 sources 记录', s.sources.length === 2 && s.sources.includes(wsFile), s.sources);

process.env.CB_COMPILER_ID = 'env-compiler';
process.env.CB_MASTER_PATH = 'env/path';
const se = loadCodeblocksSettings({ target: cbp, userSettings: [userFile] });
check('M7 环境变量覆盖一切', se.get('compilerId', '') === 'env-compiler' && se.get('masterPath', '') === 'env/path', {
  compilerId: se.get('compilerId', ''), masterPath: se.get('masterPath', ''),
});
delete process.env.CB_COMPILER_ID;
delete process.env.CB_MASTER_PATH;

// 坏配置文件不应抛异常（CLI 不能被坏设置卡死）
fs.writeFileSync(wsFile, '{ broken json');
const sb = loadCodeblocksSettings({ target: cbp, userSettings: [userFile], ignoreEnv: true });
check('M8 坏配置不抛异常', sb.get('compilerId', 'gcc') === 'user-compiler', sb.get('compilerId', 'gcc'));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nAgent 控制层（设置读取）: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
