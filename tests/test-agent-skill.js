// Agent Skill 打包/安装回归：模板 frontmatter、chatSkills 声明、工作区/用户目录写入与覆盖保护。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-agent-skill-'));

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const mock = installVscodeMock({});
const skill = require(path.join(ROOT, 'dist', 'features', 'agentSkill.js'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

try {
  const template = path.join(ROOT, 'skills', 'codeblocks-project', 'SKILL.md');
  check('K1 模板存在', fs.existsSync(template), template);
  const text = fs.readFileSync(template, 'utf-8');
  check('K2 frontmatter name 与目录一致', /^---[\s\S]*?\bname:\s*codeblocks-project\b/m.test(text));
  check('K3 description 非空且包含触发场景', /description:\s*.{20,}/.test(text) && /build/i.test(text) && /debug/i.test(text));

  const declared = (pkg.contributes.chatSkills || []).find((x) => x.path === './skills/codeblocks-project/SKILL.md');
  check('K4 package.json 声明 chatSkills 路径', !!declared, pkg.contributes.chatSkills);
  check('K5 chatSkills 路径文件存在', !!declared && fs.existsSync(path.join(ROOT, declared.path)), declared && declared.path);

  const workspace = path.join(TMP, 'ws');
  const ws = skill.installAgentSkill({ extensionPath: ROOT, target: 'workspace', workspaceRoot: workspace });
  check('K6 工作区安装写入 .github/skills', ws.written && fs.existsSync(path.join(workspace, '.github', 'skills', 'codeblocks-project', 'SKILL.md')), ws);
  check('K7 写入内容与模板一致', fs.readFileSync(ws.path, 'utf-8') === text);

  const noForce = skill.installAgentSkill({ extensionPath: ROOT, target: 'workspace', workspaceRoot: workspace });
  check('K8 已存在且 force=false 不覆盖', !noForce.written && noForce.existed, noForce);

  fs.writeFileSync(ws.path, 'changed', 'utf-8');
  const forced = skill.installAgentSkill({ extensionPath: ROOT, target: 'workspace', workspaceRoot: workspace, force: true });
  check('K9 force=true 覆盖并恢复模板', forced.written && fs.readFileSync(ws.path, 'utf-8') === text, forced);

  const home = path.join(TMP, 'home');
  const user = skill.installAgentSkill({ extensionPath: ROOT, target: 'user', homeDir: home });
  check('K10 用户目录安装到 ~/.copilot/skills', user.written && fs.existsSync(path.join(home, '.copilot', 'skills', 'codeblocks-project', 'SKILL.md')), user);

  const commandIds = (pkg.contributes.commands || []).map((x) => x.command);
  check('K11 声明 Agent Skill 安装命令', commandIds.includes('codeblocks.agent.installSkill'), commandIds.slice(-3));
  check('K12 声明 Agent 状态命令', commandIds.includes('codeblocks.agent.status'), commandIds.slice(-3));
  const cp = (pkg.contributes.chatParticipants || [])[0];
  check('K13 声明 @codeblocks participant',
    !!cp && cp.id === 'codeblocks.agent' && cp.name === 'codeblocks'
    && ['read', 'build', 'fix', 'debug', 'history', 'undo', 'status', 'help'].every((c) => (cp.commands || []).some((x) => x.name === c)),
    cp && { id: cp.id, name: cp.name, commands: (cp.commands || []).map((x) => x.name) });
  check('K14 participant 激活事件存在',
    (pkg.activationEvents || []).includes('onChatParticipant:codeblocks.agent'), pkg.activationEvents);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
  mock.restore();
}

console.log(`\nAgent Skill 安装回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
