// P1-1/P2-3?Workspace ???? / DistClean / ???????????
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const ids = new Set(pkg.contributes.commands.map((c) => c.command));
for (const id of ['codeblocks.saveWorkspaceAs', 'codeblocks.openDefaultWorkspace', 'codeblocks.distClean', 'codeblocks.clearBacktickCache']) {
  check('???????' + id, ids.has(id), id, true);
}
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8')
  + '\n' + fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'toolCommands.ts'), 'utf8');
for (const id of ['codeblocks.saveWorkspace', 'codeblocks.saveWorkspaceAs', 'codeblocks.closeWorkspace', 'codeblocks.openDefaultWorkspace', 'codeblocks.distClean', 'codeblocks.backtickCache', 'codeblocks.clearBacktickCache']) {
  check('?? registerCommand?' + id, src.includes("registerCommand('" + id + "'"), id, 'registered');
}
const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'menuStructure.ts'), 'utf8');
check('File menu references saveWorkspaceAs', menu.includes('codeblocks.saveWorkspaceAs'), true, true);
check('Build ??? Dist Clean', menu.includes("label: 'Dist Clean'"), menu.includes("label: 'Dist Clean'"), true);
check('Settings menu references backtickCache', menu.includes('codeblocks.backtickCache'), true, true);

console.log('workspace-lifecycle-commands: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
