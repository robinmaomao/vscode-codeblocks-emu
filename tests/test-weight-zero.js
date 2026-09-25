// 验证第十一轮 V1：weight="0" 是合法值（对齐 projectloader.cpp:1307 QueryIntAttribute 直接赋值）
// 解析 → weight===0；序列化往返保留 weight="0"；未写 weight 默认 50
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-weight-'));
const cbp = path.join(dir, 'w.cbp');
fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="w" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/w" prefix_auto="1" extension_auto="1" />
				<Option object_output="obj/Debug/" />
			</Target>
		</Build>
		<Unit filename="main.c">
			<Option weight="0" />
		</Unit>
		<Unit filename="util.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

// 1. weight="0" 解析为 0（不是 50）
const p1 = new ProjectParser().parse(cbp);
const m1 = p1.files.find((f) => f.relativeFilename === 'main.c');
check('weight 0 parsed', m1.weight === 0, m1.weight);
// 2. 未写 weight 的文件默认 50
const u1 = p1.files.find((f) => f.relativeFilename === 'util.c');
check('default 50', u1.weight === 50, u1.weight);

// 3. 序列化往返：weight="0" 保留（writer 以 != 50 判断）
const xml = serializeProject(p1);
check('serialize keeps weight=0', xml.includes('weight="0"'), xml.split('\n').filter((l) => l.includes('weight')));
fs.writeFileSync(cbp, xml, 'utf-8');
const p2 = new ProjectParser().parse(cbp);
const m2 = p2.files.find((f) => f.relativeFilename === 'main.c');
check('roundtrip weight 0', m2.weight === 0, m2.weight);

// 4. 越界/非法值忽略（保持默认 50，对齐 CB SetWeight 非法不生效）
const cbp2 = path.join(dir, 'w2.cbp');
fs.writeFileSync(cbp2, xml.replace('weight="0"', 'weight="abc"'), 'utf-8');
const p3 = new ProjectParser().parse(cbp2);
const m3 = p3.files.find((f) => f.relativeFilename === 'main.c');
check('invalid weight ignored', m3.weight === 50, m3.weight);

fs.rmSync(dir, { recursive: true, force: true });

console.log(`test-weight-zero: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
