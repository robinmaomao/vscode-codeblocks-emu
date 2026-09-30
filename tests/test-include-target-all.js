// L4 回归：includeInTargetAll 属性名（camelCase）/默认 false/"All" 虚拟目标合成
// 对齐 projectloader.cpp:551/619-620/682/210-221
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(a, b) { this.start = a; this.end = b; } },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
      debug: { activeDebugSession: undefined },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

function parseFixture(xml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l4t-'));
  const cbpPath = path.join(dir, 'l4.cbp');
  fs.writeFileSync(cbpPath, xml, 'utf-8');
  const project = new ProjectParser().parse(cbpPath);
  fs.rmSync(dir, { recursive: true, force: true });
  return project;
}

// 1. camelCase 属性 + 默认 false + All 合成
{
  const p = parseFixture(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l4" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="LegacyOn"><Option includeInTargetAll="1" /></Target>
\t\t\t<Target title="LegacyOff"><Option includeInTargetAll="0" /></Target>
\t\t\t<Target title="NoAttr"><Option output="bin/x" /></Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`);
  const byTitle = Object.fromEntries(p.buildTargets.map((t) => [t.title, t.includeInTargetAll]));
  check('camelCase: LegacyOn=true', byTitle.LegacyOn === true, byTitle);
  check('camelCase: LegacyOff=false', byTitle.LegacyOff === false, byTitle);
  check('camelCase: NoAttr=false（默认 false）', byTitle.NoAttr === false, byTitle);
  const all = p.virtualTargets.find((v) => v.title === 'All');
  check('合成 All=[LegacyOn]', !!all && all.targets.length === 1 && all.targets[0] === 'LegacyOn', p.virtualTargets);
}

// 2. 下划线旧写法兼容
{
  const p = parseFixture(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l4" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Underscore"><Option include_in_target_all="1" /></Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`);
  check('下划线兼容: include_in_target_all="1" → true', p.buildTargets[0].includeInTargetAll === true, p.buildTargets[0].includeInTargetAll);
}

// 3. 无 legacy true 目标：不合成 All
{
  const p = parseFixture(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l4" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="T1"><Option output="bin/x" /></Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`);
  check('无 true 目标：不合成 All', p.virtualTargets.length === 0, p.virtualTargets);
}

// 4. 文件已有 All 虚拟目标：不重复合成
{
  const p = parseFixture(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l4" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="LegacyOn"><Option includeInTargetAll="1" /></Target>
\t\t</Build>
\t\t<VirtualTargets><Add alias="All" targets="Debug" /></VirtualTargets>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`);
  const alls = p.virtualTargets.filter((v) => v.title === 'All');
  check('已有 All：不重复合成且保留原定义', alls.length === 1 && alls[0].targets.join(';') === 'Debug', p.virtualTargets);
}

// 5. 序列化往返：All 虚拟目标保留（对齐 CB m_Upgraded 写回）
{
  const p = parseFixture(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l4" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="LegacyOn"><Option includeInTargetAll="1" /></Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`);
  const xml = serializeProject(p);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l4rt-'));
  const rtPath = path.join(dir2, 'rt.cbp');
  fs.writeFileSync(rtPath, xml, 'utf-8');
  const rt = new ProjectParser().parse(rtPath);
  fs.rmSync(dir2, { recursive: true, force: true });
  const all = rt.virtualTargets.find((v) => v.title === 'All');
  check('往返：All 保留 [LegacyOn]', !!all && all.targets.join(';') === 'LegacyOn', rt.virtualTargets);
}

console.log(`include-target-all: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
