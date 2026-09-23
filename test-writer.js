// 往返测试：parse → serialize，验证不破坏 .cbp
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.log('用法: node test-writer.js <cbp文件...>');
  process.exit(1);
}

let failed = false;
for (const f of files) {
  const abs = path.resolve(f);
  const original = fs.readFileSync(abs, 'utf-8');
  const parser = new ProjectParser();
  const project = parser.parse(abs);
  const serialized = serializeProject(project);

  console.log('='.repeat(60));
  console.log('文件:', abs);
  console.log('目标数:', project.buildTargets.length, ' 文件数:', project.files.length);

  // 再 parse 一次序列化结果，对比模型关键字段
  const tmp = path.join(require('os').tmpdir(), 'cb-test-' + path.basename(f));
  fs.writeFileSync(tmp, serialized, 'utf-8');
  const reparse = parser.parse(tmp);

  const summarize = (p) => ({
    title: p.title,
    compiler: p.compilerId,
    targets: p.buildTargets.map((t) => ({
      title: t.title, type: t.targetType, out: t.outputFilename, obj: t.objectOutput,
      copts: t.compilerOptions.length, iDirs: t.includeDirs.length,
      lopts: t.linkerOptions.length, libs: t.linkLibs.length,
      before: t.commandsBeforeBuild.length, after: t.commandsAfterBuild.length,
    })),
    files: p.files.map((x) => x.relativeFilename).sort(),
  });

  const a = summarize(project);
  const b = summarize(reparse);
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log('往返一致:', same ? 'OK' : 'FAIL');
  if (!same) {
    failed = true;
    console.log('原模型:', JSON.stringify(a, null, 2));
    console.log('再解析:', JSON.stringify(b, null, 2));
  }
  fs.unlinkSync(tmp);
}

process.exit(failed ? 1 : 0);
