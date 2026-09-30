// 验证 K1：<Option platforms> 解析与当前平台判定（对齐 GetPlatformsFromString / SupportsCurrentPlatform）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { supportsCurrentPlatform } = require('../dist/model/types.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-platforms-'));
const cbp = path.join(dir, 't.cbp');
fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="t" />
		<Option platforms="Windows;Unix" />
		<Build>
			<Target title="A"><Option type="1" /><Option platforms="Windows" /><Option output="bin/a" /></Target>
			<Target title="B"><Option type="1" /><Option platforms="All" /><Option output="bin/b" /></Target>
			<Target title="C"><Option type="1" /><Option platforms="Windows;Unix;Mac" /><Option output="bin/c" /></Target>
			<Target title="D"><Option type="1" /><Option platforms="Mac" /><Option output="bin/d" /></Target>
			<Target title="E"><Option type="1" /><Option output="bin/e" /></Target>
		</Build>
		<Unit filename="main.c" />
	</Project>
</CodeBlocks_project_file>`, 'utf-8');

const p = new ProjectParser().parse(cbp);
const byTitle = Object.fromEntries(p.buildTargets.map((t) => [t.title, t]));

// 项目级：Windows;Unix → 0x04|0x02 = 6
check('项目 platforms=Windows;Unix → 6', p.platforms === 6);
// 目标级：Windows → 4
check('目标 platforms=Windows → 4', byTitle.A.platforms === 4);
// All → 0xff
check('目标 platforms=All → 0xff', byTitle.B.platforms === 0xff);
// W+U+M → 0xff（GetPlatformsFromString 语义）
check('目标 platforms=W+U+M → 0xff', byTitle.C.platforms === 0xff);
// Mac → 1
check('目标 platforms=Mac → 1', byTitle.D.platforms === 1);
// 未写 platforms → 默认 0xff
check('目标缺省 platforms → 0xff', byTitle.E.platforms === 0xff);

// supportsCurrentPlatform：spAll 恒真；spWindows 仅 Windows 真；spUnix 仅非 win/mac
check('spAll 恒支持', supportsCurrentPlatform(0xff) === true);
check('spWindows 平台判定', supportsCurrentPlatform(0x04) === (process.platform === 'win32'));
check('spUnix 平台判定', supportsCurrentPlatform(0x02) === (process.platform !== 'win32' && process.platform !== 'darwin'));
check('spMac 平台判定', supportsCurrentPlatform(0x01) === (process.platform === 'darwin'));
check('空位掩码不支持', supportsCurrentPlatform(0) === false);

fs.rmSync(dir, { recursive: true, force: true });
console.log('汇总: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
