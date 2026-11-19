// Open include file（F-05）命令级回归：
//  - 尖括号 include 搜索编译器系统头目录（有 gcc 时）
//  - 工程文件后缀匹配（include 目录未命中时）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

function writeCbp(file, title, units) {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n\t<FileVersion major="1" minor="6" />\n\t<Project>\n'
    + `\t\t<Option title="${title}" />\n\t\t<Option compiler="gcc" />\n`
    + '\t\t<Build>\n\t\t\t<Target title="Debug">\n\t\t\t\t<Option type="1" />\n'
    + `\t\t\t\t<Option output="bin/Debug/${title}" />\n\t\t\t\t<Option object_output="obj/Debug/" />\n`
    + '\t\t\t</Target>\n\t\t</Build>\n'
    + units.map((u) => `\t\t<Unit filename="${u}" />\n`).join('')
    + '\t</Project>\n</CodeBlocks_project_file>\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xml, 'utf-8');
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-open-include-'));
  const app = await activate({ tmpDir: tmp });
  const { records } = app;
  const Uri = app.vscode.Uri;
  const { queryCompilerSystemIncludes } = require('../dist/tools/clangd');

  // 系统头：<stdio.h>
  const sysDir = path.join(tmp, 'sys');
  const sysMain = path.join(sysDir, 'main.c');
  fs.mkdirSync(sysDir, { recursive: true });
  fs.writeFileSync(sysMain, '#include <stdio.h>\nint main(void){return 0;}\n', 'utf-8');
  const sysCbp = path.join(sysDir, 'sys.cbp');
  writeCbp(sysCbp, 'sys', ['main.c']);
  await app.invoke('codeblocks.openProject', Uri.file(sysCbp));
  app.setActiveEditor(sysMain, fs.readFileSync(sysMain, 'utf-8'), 'c');
  const beforeShown = records.shownDocuments.length;
  await app.invoke('codeblocks.openIncludeFile');
  const shown = records.shownDocuments.slice(beforeShown);
  const systemIncludes = queryCompilerSystemIncludes(process.platform === 'win32' ? 'gcc.exe' : 'gcc', process.platform === 'win32' ? 'g++.exe' : 'g++');
  if (systemIncludes.length && systemIncludes.some((d) => fs.existsSync(path.join(d, 'stdio.h')))) {
    check('系统头：<stdio.h> 打开编译器头文件', shown.some((p) => path.basename(p).toLowerCase() === 'stdio.h'), shown);
  } else {
    console.log('SKIP 系统头：当前环境无 gcc 系统头');
  }

  // 工程后缀：include 目录为空，src/main.c 引用 sub/util.h
  const proj = path.join(tmp, 'suffix');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'main.c'), '#include "util.h"\nint main(void){return 0;}\n', 'utf-8');
  fs.writeFileSync(path.join(proj, 'sub', 'util.h'), 'int util(void);\n', 'utf-8');
  const cbp = path.join(proj, 'suffix.cbp');
  writeCbp(cbp, 'suffix', ['src/main.c', 'sub/util.h']);
  await app.invoke('codeblocks.openProject', Uri.file(cbp));
  await app.invoke('codeblocks.setActiveProject', cbp);
  const active = path.join(proj, 'src', 'main.c');
  app.setActiveEditor(active, fs.readFileSync(active, 'utf-8'), 'c');
  const beforeSuffix = records.shownDocuments.length;
  await app.invoke('codeblocks.openIncludeFile');
  const suffixShown = records.shownDocuments.slice(beforeSuffix);
  check('工程后缀：include "util.h" 命中 sub/util.h', suffixShown.some((p) => path.normalize(p) === path.normalize(path.join(proj, 'sub', 'util.h'))), suffixShown);

  await app.deactivate().catch(() => undefined);
  console.log(`Open include file: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
