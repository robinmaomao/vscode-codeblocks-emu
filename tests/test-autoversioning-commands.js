// AutoVersioning command wiring + pre/post-build hooks (with a minimal vscode host mock).
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
      window: {
        showWarningMessage: () => undefined,
        showInformationMessage: () => undefined,
        showQuickPick: () => undefined,
        showInputBox: () => undefined,
      },
      commands: { registerCommand: () => ({ dispose() {} }) },
      env: {},
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const av = require('../dist/tools/autoversioning.js');
const { prepareAutoVersioningBuild, completeAutoVersioningBuild, addVersionHeaderToProject, registerAutoVersioningCommands } = require('../dist/features/autoVersioningCommands.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const commandIds = pkg.contributes.commands.map((c) => c.command);
for (const id of ['codeblocks.autoVersioning', 'codeblocks.bumpVersion', 'codeblocks.generateVersionHeader']) {
  check(`${id} contributed`, commandIds.includes(id), commandIds.filter((c) => /Version/.test(c)), id);
}
const extJs = fs.readFileSync(path.join(process.cwd(), 'dist', 'extension.js'), 'utf8');
check('extension registers AutoVersioning commands', extJs.includes('registerAutoVersioningCommands'), extJs.length, 'register');
check('extension hooks header generation before build', extJs.includes('prepareAutoVersioningBuild'), extJs.length, 'prepare');
check('extension hooks build count after success', extJs.includes('completeAutoVersioningBuild'), extJs.length, 'complete');

const featureJs = fs.readFileSync(path.join(process.cwd(), 'dist', 'features', 'autoVersioningCommands.js'), 'utf8');
for (const id of ['codeblocks.autoVersioning', 'codeblocks.bumpVersion', 'codeblocks.generateVersionHeader']) {
  check(`${id} registered in feature`, featureJs.includes(id), featureJs.length, id);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-av-hook-'));
async function main() {
try {
  const config = av.defaultAutoVersioningConfig();
  config.settings.headerPath = 'version.h';
  const project = { basePath: dir, commonTopLevelPath: dir, extensions: {} };
  av.writeAutoVersioningConfig(project, config);
  const token = await prepareAutoVersioningBuild(project);
  const file = path.join(dir, 'version.h');
  check('pre-build generates version.h', fs.existsSync(file), fs.existsSync(file), true);
  const first = av.parseVersionHeader(fs.readFileSync(file, 'utf8'));
  check('pre-build version defaults', first.values.major === 1 && first.values.buildCount === 1, first.values, '1.0.0.0/1');
  const firstMtime = fs.statSync(file).mtimeMs;
  const token2 = await prepareAutoVersioningBuild(project);
  check('unchanged header is not rewritten', fs.statSync(file).mtimeMs === firstMtime, fs.statSync(file).mtimeMs, firstMtime);
  const completed = await completeAutoVersioningBuild(project, token2);
  check('post-build completes once', completed === true, completed, true);
  const second = av.parseVersionHeader(fs.readFileSync(file, 'utf8'));
  check('post-build increments build count', second.values.buildCount === 2, second.values.buildCount, 2);
  check('duplicate completion is ignored', (await completeAutoVersioningBuild(project, token2)) === false, 'duplicate', false);
  check('post-build keeps version values', second.values.major === 1 && second.values.revision === 0, second.values, '1.0.0.0');

  const manifest = path.join(dir, 'manifest.xml');
  fs.writeFileSync(manifest, '<Plugin><Value version="0.0.0" /></Plugin>', 'utf8');
  const manifestConfig = av.readAutoVersioningConfig(project);
  manifestConfig.settings.updateManifest = true;
  av.writeAutoVersioningConfig(project, manifestConfig);
  await completeAutoVersioningBuild(project);
  check('build completion updates manifest', fs.readFileSync(manifest, 'utf8').includes('version="1.0.0"'), fs.readFileSync(manifest, 'utf8'), 'version="1.0.0"');

  check('version.h can be added to project', (() => {
    const added = addVersionHeaderToProject(project, manifestConfig);
    return added && project.files.some((f) => f.relativeFilename === 'version.h');
  })(), project.files.map((f) => f.relativeFilename), 'version.h');

  // The registration API should be callable with the minimal host mock.
  const registered = [];
  registerAutoVersioningCommands({ subscriptions: [] }, {
    getProject: () => project,
    saveProject: () => undefined,
    output: (line) => registered.push(line),
  });
  check('register returns without throwing', true, registered.length, 0);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
}

main().then(() => {
  console.log('autoversioning-commands: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
