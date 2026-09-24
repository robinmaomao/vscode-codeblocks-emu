// 验证 C3-C 解析缓存：同文件 mtime/size 未变时复用 XML 解析结果，变化后失效重解析
const { ProjectParser, WorkspaceParser } = require('./dist/model/parser');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpCbp = path.join(os.tmpdir(), 'cb-parse-cache.cbp');
const tmpWs = path.join(os.tmpdir(), 'cb-parse-cache.workspace');

function makeCbp(title) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="${title}" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/${title}" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;
}

function makeWs() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_workspace_file>
	<Workspace title="demo ws">
		<Project filename="app/app.cbp" />
		<Project filename="lib/platform.cbp">
			<Depends filename="app/app.cbp" />
		</Project>
	</Workspace>
</CodeBlocks_workspace_file>
`;
}

let fail = 0;
function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { console.error('FAIL ' + name); fail++; }
}

// ---- ProjectParser ----
fs.writeFileSync(tmpCbp, makeCbp('demo'), 'utf-8');
const p1 = new ProjectParser().parse(tmpCbp);
const p2 = new ProjectParser().parse(tmpCbp);
check('项目缓存命中：XML 结果对象复用（rawProject 同一引用）', p1.rawProject === p2.rawProject);
check('项目缓存命中：title 一致', p1.title === 'demo' && p2.title === 'demo');

// 修改内容（title 长度变化 → size 变化，触发失效）
fs.writeFileSync(tmpCbp, makeCbp('demo2'), 'utf-8');
const p3 = new ProjectParser().parse(tmpCbp);
check('项目缓存失效：title 更新为 demo2', p3.title === 'demo2');
check('项目缓存失效：XML 结果对象非旧引用', p3.rawProject !== p1.rawProject);

// ---- WorkspaceParser ----
fs.writeFileSync(tmpWs, makeWs(), 'utf-8');
const w1 = new WorkspaceParser().parse(tmpWs);
const w2 = new WorkspaceParser().parse(tmpWs);
check('工作区缓存命中：解析结果一致（项目数）', w1.projectPaths.length === 2 && w2.projectPaths.length === 2);
check('工作区缓存命中：依赖一致', w1.dependencies['lib/platform.cbp']?.length === 1);

fs.unlinkSync(tmpCbp);
fs.unlinkSync(tmpWs);

if (fail === 0) {
  console.log('全部通过');
  process.exit(0);
} else {
  process.exit(1);
}
