// 批次一 P3 回归：重命名的 .cbp 文本手术 + 往返（保留全部选项与归属）
//  - renameUnitInCbpText：自闭合 / 成对（含 <Option> 子节点）/ 属性顺序 / 正则特殊字符 / 未命中
//  - 端到端：夹具 <Unit> 改名后 reparse，compilerVar/compile/link/weight/virtualFolder/目标归属全部保留
// 对齐参考：projectmanagerui.cpp:2852-2916（OnTreeItemRename 成功分支 = pf->Rename + RebuildTree）
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renameUnitInCbpText, countUnitReferences, escapeRegExp } = require('../dist/project/unitText.js');
const { ProjectParser } = require('../dist/model/parser.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. 文本手术 ----
const selfClosing = '\t\t<Unit filename="main.c" />';
const r1 = renameUnitInCbpText(selfClosing, 'main.c', 'app.c');
check('自闭合单元：filename 替换', r1.replaced && r1.text === '\t\t<Unit filename="app.c" />', r1.text, '<Unit filename="app.c" />');

const paired = [
  '\t\t<Unit filename="util.c">',
  '\t\t\t<Option compilerVar="CC" />',
  '\t\t\t<Option compile="0" />',
  '\t\t\t<Option target="Debug" />',
  '\t\t</Unit>',
].join('\n');
const r2 = renameUnitInCbpText(paired, 'util.c', 'helpers.c');
check('成对单元：仅改开标签 filename，子节点原样保留',
  r2.replaced && r2.text.includes('<Unit filename="helpers.c">') && r2.text.includes('<Option compilerVar="CC" />')
  && r2.text.includes('<Option compile="0" />') && r2.text.includes('<Option target="Debug" />')
  && r2.text.endsWith('</Unit>'),
  r2.text, 'helpers.c + 全部 Option');

const attrOrder = '\t\t<Unit weight="3" filename="src/a.cpp" />';
const r3 = renameUnitInCbpText(attrOrder, 'src/a.cpp', 'src/b.cpp');
check('filename 不是首个属性：仍正确定位', r3.replaced && r3.text === '\t\t<Unit weight="3" filename="src/b.cpp" />', r3.text, 'ok');

const special = '\t\t<Unit filename="a+b(c)[d].c" />';
const r4 = renameUnitInCbpText(special, 'a+b(c)[d].c', 'x+y(z)[w].c');
check('正则特殊字符文件名（+()[]）不误判', r4.replaced && r4.text.includes('filename="x+y(z)[w].c"'), r4.text, 'ok');

const multi = '\t\t<Unit filename="a.c" />\n\t\t<Unit filename="b.c" />';
const r5 = renameUnitInCbpText(multi, 'a.c', 'c.c');
check('多单元：只改目标单元', r5.text.includes('<Unit filename="c.c" />') && r5.text.includes('<Unit filename="b.c" />'), r5.text, 'ok');

const r6 = renameUnitInCbpText(selfClosing, 'missing.c', 'x.c');
check('未命中：replaced=false 且文本不变', r6.replaced === false && r6.text === selfClosing, r6.replaced, false);

check('引用计数（重复单元检测）', countUnitReferences(multi, 'a.c') === 1 && countUnitReferences(multi, 'a.c'.replace('a', 'b')) === 1, 'ok', 1);
check('escapeRegExp 覆盖正则元字符', escapeRegExp('a+b(c)[d].e$f') === 'a\\+b\\(c\\)\\[d\\]\\.e\\$f', escapeRegExp('a+b(c)[d].e$f'), 'escaped');

// 文件名含 &（XML 转义存储为 &amp;）时的边界：当前实现按字面匹配（记录行为）
{
  const raw = '\t\t<Unit filename="a&amp;b.c" />';
  const r = renameUnitInCbpText(raw, 'a&amp;b.c', 'c.c');
  check('边界：XML 转义文件名按 .cbp 字面量传入可命中（relativeFilename 语义）', r.replaced && r.text.includes('filename="c.c"'), r.replaced, true);
}

// ---- 2. 端到端：真实 .cbp 副本改名 → 重解析选项保留 ----
{
  const src = path.join(__dirname, '../test-project/hello-cb.cbp');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ren-'));
  const cbp = path.join(tmp, 'hello-cb.cbp');
  fs.copyFileSync(src, cbp);

  // 先给 util.c 一组非默认选项，确保改名后原样保留
  let raw = fs.readFileSync(cbp, 'utf-8');
  const before = '\t\t<Unit filename="util.c" />';
  check('夹具：util.c 为自闭合单元', raw.includes(before), raw.includes(before), true);
  raw = raw.replace(before, '\t\t<Unit filename="util.c">\n\t\t\t<Option compilerVar="CC" />\n\t\t\t<Option compile="0" />\n\t\t\t<Option weight="10" />\n\t\t\t<Option virtualFolder="Sources/Deep" />\n\t\t</Unit>');
  fs.writeFileSync(cbp, raw, 'utf-8');

  const parsed = new ProjectParser().parse(cbp);
  const util = parsed.files.find((f) => f.relativeFilename === 'util.c');
  check('夹具：util.c 选项已生效（compile=false / weight=10 / vf=Sources/Deep）',
    util.compile === false && util.weight === 10 && util.virtualFolder === 'Sources/Deep',
    { compile: util.compile, weight: util.weight, vf: util.virtualFolder }, 'ok');

  // 模拟 renameProjectFile 的文本手术
  const { text, replaced } = renameUnitInCbpText(fs.readFileSync(cbp, 'utf-8'), 'util.c', 'helpers.c');
  check('端到端：文本手术命中', replaced, replaced, true);
  fs.writeFileSync(cbp, text, 'utf-8');

  const reparsed = new ProjectParser().parse(cbp);
  const renamed = reparsed.files.find((f) => f.relativeFilename === 'helpers.c');
  const oldStill = reparsed.files.find((f) => f.relativeFilename === 'util.c');
  check('端到端：旧单元消失、新单元出现', !!renamed && !oldStill, { renamed: !!renamed, old: !!oldStill }, 'ok');
  check('端到端：compilerVar/compile/link/weight/virtualFolder 全部保留',
    renamed.compilerVar === 'CC' && renamed.compile === false && renamed.weight === 10
    && renamed.virtualFolder === 'Sources/Deep' && renamed.link === util.link,
    { cv: renamed.compilerVar, compile: renamed.compile, weight: renamed.weight, vf: renamed.virtualFolder, link: renamed.link }, 'ok');
  check('端到端：其余单元（main.c）不受影响', !!reparsed.files.find((f) => f.relativeFilename === 'main.c'), true, true);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`重命名文件回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
