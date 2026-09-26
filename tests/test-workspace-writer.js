// .workspace 依赖写回（Wave 3 C1）回归
const { setProjectDependencies, wouldCreateCycle } = require('../dist/model/workspaceWriter');
const { WorkspaceParser } = require('../dist/model/parser');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const FX = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_workspace_file>
\t<Workspace title="w">
\t\t<Project filename="app/app.cbp" active="1">
\t\t\t<Depends filename="lib/lib.cbp" />
\t\t</Project>
\t\t<Project filename="lib/lib.cbp" />
\t\t<Project filename="extra/extra.cbp">
\t\t\t<Option title="kept" />
\t\t</Project>
\t</Workspace>
</CodeBlocks_workspace_file>
`;

// 1. 替换已有依赖 + 追加新依赖
const out1 = setProjectDependencies(FX, 'app/app.cbp', ['lib/lib.cbp', 'extra/extra.cbp']);
const expect1 = `\t\t<Project filename="app/app.cbp" active="1">\n\t\t\t<Depends filename="lib/lib.cbp" />\n\t\t\t<Depends filename="extra/extra.cbp" />\n\t\t</Project>`;
check('替换 + 追加依赖', out1.includes(expect1), out1.split('\n').slice(0, 8).join('|'));
check('其它工程未受影响', out1.includes('\t\t<Project filename="lib/lib.cbp" />') && out1.includes('\t\t<Project filename="extra/extra.cbp">'), null);

// 2. 自闭合工程展开
const out2 = setProjectDependencies(FX, 'lib/lib.cbp', ['app/app.cbp']);
check('自闭合展开为带 Depends', out2.includes('\t\t<Project filename="lib/lib.cbp">\n\t\t\t<Depends filename="app/app.cbp" />\n\t\t</Project>'), null);

// 3. 清空依赖
const out3 = setProjectDependencies(FX, 'app/app.cbp', []);
check('清空依赖', out3.includes('\t\t<Project filename="app/app.cbp" active="1">\n\t\t</Project>'), null);
check('清空无残留 Depends', !out3.includes('<Depends'), null);

// 4. 保留非 Depends 子节点
const out4 = setProjectDependencies(FX, 'extra/extra.cbp', ['lib/lib.cbp']);
check('保留其它子节点', out4.includes('<Option title="kept" />') && out4.includes('<Depends filename="lib/lib.cbp" />'), null);

// 5. 未找到工程 → null；无依赖且本来就空 → 原样
check('未找到工程返回 null', setProjectDependencies(FX, 'nope/x.cbp', ['a.cbp']) === null, setProjectDependencies(FX, 'nope/x.cbp', ['a.cbp']));
check('无依赖且本来就空不变', setProjectDependencies(FX, 'extra/extra.cbp', []).includes('<Option title="kept" />'), null);

// 6. 大小写/反斜杠宽容匹配
check('反斜杠匹配', setProjectDependencies(FX, 'APP\\APP.CBP', ['lib/lib.cbp']) !== null, null);

// 7. 往返：写临时文件 → WorkspaceParser 重新解析
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ws-'));
const wsFile = path.join(dir, 'w.workspace');
fs.writeFileSync(wsFile, out1, 'utf-8');
const ws = new WorkspaceParser().parse(wsFile);
check('往返依赖解析', JSON.stringify(ws.dependencies['app/app.cbp']) === JSON.stringify(['lib/lib.cbp', 'extra/extra.cbp']), ws.dependencies);

// 8. 真实工程文件（test-project/dep-test.workspace）不动盘修改
const realPath = path.resolve(__dirname, '../test-project/dep-test.workspace');
const real = fs.readFileSync(realPath, 'utf-8');
const realOut = setProjectDependencies(real, 'dep-app/dep-app.cbp', ['dep-lib/dep-lib.cbp']);
check('真实文件改依赖', realOut.includes('<Depends filename="dep-lib/dep-lib.cbp" />') && realOut.includes('<Project filename="dep-lib/dep-lib.cbp" />'), null);
const realOut2 = setProjectDependencies(real, 'dep-lib/dep-lib.cbp', ['dep-app/dep-app.cbp']);
check('真实文件给自闭合工程加依赖', realOut2.includes('\t\t<Project filename="dep-lib/dep-lib.cbp">\n\t\t\t<Depends filename="dep-app/dep-app.cbp" />\n\t\t</Project>'), null);

// 9. 环路检测
const deps = { 'a': ['b'], 'b': ['c'] };
check('有向可达 → 成环', wouldCreateCycle(deps, 'b', 'a') === true, null);
check('多级可达 → 成环', wouldCreateCycle(deps, 'c', 'a') === true, null);
check('不可达 → 不成环', wouldCreateCycle(deps, 'a', 'c') === false, null);
check('自依赖 → 成环', wouldCreateCycle(deps, 'a', 'a') === true, null);
check('未知名 → 不成环', wouldCreateCycle(deps, 'a', 'zz') === false, null);
check('大小写/斜杠归一', wouldCreateCycle({ 'A\\a.cbp': ['B/b.cbp'] }, 'b/b.cbp', 'a/a.cbp') === true, null);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`工作区依赖写回: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
