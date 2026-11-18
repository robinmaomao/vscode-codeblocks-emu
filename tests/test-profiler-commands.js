// Profiler command extraction: registration lives in features/profilerCommands.ts.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const root = process.cwd();
const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const feature = fs.readFileSync(path.join(root, 'src', 'features', 'profilerCommands.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check('profileTarget command contributed', pkg.contributes.commands.some((c) => c.command === 'codeblocks.profileTarget'), pkg.contributes.commands.length, 'profileTarget');
check('extension wires profiler feature', ext.includes('registerProfilerCommands'), ext.length, 'register');
check('extension no longer defines profileTarget', !/async function profileTarget\s*\(/.test(ext), 'found old function', 'none');
check('feature registers profileTarget', feature.includes("registerCommand('codeblocks.profileTarget'"), feature.length, 'command');
check('feature exports profileTarget', feature.includes('export async function profileTarget'), feature.length, 'export');

console.log('profiler-commands: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
