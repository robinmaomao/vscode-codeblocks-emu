// 批次一 P2 回归：递归添加文件的纯逻辑
//  - isRecursiveSourceFile：扩展名白名单 + .cbp/.layout 排除
//  - enumerateRecursiveSourceFiles：递归枚举 + SCM 目录/obj/bin 过滤 + POSIX 相对路径 + 排序
//  - buildUnitXmlForTargets：compilerVar 判定（.c→CC / Win .rc→WINDRES / 其余省略）+ 目标子集 <Option target>
// 对齐参考：projectmanagerui.cpp:1625-1712（OnAddFilesToProjectRecursively）、
//          projectloader.cpp:1820-1841（SaveUnit 的 Option 书写条件）
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isRecursiveSourceFile, enumerateRecursiveSourceFiles, buildUnitXmlForTargets, RECURSIVE_SKIP_DIRS, RECURSIVE_SOURCE_EXTS,
} = require('../dist/project/recursiveAdd.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. 白名单判定 ----
check('源文件扩展名白名单', isRecursiveSourceFile('main.c') && isRecursiveSourceFile('A.CPP') && isRecursiveSourceFile('x.h')
  && isRecursiveSourceFile('boot.s') && isRecursiveSourceFile('res.rc'), 'sources', true);
check('非源文件被排除（.o/.d/.txt/.md/无扩展名）',
  !isRecursiveSourceFile('main.o') && !isRecursiveSourceFile('main.d') && !isRecursiveSourceFile('notes.txt')
  && !isRecursiveSourceFile('README') && !isRecursiveSourceFile('.gitignore'), 'others', false);
check('.cbp/.layout 明确排除（对齐 CB：Lower().Matches("*.cbp")）',
  !isRecursiveSourceFile('proj.cbp') && !isRecursiveSourceFile('proj.layout'), 'project-files', false);
check('跳过目录集合含 SCM + obj/bin', ['obj', 'bin', '.git', '.hg', '.svn', 'cvs'].every((d) => RECURSIVE_SKIP_DIRS.has(d)),
  [...RECURSIVE_SKIP_DIRS], 'SCM+obj/bin');
check('白名单与 addFile 过滤器一致', ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'rc', 's'].every((e) => RECURSIVE_SOURCE_EXTS.has(e)),
  [...RECURSIVE_SOURCE_EXTS].sort(), 'addFile 过滤器');

// ---- 2. 递归枚举 ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-recadd-'));
const mk = (rel, content = '') => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};
mk('src/main.c'); mk('src/util.cpp'); mk('inc/util.h'); mk('src/deep/nested/thing.cc');
mk('.git/config.c'); mk('.svn/x.c'); mk('CVS/y.c'); mk('obj/hidden.c'); mk('obj/main.o'); mk('bin/app.c');
mk('proj.cbp'); mk('proj.layout'); mk('readme.md');

const found = enumerateRecursiveSourceFiles(root);
check('递归枚举：过滤 SCM/obj/bin/.cbp/.layout，保留源文件且已排序',
  JSON.stringify(found) === JSON.stringify(['inc/util.h', 'src/deep/nested/thing.cc', 'src/main.c', 'src/util.cpp']),
  found, ['inc/util.h', 'src/deep/nested/thing.cc', 'src/main.c', 'src/util.cpp']);
check('枚举结果均为 POSIX 相对路径（无盘符/反斜杠）',
  found.every((r) => !r.includes('\\') && !path.isAbsolute(r)), found, 'posix');
check('不存在的目录返回空数组', enumerateRecursiveSourceFiles(path.join(root, 'nope')).length === 0, 'n/a', []);

// ---- 3. Unit XML 生成 ----
const u1 = buildUnitXmlForTargets('src/main.c', '.c', null, true);
check('.c → compilerVar="CC" 成对节点（无 target）',
  u1 === '\t\t<Unit filename="src/main.c">\n\t\t\t<Option compilerVar="CC" />\n\t\t</Unit>', u1, 'CC 单元');
const u2 = buildUnitXmlForTargets('src/util.cpp', '.cpp', null, true);
check('.cpp → 默认 CPP，自闭合单元', u2 === '\t\t<Unit filename="src/util.cpp" />', u2, '自闭合');
const u3 = buildUnitXmlForTargets('res/app.rc', '.rc', null, true);
check('Win32 .rc → compilerVar="WINDRES"', u3.includes('compilerVar="WINDRES"'), u3, 'WINDRES');
const u4 = buildUnitXmlForTargets('res/app.rc', '.rc', null, false);
check('非 Windows .rc → 退回 CPP（自闭合）', u4 === '\t\t<Unit filename="res/app.rc" />', u4, '自闭合');
const u5 = buildUnitXmlForTargets('src/main.c', '.c', ['Debug'], true);
check('目标子集 → 追加 <Option target>（顺序：compilerVar 在前，对齐 SaveUnit）',
  u5 === '\t\t<Unit filename="src/main.c">\n\t\t\t<Option compilerVar="CC" />\n\t\t\t<Option target="Debug" />\n\t\t</Unit>', u5, 'CC+target');
const u6 = buildUnitXmlForTargets('src/util.cpp', '.cpp', ['Release'], true);
check('目标子集（无 compilerVar）→ 仅 <Option target>',
  u6 === '\t\t<Unit filename="src/util.cpp">\n\t\t\t<Option target="Release" />\n\t\t</Unit>', u6, 'target only');
const u7 = buildUnitXmlForTargets('src/a&b.cpp', '.cpp', ['<Rel"x>'], true);
check('XML 转义（& < > "）', u7.includes('a&amp;b.cpp') && u7.includes('&lt;Rel&quot;x&gt;'), u7, 'escaped');

// ---- 4. 端到端：把生成的 <Unit> 写入真实 .cbp 再解析（验证与 parser/writer 兼容） ----
{
  const { ProjectParser } = require('../dist/model/parser.js');
  const srcCbp = path.join(__dirname, '../test-project/hello-cb.cbp');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-recadd-e2e-'));
  const cbpCopy = path.join(tmpDir, 'hello-cb.cbp');
  fs.copyFileSync(srcCbp, cbpCopy);

  const before = new ProjectParser().parse(cbpCopy);
  const units = [
    buildUnitXmlForTargets('rec/main.c', '.c', null, true),        // 全部目标
    buildUnitXmlForTargets('rec/lib.cpp', '.cpp', ['Debug'], true), // 目标子集
  ];
  const raw = fs.readFileSync(cbpCopy, 'utf-8');
  const at = raw.lastIndexOf('</Project>');
  fs.writeFileSync(cbpCopy, raw.slice(0, at) + units.join('\n') + '\n' + raw.slice(at), 'utf-8');

  const after = new ProjectParser().parse(cbpCopy);
  const added = after.files.filter((f) => f.relativeFilename.startsWith('rec/'));
  const main = added.find((f) => f.relativeFilename === 'rec/main.c');
  const lib = added.find((f) => f.relativeFilename === 'rec/lib.cpp');
  check('端到端：解析出 2 个新增单元', added.length === 2, added.map((f) => f.relativeFilename), 2);
  check('端到端：.c → compilerVar=CC；.cpp → 默认 CPP',
    main?.compilerVar === 'CC' && lib?.compilerVar === 'CPP',
    [main?.compilerVar, lib?.compilerVar], ['CC', 'CPP']);
  check('端到端：未写 target → 隐式归属全部目标（explicitTargets=false）',
    main?.explicitTargets === false && main.buildTargets.length === (before.buildTargets.length || 1),
    { explicit: main?.explicitTargets, targets: main?.buildTargets }, 'all');
  check('端到端：目标子集 → 仅归属 Debug（explicitTargets=true）',
    lib?.explicitTargets === true && JSON.stringify(lib.buildTargets) === JSON.stringify(['Debug']),
    { explicit: lib?.explicitTargets, targets: lib?.buildTargets }, ['Debug']);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

fs.rmSync(root, { recursive: true, force: true });

console.log(`递归添加回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
