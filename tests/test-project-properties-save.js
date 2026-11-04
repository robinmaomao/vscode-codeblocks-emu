// 工程属性面板「保存」端到端回归（缺陷：doSave() 收集未渲染 tab 的表单抛 TypeError ⇒ 保存静默失效）：
//  - 面板打开后按 webview 的 postMessage 形状回放一次「未改动任何 tab 的保存」：写回内容必须与打开时等价
//  - 改名（构建目标页唯一改动）后保存：只有标题变化，其余字段（自定义编译选项 / 虚拟目标 / 备注等）不得丢失
//  - close=true 时保存后面板关闭
//
// 说明：数据取自面板 HTML 内嵌的 `const data = {...}`（即面板渲染时的完整模型），
// 因此回放的 payload 与「用户什么都没改就点保存」一致。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(label, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + label); }
  else { fail++; console.log(`FAIL ${label}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

function writeCbp(file) {
  fs.writeFileSync(file, [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
    '<CodeBlocks_project_file>',
    '\t<FileVersion major="1" minor="6" />',
    '\t<Project>',
    '\t\t<Option title="app" />',
    '\t\t<Option compiler="gcc" />',
    '\t\t<Option show_notes="1">',
    '\t\t\t<notes><![CDATA[panel save probe]]></notes>',
    '\t\t</Option>',
    '\t\t<Build>',
    '\t\t\t<Target title="Debug">',
    '\t\t\t\t<Option type="1" />',
    '\t\t\t\t<Option compiler="gcc" />',
    '\t\t\t\t<Option output="bin/Debug/app" />',
    '\t\t\t\t<Compiler>',
    '\t\t\t\t\t<Add option="-g" />',
    '\t\t\t\t</Compiler>',
    '\t\t\t</Target>',
    '\t\t</Build>',
    '\t\t<Compiler>',
    '\t\t\t<Add option="-pipe" />',
    '\t\t</Compiler>',
    '\t\t<VirtualTargets>',
    '\t\t\t<Add alias="Everything" targets="Debug" />',
    '\t\t</VirtualTargets>',
    '\t\t<Unit filename="main.c" />',
    '\t</Project>',
    '</CodeBlocks_project_file>',
    '',
  ].join('\n'), 'utf-8');
}

/** 取面板 HTML 内嵌的模型数据（`const data = {...};`）——按花括号配平扫描（字符串感知），避免备注里出现 `};` 时误截断 */
function panelData(html) {
  const marker = 'const data = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('未找到面板内嵌数据');
  const from = start + marker.length;
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(from, i + 1));
    }
  }
  throw new Error('面板内嵌数据不完整');
}

/** 按 webview 的 postMessage 形状组装保存消息（等价于"未编辑任何字段就点保存"） */
function savePayload(data, opts = {}) {
  return {
    type: 'save',
    targets: data.targets,
    files: data.files,
    options: { project: data.projectOpts, targets: data.targetOpts },
    searchDirs: { project: data.projectDirs, targets: data.targetDirs },
    buildScripts: { project: data.projectScripts, targets: data.targetScripts },
    projectSettings: data.projectSettings,
    notes: data.notes,
    virtualTargets: data.virtualTargets,
    debuggerSettings: data.debugger,
    close: opts.close === true,
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ppsave-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  fs.mkdirSync(path.dirname(cbp), { recursive: true });
  writeCbp(cbp);

  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(100);
  await app.invoke('codeblocks.projectProperties');
  const panel = app.mock.webviews[app.mock.webviews.length - 1];
  check('S1 工程属性面板已打开', !!panel && panel.kind === 'codeblocks.projectProperties', panel && panel.kind);
  const data = panelData(panel.webview.html);

  // ---- A. 未编辑直接保存：内容等价 ----
  panel.webview.__emit(savePayload(data));
  await sleep(200);
  const written = fs.readFileSync(cbp, 'utf-8');
  check('A1 未编辑保存成功（回发 saved 且无 error）',
    panel.webview.posted.some((m) => m.type === 'saved') && !panel.webview.posted.some((m) => m.type === 'error'),
    panel.webview.posted.map((m) => m.type), ['saved']);
  check('A2 项目级自定义编译选项未丢失', /<Add option="-pipe" \/>/.test(written), written.includes('-pipe'));
  check('A3 目标编译选项未丢失', /<Add option="-g" \/>/.test(written), written.includes('-g'));
  check('A4 虚拟目标未丢失', /alias="Everything"/.test(written), /alias="[^"]*"/.exec(written)?.[0]);
  check('A5 备注未丢失', written.includes('panel save probe'), null);

  // ---- B. 只改名：其它字段不变 ----
  const data2 = panelData(panel.webview.html);
  const renamed = data2.targets.map((t, i) => (i === 0 ? { ...t, title: 'DebugRenamed' } : t));
  panel.webview.__emit(savePayload({ ...data2, targets: renamed }));
  await sleep(200);
  const written2 = fs.readFileSync(cbp, 'utf-8');
  check('B1 目标改名已写回', /<Target title="DebugRenamed">/.test(written2), /<Target title="[^"]*">/.exec(written2)?.[0]);
  check('B2 改名不影响其它目标字段', /output="bin\/Debug\/app"/.test(written2), /output="[^"]*"/.exec(written2)?.[0]);
  check('B3 改名不影响项目级选项', written2.includes('-pipe'), null);

  // ---- C. 保存并关闭 ----
  const data3 = panelData(panel.webview.html);
  panel.webview.__emit(savePayload(data3, { close: true }));
  await sleep(200);
  check('C1 save+close 后面板已关闭', panel.__disposed === true, panel.__disposed);

  await app.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nproject-properties-save: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('运行异常: ' + (e && e.stack ? e.stack : e));
  console.log(`\nproject-properties-save: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
