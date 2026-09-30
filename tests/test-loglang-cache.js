// logLang 偏好缓存失效回归（审计 P1.3）：
//  - 首次读取缓存后，设置变更不立即影响 buildLogPrefs（旧行为）
//  - resetBuildLogPrefsCache() 后重新读取生效（plainCbLog / log.english / strictQuoting / quietSuccess）
//  - dist 接线静态断言：extension.ts 配置监听包含四键 + resetBuildLogPrefsCache
const Module = require('module');
const origLoad = Module._load;
const settings = {};
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }) },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const path = require('path');
const { buildLogPrefs, msg, strictQuoting, quietSuccess, resetBuildLogPrefsCache } = require('../dist/build/logLang.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

// 1. 初始默认值
let p = buildLogPrefs();
check('默认全部 false', p.plain === false && p.english === false && p.strict === false && p.quiet === false, p);

// 2. 修改设置但不重置 → 仍返回缓存（旧行为复现）
settings['build.plainCbLog'] = true;
settings['log.english'] = true;
settings['build.strictQuoting'] = true;
settings['ui.quietSuccess'] = true;
p = buildLogPrefs();
check('未重置时仍读缓存（plain/english/strict/quiet 全 false）',
  p.plain === false && p.english === false && p.strict === false && p.quiet === false, p);

// 3. 重置后生效
resetBuildLogPrefsCache();
p = buildLogPrefs();
check('重置后读取到新值（全 true）',
  p.plain === true && p.english === true && p.strict === true && p.quiet === true, p);
check('msg() 走 english=true 分支', msg('中文', 'english') === 'english', msg('中文', 'english'));
check('strictQuoting()/quietSuccess() 同步生效', strictQuoting() === true && quietSuccess() === true);

// 4. 再次修改并重置（反向验证）
settings['log.english'] = false;
resetBuildLogPrefsCache();
check('再次重置后 english=false 生效', buildLogPrefs().english === false && msg('中文', 'english') === '中文');

// 5. dist 接线静态断言
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
check('extension 接线：监听 codeblocks.build.plainCbLog', ext.includes("affectsConfiguration('codeblocks.build.plainCbLog')"), null);
check('extension 接线：监听 codeblocks.log.english', ext.includes("affectsConfiguration('codeblocks.log.english')"), null);
check('extension 接线：监听 codeblocks.build.strictQuoting', ext.includes("affectsConfiguration('codeblocks.build.strictQuoting')"), null);
check('extension 接线：监听 codeblocks.ui.quietSuccess', ext.includes("affectsConfiguration('codeblocks.ui.quietSuccess')"), null);
check('extension 接线：调用 resetBuildLogPrefsCache', ext.includes('resetBuildLogPrefsCache'), null);

console.log(`logLang 缓存失效回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
