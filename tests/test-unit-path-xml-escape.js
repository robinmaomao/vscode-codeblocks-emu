// P0-4：单元路径 XML 转义回归（路径含 & / < / > / " 时的添加、改名、计数、切换 compile/link）
const { escapeXmlAttr, unescapeXmlAttr } = require('../dist/model/xml.js');
const { renameUnitInCbpText, countUnitReferences } = require('../dist/project/unitText.js');
const { buildUnitXmlForTargets } = require('../dist/project/recursiveAdd.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

check('escapeXmlAttr 覆盖四个实体', escapeXmlAttr('A&B<C>D"E') === 'A&amp;B&lt;C&gt;D&quot;E', escapeXmlAttr('A&B<C>D"E'), 'A&amp;B&lt;C&gt;D&quot;E');
check('unescapeXmlAttr 往返', unescapeXmlAttr(escapeXmlAttr('A&B<C>D"E')) === 'A&B<C>D"E', unescapeXmlAttr(escapeXmlAttr('A&B<C>D"E')), 'A&B<C>D"E');
check('未知实体原样保留', unescapeXmlAttr('A&nbsp;B') === 'A&nbsp;B', unescapeXmlAttr('A&nbsp;B'), 'A&nbsp;B');

// buildUnitXmlForTargets 输出合法属性值
const unit = buildUnitXmlForTargets('src/A&B.c', '.c', null, true);
check('Unit 路径 & 被转义', unit.includes('filename="src/A&amp;B.c"'), unit, '&amp;');
check('Unit 路径 < > " 被转义', buildUnitXmlForTargets('a<b>c"d.c', '.c', null, true).includes('filename="a&lt;b&gt;c&quot;d.c"'), buildUnitXmlForTargets('a<b>c"d.c', '.c', null, true), 'escaped');

// 原始 .cbp 文本是转义形式；模型传入解码路径（a&b.c）应命中并写回转义形式
const raw = '\t\t<Unit filename="src/a&amp;b.c" />';
const renamed = renameUnitInCbpText(raw, 'src/a&b.c', 'src/c&d.c');
check('改名：解码路径命中转义文本', renamed.replaced, renamed.replaced, true);
check('改名：新路径写回转义形式', renamed.text.includes('filename="src/c&amp;d.c"'), renamed.text, '&amp;');
check('改名：不产生双重转义', !renamed.text.includes('&amp;amp;'), renamed.text, 'no double escape');
check('计数：解码路径命中转义文本', countUnitReferences(raw, 'src/a&b.c') === 1, countUnitReferences(raw, 'src/a&b.c'), 1);
check('计数：不误命中其它路径', countUnitReferences(raw, 'src/a&c.c') === 0, countUnitReferences(raw, 'src/a&c.c'), 0);

// 成对节点 + 子选项保留
const paired = '\t\t<Unit filename="a&amp;b.c">\n\t\t\t<Option compilerVar="CC" />\n\t\t</Unit>';
const r2 = renameUnitInCbpText(paired, 'a&b.c', 'x&y.c');
check('成对节点：仅改开标签且保留子选项', r2.replaced && r2.text.includes('<Unit filename="x&amp;y.c">') && r2.text.includes('<Option compilerVar="CC" />'), r2.text, 'ok');

console.log('unit-path-xml-escape: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
