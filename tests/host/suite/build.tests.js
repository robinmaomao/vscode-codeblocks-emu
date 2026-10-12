// 宿主集成：真实构建与诊断链路（打开工程 → codeblocks.build → 产物 / 诊断断言）
//
// 环境要求：PATH 上有 gcc（本机 mingw64 可用）。缺失时整组 SKIP（`SKIP ...：原因` 行 + 不失败），
//          以避免无工具链的 CI 误报。
//
// 观测手段逐条对应（不伪造断言；宿主限制与替代观测点见下）：
//  1. 打开工程：宿主内不能用文件对话框（codeblocks.openProject 弹系统选择框，无法自动驾驶），
//     改用 `codeblocks.openRecentProject <abs path>`（src/extension.ts 处理器签名 (filename?: string)）。
//     可观测代理 = 扩展输出通道落盘日志中的「已打开项目: <title>」行。
//  2. 构建结束：`codeblocks.build` 命令内部 await build()，Promise resolve 即构建结束（外壳再套 170s 超时防挂死）。
//  3. 「构建成功」行 / 链接产物路径行 / 编译器诊断行：读扩展输出通道的落盘日志
//     （<user-data>/logs/**/exthost/robinmaomao.codeblocks-vscode/CodeBlocks.log）。
//     vscode API 不暴露 OutputChannel 内容，这是宿主内**唯一**可读的输出通道文本；
//     其存在性由启动器在 <user-data>/User/settings.json 预置 codeblocks.build.persistLog=true 保证
//     （LogOutputChannel 落盘；构建开始时通道 clear() → 文件内容即本次构建输出）。
//  4. 产物：<proj>/bin/Debug/*.exe 存在 + mtime 不早于构建开始 + 真实运行一次验证行为。
//  5. Problems 诊断：`codeblocks.clangd.enabled=false` 时由构建引擎写入（source='Code::Blocks'）。
//     背景：本机存在 clangd 二进制（clangd 扩展的下载目录），扩展会判定「clangd 接管诊断」
//     （src/extension.ts 的 clangdDiagnosticsEnabled）并把 Problems 交给 clangd；隔离 profile 中没有 clangd 扩展，
//     故用例显式关闭 clangd 集成以获得确定性的「构建引擎 → Problems」链路（用例结束恢复默认）。
//  6. HTML 构建日志：开启产品自有设置 codeblocks.build.saveHtmlLog（对齐 CB save_html_build_log）→
//     <proj>/<base>_build_log.html（起止时间 + 诊断表），作为输出通道之外的第二条磁盘取证路径。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vscode = require('vscode');
const { suite } = require('./framework');
const U = require('./hostUtil');

const gcc = U.findTool('gcc');

// 警告探针：-Wall 下 gcc 产生 "unused variable"（warning 级），不阻断链接
const WARN_C_SOURCE = `#include <stdio.h>

int main(void)
{
    int cb_host_unused_probe = 42;
    printf("warn-probe: alive\\n");
    return 0;
}
`;

const WARN_CBP = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
    <FileVersion major="1" minor="6" />
    <Project>
        <Option title="cb-host-warn" />
        <Option compiler="gcc" />
        <Build>
            <Target title="Debug">
                <Option type="1" />
                <Option compiler="gcc" />
                <Option output="bin/Debug/warnprobe" />
                <Option object_output="obj/Debug/" />
                <Compiler>
                    <Add option="-Wall" />
                </Compiler>
            </Target>
        </Build>
        <Unit filename="probe.c" />
    </Project>
</CodeBlocks_project_file>
`;

const warnLine = WARN_C_SOURCE.split('\n').findIndex((l) => l.includes('cb_host_unused_probe')) + 1; // 1 基

/** 工具链缺失时统一的 SKIP 输出 */
function skipNoGcc(ctx, what) {
  console.log(`SKIP ${what}：PATH 未找到 gcc（无工具链环境跳过真实构建，不判失败）`);
  ctx.skip();
}

suite('宿主集成 · 真实构建与诊断（gcc 工具链）', (t) => {
  t.test('打开 hello-cb 工程 → codeblocks.build → bin/Debug/hello.exe + 构建成功行 + 无错误诊断', async (ctx) => {
    if (!gcc) skipNoGcc(ctx, '宿主内真实构建（hello-cb）');
    const ws = U.workspaceDir();
    if (!ws) {
      console.log('SKIP 宿主内真实构建：无工作区文件夹');
      ctx.skip();
    }

    // 前置：干净目录（无 bin/obj），确保产物是本次构建产出
    const projDir = path.join(ws, 'cb-host-build');
    fs.rmSync(projDir, { recursive: true, force: true });
    const cbp = U.copyHelloProject(projDir);
    const exePath = path.join(projDir, 'bin', 'Debug', 'hello.exe');
    const htmlLogPath = path.join(projDir, 'hello-cb_build_log.html');
    assert.ok(!fs.existsSync(exePath), '前置失败：产物已存在，无法证明本次构建产出');

    await U.setConfig('clangd.enabled', false); // Problems 由构建引擎产出（隔离环境无 clangd 扩展）
    await U.setConfig('build.saveHtmlLog', true); // 产品能力：HTML 构建日志落盘
    try {
      // 1) 打开工程（观测：输出日志「已打开项目: hello-cb」）
      const off = U.logOffset();
      await vscode.commands.executeCommand('codeblocks.openRecentProject', cbp);
      await vscode.commands.executeCommand('codeblocks.setActiveProject', cbp);
      const opened = await U.waitForLogLine('已打开项目: hello-cb', off, 20000);
      assert.ok(opened, `工程未打开（观测手段：输出通道落盘日志 ${U.extensionLogPath() || '未找到扩展日志'}）`);
      // 让 clangd 生成流程跑一轮（clangd.enabled=false → 构建引擎接管 Problems，链路确定）
      await vscode.commands.executeCommand('codeblocks.generateCompileCommands');
      await U.delay(600);

      // 2) 构建（命令 resolve 即构建结束）
      const t0 = Date.now();
      await U.withTimeout(vscode.commands.executeCommand('codeblocks.build'), 170000, 'codeblocks.build');

      // 3) 产物（观测手段：文件系统）
      const exe = await U.waitFor(() => (fs.existsSync(exePath) ? exePath : undefined), 20000);
      assert.ok(exe, `构建结束但产物不存在：${exePath}`);
      const stat = fs.statSync(exePath);
      assert.ok(stat.size > 0, '产物为空文件');
      assert.ok(stat.mtimeMs >= t0 - 2000, `产物未在本次构建中更新（mtime=${new Date(stat.mtimeMs).toISOString()}）`);

      // 4) 构建成功行 / 构建汇总行 / 链接产物行（观测手段：输出通道落盘日志）
      const okLine = await U.waitForLogLine('[Code::Blocks] 构建成功', 0, 15000);
      assert.ok(okLine, `输出日志缺少构建成功行（观测手段：${U.extensionLogPath() || '未找到扩展日志'}）`);
      const summary = await U.waitForLogLine(/构建完成: hello-cb \(Debug\)/, 0, 15000);
      const linkLine = await U.waitForLogLine(/链接成功\s*→\s*bin[\\/]Debug[\\/]hello/, 0, 15000);
      const logTail = U.readExtensionLog().split(/\r?\n/).slice(-6).join(' | ');
      assert.ok(summary, `输出日志缺少构建汇总行（工程/目标）：${logTail}`);
      assert.ok(linkLine, `输出日志缺少链接产物路径行（bin\\Debug\\hello）：${logTail}`);
      // 日志确实属于本次临时工作区（HTML 构建日志行含临时工程绝对路径）
      const projDirNorm = path.join(ws, 'cb-host-build').replace(/\\/g, '/').toLowerCase();
      assert.ok(U.readExtensionLog().replace(/\\/g, '/').toLowerCase().includes(projDirNorm),
        '输出日志未指向本次临时工程目录');

      // 5) 中间产物（两个编译单元）
      for (const obj of ['main.o', 'util.o']) {
        assert.ok(fs.existsSync(path.join(projDir, 'obj', 'Debug', obj)), `缺少对象文件 obj/Debug/${obj}`);
      }

      // 6) 产物真实可运行（链接结果验证）
      const run = spawnSync(exePath, [], { encoding: 'utf-8', windowsHide: true });
      assert.strictEqual(run.status, 0, `产物运行失败：${run.stderr}`);
      assert.ok((run.stdout || '').includes('hello-cb: 2 + 3 = 5'), `产物输出异常：${JSON.stringify(run.stdout)}`);

      // 7) 干净构建 → 无错误诊断（观测手段：vscode.languages.getDiagnostics）
      const errors = U.diagnosticsForFile(path.join(projDir, 'main.c'))
        .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
      assert.deepStrictEqual(errors.map((d) => d.message), [], '干净构建产生了错误诊断');

      // 8) HTML 构建日志（起止时间 + 无 error 行）
      assert.ok(fs.existsSync(htmlLogPath), `未生成 HTML 构建日志：${htmlLogPath}`);
      const html = fs.readFileSync(htmlLogPath, 'utf-8');
      assert.ok(html.includes('Build started on:') && html.includes('Build ended on:'), 'HTML 构建日志缺少起止时间');
      assert.ok(!/class="error"/.test(html), 'HTML 构建日志出现错误诊断行');
    } finally {
      await U.setConfig('build.saveHtmlLog', undefined);
    }
  });

  t.test('诊断链路：-Wall 警告 → 构建仍成功 + Problems(source=Code::Blocks) + 输出/HTML 日志诊断行', async (ctx) => {
    if (!gcc) skipNoGcc(ctx, '宿主内诊断链路（-Wall 警告工程）');
    const ws = U.workspaceDir();
    if (!ws) {
      console.log('SKIP 宿主内诊断链路：无工作区文件夹');
      ctx.skip();
    }

    // 本地生成警告工程（不依赖仓库夹具；标题唯一）
    const projDir = path.join(ws, 'cb-host-warn');
    fs.rmSync(projDir, { recursive: true, force: true });
    fs.mkdirSync(projDir, { recursive: true });
    const srcPath = path.join(projDir, 'probe.c');
    fs.writeFileSync(srcPath, WARN_C_SOURCE, 'utf-8');
    const cbp = path.join(projDir, 'cb-host-warn.cbp');
    fs.writeFileSync(cbp, WARN_CBP, 'utf-8');
    const exePath = path.join(projDir, 'bin', 'Debug', 'warnprobe.exe');
    const htmlLogPath = path.join(projDir, 'cb-host-warn_build_log.html');

    await U.setConfig('clangd.enabled', false);
    await U.setConfig('build.saveHtmlLog', true);
    try {
      const off = U.logOffset();
      await vscode.commands.executeCommand('codeblocks.openRecentProject', cbp);
      await vscode.commands.executeCommand('codeblocks.setActiveProject', cbp);
      assert.ok(await U.waitForLogLine('已打开项目: cb-host-warn', off, 20000), '警告工程未打开');
      await vscode.commands.executeCommand('codeblocks.generateCompileCommands');
      await U.delay(600);

      await U.withTimeout(vscode.commands.executeCommand('codeblocks.build'), 170000, 'codeblocks.build');

      // 1) 警告不阻断链接 → 产物存在
      assert.ok(await U.waitFor(() => (fs.existsSync(exePath) ? exePath : undefined), 20000),
        `警告场景下产物未生成（warning 不应判失败）：${exePath}`);
      // 2) 构建成功行（观测：输出通道落盘日志）
      assert.ok(await U.waitForLogLine('[Code::Blocks] 构建成功', 0, 15000), '输出日志缺少构建成功行（仅有警告时应判成功）');
      // 3) 输出日志中的诊断行（gcc stderr → onLine → outputChannel）
      assert.ok(await U.waitForLogLine('unused variable', 0, 15000), '输出日志缺少编译器警告行 unused variable');

      // 4) Problems 诊断（观测手段：vscode.languages.getDiagnostics() 按 fsPath 匹配 + source 判定归属）
      const cbDiags = await U.waitFor(() => {
        const d = U.diagnosticsForFile(srcPath).filter((x) => x.source === 'Code::Blocks');
        return d.length ? d : undefined;
      }, 15000);
      assert.ok(cbDiags, `Problems 未出现构建引擎诊断（当前 probe.c 诊断共 ${U.diagnosticsForFile(srcPath).length} 条）`);
      const warn = cbDiags.find((d) => d.severity === vscode.DiagnosticSeverity.Warning && /unused variable/.test(d.message));
      assert.ok(warn, `未出现 unused variable 警告诊断：${JSON.stringify(cbDiags.map((d) => ({ s: d.severity, m: d.message })))}`);
      assert.strictEqual(warn.range.start.line, warnLine - 1, `警告行号应为 ${warnLine}（0 基 ${warnLine - 1}），实际 0 基 ${warn.range.start.line}`);

      // 5) HTML 构建日志诊断行（磁盘取证）
      assert.ok(fs.existsSync(htmlLogPath), `未生成 HTML 构建日志：${htmlLogPath}`);
      const html = fs.readFileSync(htmlLogPath, 'utf-8');
      assert.ok(/class="warning"/.test(html), 'HTML 构建日志缺少 warning 行');
      assert.ok(html.includes('unused variable') && html.includes('probe.c'), 'HTML 构建日志警告行未指向 probe.c');
    } finally {
      await U.setConfig('build.saveHtmlLog', undefined);
    }
  });

  t.test('线索取证（仅记录，不判失败）：检测到 clangd 二进制 → 构建引擎停止写 Problems', async (ctx) => {
    // 现象取证：恢复 clangd.enabled 默认(true) 后重新构建警告工程：
    //  - 输出日志仍有编译警告行（onLine 与 clangd 无关）；
    //  - Problems 中 source=Code::Blocks 的诊断被清空且不再写入（clangdDiagnosticsEnabled=true）。
    // 若此时环境里没有 clangd 扩展（隔离 profile 即如此），Problems 面板将完全没有构建诊断 —— 线索已在汇报中说明。
    if (!gcc) skipNoGcc(ctx, 'clangd 诊断归属取证');
    const ws = U.workspaceDir();
    if (!ws) {
      console.log('SKIP clangd 诊断归属取证：无工作区文件夹');
      ctx.skip();
    }
    const projDir = path.join(ws, 'cb-host-warn');
    const cbp = path.join(projDir, 'cb-host-warn.cbp');
    if (!fs.existsSync(cbp)) {
      console.log('SKIP clangd 诊断归属取证：警告工程不存在（需先运行上一用例）');
      ctx.skip();
    }

    await U.setConfig('clangd.enabled', undefined); // 恢复默认
    try {
      await vscode.commands.executeCommand('codeblocks.generateCompileCommands');
      await U.delay(800);
      await vscode.commands.executeCommand('codeblocks.setActiveProject', cbp);
      await U.withTimeout(vscode.commands.executeCommand('codeblocks.build'), 170000, 'codeblocks.build（取证）');
      await U.delay(1500);

      const cbDiags = U.diagnosticsForFile(path.join(projDir, 'probe.c')).filter((d) => d.source === 'Code::Blocks');
      const log = U.readExtensionLog();
      const clangdExt = vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd');
      console.log(`     · 观测：clangd 扩展已安装=${!!clangdExt}；Problems 中 source=Code::Blocks 诊断=${cbDiags.length} 条；输出日志含警告行=${/unused variable/.test(log)}`);
      console.log('     · 说明：clangd 二进制被检测到即停止写 Problems（clangdDiagnosticsEnabled），clangd 扩展缺失时 Problems 无诊断 → 见汇报「产品缺陷线索」');
    } finally {
      await U.setConfig('clangd.enabled', undefined);
      await U.setConfig('build.saveHtmlLog', undefined);
    }
  });
});
