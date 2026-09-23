// 验证 buildHtml 生成的 WebView HTML 中 <script> 语法是否合法
const fs = require('fs');
const path = require('path');

// 1. 从 dist 提取 buildHtml 的模板字符串字面量
const distPath = path.resolve('dist/ui/projectPropertiesPanel.js');
const dist = fs.readFileSync(distPath, 'utf-8');
const startMarker = 'return `';
const s = dist.indexOf(startMarker);
if (s < 0) { console.error('未找到 return `'); process.exit(1); }
const tplStart = s + startMarker.length;
const endMarker = '`;';
const e = dist.indexOf(endMarker, tplStart);
if (e < 0) { console.error('未找到模板结尾'); process.exit(1); }
const htmlTemplate = dist.slice(tplStart, e);

// 2. 生成插值数据（用 parser 解析 hello-cb）
const { ProjectParser } = require('./dist/model/parser');
const project = new ProjectParser().parse('test-project/hello-cb.cbp');
const cmp = project.compilerId;
const targets = project.buildTargets.map(t => ({ originalTitle: t.title, title: t.title, targetType: t.targetType, outputFilename: t.outputFilename, objectOutput: t.objectOutput, compilerId: t.compilerId }));
const files = project.files.map(f => ({ relativeFilename: f.relativeFilename, compilerVar: f.compilerVar === 'CPP' ? '' : f.compilerVar, compile: f.compile !== false, link: f.link !== false, buildTargets: [...f.buildTargets], buildCommand: (f.customBuildCommands[cmp] ?? '').replace(/\r?\n/g, '\\n') }));
const projectOpts = { compilerOptions: [...project.compilerOptions], linkerOptions: [...project.linkerOptions], linkLibs: [...project.linkLibs] };
const targetOpts = project.buildTargets.map(t => ({ compilerOptions: [...t.compilerOptions], linkerOptions: [...t.linkerOptions], linkLibs: [...t.linkLibs] }));
const projectDirs = { includeDirs: [...project.includeDirs], libDirs: [...project.libDirs], resourceDirs: [...project.resourceIncludeDirs] };
const targetDirs = project.buildTargets.map(t => ({ includeDirs: [...t.includeDirs], libDirs: [...t.libDirs], resourceDirs: [...t.resourceIncludeDirs] }));
const projectSettings = { title: project.title, compilerId: project.compilerId, virtualFolders: [...project.virtualFolders] };
const typeOptions = Object.entries({ 0:'可执行文件 (Executable)',1:'控制台程序 (Console application)',2:'静态库 (Static library)',3:'动态库 (Dynamic library)',4:'仅命令 (Commands only)',5:'本机 (Native)' })
  .map(([v,name]) => `<option value="${v}">${name}</option>`).join('');
const data = JSON.stringify({ title: project.title, compilerId: cmp, targets, files, projectOpts, targetOpts, projectDirs, targetDirs, projectSettings }).replace(/</g, '\\u003c');

// 3. 插值
let html = htmlTemplate.replace('${data}', data).replace('${typeOptions}', typeOptions);

// 4. 提取 script 内容
const sm = html.match(/<script>([\s\S]*?)<\/script>/);
if (!sm) { console.error('未找到 <script>'); process.exit(1); }
const script = sm[1];

// 5. 语法检查（new Function 只编译不执行，document/vscode 未定义不影响语法检查）
try {
  new Function(script);
  console.log('script 语法 OK');
} catch (e) {
  console.error('script 语法错误:', e.message);
  // 打印出错附近内容
  const lines = script.split('\n');
  console.error('脚本前 30 行:');
  lines.slice(0, 30).forEach((l, i) => console.error(String(i + 1).padStart(3), JSON.stringify(l)));
  process.exit(1);
}
