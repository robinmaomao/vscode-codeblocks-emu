// 宿主集成：真实调试会话（VS Code 工作台发起 → 扩展 DAP 适配器 → 真实 gdb）
//
// 设计要点（均为实测结论，勿轻易改动）：
//  1. **不使用 `vscode.debug.startDebugging`**：`--extensionTestsPath` 运行方式下，从测试扩展调用该 API 会永久
//     挂起（实测连内置 `ms-vscode.js-debug` 的 `pwa-node` 类型同样挂起，且工作台仍能响应命令 → 属测试宿主
//     限制而非扩展缺陷）。因此改为「工作台侧发起」：写 `.vscode/launch.json` + 触发 `workbench.action.debug.start`，
//     之后只用事件与 `activeDebugSession` 观测（该命令的 promise 可能长期 pending，一律不 await）。
//  2. **断点必须落在会话所属工作区文件夹内**：VS Code 只把该文件夹内的断点下发给适配器。故探针源码在工作区内
//     现场生成并用 gcc 编译（顺带验证「源码 → 编译 → 调试」宿主全链路）。
//  3. 适配器未消费 `stopOnEntry`，且探针为长驻循环 → 用「暂停 → 停止 → 下断点 → 继续 → 命中」验证断点闭环。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vscode = require('vscode');
const { suite } = require('./framework');

const PROBE_SOURCE = `#include <stdio.h>
#ifdef _WIN32
#include <windows.h>
#define WAIT_MS(ms) Sleep(ms)
#else
#include <unistd.h>
#define WAIT_MS(ms) usleep((ms) * 1000)
#endif

int main(void) {
    int left = 2;
    int right = 3;
    int tick = 0;
    printf("host-probe: start\\n");
    fflush(stdout);
    for (int i = 0; i < 1200; i++) {
        tick += left + right; // BREAK
        WAIT_MS(50);
    }
    printf("host-probe: done tick=%d\\n", tick);
    return 0;
}
`;

function findTool(name) {
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf-8', windowsHide: true });
  if (w.status !== 0) return undefined;
  const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first && fs.existsSync(first) ? first : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** DAP 请求在适配器异常时可能永不返回 → 一律套超时，避免整轮宿主测试挂死 */
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`DAP 请求超时（${ms} ms）：${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(fn, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  return undefined;
}

/** 轮询 threads + stackTrace，直到目标处于停止态（运行中时两个请求都会失败或返回空） */
async function waitForStop(session, ms) {
  return waitFor(async () => {
    try {
      const threads = await withTimeout(session.customRequest('threads'), 8000, 'threads');
      if (!threads || !threads.threads || !threads.threads.length) return undefined;
      const st = await withTimeout(
        session.customRequest('stackTrace', { threadId: threads.threads[0].id, levels: 3 }), 8000, 'stackTrace');
      if (st && st.stackFrames && st.stackFrames.length) {
        return { frames: st.stackFrames, threadId: threads.threads[0].id };
      }
    } catch { /* 运行中 → 重试 */ }
    return undefined;
  }, ms);
}

suite('宿主集成 · 真实调试会话（工作台发起）', (t) => {
  t.test('现场编译探针 → F5 启动会话 → 暂停/下断点/继续 → 命中断点 → 作用域与变量 → 终止', async (ctx) => {
    const gdb = findTool('gdb');
    const gcc = findTool('gcc');
    if (!gcc || !gdb) ctx.skip();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) ctx.skip();

    const step = (name) => console.log(`     · ${name}`);
    const srcPath = path.join(folder.uri.fsPath, 'host-probe.c');
    const exePath = path.join(folder.uri.fsPath, 'host-probe.exe');
    fs.writeFileSync(srcPath, PROBE_SOURCE, 'utf-8');
    const cc = spawnSync(gcc, ['-g', '-O0', '-o', exePath, srcPath], { encoding: 'utf-8', windowsHide: true });
    assert.strictEqual(cc.status, 0, `探针编译失败：${cc.stderr || cc.stdout}`);
    assert.ok(fs.existsSync(exePath), '探针可执行文件未生成');
    const breakLine = PROBE_SOURCE.split('\n').findIndex((l) => l.includes('// BREAK')) + 1;
    step(`探针已编译（断点行=${breakLine}）gdb=${gdb}`);

    const dap = [];
    const dapRecord = (dir, m) => {
      const line = `${dir} ${m && (m.command || m.event || m.type)}`;
      dap.push(line);
      if (dap.length <= 80) console.log(`     · DAP ${line}`);
    };
    const trackerSub = vscode.debug.registerDebugAdapterTrackerFactory('codeblocks', {
      createDebugAdapterTracker() {
        return {
          onWillReceiveMessage: (m) => dapRecord('>>', m),
          onDidSendMessage: (m) => dapRecord('<<', m),
          onError: (e) => dapRecord('!!', { event: e && e.message }),
          onExit: (code) => dapRecord('xx', { event: `exit=${code}` }),
        };
      },
    });

    const events = [];
    const startedSub = vscode.debug.onDidStartDebugSession((s) => {
      if (s.type === 'codeblocks') events.push(`start:${s.name}`);
    });
    const termSub = vscode.debug.onDidTerminateDebugSession((s) => {
      if (s.type === 'codeblocks') events.push('terminate');
    });
    const bp = {
      id: 'cb-host-bp-1',
      enabled: true,
      location: new vscode.Location(vscode.Uri.file(srcPath), new vscode.Position(breakLine - 1, 0)),
    };

    try {
      // 写工作台可见的 launch 配置（不使用 launch.json 时 F5 需要额外选择调试器，会引入 UI 交互），
      // 并把探针源码设为活动编辑器：F5 需要「活动编辑器语言 + 匹配的配置」才能免交互选中配置，
      // 否则会弹出「Select debug configuration」选择框而永久等待（实测）。
      const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(path.join(vscodeDir, 'launch.json'), JSON.stringify({
        version: '0.2.0',
        configurations: [{
          type: 'codeblocks',
          name: 'host-probe',
          request: 'launch',
          program: exePath,
          cwd: folder.uri.fsPath,
          gdbPath: gdb,
          stopOnEntry: false,
        }],
      }, null, 2), 'utf-8');
      const srcUri = vscode.Uri.file(srcPath);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(srcUri), { preview: false });
      step(`activeEditor=${vscode.window.activeTextEditor?.document.uri.fsPath}`);

      // 会话启动前下断点：VS Code 会在会话就绪时把工作区内的源断点下发给适配器
      // （API 路径 + 编辑器切换路径，后者等价于用户按 F9）
      vscode.debug.addBreakpoints([bp]);
      try {
        const pos = new vscode.Position(breakLine - 1, 0);
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          editor.selection = new vscode.Selection(pos, pos);
          await vscode.commands.executeCommand('editor.debug.action.toggleBreakpoint');
        }
      } catch (err) {
        step(`编辑器切换断点跳过：${err && err.message}`);
      }
      step(`断点=${JSON.stringify(vscode.debug.breakpoints.map((b) => `${path.basename(b.location?.uri?.fsPath ?? '?')}:${(b.location?.range?.start?.line ?? -1) + 1}`))}`);

      let cmdState = 'pending';
      void vscode.commands.executeCommand('workbench.action.debug.start').then(
        () => { cmdState = 'resolved'; },
        (err) => { cmdState = `rejected:${err && err.message ? err.message : err}`; },
      );

      const session = await waitFor(() => vscode.debug.activeDebugSession, 40000);
      step(`activeDebugSession=${session && session.type} cmd=${cmdState}`);
      if (!session) step(`DAP=${JSON.stringify(dap)}`);
      assert.ok(session, `未出现 codeblocks 调试会话（cmd=${cmdState}）`);
      assert.strictEqual(session.type, 'codeblocks');

      // 1) 等待命中会话启动前设置的断点（目标启动即循环，断点应在首次迭代命中）
      const hit = await waitForStop(session, 40000);
      if (!hit) step(`未命中，DAP=${JSON.stringify(dap)}`);
      assert.ok(hit, '未命中会话启动前设置的断点');
      step(`命中=${hit.frames[0].name}:${hit.frames[0].line}`);
      assert.strictEqual(hit.frames[0].name, 'main', `栈顶应为 main，实际 ${hit.frames[0].name}`);
      assert.strictEqual(hit.frames[0].line, breakLine, `应停在断点行 ${breakLine}，实际 ${hit.frames[0].line}`);

      // 4) 作用域与变量：宿主内完整链路（D-02/D-03 登记项在此口径下记录）
      const scopes = await withTimeout(session.customRequest('scopes', { frameId: hit.frames[0].id }), 15000, 'scopes');
      assert.ok(scopes && scopes.scopes && scopes.scopes.length >= 1, 'scopes 为空');
      step(`scopes=${scopes.scopes.map((s) => s.name).join(',')}`);
      const locals = scopes.scopes.find((s) => /local|局部/i.test(s.name)) ?? scopes.scopes[0];
      const vars = await withTimeout(
        session.customRequest('variables', { variablesReference: locals.variablesReference }), 15000, 'variables');
      const byName = new Map((vars.variables || []).map((v) => [v.name, v.value]));
      step(`locals=${[...byName].map(([k, v]) => `${k}=${v}`).join(',')}`);
      assert.strictEqual(byName.get('left'), '2', `left 值异常：${byName.get('left')}`);
      assert.strictEqual(byName.get('right'), '3', `right 值异常：${byName.get('right')}`);

      // 5) 终止（长驻循环不会自行结束，必须显式停止）
      await withTimeout(session.customRequest('continue', { threadId: hit.threadId }), 10000, 'continue-final').catch(() => undefined);
      await vscode.debug.stopDebugging();
      const terminated = await waitFor(() => !vscode.debug.activeDebugSession, 20000);
      step(`会话已结束=${!!terminated} cmd=${cmdState}`);
    } finally {
      vscode.debug.removeBreakpoints([bp]);
      startedSub.dispose(); termSub.dispose(); trackerSub.dispose();
    }

    assert.ok(events.some((e) => e.startsWith('start:')), '未观察到 onDidStartDebugSession(codeblocks)');
    assert.ok(events.includes('terminate'), '未观察到会话终止事件');
  });
});
