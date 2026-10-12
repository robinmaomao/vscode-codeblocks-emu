// L2 VS Code 宿主集成测试启动器
//
// 设计要点：
//  - 默认使用**声明的最低支持版本** VS Code（engines.vscode，本仓库 ^1.85.0）→ 由 @vscode/test-electron
//    下载一次到 .vscode-test/（仅首次联网）；这是兼容性测试的正确靶点。
//  - 也可指定本机安装复跑：设置 CB_VSCODE_PATH=<Code.exe>（实测本机 1.141.0 可正常跑通全部宿主用例）。
//  - 工作区使用临时目录（无 .cbp，避免激活时弹「检测到项目」选择框干扰）
//  - suite 复制到无空格路径运行（避免路径含空格带来的参数解析问题）
//
// 环境变量：
//   CB_VSCODE_PATH     指定 Code.exe（跳过下载，用于复用本机 VS Code）
//   CB_VSCODE_VERSION  指定测试靶点版本（默认读 package.json engines.vscode）
//   CB_HOST_KEEP       设为 1 时保留临时目录（排查用）
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function declaredVersion() {
  if (process.env.CB_VSCODE_VERSION) return process.env.CB_VSCODE_VERSION;
  try {
    const engines = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).engines?.vscode || '';
    const m = /(\d+\.\d+\.\d+)/.exec(engines);
    return m ? m[1] : 'stable';
  } catch {
    return 'stable';
  }
}

async function main() {
  let testElectron;
  try {
    testElectron = require('@vscode/test-electron');
  } catch {
    console.log('SKIP host：未安装 @vscode/test-electron（npm i -D @vscode/test-electron）');
    console.log('\nhost 宿主集成: 0 pass, 0 fail, 1 skip');
    process.exit(0);
  }
  const { runTests, downloadAndUnzipVSCode } = testElectron;

  let vscodeExecutablePath = process.env.CB_VSCODE_PATH;
  if (vscodeExecutablePath) {
    if (!fs.existsSync(vscodeExecutablePath)) {
      console.log(`CB_VSCODE_PATH 不存在：${vscodeExecutablePath}`);
      process.exit(2);
    }
    console.log(`host 靶点：本机 VS Code（${vscodeExecutablePath}）`);
  } else {
    const version = declaredVersion();
    try {
      vscodeExecutablePath = await downloadAndUnzipVSCode(version === 'stable' ? undefined : version);
      console.log(`host 靶点：VS Code ${version}\n           ${vscodeExecutablePath}`);
    } catch (err) {
      console.log(`SKIP host：无法获取 VS Code ${version}（${String(err.message || err).split('\n')[0]}）；可设 CB_VSCODE_PATH 复用本机安装`);
      console.log('\nhost 宿主集成: 0 pass, 0 fail, 1 skip');
      process.exit(0);
    }
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-host-ws-'));
  fs.writeFileSync(path.join(workspace, 'main.c'), 'int main(void) { return 0; }\n', 'utf-8');

  const staging = path.join(os.tmpdir(), `cb-host-suite-${process.pid}`);
  fs.mkdirSync(staging, { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, 'suite'))) {
    const src = path.join(__dirname, 'suite', f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(staging, f));
  }
  const testsEntry = path.win32.join(staging, 'index.js');
  console.log(`host 工作区：${workspace}`);
  console.log(`host 用例：${testsEntry}（存在=${fs.existsSync(testsEntry)}）`);

  const profile = path.join(root, '.vscode-test', `host-profile-${process.pid}`);
  const userDataDir = path.join(profile, 'user-data');
  console.log(`host user-data：${userDataDir}`);
  const launchArgs = [
    workspace,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${path.join(profile, 'extensions')}`,
    '--disable-gpu',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-sandbox',
  ];
  if (process.env.CB_HOST_LOG) {
    // 排查用：把主进程日志写成 trace（日志落在 <user-data>/logs/，需配合 CB_HOST_KEEP=1 保留）
    launchArgs.push('--log=trace');
    console.log('host 主进程日志：trace（CB_HOST_LOG=1）');
  }
  const exitCode = await new Promise((resolve) => {
    runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath: testsEntry,
      extensionTestsEnv: {
        CB_HOST_USER_DATA: userDataDir,
        CB_REPO_ROOT: root,
      },
      launchArgs,
    }).then(() => resolve(0)).catch((err) => {
      console.error('host 运行失败: ' + (err && err.message ? err.message : err));
      resolve(1);
    });
  });

  if (!process.env.CB_HOST_KEEP) {
    for (const d of [workspace, staging, profile]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } else {
    console.log(`（保留：workspace=${workspace} staging=${staging} profile=${profile}）`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('host 启动异常: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
