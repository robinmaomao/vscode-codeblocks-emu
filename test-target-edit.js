// 验证目标增删改 + 文件归属同步后的序列化结果
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
const { TargetType, OptionsRelation, OptionsRelationType, LinkerExecutableOption } = require('./dist/model/types');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve('test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

function createEmptyTarget() {
  return {
    title: '',
    targetType: TargetType.ConsoleOnly,
    compilerId: 'gcc',
    outputFilename: '',
    objectOutput: '',
    optionRelations: {
      [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
    },
    compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    files: [],
    linkerExecutable: LinkerExecutableOption.AutoDetect,
    createDefFile: false, createStaticLib: false,
    useConsoleRunner: true, includeInTargetAll: true,
    commandsBeforeBuild: [], commandsAfterBuild: [],
    commandsBeforeClean: [], commandsAfterClean: [],
    buildScripts: [], envVars: [], alwaysRunPostBuildSteps: false,
  };
}

// 模拟编辑：Debug 重命名 Debug2，删除 Release，新增 Release2
const edits = [
  { originalTitle: 'Debug', title: 'Debug2', targetType: 1, outputFilename: 'bin/Debug/hello', objectOutput: 'obj/Debug/', compilerId: 'gcc' },
  { originalTitle: '', title: 'Release2', targetType: 1, outputFilename: 'bin/Release2/hello', objectOutput: 'obj/Release2/', compilerId: 'gcc' },
];

const oldByOriginal = new Map(project.buildTargets.map((t) => [t.title, t]));
const renameMap = new Map();
const newTargets = [];
const newTitles = new Set();

for (const e of edits) {
  let t;
  if (e.originalTitle && oldByOriginal.has(e.originalTitle)) {
    t = oldByOriginal.get(e.originalTitle);
    if (t.title !== e.title) { renameMap.set(t.title, e.title); t.title = e.title; }
  } else {
    t = createEmptyTarget();
    t.title = e.title;
  }
  t.targetType = e.targetType;
  t.outputFilename = e.outputFilename;
  t.objectOutput = e.objectOutput || '';
  t.compilerId = e.compilerId;
  newTargets.push(t);
  newTitles.add(e.title);
}

for (const f of project.files) {
  if (!f.explicitTargets) {
    f.buildTargets = [...newTitles];
    continue;
  }
  const mapped = new Set();
  for (const bt of f.buildTargets) {
    const m = renameMap.get(bt) ?? bt;
    if (newTitles.has(m)) mapped.add(m);
  }
  f.buildTargets = [...mapped];
}
project.buildTargets = newTargets;

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

// 再解析验证
const tmp = path.join(require('os').tmpdir(), 'cb-target-edit-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
console.log('目标:', reparse.buildTargets.map((t) => `${t.title}(type=${t.targetType}, obj=${t.objectOutput})`));
console.log('文件归属:');
for (const f of reparse.files) console.log('  ', f.relativeFilename, '->', f.buildTargets);
fs.unlinkSync(tmp);
