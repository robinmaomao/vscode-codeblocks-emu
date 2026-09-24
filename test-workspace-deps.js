// 验证 .workspace 的 <Depends> 依赖解析
const { WorkspaceParser } = require('./dist/model/parser');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_workspace_file>
	<Workspace title="demo">
		<Project filename="app/app.cbp" active="1">
			<Depends filename="lib/platform.cbp" />
			<Depends filename="lib/audio.cbp" />
		</Project>
		<Project filename="lib/platform.cbp" />
		<Project filename="lib/audio.cbp" />
	</Workspace>
</CodeBlocks_workspace_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-ws-deps.workspace');
fs.writeFileSync(tmp, ws, 'utf-8');

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

const parsed = new WorkspaceParser().parse(tmp);
check('projectPaths = 3', parsed.projectPaths.length === 3);
check('activeProject = app/app.cbp', parsed.activeProject === 'app/app.cbp');
check('dependencies[app/app.cbp] = 2 项', (parsed.dependencies['app/app.cbp'] ?? []).length === 2);
check('依赖含 lib/platform.cbp', (parsed.dependencies['app/app.cbp'] ?? []).includes('lib/platform.cbp'));
check('依赖含 lib/audio.cbp', (parsed.dependencies['app/app.cbp'] ?? []).includes('lib/audio.cbp'));
check('platform 无依赖', parsed.dependencies['lib/platform.cbp'] === undefined);

fs.unlinkSync(tmp);
process.exit(failed ? 1 : 0);
