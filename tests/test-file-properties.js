// 文件属性对话框（CB ProjectFileOptionsDlg）回归：
//  - analyzeFile：行数统计（代码 / 注释 / 空行）、大小、时间戳格式、只读判定、未知语言不做行数统计
//  - objectNameFor：源文件 / 资源脚本 / 头文件（PCH）在 extended_obj_names 下的命名（对齐 SetObjName）
//  - 面板三页结构（General / Build / Advanced）、标题模板、自动生成文件禁用 Build/Advanced、对象文件名只读
//  - customBuild 按编译器存储 + 写盘仅保留 buildCommand 非空条目（use 标志保留）
//  - 保存路径：只读切换走 chmod，compilerVar 自由文本 + compile 时补 CPP
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeFile, objectNameFor, commentTokenFor } = require('../dist/model/fileStats.js');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fileprops-'));

// ---- 1. analyzeFile：C 注释统计 ----
const sample = path.join(dir, 'sample.cpp');
fs.writeFileSync(sample, [
  'int a;',
  '// hello',
  '/* block',
  '   still block',
  '*/',
  '',
  'int b; // trailing',
].join('\n'), 'utf-8');
const st = analyzeFile(sample);
check('行数统计已启用（C/C++ 有注释标记）', st.counted === true, st.counted);
check('总行数 = 7（含中间空行）', st.totalLines === 7, st.totalLines);
check('空行 = 1', st.emptyLines === 1, st.emptyLines);
check('实际代码行 = 2（含「代码 + 注释」混合行）', st.codeLines === 2, st.codeLines);
check('注释行 = 4', st.commentLines === 4, st.commentLines);
check('文件大小 = 字节数', st.fileSize === fs.statSync(sample).size, st.fileSize);
check('时间戳格式 DD/MM/YYYY HH:MM:SS', /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(st.modified), st.modified);
check('可写文件 readOnly=false', st.readOnly === false, st.readOnly);

// ---- 2. 未知语言：不做行数统计（CB 只在 lang != HL_NONE 时统计） ----
const txt = path.join(dir, 'notes.txt');
fs.writeFileSync(txt, 'one\ntwo\n\nthree\n', 'utf-8');
const stTxt = analyzeFile(txt);
check('未知语言 counted=false', stTxt.counted === false, stTxt.counted);
check('未知语言仍给出大小/时间戳', stTxt.fileSize > 0 && stTxt.modified.length === 19, [stTxt.fileSize, stTxt.modified]);
check('注释标记：.cpp 有、.txt 无', commentTokenFor('a.cpp').line === '//' && commentTokenFor('a.txt').line === '', [commentTokenFor('a.cpp'), commentTokenFor('a.txt')]);

// ---- 3. 只读判定 ----
const roFile = path.join(dir, 'ro.c');
fs.writeFileSync(roFile, 'int x;\n', 'utf-8');
fs.chmodSync(roFile, 0o444);
check('chmod 444 后 readOnly=true', analyzeFile(roFile).readOnly === true, analyzeFile(roFile).readOnly);
fs.chmodSync(roFile, 0o666);

// ---- 4. 文件不存在 ----
check('文件不存在返回 null', analyzeFile(path.join(dir, 'missing.c')) === null, analyzeFile(path.join(dir, 'missing.c')));

// ---- 5. objectNameFor（对齐 projectfile.cpp SetObjName） ----
const opts = { extendedObjectNames: false, objectExtension: 'o', supportsPch: true, pchExtension: 'gch', pchSourceFile: false, relativeFilename: 'src/main.c' };
check('源文件 → 换扩展名 .o', objectNameFor('src/main.c', opts) === 'src/main.o', objectNameFor('src/main.c', opts));
check('extended_obj_names → 追加 .o', objectNameFor('src/main.c', { ...opts, extendedObjectNames: true }) === 'src/main.c.o',
  objectNameFor('src/main.c', { ...opts, extendedObjectNames: true }));
check('资源脚本 .rc → .res', objectNameFor('res/app.rc', opts) === 'res/app.res', objectNameFor('res/app.rc', opts));
check('资源脚本 extended → 追加 .res', objectNameFor('res/app.rc', { ...opts, extendedObjectNames: true }) === 'res/app.rc.res',
  objectNameFor('res/app.rc', { ...opts, extendedObjectNames: true }));
check('头文件（支持 PCH）→ 追加 .gch', objectNameFor('inc/guard.h', opts) === 'inc/guard.h.gch', objectNameFor('inc/guard.h', opts));
check('PCH 源文件模式基于 relativeFilename', objectNameFor('inc/guard.h', { ...opts, pchSourceFile: true, relativeFilename: 'include/guard.h' }) === 'include/guard.h.gch',
  objectNameFor('inc/guard.h', { ...opts, pchSourceFile: true, relativeFilename: 'include/guard.h' }));
check('不支持 PCH 时头文件原名', objectNameFor('inc/guard.h', { ...opts, supportsPch: false }) === 'inc/guard.h',
  objectNameFor('inc/guard.h', { ...opts, supportsPch: false }));

// ---- 6. customBuild 写盘：仅保留 buildCommand 非空条目，use 标志原样保存 ----
const cbp = path.join(dir, 'p.cbp');
fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="p" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/p" prefix_auto="1" extension_auto="1" />
				<Option object_output="obj/Debug/" />
			</Target>
		</Build>
		<Unit filename="main.c">
			<Option compiler="gcc" use="0" buildCommand="gcc -E $file" />
		</Unit>
		<Unit filename="util.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
const proj = new ProjectParser().parse(cbp);
const mainFile = proj.files.find((f) => f.relativeFilename === 'main.c');
check('解析 customBuild（含 use=0）', mainFile.customBuildCommands.gcc?.command === 'gcc -E $file' && mainFile.customBuildCommands.gcc?.use === false,
  mainFile.customBuildCommands);

// 模拟保存：gcc 条目 use=false + 非空命令；msvc 条目空命令应被丢弃
mainFile.customBuildCommands = { gcc: { command: 'gcc -E $file', use: false }, msvc: { command: '', use: true } };
const xml = serializeProject(proj);
check('保留非空命令条目并写 use="0"', xml.includes('<Option compiler="gcc" use="0" buildCommand="gcc -E $file" />'),
  xml.split('\n').filter((l) => l.includes('buildCommand')));
check('空命令条目被丢弃（对齐 projectloader 写盘条件）', !xml.includes('msvc'), xml.split('\n').filter((l) => l.includes('msvc')));

// 换行转义：多行命令写成 \n
mainFile.customBuildCommands = { gcc: { command: 'cmd1\ncmd2', use: true } };
check('多行命令转义为 \\n', serializeProject(proj).includes('buildCommand="cmd1\\ncmd2"'),
  serializeProject(proj).split('\n').filter((l) => l.includes('buildCommand')));

// ---- 7. 面板结构（三页 + 标题 + 禁用规则） ----
const dist = fs.readFileSync(path.resolve(__dirname, '../dist/ui/projectPropertiesPanel.js'), 'utf-8');
check('标题模板对齐 CB（Properties of "{0}"）', /Properties of "\{0\}"/.test(dist), 'title');
check('三页页签 general/build/advanced', /'general'/.test(dist) && /'build'/.test(dist) && /'advanced'/.test(dist));
check('自动生成文件时 Build/Advanced 禁用（仅 general 放行）',
  /function fileTabDisabled\(id, f\) \{ return id !== 'general' && fileAutoGenerated\(f\); \}/.test(dist), 'fileTabDisabled');
check('对象文件名只读（disabled 输入框）', /id="ff-obj" type="text" disabled/.test(dist), 'ff-obj');
check('编译变量为自由文本（无 CC/WINDRES 下拉）', !/id="ff-var">[\s\S]{0,200}<option/.test(dist), 'ff-var');
check('权重为滑块（0-100，步进 10）', /id="ff-weight" min="0" max="100" step="10"/.test(dist), 'ff-weight');
check('Advanced 页展示编译器默认命令（Default:）', /ffDefaultCommand/.test(dist) && /compileResource/.test(dist) && /compileObject/.test(dist));
check('取消时还原快照（CB EndModal 只在 OK 时应用）',
  /function restoreFileSnapshot\(\)/.test(dist) && /if \(files\[selectedFile\]\) files\[selectedFile\] = JSON\.parse\(fileSnapshot\)/.test(dist));
check('中文魔数警告行（#FF0000 两行）', /ff-note danger/.test(dist) && /#FF0000/.test(dist), 'danger');

// ---- 8. 保存路径（extension.ts）：compilerVar 补 CPP + chmod 只读 ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
check('compile 且 compilerVar 空 → 补 "CPP"', /f\.compilerVar = cv \|\| \(fe\.compile \? 'CPP' : ''\);/.test(ext), 'compilerVar');
check('只读切换调用 chmodSync（0o444 / 0o666）', /fs\.chmodSync\(f\.absolutePath, fe\.statistics\.readOnly \? 0o444 : 0o666\)/.test(ext), 'chmod');
check('customBuild 整体替换（保留其它编译器条目）', /f\.customBuildCommands = customBuild;/.test(ext), 'customBuild');

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n文件属性对话框: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
