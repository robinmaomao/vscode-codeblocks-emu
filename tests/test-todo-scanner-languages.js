// F-06：TODO 扫描按语言识别注释（# / REM / ::），且不误报 C 预处理器。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseBufferForTodos } = require('../dist/tools/todoScanner.js');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const BASE = { startStrings: ['TODO', 'FIXME'], allowedTypes: ['TODO', 'FIXME'] };
const texts = (buf, file, opts) => parseBufferForTodos(buf, file, opts).map((t) => t.text);

check('xm：# 行注释', JSON.stringify(texts('config TEST\n{\n  # TODO: xm\n}\n', 'a.xm')) === JSON.stringify(['xm']), texts('config TEST\n{\n  # TODO: xm\n}\n', 'a.xm'));
check('ld：# 行注释', JSON.stringify(texts('SECTIONS\n{\n  # TODO: ld\n}\n', 'a.ld')) === JSON.stringify(['ld']), texts('SECTIONS\n{\n  # TODO: ld\n}\n', 'a.ld'));
check('ld：/* */ 块注释', JSON.stringify(texts('/* FIXME: block */\n', 'a.ld')) === JSON.stringify(['block']), texts('/* FIXME: block */\n', 'a.ld'));
check('ld：保留 // 兼容行为', JSON.stringify(texts('// TODO: legacy\n', 'a.ld')) === JSON.stringify(['legacy']), texts('// TODO: legacy\n', 'a.ld'));
check('c：#define TODO 不误报', texts('#define TODO 1\nint main(void){return 0;}\n', 'a.c').length === 0, texts('#define TODO 1\n', 'a.c'));
check('c：// TODO 正常识别', JSON.stringify(texts('// TODO: c\n', 'a.c')) === JSON.stringify(['c']), texts('// TODO: c\n', 'a.c'));
check('s：默认不识别 #', texts('  # TODO: gas\n', 'a.s', BASE).length === 0, texts('  # TODO: gas\n', 'a.s', BASE));
check('s：开 asmHashComment 后识别 #', JSON.stringify(texts('  # TODO: gas\n', 'a.s', { ...BASE, asmHashComment: true })) === JSON.stringify(['gas']), texts('  # TODO: gas\n', 'a.s', { ...BASE, asmHashComment: true }));
check('s：开 asmHashComment 后仍识别 //', JSON.stringify(texts('// TODO: preprocessed\n', 'a.s', { ...BASE, asmHashComment: true })) === JSON.stringify(['preprocessed']), texts('// TODO: preprocessed\n', 'a.s', { ...BASE, asmHashComment: true }));
check('S：开 asmHashComment 后不误报 #define TODO', texts('#define TODO 1\n', 'a.S', { ...BASE, asmHashComment: true }).length === 0, texts('#define TODO 1\n', 'a.S', { ...BASE, asmHashComment: true }));
check('bat：REM / ::', JSON.stringify(texts('REM TODO: batch\n:: FIXME: label\n', 'a.bat')) === JSON.stringify(['batch', 'label']), texts('REM TODO: batch\n:: FIXME: label\n', 'a.bat'));
check('bat：REMARK 不误报', texts('REMARK TODO: no\n', 'a.bat').length === 0, texts('REMARK TODO: no\n', 'a.bat'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-todo-lang-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const files = {
    'a.s': '  # TODO: asm-hash\n  .text\n',
    'a.xm': 'config TEST\n{\n  # TODO: xm-hash\n}\n',
    'a.ld': 'SECTIONS\n{\n  # TODO: ld-hash\n}\n',
    'main.c': '#define TODO 1\nint main(void){return 0;}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(proj, name), text, 'utf-8');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n\t<FileVersion major="1" minor="6" />\n\t<Project>\n'
    + '\t\t<Option title="todo-lang" />\n\t\t<Option compiler="gcc" />\n'
    + '\t\t<Build>\n\t\t\t<Target title="Debug">\n\t\t\t\t<Option type="1" />\n'
    + '\t\t\t\t<Option output="bin/Debug/app" />\n\t\t\t\t<Option object_output="obj/Debug/" />\n'
    + '\t\t\t</Target>\n\t\t</Build>\n'
    + Object.keys(files).map((n) => `\t\t<Unit filename="${n}" />\n`).join('')
    + '\t</Project>\n</CodeBlocks_project_file>\n';
  const cbp = path.join(proj, 'todo-lang.cbp');
  fs.writeFileSync(cbp, xml, 'utf-8');

  const app = await activate({ tmpDir: tmp, config: { 'codeblocks.editor.asmHashComment': false } });
  app.setConfig('codeblocks.editor.asmHashComment', true);
  await app.invoke('codeblocks.openProject', app.vscode.Uri.file(cbp));
  await app.invoke('codeblocks.todoList');
  let channel = app.mock.channels.find((c) => c.name === 'Code::Blocks');
  let out = channel ? channel.lines.join('\n') : '';
  check('命令级：asmHashComment=true 命中 .s # TODO', /asm-hash/.test(out), out);
  check('命令级：命中 .xm / .ld # TODO', /xm-hash/.test(out) && /ld-hash/.test(out), out);
  check('命令级：不误报 C #define TODO', !/define/.test(out), out);

  app.setConfig('codeblocks.editor.asmHashComment', false);
  await app.invoke('codeblocks.todoList');
  channel = app.mock.channels.find((c) => c.name === 'Code::Blocks');
  out = channel ? channel.lines.join('\n') : '';
  check('命令级：asmHashComment=false 不命中 .s # TODO', !/asm-hash/.test(out), out);
  check('命令级：.xm / .ld 仍命中', /xm-hash/.test(out) && /ld-hash/.test(out), out);

  await app.deactivate().catch(() => undefined);
  console.log(`TODO 语言注释扫描: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
