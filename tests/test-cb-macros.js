// 验证第八轮 S1/S2/S3：replaceCbMacros（$(#全局变量)/日期/env 回退/反转义）+ CodeBlocksConfig 全局变量解析
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { workspaceFolders: [{ uri: { fsPath: 'C:\\ws' } }] },
      window: { activeTextEditor: undefined },
      env: { appRoot: 'C:\\apps\\code' },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { replaceCbMacros, cbBuiltinVars } = require('../dist/compiler/cbMacros.js');
const { CodeBlocksConfig } = require('../dist/compiler/codeblocksConfig.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const gcv = {
  wx: { base: 'C:\\wx\\3.0', include: 'C:\\wx\\include', lib: 'C:\\wx\\lib' },
  riscv: { base: 'E:\\riscv', cflags: '-march=rv32imac' },
};

// 1. $(#var) → base（UnixFilename 规范化：反斜杠→正斜杠）
check('gcv base', replaceCbMacros('x $(#wx) y', { gcv }) === 'x C:/wx/3.0 y');
// 2. $(#var.member) → 成员
check('gcv member', replaceCbMacros('-I$(#wx.include)', { gcv }) === '-IC:/wx/include');
check('gcv cflags', replaceCbMacros('$(#riscv.cflags)', { gcv }) === '-march=rv32imac');
// 3. 未知 $(#var) → 移除
check('gcv unknown', replaceCbMacros('a $(#nope) b', { gcv }) === 'a  b');
// 4. 日期宏格式（NOW = YYYY-MM-DD-HH.MM）
const now = replaceCbMacros('$(NOW)|$(TODAY)|$(TDAY)', {});
check('date macros', /^\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\|\d{4}-\d{2}-\d{2}\|\d{8}$/.test(now), now);
// 5. 环境变量回退（wxGetEnv 语义）
check('env fallback', replaceCbMacros('$(PATH)', {}).length > 0);
// 6. 未命中且无环境变量 → 空替换（CB 同）
check('unknown removed', replaceCbMacros('a $(ZZ_NO_SUCH_VAR_9X) b', {}) === 'a  b');
// 7. 反转义：$$→$、%%→%
check('unescape', replaceCbMacros('echo $$HOME %%A', {}) === 'echo $HOME %A');
// 8. 内置宏 + 自定义变量迭代替换
check('nested', replaceCbMacros('$(OUT)', { customVars: { OUT: '$(TARGET_NAME)!' }, vars: { TARGET_NAME: 'Debug' } }) === 'Debug!');
// 9. cbBuiltinVars：空 objectOutput → .objs（原生分隔符）
const bv = cbBuiltinVars('C:\\proj', 'bin\\Debug\\app', 'Debug', '', 'proj', 'C:\\proj\\proj.cbp');
check('builtin .objs', bv.TARGET_OBJECT_DIR === '.objs' + (process.platform === 'win32' ? '\\' : '/'));
check('builtin workspace', bv.WORKSPACE_DIR.replace(/\//g, '\\') === 'C:\\ws\\');
check('builtin apppath', bv.APPPATH.replace(/\//g, '\\') === 'C:\\apps\\code');

// 10. CodeBlocksConfig 解析 /gcv/sets/default/<var>/<member>
const confPath = path.join(os.tmpdir(), 'cb-test-gcv-' + process.pid + '.conf');
fs.writeFileSync(confPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<!DOCTYPE CodeBlocksConfig>
<CodeBlocksConfig version="1">
  <gcv>
    <sets>
      <default>
        <wx>
          <base><![CDATA[C:\\wx\\3.0]]></base>
          <include><![CDATA[C:\\wx\\include]]></include>
          <lib><![CDATA[C:\\wx\\lib]]></lib>
        </wx>
      </default>
    </sets>
  </gcv>
</CodeBlocksConfig>
`, 'utf-8');
const cfg = new CodeBlocksConfig();
cfg.load(confPath);
const vars = cfg.globalVariables();
check('config gcv parse', !!vars['wx'] && vars['wx'].base === 'C:\\wx\\3.0' && vars['wx'].lib === 'C:\\wx\\lib', vars['wx']);
fs.rmSync(confPath, { force: true });

console.log(`test-cb-macros: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
