// Makefile 导出（Wave 3 B4）回归：格式化单元 + mingw32-make 真机端到端
const { generateMakefile, recipeCommand, makeRelative } = require('../dist/build/makefileExporter');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

// ---- 单元：格式化 ----
check('$ 转义为 $$', recipeCommand('gcc -o "$(OUT)"') === 'gcc -o "$$(OUT)"', recipeCommand('gcc -o "$(OUT)"'));
check('多行命令连接为 &&', recipeCommand('a\nb') === 'a && b', recipeCommand('a\nb'));
check('makeRelative 绝对转相对', makeRelative('C:/p', 'C:/p/obj/main.o') === 'obj/main.o', makeRelative('C:/p', 'C:/p/obj/main.o'));

const unitOpts = {
  projectTitle: 't', projectFile: 't.cbp', basePath: 'C:/p', generatedAt: '2026-01-01', platform: 'win32',
  targets: [{
    targetTitle: 'default', output: 'C:/p/bin/app.exe',
    compile: [{ object: 'C:/p/obj/main.o', source: 'C:/p/main.c', command: 'gcc -c "C:/p/main.c" -o "C:/p/obj/main.o"' }],
    link: { kind: 'link', command: 'gcc -o "C:/p/bin/app.exe" "C:/p/obj/main.o"', objects: ['C:/p/obj/main.o'] },
  }],
};
const unit = generateMakefile(unitOpts);
check('all 目标', unit.includes('all: bin/app.exe'), null);
check('链接规则依赖对象（含目录前置）', unit.includes('bin/app.exe: obj/main.o | bin/'), null);
check('编译规则（含目录前置）', unit.includes('obj/main.o: main.c | obj/'), null);
check('目录创建规则（win cmd）', unit.includes('obj/:') && unit.includes('cmd /c if not exist "obj" mkdir "obj"'), null);
check('配方行以 tab 开头', unit.includes('\tgcc -c "C:/p/main.c"'), null);
check('clean 规则（win cmd）', unit.includes('-cmd /c del /q "obj\\main.o"'), null);

const posix = generateMakefile({ ...unitOpts, platform: 'linux' });
check('目录创建规则（posix）', posix.includes('mkdir -p "obj"'), null);
check('clean 规则（posix）', posix.includes('-rm -f "obj/main.o"'), null);

// ---- 端到端：mingw32-make 真机构建 ----
function findTool(candidates, name) {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  const w = spawnSync('where.exe', [name], { encoding: 'utf-8' });
  if (w.status === 0) {
    const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  return undefined;
}
const gcc = findTool(['D:\\Program Files\\mingw64\\bin\\gcc.exe'], 'gcc.exe');
const make = findTool(['D:\\Program Files\\mingw64\\bin\\mingw32-make.exe'], 'mingw32-make.exe');
if (!gcc || !make) {
  console.log(`SKIP mingw32-make 端到端（gcc=${gcc || '未找到'}, make=${make || '未找到'}）`);
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mk-'));
  fs.writeFileSync(path.join(dir, 'main.c'), '#include <stdio.h>\nint add(int,int);\nint main(void){printf("MKOK %d\\n", add(2,3));return 0;}\n');
  fs.writeFileSync(path.join(dir, 'util.c'), 'int add(int a,int b){return a+b;}\n');
  const objMain = path.join(dir, 'obj', 'main.o');
  const objUtil = path.join(dir, 'obj', 'util.o');
  const exe = path.join(dir, 'bin', 'app.exe');
  const q = (p) => '"' + p + '"';

  const content = generateMakefile({
    projectTitle: 'mk-e2e', projectFile: 'mk.cbp', basePath: dir, generatedAt: new Date().toISOString(),
    targets: [{
      targetTitle: 'default', output: exe,
      compile: [
        { object: objMain, source: path.join(dir, 'main.c'), command: `${q(gcc)} -c ${q(path.join(dir, 'main.c'))} -o ${q(objMain)}` },
        { object: objUtil, source: path.join(dir, 'util.c'), command: `${q(gcc)} -c ${q(path.join(dir, 'util.c'))} -o ${q(objUtil)}` },
      ],
      link: { kind: 'link', command: `${q(gcc)} -o ${q(exe)} ${q(objMain)} ${q(objUtil)}`, objects: [objMain, objUtil] },
    }],
  });
  const mkFile = path.join(dir, 'Makefile');
  fs.writeFileSync(mkFile, content, 'utf-8');

  const r1 = spawnSync(make, ['-f', mkFile], { cwd: dir, encoding: 'utf-8' });
  check('make 构建退出码 0', r1.status === 0, { status: r1.status, stdout: r1.stdout, stderr: r1.stderr });
  check('产物存在', fs.existsSync(exe), fs.existsSync(exe));
  const run = spawnSync(exe, [], { encoding: 'utf-8' });
  check('程序运行输出正确', (run.stdout || '').includes('MKOK 5'), run.stdout);

  // 增量：再次 make 不重建（退出码 0，且不报错）
  const r2 = spawnSync(make, ['-f', mkFile], { cwd: dir, encoding: 'utf-8' });
  check('重复 make 幂等', r2.status === 0, { status: r2.status, stderr: r2.stderr });

  // clean
  const r3 = spawnSync(make, ['-f', mkFile, 'clean'], { cwd: dir, encoding: 'utf-8' });
  check('clean 退出码 0', r3.status === 0, { status: r3.status, stderr: r3.stderr });
  check('clean 删除对象与产物', !fs.existsSync(objMain) && !fs.existsSync(objUtil) && !fs.existsSync(exe), { objMain: fs.existsSync(objMain), exe: fs.existsSync(exe) });

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`Makefile 导出: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
