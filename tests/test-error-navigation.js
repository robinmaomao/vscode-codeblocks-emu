// 编译错误跳转回归（修复「构建失败但不跳到对应源码」）：
//  根因：`executeCommand('vscode.open', uri, { selection: new vscode.Range(...) })` —— 命令参数跨进程走 JSON
//        序列化，`Range.toJSON()` 返回 `[start, end]`（Position → `{line, character}`），主进程拿到的
//        `options.selection` 不是 IRange ⇒ 只打开文件、不定位（文件本来就打开时表现为"根本没跳"）。
//  修复：`vscode.open` 全部替换为纯标量参数的命令 `codeblocks.openLocation`
//        （openTextDocument → showTextDocument({ selection }) → revealRange）。
//  附带：链接期伪文件（ld.exe / collect2.exe）与已不存在的文件没有可用位置 ⇒ 跳过并继续找下一条。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const root = path.resolve(__dirname, '..');
const dist = (rel) => path.join(root, 'dist', rel);
const readDist = (rel) => (fs.existsSync(dist(rel)) ? fs.readFileSync(dist(rel), 'utf8') : '');

async function main() {
  const mock = installVscodeMock();
  const vscode = mock.vscode;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-jump-'));
  const shown = [];
  try {
    // 真实语义的文档桩：文件不存在 → 打开失败（真实 VS Code 同样 reject）
    vscode.workspace.openTextDocument = (p) => {
      const fp = typeof p === 'string' ? p : (p && p.fsPath) || String(p);
      if (!fs.existsSync(fp)) return Promise.reject(new Error('file not found'));
      const lines = fs.readFileSync(fp, 'utf-8').split(/\r?\n/);
      return Promise.resolve({
        uri: vscode.Uri.file(fp),
        fileName: fp,
        lineCount: lines.length,
        getText: () => lines.join('\n'),
        lineAt: (i) => ({ text: lines[i] ?? '', range: { start: { line: i, character: 0 }, end: { line: i, character: (lines[i] ?? '').length } } }),
      });
    };
    vscode.window.showTextDocument = (doc, opts) => {
      shown.push({ file: doc && doc.fileName, selection: opts && opts.selection });
      return Promise.resolve({ document: doc, selection: opts && opts.selection, revealRange: () => {} });
    };

    // ---------- A. 静态接线：不再使用会丢失定位的 vscode.open + { selection: Range } ----------
    const buildLogDist = readDist('ui/buildLogTreeProvider.js');
    const symbolDist = readDist('ui/symbolTreeProvider.js');
    const openLocationDist = readDist('ui/openLocation.js');
    const extDist = readDist('extension.js');
    check('A1 存在统一的跳转模块 ui/openLocation', openLocationDist.includes('openFileAtLocation'), null);
    check('A2 跳转实现用 showTextDocument({ selection }) + revealRange',
      openLocationDist.includes('showTextDocument') && openLocationDist.includes('revealRange'), null);
    check('A3 Build Log 不再用 vscode.open 传 Range 定位',
      !/command:\s*['"]vscode\.open['"]/.test(buildLogDist)
      && !/executeCommand\(\s*['"]vscode\.open['"]/.test(buildLogDist), null);
    check('A4 Symbols 视图改为 codeblocks.openLocation',
      symbolDist.includes('codeblocks.openLocation') && !/command:\s*['"]vscode\.open['"]/.test(symbolDist), null);
    check('A5 Build Log 树节点命令改为 codeblocks.openLocation', buildLogDist.includes('codeblocks.openLocation'), null);
    check('A6 extension 注册 codeblocks.openLocation 命令', extDist.includes("'codeblocks.openLocation'"), null);

    // ---------- B. 导航列表：伪文件 / 已不存在的文件跳过，落到真实源码 ----------
    check('B1 dist 含可导航判断（isNavigableDiagnosticFile，排除伪文件与构建产物）',
      buildLogDist.includes('isNavigableDiagnosticFile'), null);

    const { BuildLogTreeProvider } = require(dist('ui/buildLogTreeProvider.js'));
    const provider = new BuildLogTreeProvider();
    const realSource = path.join(tmp, 'main.c');
    fs.writeFileSync(realSource, 'int main(void) {\n  return 0\n}\n', 'utf-8');
    const diag = (over) => ({ severity: 'error', message: 'x', ...over });
    const summaryOf = (diagnostics) => ({
      success: false,
      durationMs: 1,
      projects: [{
        projectName: 'p', targetName: 't', compilerPath: 'gcc', success: false,
        compiledCount: 1, skippedCount: 0, failedCount: 1,
        linkSuccess: false, linkSkipped: false, durationMs: 1,
        diagnostics,
      }],
      errorCount: diagnostics.length,
      warningCount: 0,
    });

    provider.setSummary(summaryOf([
      diag({ message: 'cannot find -lfoo', file: path.join(tmp, 'ld.exe') }),
      diag({ message: 'collect2', file: path.join(tmp, 'collect2.exe') }),
    ]));
    const none = await provider.gotoFirstError();
    check('B2 只有链接期伪文件时判定为「无可导航错误」', none === undefined && provider.hasErrors() === false, none);

    // B2e：对象文件（构建产物）同样不是源码位置 ⇒ 不进 F4 导航
    provider.setSummary(summaryOf([
      diag({ message: 'cannot find -lfoo', file: path.join(tmp, 'ld.exe') }),
      diag({ message: 'undefined ref', file: path.join(tmp, 'obj', 'main.o'), line: 2 }),
    ]));
    check('B2e 伪文件与对象文件都不进 F4 导航', provider.hasErrors() === false, null);

    // B2b–B2d：树节点本身也按可导航性挂命令（这是「点击不跳转」的直接来源）
    provider.setSummary(summaryOf([
      diag({ message: 'cannot find -lfoo', file: path.join(tmp, 'ld.exe') }),
      diag({ message: 'undefined ref', file: path.join(tmp, 'obj', 'main.o'), line: 2 }),
      diag({ message: 'expected ;', file: realSource, line: 3, column: 3 }),
    ]));
    const rootNode = provider.getChildren()[0];
    const projectNode = rootNode.children[0];
    const errorGroup = projectNode.children.find((c) => c.kind === 'group');
    const nodes = errorGroup ? errorGroup.children : [];
    check('B2b 伪文件/对象文件节点不挂跳转命令',
      nodes.length === 3 && nodes[0].command === undefined && nodes[1].command === undefined,
      nodes.map((n) => ({ label: n.label, cmd: n.command })));
    check('B2c 真实源码节点仍挂 codeblocks.openLocation',
      !!nodes[2] && !!nodes[2].command && nodes[2].command.command === 'codeblocks.openLocation', nodes[2] && nodes[2].command);
    check('B2d 无源码位置节点显示提示（description）',
      nodes.length === 3
      && /源码位置|source location/i.test(String(nodes[0].description))
      && /源码位置|source location/i.test(String(nodes[1].description)),
      nodes.map((n) => n.description));

    provider.setSummary(summaryOf([
      diag({ message: 'cannot find -lfoo', file: path.join(tmp, 'ld.exe') }),
      diag({ message: 'stale', file: path.join(tmp, 'gone.c'), line: 1 }),
      diag({ message: 'expected ;', file: realSource, line: 3, column: 3 }),
    ]));
    const first = await provider.gotoFirstError();
    check('B3 跳过伪文件与已不存在的文件，落到真实源码', !!first && first.file === realSource && first.line === 3, first);
    check('B4 定位成功且带 selection（打开的是目标文件）',
      shown.length === 1 && shown[0].file === realSource && !!shown[0].selection, shown);

    shown.length = 0;
    provider.setSummary(summaryOf([
      diag({ message: 'e1', file: realSource, line: 1 }),
      diag({ message: 'e2', file: realSource, line: 2 }),
    ]));
    const n1 = await provider.gotoNextError();
    const n2 = await provider.gotoNextError();
    check('B5 下一条错误逐条前进', n1 && n1.line === 1 && n2 && n2.line === 2, [n1, n2]);

    // ---------- C. clangd：打开工程必须触发重启（不受 restartOnActiveProjectSwitch 限制）----------
    check('C1 dist 打开工程时置 restartClangdReason = open', extDist.includes("restartClangdReason = 'open'"), null);
    check('C2 dist 重启判定接受 open 原因', /restartReason === 'open'/.test(extDist), null);
    check('C3 dist 门槛含「clangd 扩展已激活」', extDist.includes('clangdExtensionActive'), null);
    check('C4 dist 重启判定同时接受配置变化（configWritten）', extDist.includes('configWritten'), null);
  } finally {
    mock.restore();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  console.log(`错误跳转回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
