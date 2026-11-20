// 外部修改检测（真实 VS Code 宿主）：验证 .cbp 文件 watcher 在真实文件事件下触发检测/重载。
// 这是 E3 观察项「外部修改未弹窗」的宿主级回归：不依赖 mock 的 emitFileEvent，直接改真实文件。
// 使用 auto 模式避免模态框依赖，断言输出通道的检测日志（同时验证 tracker + watcher + drain 链路）。
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { suite } = require('./framework');
const {
  EXT_ID, workspaceDir, copyHelloProject, delay, waitForLogLine, logOffset, readExtensionLog, setConfig,
} = require('./hostUtil');

suite('External change', ({ test }) => {
  test('真实 .cbp 外部修改触发检测并自动重载', async () => {
    const workspace = workspaceDir();
    if (!workspace) throw new Error('宿主工作区为空');

    const dir = path.join(workspace, 'e3-external-host');
    fs.rmSync(dir, { recursive: true, force: true });
    const cbp = copyHelloProject(dir, 'host-external-detect');

    await vscode.extensions.getExtension(EXT_ID).activate();
    await setConfig('detect.checkExternalChanges', 'auto');
    await vscode.commands.executeCommand('codeblocks.openProject', vscode.Uri.file(cbp));
    await delay(1200);

    try {
      const before = logOffset();
      // 在根节点后追加注释：保留原工程结构，仅改变文件签名
      fs.appendFileSync(cbp, '\n<!-- external host test -->\n', 'utf-8');
      const sawDetection = await waitForLogLine(
        /External change detected: .*e3-external-host|检测到外部修改：.*e3-external-host/i,
        before,
        15000,
      );
      if (!sawDetection) {
        throw new Error(`未检测到 .cbp 外部修改；最近日志=${readExtensionLog().slice(-1200)}`);
      }
    } finally {
      await setConfig('detect.checkExternalChanges', 'prompt').catch(() => undefined);
      await vscode.commands.executeCommand('codeblocks.closeProject', { project: { filename: cbp } }).catch(() => undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
