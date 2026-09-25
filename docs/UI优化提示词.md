# 提示词：Code::Blocks 功能驱动的 VS Code 扩展 UI 优化

> ⚠️ **历史存档**：本提示词为早期 UI 优化阶段编写（其中「现有命令/视图/文件数」等盘点已过时）。扩展定位约束（原生移植、功能与 Code::Blocks 对齐）延续至今，当前功能现状见 [使用说明](./使用说明.md) 与 [与 Code::Blocks 对齐对照](./对齐对照.md)。

> 本提示词基于已实现的 `codeblocks-vscode` 扩展（`src/` 17 个 TS 文件，已通过 `tsc` 编译并打包 `.vsix`）编写，类名/文件/命令 ID 均为真实存在的符号，可直接投喂给 AI。

## 核心定位约束（务必遵守，沿用既有原则）

> **不是「`.cbp → tasks.json/launch.json` 桥接」**，而是把 Code::Blocks 的功能内核
> **原生移植**进 VS Code 扩展：扩展自身就是一个「迷你 IDE 内核」，直接承载项目模型、
> 构建引擎、编译器管理与调试引擎，像 Code::Blocks 的 `compilergcc`/`debuggergdb` 插件一样工作。

本次 UI 优化的本质，是把这个「迷你 IDE 内核」的**交互面**补齐：让用户在 VS Code 里获得
与 Code::Blocks 相近的操作体验（菜单栏、项目自动加载、构建前自动保存），而不是退回
到「命令面板里手动找命令」的尴尬状态。

---

```markdown
你是一名精通 Code::Blocks 源码架构（C++/wxWidgets）、VS Code 扩展开发
（TypeScript + VS Code Extension API + TreeDataProvider + Webview + Debug Adapter Protocol）
的资深工程师。

当前工作区已有一个可运行的原生移植扩展 `codeblocks-vscode`（TypeScript），
其功能内核（项目模型、构建引擎、编译器管理、调试引擎）已经实现并通过编译。
请基于以下「现状盘点」与「目标任务」，完成扩展 UI 层的优化设计与实现提示。

## 一、现状盘点（已测绘，直接使用，勿臆造）

### 1. 现有命令（src/extension.ts 中已注册，共 12 个）
- codeblocks.openProject       打开项目（.cbp/.workspace）
- codeblocks.build             增量编译（构建当前目标）
- codeblocks.rebuild           全量编译（重新构建）
- codeblocks.buildAndRun       构建并运行（F9）
- codeblocks.run               运行
- codeblocks.clean             清理
- codeblocks.debug             调试（F8，内联 DAP + GDB MI）
- codeblocks.selectTarget      选择构建目标
- codeblocks.detectCompilers   探测编译器
- codeblocks.compilerOptions   编译选项面板（Webview）
- codeblocks.codeStats         代码统计
- codeblocks.todoList          TODO 列表
- codeblocks.format            AStyle 格式化

### 2. 现有 UI 贡献（package.json 的 contributes）
- viewsContainers：activitybar 上有 `codeblocks` 图标容器
- views：容器内两个视图 `codeblocks.projectTree`（项目树）、`codeblocks.buildLog`（构建日志）
- keybindings：F9/Ctrl+F9/Ctrl+F10/Ctrl+F11/Ctrl+Shift+F9/F8 已对齐 Code::Blocks
- debuggers：type `codeblocks`（内联 DAP）

### 3. 现有 UI 实现文件
- src/ui/projectTreeProvider.ts   项目树（TreeDataProvider，展示 项目→目标/文件 层级）
- src/ui/compilerOptionsPanel.ts  编译选项 Webview（按 Category 分组 checkbox）

### 4. 现有交互缺口（本次要补的）
- 没有「菜单栏」：所有功能只能通过命令面板（Ctrl+Shift+P）触发，操作入口分散、不可见
- .cbp 自动加载逻辑简陋：src/extension.ts 末尾的 activate() 只在「恰好 1 个 .cbp」时
  才 openProject；多个 .cbp 不弹选择、工作区后续变化不监听、无 .cbp 时无引导
- 构建前不会自动保存当前编辑器中的未保存文件（Code::Blocks 默认会在构建前保存）

## 二、目标任务

### 任务 1：扩展页面新增「菜单栏」
在 `codeblocks` 视图容器内提供一处类 Code::Blocks 的常驻菜单栏（操作入口），
至少包含：打开项目、编译器选项、增量编译、全量编译、运行、调试、清理。

实现方式（按优先级，任选其一或组合）：
- 【推荐】使用 `contributes.menus` 的 `view/title` 为 `codeblocks.projectTree` 视图标题栏
  添加内联图标按钮（`"group": "navigation"`），按钮映射到上述命令；
- 在 `codeblocks` 视图容器内新增一个 `welcome`（viewsWelcome / Webview）作为「主页」，
  主页顶部渲染一排菜单按钮，未打开项目时显示「打开项目」主 CTA；
- 可选：通过 `menus.commandPalette` 调整命令在命令面板的可见性，避免与按钮重复；
- 可选：为「增量编译/全量编译」补充 `codeblocks.build`（增量）与 `codeblocks.rebuild`（全量）
  的中文标题区分，并在按钮 tooltip/图标上体现差异（参考 compiler_toolbar.xrc 的 Build/Rebuild）。

要求：
- 图标使用 `resources/codeblocks.svg` 或 VS Code 内置 `$(...)` codicon，保持与主题一致；
- 按钮在「未打开项目」状态下应禁用或给出友好提示（当前命令内部已用 requireProject() 兜底）。

### 任务 2：工作区自动检测 .cbp 并打开
完善 src/extension.ts 的自动加载逻辑，达到 Code::Blocks 的「打开工作区即加载项目」体验：
- 保留现有 `findCbpFiles()`，但把「恰好 1 个才打开」升级为：
  - 0 个：不报错，在视图内显示欢迎引导（配合任务 1 的主页 CTA）；
  - 1 个：自动 `openProject()`；
  - 多个：弹出 `vscode.window.showQuickPick` 让用户选择要打开的项目；
- 监听 `vscode.workspace.onDidChangeWorkspaceFolders`，工作区文件夹增删后重新检测；
- 可选：用 `vscode.workspace.createFileSystemWatcher('**/*.cbp')` 监听 .cbp 的新增/删除，
  触发重新检测或更新项目树；
- 打开项目后，把当前项目路径写入配置（如 `codeblocks.activeProject`）以便重启后恢复。

### 任务 3：编译时自动保存当前工作区文件
在触发编译/构建前自动保存未保存的文件（对齐 Code::Blocks 的
「Save all files before build」默认行为）：
- 在 `build()`、`buildAndRun`、`clean()`（以及 `debug()` 可选）执行前调用
  `vscode.workspace.saveAll(false)`（仅保存工作区中 dirty 的文档）；
- 注意：`saveAll(includeUntitled)` 的 `includeUntitled` 应为 false，避免对无标题缓冲区
  弹出保存对话框阻塞构建；
- 若项目文件（.cbp）本身在编辑器中是 dirty 状态，也应在重新解析前保存；
- 提供一个配置项 `codeblocks.saveBeforeBuild`（默认 true）让用户可关闭该行为。

## 三、UI 优化建议（额外加分项，按价值排序）

1. **构建日志视图集成**：把 `outputChannel` 的内容同步到 `codeblocks.buildLog` 视图
   （改用 TreeDataProvider 或 LogOutputChannel + `show()`），让错误/警告可点击跳转到源码行。
2. **项目树增强**：
   - 目标节点、文件节点补充 `contextValue`，通过 `view/item/context` 右键菜单提供
     「编译该文件 / 从目标移除 / 设为活动目标」等上下文操作；
   - 文件图标按扩展名区分（.c/.cpp/.h/.rc），目标节点标注活动目标（▶/●）。
3. **状态栏指示器**：用 `window.createStatusBarItem` 显示「当前项目 + 当前目标 + 当前编译器」，
   点击可快速切换目标/编译器。
4. **构建进度条**：构建期间用 `window.withProgress` 展示进度，避免用户以为卡死。
5. **错误列表（Problems 面板）**：确保 onDiagnostic 把每个编译错误的 source 指向具体文件
   Uri（当前实现写成了 `Uri.file(project.basePath)`，应改为 `Uri.file(该错误文件绝对路径)`），
   使 VS Code 的 Problems 面板与 Code::Blocks 的 Build messages 一样可点跳。
6. **主题一致性**：Webview 全面使用 VS Code CSS 变量（`--vscode-*`），支持浅色/深色主题。

## 四、验收标准

- [ ] `codeblocks` 视图容器内有可见的菜单栏/标题栏按钮，可一键触发打开项目、增量编译、
      全量编译、运行、调试、清理，未打开项目时按钮状态合理；
- [ ] 打开工作区后，.cbp 被自动检测：单个自动打开、多个弹选择、零个显示引导；
      工作区增删文件夹后能重新检测；
- [ ] 触发构建/运行/清理前，当前未保存文件被自动保存（且可配置开关）；
- [ ] 全部改动通过 `npx.cmd tsc -p ./` 编译（0 错误）；
- [ ] 重新打包 `.vsix`（`npx.cmd vsce package`）并安装验证。
```

---

## 附：可直接复用的现有符号速查

| 用途 | 符号 / 位置 |
|------|------------|
| 打开项目 | `openProject(path)`（extension.ts） |
| 增量/全量编译 | `build(false)` / `build(true)`（返回 `Promise<boolean>`） |
| 项目树刷新 | `projectTreeProvider.setProject(project)` |
| .cbp 扫描 | `findCbpFiles(folders)`（extension.ts） |
| 编译器选项面板 | `CompilerOptionsPanel.show(compiler, project, target, extensionUri)` |
| 配置读取 | `vscode.workspace.getConfiguration('codeblocks')` |
| 视图 ID | `codeblocks.projectTree` / `codeblocks.buildLog` |

> 实现时优先复用上述既有函数，避免重复造轮子；新增命令/菜单/配置项需同步更新
> `package.json` 的 `contributes` 与 `activationEvents`。
