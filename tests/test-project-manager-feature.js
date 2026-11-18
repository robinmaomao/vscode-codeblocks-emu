// Project manager QuickPick extraction: item builder + registration surface.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
      window: { createQuickPick: () => { throw new Error('not called in this test'); } },
      commands: { executeCommand: async () => undefined },
      QuickPickItemKind: { Separator: -1 },
      ThemeIcon: class { constructor(id) { this.id = id; } },
      env: {},
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const path = require('path');
const { buildManagerItems } = require('../dist/features/projectManager.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const ext = fs.readFileSync(path.join(process.cwd(), 'src', 'extension.ts'), 'utf8');
const feature = fs.readFileSync(path.join(process.cwd(), 'src', 'features', 'projectManager.ts'), 'utf8');
check('extension imports project manager feature', ext.includes("from './features/projectManager'"), ext.length, 'import');
check('extension no longer defines buildManagerItems', !/function buildManagerItems\s*\(/.test(ext), 'found old builder', 'none');
check('feature exports showProjectManager', feature.includes('export async function showProjectManager'), feature.length, 'show');
check('feature exports buildManagerItems', feature.includes('export function buildManagerItems'), feature.length, 'build');

const open = [
  { filename: 'C:/work/alpha.cbp', title: 'Alpha' },
  { filename: 'C:/work/beta.cbp', title: 'Beta' },
];
const items = buildManagerItems({
  getOpenProjects: () => open,
  getActiveProject: () => open[0],
  setActiveProject: () => undefined,
  removeProject: () => undefined,
  scanWorkspaceProjects: async () => undefined,
});
check('manager includes actions', items.slice(0, 3).map((i) => i.action).join(',') === 'open,new,scan', items.slice(0, 3), 'actions');
check('manager marks active project', items.some((i) => i.filename === open[0].filename && i.label.includes('circle-filled')), items, 'active');
check('manager lists both projects', items.filter((i) => i.filename).length === 2, items, 2);

console.log('project-manager-feature: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
