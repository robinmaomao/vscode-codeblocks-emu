// 验证编译/链接选项编辑后的序列化结果（模拟 saveProjectProperties 的 options 处理）
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 模拟 options 应用（targets 顺序 == project.buildTargets 顺序）
const options = {
  project: { compilerOptions: ['-std=c11'], linkerOptions: ['-s'], linkLibs: ['m'] },
  targets: [
    { compilerOptions: ['-g', '-Wall'], linkerOptions: ['-T', 'link.ld'], linkLibs: ['pthread'] },
    { compilerOptions: ['-O2'], linkerOptions: [], linkLibs: [] },
  ],
};

project.compilerOptions = options.project.compilerOptions;
project.linkerOptions = options.project.linkerOptions;
project.linkLibs = options.project.linkLibs;
for (let i = 0; i < project.buildTargets.length && i < options.targets.length; i++) {
  project.buildTargets[i].compilerOptions = options.targets[i].compilerOptions;
  project.buildTargets[i].linkerOptions = options.targets[i].linkerOptions;
  project.buildTargets[i].linkLibs = options.targets[i].linkLibs;
}

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

// 再解析验证
const tmp = path.join(require('os').tmpdir(), 'cb-options-edit-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
console.log('项目级:', JSON.stringify({ c: reparse.compilerOptions, l: reparse.linkerOptions, libs: reparse.linkLibs }));
for (const t of reparse.buildTargets) {
  console.log(`${t.title}:`, JSON.stringify({ c: t.compilerOptions, l: t.linkerOptions, libs: t.linkLibs }));
}
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
check('项目级选项', JSON.stringify(reparse.compilerOptions) === JSON.stringify(['-std=c11']) && JSON.stringify(reparse.linkerOptions) === JSON.stringify(['-s']) && JSON.stringify(reparse.linkLibs) === JSON.stringify(['m']), { c: reparse.compilerOptions, l: reparse.linkerOptions, libs: reparse.linkLibs });
check('目标级选项', JSON.stringify(reparse.buildTargets[0].compilerOptions) === JSON.stringify(['-g', '-Wall']) && JSON.stringify(reparse.buildTargets[0].linkerOptions) === JSON.stringify(['-T', 'link.ld']) && JSON.stringify(reparse.buildTargets[1].compilerOptions) === JSON.stringify(['-O2']), reparse.buildTargets.map((t) => ({ c: t.compilerOptions, l: t.linkerOptions, libs: t.linkLibs })));
console.log(`编译/链接选项编辑: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
