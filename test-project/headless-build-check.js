// 无头构建校验脚本（不打包进 VSIX，test-project/** 已在 .vscodeignore）
// 用法: node test-project/headless-build-check.js [cbp路径...]
// 在无 VS Code 宿主环境下用 dist 产物驱动 BuildEngine 真实编译/链接，验证 D1-D12 对齐改动。
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    const cfgStore = {
      'build.verboseOutput': false,
      'build.skipIncludeDeps': false,
    };
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => (key in cfgStore ? cfgStore[key] : def),
        }),
      },
      window: { showWarningMessage: () => {}, showInformationMessage: () => {} },
      LogOutputChannel: function () {},
      DiagnosticSeverity: { Error: 0, Warning: 1 },
      Diagnostic: function () {},
      Uri: { file: (p) => ({ fsPath: p }) },
    };
  }
  return origLoad(request, parent, isMain);
};

const path = require('path');
const fs = require('fs');
const { ProjectParser } = require('../dist/model/parser.js');
const { applyGeneratedFiles } = require('../dist/build/generatedFiles.js');
const { CompilerOptionsLoader } = require('../dist/compiler/optionsLoader.js');
const { CodeBlocksConfig } = require('../dist/compiler/codeblocksConfig.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');

const loader = new CompilerOptionsLoader(path.join(__dirname, '..', 'resources', 'compilers'));
const cbCfg = new CodeBlocksConfig();
cbCfg.load();
const getCompiler = (id) => {
  const c = loader.load(id);
  const up = cbCfg.resolvePrograms(id);
  if (up) {
    c.programs = { ...c.programs, C: up.C, CPP: up.CPP, LD: up.LD, LIB: up.LIB };
    c.masterPath = up.masterPath;
  }
  const sd = cbCfg.searchDirs(id);
  if (sd) {
    c.includeDirs = sd.includeDirs;
    c.libDirs = sd.libDirs;
    c.resIncludeDirs = sd.resIncludeDirs;
    c.linkLibs = sd.linkLibs;
  }
  return c;
};

const out = {
  info: (l) => console.log('[i] ' + l),
  warn: (l) => console.log('[w] ' + l),
  error: (l) => console.log('[e] ' + l),
  debug: (l) => console.log('[d] ' + l),
};

async function buildOne(cbp) {
  console.log('==== BUILD ' + cbp + ' ====');
  const project = new ProjectParser().parse(cbp);
  applyGeneratedFiles(project, getCompiler);
  const compiler = getCompiler(project.buildTargets[0]?.compilerId || project.compilerId);
  const engine = new BuildEngine(project, compiler, out);
  const ok = await engine.build(undefined, {
    onLine: (l, sev) => console.log('[' + (sev || 'i') + '] ' + l),
  });
  console.log('==== ' + (ok ? 'SUCCESS' : 'FAILED') + ' ====');
  return ok;
}

// 单文件编译 / 单文件 Clean 校验（对齐 CompileFile / GetCleanSingleFileCommand）
async function singleFileCheck(cbp) {
  console.log('==== SINGLE FILE ' + cbp + ' ====');
  const project = new ProjectParser().parse(cbp);
  applyGeneratedFiles(project, getCompiler);
  const compiler = getCompiler(project.buildTargets[0]?.compilerId || project.compilerId);
  const engine = new BuildEngine(project, compiler, out);
  const targetTitle = project.buildTargets[0].title;
  // hello-cb.cbp：object_output=obj/Debug/，main.c 对象 = obj/Debug/main.o
  const objAbs = path.join(project.basePath, 'obj', 'Debug', 'main.o');

  // 1. Clean（残留对象应先被删）
  engine.cleanFile(targetTitle, 'main.c');
  if (fs.existsSync(objAbs)) {
    console.log('[e] cleanFile 未删除对象: ' + objAbs);
    return false;
  }
  // 2. Compile
  const ok = await engine.compileFile(targetTitle, 'main.c', {
    onLine: (l, sev) => console.log('[' + (sev || 'i') + '] ' + l),
  });
  if (!ok) {
    console.log('[e] compileFile 失败');
    return false;
  }
  if (!fs.existsSync(objAbs)) {
    console.log('[e] 对象未产出: ' + objAbs);
    return false;
  }
  // 3. Clean again
  engine.cleanFile(targetTitle, 'main.c');
  if (fs.existsSync(objAbs)) {
    console.log('[e] cleanFile 未删除编译后的对象: ' + objAbs);
    return false;
  }
  console.log('==== SINGLE FILE OK ====');
  return true;
}

(async () => {
  const args = process.argv.slice(2);
  const list = args.length
    ? args.map((a) => path.resolve(a))
    : [
        path.join(__dirname, 'dep-lib', 'dep-lib.cbp'),
        path.join(__dirname, 'dep-app', 'dep-app.cbp'),
      ];
  let allOk = true;
  for (const c of list) {
    if (!(await buildOne(c))) allOk = false;
  }
  // 单文件编译 / Clean（hello-cb，固定存在）
  const singleCbp = path.join(__dirname, 'hello-cb.cbp');
  if (fs.existsSync(singleCbp) && !(await singleFileCheck(singleCbp))) allOk = false;
  process.exit(allOk ? 0 : 1);
})();
