# 测试执行报告（0.8.137 · 滚动更新）

> 生成时间：2026-11-04 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 根因取证与逐项方案见 [release/0.8.137.md](../release/0.8.137.md)；上一版发布说明见 [release/0.8.136.md](../release/0.8.136.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **2/2** | 契约 44 项 + 文档一致性 6 项（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=175 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具，不参与自动回归） |
| L3 视觉 | `npm run test:visual` | **24/24** | 面板 CSS 变更后更新 `props-targets` 基线（dark/light）：旧基线正是"按钮竖排单字"的故障形态 |
| L1 端到端 | `npm run test:e2e` | **4/4** | 真实工具链（本机 GCC 8.1 / MinGW） |
| L4 性能 | `npm run test:perf` | **1/1（0 fail）** | 微基准与真实构建基准均未退化 |
| L5 打包 | `npm run test:pack` | **1/1** | VSIX 0.8.137 打包 / 安装冒烟通过 |
| 产物 | `npm run bundle` | 通过 | 1,833,246 B，无告警 |
| L2 宿主 | `npm run test:host` | 未执行 | 需 VS Code 宿主（`@vscode/test-electron`），按需在本机执行 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/浏览器验证 |
|--------|-----------|------------------|
| `.cbp` 外部修改检测（对齐 CB `CheckForExternallyModifiedProjects`） | `tests/test-external-changes.js` **35 断言**：change 事件、窗口焦点检查、原子保存（create 与"文件仍在的 delete"）、`ignore`（`Touch` 语义不重复弹）、`reload`、自身写盘不弹、XML 损坏保留旧模型、`off` 与手动命令 | 待真实环境补：外部编辑器改 `test-project/hello-cb.cbp` 后切回 VS Code 应弹「已在磁盘上被修改」 |
| 编译输出编码治理（逐行 UTF-8/GBK 判定） | `tests/test-encoding-lines.js` **25 断言**：混排编码、跨块多字节、BOM/GBK 读写、响应文件 ANSI、GBK `.cbp`、脚本输出、真实 GCC 中文路径 | 中文 Windows 下 GCC 报错（路径 GBK + 源码摘录 UTF-8）双向可读 |
| 工程属性面板可用性/布局 + 编译选项面板落盘 | `tests/test-project-properties-save.js` **10 断言**、`tests/test-compiler-options-apply.js` **23 断言**、`tests/test-webview-panels.js` **40 断言**、`tests/test-i18n-webview.js` **19 断言**（含中英两态内联脚本可编译） | Chromium 渲染 `dist` 真实面板：未切 tab 直接保存无 `pageerror`、520 px 窄面板按钮水平换行、英文界面可渲染可保存、目标改名/删除后 `remote_debugging` 同步 |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 110 | 109 | 99% |
| 视图 | 5 | 5 | **100%** |
| 设置项 | 83 | 83 | **100%** |
| 快捷键 | 33 | 33 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 剩余缺口 1 个命令：`codeblocks.detectCompilers`（已登记的可解释缺项：真实并行探测外部编译器，需交互环境）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | `codeblocks.detect.checkExternalChanges`（`prompt` / `auto` / `off`，默认 `prompt`）——已打开 `.cbp` 被其它程序修改后的处理方式（对齐 CB `environment/check_modified_files`） |
| 新增命令 | `codeblocks.reloadProject`（`Code::Blocks: 从磁盘重新加载工程`；工程树右键 / Menu → Project） |
| 行为变更 | 编译选项面板「应用」改为**立即写回 `.cbp`** 并重绑重解析后的工程/目标；只管理 `options_<id>.xml` 内的选项（手写自定义选项保留） |
| 行为变更 | 工程属性面板保存不再依赖"先切到各 tab"；收集/写盘异常在顶栏状态区可见（悬停看全文） |
| 新增单测 | `tests/test-external-changes.js`、`tests/test-encoding-lines.js`、`tests/test-compiler-options-apply.js`、`tests/test-project-properties-save.js`（共 93 断言） |
| 回归同步 | `tests/test-webview-panels.js`（+21）、`tests/test-i18n-webview.js`（+1）、`tests/_harness/vscodeMock.js`（`onDidReceiveMessage` thisArg 绑定、面板 `dispose()` 幂等）、`tests/test-settings-structure.js`（设置项 **83** / 配置分组 8）、`tests/visual/baselines/{dark,light}/props-targets.png`（面板布局基线刷新）、`docs/testing/coverage-matrix.md` 重新生成 |
| 行为边界 | 不改编译/链接流程与命令行生成；不写工作区 `.vscode/settings.json`；`.cbp` 读写保留原编码；外部修改检测只作用于已打开工程的 `.cbp` |
| 已知限制 | `Compile File (Without Project)` 走 VS Code 任务终端（固定 UTF-8），无法解码编译器 GBK 输出（见使用说明 §16） |

## 4. 缺陷与处置（本轮 review 发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | `doSave()` 收集未渲染 tab 的表单时抛 `TypeError` | 点击「保存」静默无反应 | 各 `collect*Form` 加元素存在性守卫 + `doSave` try/catch 写状态区 |
| 2 | 英文译文含撇号（`compiler's` / `CB's`）截断内联脚本字符串 | 英文界面整个面板脚本不执行（tab/按钮全失效） | 修正词条 + 新增「中英两态内联脚本必须可编译」守卫 |
| 3 | `.list-actions` 无换行、按钮无 `nowrap`、`.layout` 固定 240px | 窄面板中文按钮竖排单字、表单被挤成细条 | CSS：`nowrap` + `flex-wrap` + `minmax` + `<720px` 单列堆叠 |
| 4 | 编译选项面板「应用」只改内存模型 | 重开工程即丢，且内存/磁盘不一致 | 宿主回调 `persistProjectAndReload` 立即落盘并重绑 |
| 5 | 目标被删除后目标级 tab 作用域索引失效 | 保存抛错（整次保存失败） | 四个 collector 补 `if (!cur) return;`（调试器保留 search_path） |
| 6 | 应用时目标已被外部改名/删除会静默写工程级选项 | 选项作用域错位 | 宿主检测目标缺失即报错（不写盘、不改内存） |
| 7 | 目标改名/删除未同步 `remote_debugging` | 远程配置变孤儿节点 / 改名后配置丢失 | 改名同步 + 删除同步 |
| 8 | 编译选项应用「先改内存再写盘」 | 写盘失败后内存已污染，后续序列化会写入未落盘选项 | 失败不改内存，成功才改（有回调时用宿主返回的新对象） |
| 9 | 测试脚手架：`onDidReceiveMessage` 忽略 `thisArg`、面板 `dispose()` 不可重入 | 面板消息处理器 `this` 丢失、重复 dispose 栈溢出 | 修正 mock（幂等 dispose + thisArg 绑定） |

## 5. 待办与已知限制

- **真实环境手验**：外部编辑器改 `.cbp` 后切回 VS Code 应弹「已在磁盘上被修改」（`重新加载` / `全部重新加载` / `忽略`；关闭弹窗＝本轮不再打扰，下次获得焦点再问）。
- **手工验收**：面板相关交互见 [手工验收清单](./manual-acceptance.md) §4（含窄面板、英文界面、未切 tab 直接保存三条新增项）。
- **已记录不修**：`Compile File (Without Project)` 的终端编码限制（见使用说明 §16）；`codeblocks.detectCompilers` 的真实并行探测缺项。
