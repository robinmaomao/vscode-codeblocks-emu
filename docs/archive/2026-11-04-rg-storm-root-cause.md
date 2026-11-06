# `rg` 风暴根因分析与修复（0.8.136）

> 状态：**已定位 / 已修复 / 已验证**（0.8.136，2026-11-04）
> 一句话结论：**工作区路径里成对的 `[ ]` 被 VS Code 当成 glob**，AI 指令发现的搜索根因此从工程目录被截断到祖先目录，
> 之后每次文件变更都用 `rg --files`（无任何 `-g` 过滤）枚举整棵树 ⇒ `rg.exe` + `conhost.exe` 洪水、CPU 100%。

相关实现：[`src/build/workspacePathGuard.ts`](../../src/build/workspacePathGuard.ts) ｜ 发布说明：[`docs/release/0.8.136.md`](../release/0.8.136.md) ｜ 测试：[`docs/testing/test-report-0.8.142.md`](../testing/test-report-0.8.142.md)

---

## 1. 现象

同一份 `.cbp`：

| 路径 | 构建表现 |
|---|---|
| `E:\Work_Share\2026\10\[内部]5756C_lvd_reset\SDK_AB575X_S687_VDDCORE_TEST_20261030` | 任务管理器里 VS Code 一组多出上百个 `rg.exe` / `conhost.exe`，CPU 打满，构建墙钟翻倍 |
| `E:\Work_Share\VSCode Workstation\test_sdks\SDK_AB575X_S687_VDDCORE_TEST_20261030` | 正常 |

复现与工程内容无关：**往 `E:\Work_Share\2026\10` 下增删一批文件**（例如复制一份工程）即可触发；在 `E:\Work_Share\2026`、`E:\Work_Share\2026\11` 下同样的操作不触发。

---

## 2. 结论

根因不在 `.cbp`、编译器、Code::Blocks 扩展，也不在"父目录文件多"本身：

1. VS Code 的 AI 指令定位器（`PromptFilesLocator`）把 `.github/instructions`、`.claude/rules` 拼成**绝对路径**；
2. 它用 `Eao()` 按"路径段是否含 glob 元字符"把绝对路径拆成 `{ searchRoot, filePattern }`（判定函数 `xgn()`）；
3. 路径里出现 `[内部]5756C_lvd_reset` 这种**成对 `[ ]`** 的目录名时，**搜索根被截断到该段之前的祖先目录**（实测 `E:\Work_Share\2026\10`），其余部分变成 glob；
4. 因为 glob 在 JS 侧匹配（`shouldGlobMatchFilePattern`），ripgrep **拿不到任何 `-g`**，只能把祖先目录整棵列一遍；
5. 该搜索由**文件变更触发**，构建写几十个对象文件就叠出上百次全树枚举。

关键数字（同一窗口、同一时刻，只改写入位置）：

| 写入位置 | `rg` 唯一进程 | 并发峰值 |
|---|---:|---:|
| `E:\Work_Share\2026\10`（被放大的搜索根） | 19 | 9 |
| `E:\Work_Share\2026\10\test_sdks`（其子孙目录） | 6 | 6 |
| `E:\Work_Share\2026\test`（兄弟目录） | 0 | 0 |
| `E:\Work_Share\2026\11`（兄弟目录） | 0 | 0 |

修复前后（同一工作区，写 10 个文件）：

| 状态 | `rg` 唯一 | 峰值 |
|---|---:|---:|
| 修复前 | 16 | 10 |
| 关闭两处扫描后（用户级设置，**无需重载**） | **0** | **0** |

---

## 3. 机制

VS Code 1.144.1 `workbench.desktop.main.js`（`PromptFilesLocator`）：

```js
function xgn(seg) { /* * ? 任意命中；[ ] / { } 需成对；\ 转义 */ }

function Eao(type, uri) {
  if (type !== 'instructions' && type !== 'prompt') return { searchRoot: uri };
  const seg = uri.path.split('/');
  let t = 0;
  while (t < seg.length && xgn(seg[t]) === false) t++;   // 第一个含元字符的路径段
  if (t === seg.length) return { searchRoot: uri };       // 无元字符 → 整条路径就是搜索根（只 stat）
  return { searchRoot: uri.with({ path: seg.slice(0, t).join('/') }), filePattern: seg.slice(t).join('/') };
}
```

对坏路径 `<ws>/.github/instructions` 求值：

```text
location    = E:\Work_Share\2026\10\[内部]5756C_lvd_reset\SDK_...\.github\instructions
searchRoot  = E:\Work_Share\2026\10          ← 在第一个含 [ ] 的段之前截断
filePattern = [内部]5756C_lvd_reset/SDK_.../.github/instructions
```

推论（全部被实测验证）：

- 搜索根**不在工作区内** ⇒ `getWorkspaceFolder(searchRoot)` 为空 ⇒ 连 `excludePattern` 都没有，所以
  `files.watcherExclude` / `search.exclude` **一律无效**；
- 路径干净时 `Eao()` 返回整条 location、**没有 filePattern** ⇒ 调用方走 `fileStat` 分支，**根本不启动 rg**
  —— 这就是"换个路径就正常"的原因；
- 同理，`2026\10` 的兄弟目录不在这个搜索根内，写入不触发。

---

## 4. 证据

### 4.1 真实派发（扩展宿主内 hook `ChildProcess.prototype.spawn`）

一次 10 文件写入共抓到 36 次 `rg` 派发，全部一致：

```text
cwd  = e:\Work_Share\2026\10
argv = rg.exe --files --hidden --case-sensitive --no-require-git
       --glob-case-insensitive --ignore-file-case-insensitive
       --no-ignore-parent --follow --no-config          ← 没有任何 -g
caller = spawnRipgrep → async cmdTraversal (FileSearchEngine, extensionHostProcess.js)
```

### 4.2 请求内容（断点于 `FileSearchEngine.cmdTraversal`，25 s 采样）

```json
{ "folderQueries": [{ "folder": "e:\\Work_Share\\2026\\10" }],
  "type": 1, "shouldGlobMatchFilePattern": true, "ignoreGlobCase": true, "sortByScore": true,
  "filePattern": "[内部]5756C_lvd_reset/SDK_.../.github/instructions", "extraFileResources": [] }
```

12 次请求、只有两种模式，各 6 次：

| 次数 | `filePattern` |
|---:|---|
| 6 | `[内部]5756C_lvd_reset/SDK_.../.github/instructions` |
| 6 | `[内部]5756C_lvd_reset/SDK_.../.claude/rules` |

补充事实：

- 两个目标目录在工程里**都不存在** ⇒ 每次都必须扫完整棵树才能得出"没有"；
- 异步栈为 `doInternalFileSearch ← $provideFileSearchResults ← _receiveRequest`，即**工作台进程 → 扩展宿主的 RPC**，
  且走的是内置 ripgrep 句柄；
- 在 `_findFilesImpl`（`vscode.workspace.findFiles` 唯一入口）下断点，风暴期间**一次都没有命中**
  ⇒ 不是任何扩展在调用 `findFiles` API。

### 4.3 代码级对照（用 VS Code 自身的 `xgn` / `Eao` 跑真实路径）

| 场景 | `searchRoot` | `filePattern` | 是否启动 rg |
|---|---|---|---|
| 含 `[ ]`（现状） | `E:\Work_Share\2026\10` | `[内部].../.github/instructions` | **是** |
| 仅把父目录改名去掉 `[ ]` | 完整 `.github/instructions` 路径 | 无 | **否**（只 stat） |
| 无元字符的仓库窗口 | 完整 `.github/instructions` 路径 | 无 | **否**（与实测 0 次一致） |

### 4.4 触发方式

| 条件 | 观测 |
|---|---|
| 静置 30 s（无写入） | `rg` 唯一 0、峰值 0 |
| 写入 10 个文件 | 25 s 内 12 次搜索请求；`rg` 唯一 19、峰值 9 |

---

## 5. 修复（0.8.136）

### 5.1 扩展能力

| 项 | 内容 |
|---|---|
| 设置 | `codeblocks.workspace.pathGuard`：`off` / `prompt`（默认）/ `auto` |
| 命令 | `Code::Blocks: 检查工作区路径`（`codeblocks.checkWorkspacePath`，`off` 时也可用） |
| 检查 | 逐段判定 `[ ] { } * ?`（含未闭合/转义，与 `xgn()` 一致）；复刻 `Eao()` 算出**真实搜索根**，并统计其文件数（上限 5000，盘符根短路） |
| 报告 | 输出通道 + 通知：命中段、`searchRoot`、`filePattern`、影响、两条修复路径、恢复方法；按钮 `关闭这两处扫描` / `复制诊断` / `不再提示` |
| 修复动作 | 把 `chat.instructionsFilesLocations` 的 `.github/instructions`、`.claude/rules` 写为 `false`，经 `ConfigurationTarget.Global` **只写用户设置**（幂等、保留其它键、立即生效）；写入后回读有效值，检测工作区级覆盖 |
| 免打扰 | 每窗口每路径只提示一次；`不再提示` 记入 `globalState`；**两项已为 `false` 时自动流程不再提示**（重载/重开也安静），手动命令仍给报告 |
| 开销 | 路径分析 < 5 ms；`countFilesCapped('E:\Work_Share\2026\10')` ≈ 49 ms（2498 文件） |

### 5.2 用户侧两条修复路径

| 方案 | 做法 | 代价 |
|---|---|---|
| **改名（最彻底）** | 把命中目录改成不含 `[ ] { } * ?` 的名字，如 `[内部]xxx` → `内部_xxx` | 只改目录名；`.cbp` 用相对路径，构建/调试不受影响；指令发现功能保留 |
| **关闭两处扫描** | 设置里点「关闭这两处扫描」（或把 `pathGuard` 设为 `auto`） | 这两处的指令自动发现关闭（工程里本来没有这些目录），其它 AI 功能不受影响；改回 `true` 即恢复 |

### 5.3 边界与已知限制

- **不改**编译/链接/清理/调试流程，不改 `.cbp`，不动 `files.watcherExclude` / `search.exclude`，**不禁用** Copilot Chat；
- 写的是**用户级**设置，影响所有工作区（需求如此），恢复方法写在通知/输出/手册中；
- 若目标 VS Code 版本没有 `chat.instructionsFilesLocations` 键，写入不生效——此时"改名"是恒定有效的路径；
- `chat.instructionsFilesLocations: {}` **无效**：该设置以默认列表为基线，只有**显式 `false`** 才会剔除对应位置。

---

## 6. 验证记录

| 项 | 结果 |
|---|---|
| 单测 `tests/test-workspace-path-guard.js` | 44 断言全通过（元字符判定、搜索根截断含 UNC、文件计数上限与盘符根、设置合并幂等、"已关闭"判定、设置/命令注册） |
| `npm test` | TOTAL=171 FAIL=0 SKIP=1 |
| `npm run test:contract` | 2/2（契约 44 + 文档一致性 6） |
| `npm run compile` / `npm run bundle` | 无错误、无告警 |
| 真实环境（VS Code 1.144.1） | 用户级写入两项 `false` 后，向 `E:\Work_Share\2026\10` 写 10 个文件 ⇒ `rg` 唯一 0 / 峰值 0，无需重载 |

---

## 7. 已排除的假设与无效手段（避免重复排查）

| 假设 / 手段 | 结论 |
|---|---|
| 编译器 / Code::Blocks 扩展自身吃 CPU | 排除：全部扩展禁用后 `rg` 为 0；编译器每单元仅十几~几十 ms CPU |
| "父目录文件太多"是触发原因 | 排除：好路径的父目录 `test_sdks` 有 4221 个文件却为 0 次；`2026` 根目录（108454 文件）写入也不触发 |
| AI/Agent **会话根**被设成父目录 | 排除：扫描 351 个 `agentSessionData/*/session.db` 的 `workingDirectory`，**没有一个**指向 `2026\10` |
| Git 仓库发现（仓库根 = 父目录） | 排除：`2026`、`2026\10`、`test_sdks`、工程目录均无 `.git` |
| `files.watcherExclude` / `search.exclude` | **无效**：搜索请求不带任何 exclude 参数，且搜索根在工作区之外（实测写入已排除目录仍产生 23 个 `rg`） |
| 关闭 Chat 面板 | **无效**：只隐藏 UI，会话/索引仍在后台 |
| `localIndex` / `enableCodeSearch` / `codeSearchExternalIngest` 三项索引设置 | **不足以解决**：不覆盖这条指令目录探测 |
| `chat.instructionsFilesLocations: {}` | **无效**（空对象 = 保留全部默认位置），必须写显式 `false` |
| 把对象/产物移出工作区（原方案 C） | **不解决**：只减少触发次数，不改变枚举范围 |

---

## 8. 附录：取证方法（可复现）

1. **开启扩展宿主 inspector**：`node -e "process._debugProcess(<exthostPid>)"`，再用
   `netstat -ano -p tcp` 找到该 PID 新开的 LISTEN 端口，`fetch('http://127.0.0.1:<port>/json/list')` 取 WebSocket 地址。
2. **抓真实派发**：`Runtime.evaluate` 里 hook `process.getBuiltinModule('child_process').ChildProcess.prototype.spawn`，
   记录 `options.file / options.args / options.cwd / new Error().stack`。
   > 只改 `child_process.spawn` 抓不到——VS Code 走的是 `ChildProcess.prototype.spawn`。
3. **抓请求内容**：`Debugger.setBreakpointByUrl({ lineNumber: 182, columnNumber: 4407, urlRegex: 'extensionHostProcess\\.js' })`
   命中 `FileSearchEngine.cmdTraversal`，在首帧 `Debugger.evaluateOnCallFrame` 读 `this.config` 与 `paused.asyncStackTrace`。
4. **注意**：断点会暂停扩展宿主，取证后必须立即 `Debugger.resume` + `removeBreakpoint`，最后 `inspector.close()`；
   本次取证结束后已清理临时脚本与探针目录，工程源码与构建配置均未改动。
