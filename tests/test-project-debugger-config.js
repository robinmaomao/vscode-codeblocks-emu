// 验证第三轮 R3/R4/R5：
//  - <Extensions><debugger> 的 search_path / remote_debugging 解析、写回（保留其它节点）、MergeWith 合并
//  - 远程调试准备命令序列（对齐 gdb_driver.cpp:141-260 / gdb_commands.h:1711-1745）
//  - 源目录 directory 命令、user arguments 分词
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');
const {
  parseProjectDebuggerConfig, applyProjectDebuggerConfig, mergeRemoteOptions, defaultRemoteOptions, isRemoteOptionsOk,
} = require('../dist/model/projectDebuggerExtensions.js');
const { buildSourceDirCommands, buildRemoteDebugCommands, splitCommandLineArgs } = require('../dist/debug/remoteDebugging.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. 纯解析（含单/数组两种形态与多行命令） ----
const rawExt = {
  debugger: {
    other_plugin_node: { '@_x': '1' },
    search_path: [{ '@_add': 'C:\\src\\one' }, { '@_add': 'rel/two' }],
    remote_debugging: [
      { options: { '@_conn_type': '0', '@_ip_address': '127.0.0.1', '@_ip_port': '3333' } },
      {
        '@_target': 'Debug',
        options: {
          '@_conn_type': '2', '@_serial_port': 'COM4', '@_serial_baud': '921600',
          '@_additional_cmds': 'monitor reset\nload', '@_extended_remote': '1',
        },
      },
    ],
  },
  codeblocks_project_custom_variables: { x: { '@_value': 'y' } },
};
const parsed = parseProjectDebuggerConfig(rawExt);
check('search_path 解析（2 条）', JSON.stringify(parsed.searchPaths) === JSON.stringify(['C:\\src\\one', 'rel/two']), parsed.searchPaths);
check('项目级远程解析', parsed.remote[0].connType === 0 && parsed.remote[0].ip === '127.0.0.1' && parsed.remote[0].target === '', parsed.remote[0]);
check('目标级远程解析（多行命令）', parsed.remote[1].serialPort === 'COM4' && parsed.remote[1].serialBaud === '921600'
  && parsed.remote[1].additionalCmds === 'monitor reset\nload' && parsed.remote[1].extendedRemote === true, parsed.remote[1]);

// ---- 2. 写回 + 保留其它节点 + 全默认跳过 ----
const cfg = {
  searchPaths: ['D:/inc'],
  remote: [
    { ...defaultRemoteOptions(''), connType: 0, ip: '192.168.0.5', ipPort: '2331' },
    { ...defaultRemoteOptions('Debug'), connType: 2, serialPort: 'COM9', additionalShellCmdsBefore: 'echo on' },
    { ...defaultRemoteOptions('Release') }, // 全默认 → 应跳过
  ],
};
const ext2 = applyProjectDebuggerConfig(rawExt, cfg);
check('写回保留其它 debugger 子节点', ext2.debugger && ext2.debugger.other_plugin_node && ext2.debugger.other_plugin_node['@_x'] === '1', ext2.debugger && ext2.debugger.other_plugin_node);
check('写回保留其它扩展节点', ext2.codeblocks_project_custom_variables && ext2.codeblocks_project_custom_variables.x['@_value'] === 'y', ext2.codeblocks_project_custom_variables);
check('search_path 重建', JSON.stringify(ext2.debugger.search_path) === JSON.stringify([{ '@_add': 'D:/inc' }]), ext2.debugger.search_path);
const rdNodes = ext2.debugger.remote_debugging;
check('remote 条目数（全默认跳过）', Array.isArray(rdNodes) && rdNodes.length === 2, rdNodes && rdNodes.length);
check('项目级 remote 无 target 属性', !rdNodes[0]['@_target'] && rdNodes[0].options['@_ip_address'] === '192.168.0.5', rdNodes[0]);
check('目标级 remote 写 serial 与 shell 命令', rdNodes[1]['@_target'] === 'Debug' && rdNodes[1].options['@_serial_port'] === 'COM9'
  && rdNodes[1].options['@_additional_shell_cmds_before'] === 'echo on', rdNodes[1]);

// 清空 → search_path/remote_debugging 移除（保留其它 debugger 子节点与其它扩展）
const ext3 = applyProjectDebuggerConfig(rawExt, { searchPaths: [], remote: [] });
check('清空后移除 search/remote 子节点', ext3.debugger && ext3.debugger.search_path === undefined && ext3.debugger.remote_debugging === undefined, ext3.debugger);
check('清空后保留其它 debugger 子节点', ext3.debugger && ext3.debugger.other_plugin_node['@_x'] === '1', ext3.debugger);
check('清空后仍保留其它扩展节点', ext3.codeblocks_project_custom_variables !== undefined, true);
// 仅含搜索/远程时 → debugger 节点整体移除
const ext4 = applyProjectDebuggerConfig({ debugger: { search_path: [{ '@_add': 'x' }] } }, { searchPaths: [], remote: [] });
check('仅含搜索/远程时 debugger 节点移除', ext4.debugger === undefined, ext4.debugger);

// ---- 3. MergeWith 语义 ----
const projDefault = { ...defaultRemoteOptions(''), connType: 0, ip: '10.0.0.1', ipPort: '1234', additionalCmds: 'set pagination off', skipLDpath: true };
const tgt = { ...defaultRemoteOptions('Debug'), connType: 2, serialPort: 'COM7', serialBaud: '115200', additionalCmds: 'monitor reset' };
const merged = mergeRemoteOptions(projDefault, tgt);
check('合并：目标 IsOk 覆盖连接字段', merged.connType === 2 && merged.serialPort === 'COM7' && merged.ip === '', merged);
check('合并：附加命令换行追加', merged.additionalCmds === 'set pagination off\nmonitor reset', merged.additionalCmds);
check('合并：布尔以目标为准（false 覆盖 true）', merged.skipLDpath === false, merged.skipLDpath);
check('合并：目标无效时仅项目默认', mergeRemoteOptions(projDefault, { ...defaultRemoteOptions('Debug') }).ip === '10.0.0.1', mergeRemoteOptions(projDefault, defaultRemoteOptions('Debug')).ip);
check('合并：均无效 → undefined', mergeRemoteOptions(defaultRemoteOptions(''), defaultRemoteOptions('Debug')) === undefined, true);
check('IsOk：串口需端口+波特率', isRemoteOptionsOk({ ...defaultRemoteOptions(''), connType: 2, serialPort: 'COM1' }) === true
  && isRemoteOptionsOk({ ...defaultRemoteOptions(''), connType: 2 }) === false, true);

// ---- 4. 端到端：工程模型 → 序列化 → 重新解析 ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-dbgext-'));
const cbp = path.join(dir, 'dbgtest.cbp');
fs.copyFileSync(path.resolve(__dirname, '../test-project/hello-cb.cbp'), cbp);
const project = new ProjectParser().parse(cbp);
project.extensions = applyProjectDebuggerConfig(project.extensions, cfg);
const xml = serializeProject(project);
check('XML 含 search_path', xml.includes('search_path'), xml.includes('search_path'));
check('XML 含 remote_debugging', xml.includes('remote_debugging') && xml.includes('ip_address="192.168.0.5"'), true);
const tmp = path.join(dir, 'roundtrip.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const rt = new ProjectParser().parse(tmp);
const back = parseProjectDebuggerConfig(rt.extensions);
check('往返 searchPaths', JSON.stringify(back.searchPaths) === JSON.stringify(['D:/inc']), back.searchPaths);
check('往返 remote 数', back.remote.length === 2, back.remote.length);
check('往返 serial 波特率默认与命令', back.remote[1].serialPort === 'COM9' && back.remote[1].additionalShellCmdsBefore === 'echo on', back.remote[1]);

// ---- 5. 命令构建 ----
check('directory 命令（反斜杠转斜杠）', JSON.stringify(buildSourceDirCommands(['C:\\Work dir\\src'])) === JSON.stringify(['directory "C:/Work dir/src"']), buildSourceDirCommands(['C:\\Work dir\\src']));
check('directory 无空格不加引号/空项过滤', JSON.stringify(buildSourceDirCommands(['', 'C:\\src'])) === JSON.stringify(['directory C:/src']), buildSourceDirCommands(['', 'C:\\src']));

const serialRd = { ...defaultRemoteOptions('Debug'), connType: 2, serialPort: '/dev/ttyUSB0', serialBaud: '115200', extendedRemote: true, additionalCmdsBefore: 'set remotetimeout 20', additionalShellCmdsBefore: 'echo before', additionalCmds: 'monitor reset', additionalShellCmdsAfter: 'echo after' };
const steps = buildRemoteDebugCommands(serialRd);
const seq = steps.map((s) => s.kind + ':' + s.command);
check('远程命令顺序（串口+extended）', JSON.stringify(seq) === JSON.stringify([
  'console:set remotetimeout 20',
  'shell:echo before',
  'console:set remotebaud 115200',
  'console:target extended-remote /dev/ttyUSB0',
  'console:monitor reset',
  'shell:echo after',
]), seq);

const tcpRd = { ...defaultRemoteOptions(''), connType: 0, ip: '10.1.2.3', ipPort: '3333' };
check('TCP target remote', buildRemoteDebugCommands(tcpRd).slice(-1)[0].command === 'target remote tcp:10.1.2.3:3333', buildRemoteDebugCommands(tcpRd));
const udpRd = { ...defaultRemoteOptions(''), connType: 1, ip: '10.1.2.3', ipPort: '3333' };
check('UDP target remote', buildRemoteDebugCommands(udpRd).slice(-1)[0].command === 'target remote udp:10.1.2.3:3333', buildRemoteDebugCommands(udpRd));
check('无效配置 → 空序列', buildRemoteDebugCommands(defaultRemoteOptions('')).length === 0, true);

// ---- 6. user arguments 分词 ----
check('分词（引号感知）', JSON.stringify(splitCommandLineArgs('--nx --args "E:\\a b.exe" -x')) === JSON.stringify(['--nx', '--args', 'E:\\a b.exe', '-x']), splitCommandLineArgs('--nx --args "E:\\a b.exe" -x'));
check('分词（空串）', splitCommandLineArgs('').length === 0, true);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`调试器扩展配置 + 远程命令: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
