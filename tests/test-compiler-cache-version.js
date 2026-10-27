// 编译缓存工具版本探测回归：
//  - 普通可执行文件走 execFile（不经 shell）
//  - Windows 的 .cmd / .bat（Scoop shim 等）不能由 execFile 直接启动，必须经 cmd.exe
//  - 工具不存在/启动失败 → undefined（版本号只用于展示，不影响检测/启用）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { queryToolVersion, parseToolVersion } = require('../dist/build/compilerCache.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ccver-'));

(async () => {
  check('parseToolVersion 基线', parseToolVersion('ccache version 4.8.3') === '4.8.3', null);

  if (process.platform === 'win32') {
    const cmd = path.join(tmp, 'ccache.cmd');
    fs.writeFileSync(cmd, '@echo ccache version 4.14.1\r\n', 'utf-8');
    const v1 = await queryToolVersion(cmd);
    check('Windows .cmd shim：可查询版本（经 cmd.exe）', v1 === '4.14.1', v1);

    const bat = path.join(tmp, 'sccache.bat');
    fs.writeFileSync(bat, '@echo sccache 0.18.0\r\n', 'utf-8');
    const v2 = await queryToolVersion(bat);
    check('Windows .bat shim：可查询版本（经 cmd.exe）', v2 === '0.18.0', v2);
  } else {
    const sh = path.join(tmp, 'ccache');
    fs.writeFileSync(sh, '#!/bin/sh\necho "ccache version 4.9.1"\n', 'utf-8');
    fs.chmodSync(sh, 0o755);
    const v = await queryToolVersion(sh);
    check('POSIX 可执行脚本：可查询版本', v === '4.9.1', v);
  }

  const missing = await queryToolVersion(path.join(tmp, 'no-such-tool.exe'));
  check('不存在的工具：返回 undefined 且不抛异常', missing === undefined, missing);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`编译缓存版本探测: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
