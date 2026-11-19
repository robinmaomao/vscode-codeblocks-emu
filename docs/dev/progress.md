# CodeBlocks Power by VS Code —— 开发进度快照

> 本文件用于**恢复开发进度**。改动大、需要中断时，更新此文件即可保证后续能快速续上。

## 一、总体进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| P0 工程属性编辑 | ✅ 完成 | 9 个 tab 的「工程属性」WebView 面板，可视化编辑并写回 .cbp |
| P1 新建工程向导 | ✅ 完成 | 4 模板生成 .cbp + 骨架源文件 |
| P1 构建目标可视化切换 | ✅ 完成 | 目标切换用状态栏 / 右键 / 工程属性面板；工程树按「公共顶层目录」展开（对齐 CB Manager 不含目标层级） |
| P2 工程间依赖 (.workspace) | ✅ 完成 | 解析 `<Depends>` 依赖 + DFS 拓扑排序自动决定编译顺序 |
| P3 文件级自定义命令 UI | ✅ 完成 | 文件属性面板编辑 + 工程树文件节点右键快捷入口 |
| P3 性能优化 | ✅ 完成 | 三大缓存（include 依赖 / 工程树懒加载 / XML 解析）+ LRU + 盘符归一化 |

## 二、P0 工程属性编辑（已完成）

面板 `src/ui/projectPropertiesPanel.ts`，命令 `codeblocks.projectProperties`（**6 个 tab**，对齐 CB `ProjectOptionsDlg`；顶部 `目标：` 选择器 + 底部 `保存 / 保存并关闭 / 还原设置`）：

1. **项目设置**：标题 / 平台 / 文件名（只读）/ Makefile 与执行目录 / PCH 策略 / 对象文件名生成 / 检查外部修改；左下「工程的依赖…」「工程的构建选项…」
2. **构建目标**：左栏目标列表 + 添加/重命名/复制/删除/↑↓ + 虚拟目标…/依赖…/重排…/构建选项…/从目标创建工程…；右栏「所选构建目标选项」+「构建目标文件」（切换勾选 / 全部选中 / 全部取消 / 选中文件属性）
3. **构建脚本**：`<Script file>` + **pre/post build 命令**（`<ExtraCommands><Add before/after>`）+ Squirrel 语法校验
4. **备注**：notes + show_notes（CDATA）
5. **C/C++ parser options**：`<code_completion><search_path add>` 读写
6. **调试器**：search_path + 每目标 `remote_debugging`（项目级默认 + 目标覆盖）

**Selected file properties…** 模态按 CB `ProjectFileOptionsDlg` 三页：General（只读工程/路径 + 行数·大小·时间戳 + 只读切换，统计与 `CountLines`/`AnalyseLine` 同口径）/ Build（编译、链接、归属目标、优先级权重滑块）/ Advanced（编译变量自由文本、对象文件名只读、按编译器保存的自定义构建命令、默认命令提示）。取消丢弃修改，确定才写回；自动生成文件的 Build / Advanced 禁用。统计与对象名逻辑在 `src/model/fileStats.ts`。

要点（0.8.137 起）：保存不要求"先切到各 tab"（收集函数按元素存在性跳过未渲染表单）；收集/写盘异常显示在顶栏状态区；
目标改名/删除会同步文件归属、虚拟目标与 `remote_debugging`。
0.8.151 追加：Properties / Build options 的灰显规则按 CB 源码逐条补齐；Build options 删除 CB 没有的 `Extensions` 页、项目自定义变量文本域、`Dist-clean`、`Silent build`；新增 `Set Programs' Arguments…`（CB `SelectTargetDlg`）对话框。

核心文件：`src/model/{types,parser,projectWriter}.ts`（模型 / 解析 / 序列化）、`src/ui/projectPropertiesPanel.ts`（面板）、
`src/extension.ts` 的 `saveProjectProperties` + `persistProjectAndReload`（写回并重解析刷新）。

## 三、P1 新建工程向导（已完成）

- `src/project/newProject.ts`：`PROJECT_TEMPLATES`（Console/Static/Shared/Empty 四模板）+ `createProjectFromTemplate(name, basePath, tpl)`
- 命令 `codeblocks.newProject`：QuickPick 模板 → InputBox 名称 → showOpenDialog 目录 → mkdir + 写 main.c + 写 .cbp → openProject
- 入口：项目树标题栏 `$(new-file)`、Menu 视图 File → New Project…

## 四、P1 构建目标可视化切换（已完成）

- 工程树按「公共顶层目录」展开（对齐 CB Manager：**不含目标层级**，文件只出现一次）；
- 目标切换入口：状态栏目标下拉、工程树/编辑器右键、命令 `codeblocks.selectProjectTarget`、
  工程属性面板「构建目标」页与顶部「快速切换到该目标」下拉；
- 选中目标持久化在 `workspaceState`（`codeblocks.selectedTargets`，按工程文件名记忆，支持虚拟目标）。

## 五、P2 / P3（已完成）

### P2 工程间依赖（.workspace）✅
- `WorkspaceParser` 解析 `<Depends>` 依赖 → DFS 拓扑排序（依赖先编译、环检测）；打开 `.workspace` 自动打开全部项目；reload 后恢复全部项目 + 依赖（`restorePersistedProjects`）。

### P3 文件级自定义命令 UI ✅
- 工程树文件节点右键「Edit Custom Build Command...」编辑 `<Option buildCommand>` 写回 `.cbp`；文件属性模态的 **Advanced** 页按编译器编辑（`<Option compiler= use= buildCommand=>` 映射），多行命令推荐在面板内改。

### P3 性能优化 ✅
- 大工程三项缓存：include 依赖缓存（buildEngine）、工程树懒加载（projectTreeProvider）、XML 解析缓存（parser）；缓存 key 盘符归一化 + LRU 容量上限（`src/tools/lru.ts`）。

## 六、构建 / 打包 / 安装命令

```powershell
# 编译（等价 npm run compile；Windows 用 npm.cmd）
npm.cmd run compile

# 打包 VSIX（等价 npx.cmd vsce package）
npm.cmd run package

# 安装（版本号以 package.json 为准）
code --install-extension "codeblocks-vscode-0.9.2.vsix" --force

# 全量回归测试
npm.cmd test
```

## 七、测试脚本（`tests/`，已加入 .vscodeignore 不打进 VSIX）

- 全量回归：`npm test`（= `node tests/run-all.js`）逐文件执行并汇总 `.cbtest.txt`；分层命令、覆盖范围与环境约束见 [测试方案](../testing/strategy.md)。
- `test-writer.js` 为需 `<cbp>` 参数的手工脚本（计入 `SKIP`）；批量模式 `node tests/test-writer.js --check` 自动发现探针工程，往返一致性由 `test-writer-automation.js` 纳入自动回归。
- 新增脚本遵循既有约定（命名自发现、`N pass, M fail` 摘要、退出码门控）；调试/审计临时脚本统一放 `.cb-tools/`（已 gitignore）。
- 改 WebView 面板后必跑三件套：`test-html-syntax.js` + `test-webview-panels.js` + `test-i18n-webview.js`。

## 八、关键踩坑记录（务必遵守）

1. **TS 模板字符串内嵌 JS 的转义**：在 `buildHtml()` 的反引号模板里写前端 JS 时，JS 里的 `'\n'` 必须写成 `'\\n'`（双重转义），否则 TS 会把它解释成真实换行导致前端 script 语法错误、面板空白。改 WebView 后必跑 `tests/test-webview-panels.js` 与 `tests/test-i18n-webview.js`（后者会编译中英两态的真实内联脚本——英文译文里的撇号曾截断字符串导致整段脚本失效）。
2. **`<{~None~}>`**：Code::Blocks 用该特殊值表示「文件不归属任何目标」，parser 已特判（buildTargets=[]）。
3. **`useConsoleRunner` 默认 true**（Code::Blocks 读取默认 true，非 false）。
4. **ResDirs 关系键**：`projectResourceIncludeDirsRelation`（不是 projectResIncludeDirsRelation）。
5. **`test-project/hello-cb.cbp`** 曾被面板保存测试写回为 type=0/3，已 `git checkout` 恢复（type=1）。测试脚本都写 tmp 文件，不写原文件。
6. **Code::Blocks 25.03 已无 priority 字段**（projectfile.h 只有 weight）。
7. **日志输出超 20KB 会写文件**，用 read_file 读取。

> **Code::Blocks 对话框移植专题**：Build options / Properties 的源码地图、已确认的 CB 语义（`additionalLibs` 整串、`Linker executable` 作用域、`OnProjectTypeChanged` 无条件改写、`ValidateTargetName`、`DoCheckScripts` 文案等）、有意保留差异、实现踩坑与对齐清单，见 [cb-porting-lessons.md](./cb-porting-lessons.md)。

## 九、版本历史

> 逐版本明细见 [`release/`](../release/)：正式版说明 + 最近两份 dev 说明；0.8.76–0.8.128 的逐版说明已合并归档到
> [`release/archive/0.8.76-0.8.99-dev.md`](../release/archive/0.8.76-0.8.99-dev.md) 与
> [`release/archive/0.8.100-0.8.128-dev.md`](../release/archive/0.8.100-0.8.128-dev.md)。
> 0.8.89 及以前的逐轮条目见 [`archive/progress-history-0.8.89.md`](../archive/progress-history-0.8.89.md)；正式版里程碑汇总见 [CHANGELOG](../../CHANGELOG.md)。

| 版本 | 主题 |
|------|------|
| [0.8.119](../release/0.8.119.md) | 0.8.12-dev → 0.8.119-dev 功能与文档汇入 main（正式版里程碑） |
| [0.8.127](../release/0.8.127.md) | 编译缓存、惰性命令生成、打包瘦身、构建性能批次 |
| [0.8.128](../release/0.8.128.md) | 汇编注释可配置 + 文档整理与 README 优化 |
| [0.8.129](../release/0.8.129.md) | 测试分层体系（七层 + CI）+ 20 个缺陷与 1 项能力缺口收口 |
| [0.8.130](../release/0.8.130.md) | post-build 脚本实时化/超时与杀树、并行上限 32、clangd 补全与配置治理 |
| [0.8.131](../release/0.8.131.md) | 工作区检测开销治理 + clangd 设置即时生效 + 设置即时生效收口 |
| [0.8.132](../release/0.8.132.md) | 中英文界面语言切换（i18n 运行时 + 静态贡献全量 nls + 运行时文案全覆盖） |
| [0.8.133](../release/0.8.133.md) | 构建日志补齐 Code::Blocks 产物体积行 |
| [0.8.134](../release/0.8.134.md) | 构建并发/CPU 守卫 + clangd 与 ccache 缺陷修复 |
| [0.8.135](../release/0.8.135.md) | 构建期进程/CPU 收口 + 产物排除写入用户设置 |
| [0.8.136](../release/0.8.136.md) | 工作区路径守卫 + AI 指令扫描治理 |
| [0.8.137](../release/0.8.137.md) | `.cbp` 外部修改检测 + 编译输出编码 + 工程属性面板修复 |
| [0.8.138](../release/0.8.138.md) | ccache 非 ASCII 路径修复（中文/特殊符号工程路径下缓存不生效） |
| [0.8.139](../release/0.8.139.md) | 8.3 短路径拼接修复（windres / Use83Paths）+ CI 回归与全量复核 |
| [0.8.140](../release/0.8.140.md) | 构建性能归因告警改为可选（`build.performanceAdvisor`，默认关闭） |
| [0.8.141](../release/0.8.141.md) | 打开工程后 clangd 不重启（不分析）修复 + 编译错误自动跳转修复 |
| [0.8.142](../release/0.8.142.md) | 链接期错误（undefined reference）定位与跳转修复 |
| [0.8.143-agent-control](../release/0.8.143-agent-control.md) | 分支预发布版：Agent 全控制（LM Tools + MCP + CLI）+ 总闸 / 只读开关（已随 0.9.0 合入 main） |
| [0.8.145](../release/0.8.145.md) | 工程内搜索（Project Search）：只搜索已打开 .cbp 工程，文件/内容双模式；UI 对齐 VS Code 内置搜索（字体/行高/codicon/Seti 文件图标、Aa/Ab/.* 输入框内选项），结果按工程分组并默认全展开，搜索后结果固定；搜索/Enter 即写历史且历史面板位于搜索框下方；清空历史走 VS Code 原生模态确认；修复视图 webview 类型、clangd 重启竞态（applyFix 重复注册）与 pre/post-build 同目录批处理解析 |
| [0.8.146](../release/0.8.146.md) | clangd `#ifdef` 关闭区域（inactive regions）不再变暗修复：`LanguageClient.restart()` 复用同客户端/Feature，`clear()` 只 dispose 装饰类型不清空字段 ⇒ 永不重建；改为在客户端停止/启动过渡时清空、Running 时重建并重放区域 |
| [0.8.147](../release/0.8.147.md) | 工程搜索体验：Text 结果排版对齐 VS Code 内置 Search（界面字体 / 22px 行高 / 行号右对齐定宽 / 预览 120 字符）、Files 模式补回 Search 按钮且四个控件同一行、切换 Explorer 后两种模式的搜索记录保持（Provider 回放缓存）、状态行按模式记忆、`Keep history` 开关对齐、Files 模式 `Aa`/`Ab`/`.*` 置灰 |
| [0.8.148](../release/0.8.148.md) | Build Log 诊断跳转修复：链接期段名伪路径（`src/main.c:(.text+0x9)`）不再误判「无改善」、`.o/.obj` 只作源码线索、无源码位置条目不再显示为可点击；统一清理 ANSI 颜色输出（`-fdiagnostics-color=always`） |
| [0.8.150](../release/0.8.150.md) | 工程右键 Build options… / Properties… 完整移植 Code::Blocks：共享 Build options 视图（Compiler / Linker / Search directories / Pre-post / Variables / Make）、Compiler Flags 右键菜单（新建/修改/删除/仅 C/仅 C++/展开折叠）+ 覆盖与自定义参数、Silent build 派生与 Dist-clean 只读、Selected compiler 自动匹配工程声明编译器 |
| [0.8.151](../release/0.8.151.md) | 工程属性 / 构建选项 UI 二次精修：按 CB `project_options.xrc` 重排（Project settings 单张 2 列网格、PCH Strategy radio box、目标文件列表回右栏、脚本页 1:2）；按钮统一复用 Build options `.bo-*`；工程右键菜单按 CB 排序 + 保存/关闭/移除文件/展开折叠命令；Expand All 修复（发布后 main 追加的对齐内容随 0.8.152 发布） |
| [0.8.152](../release/0.8.152.md) | 体验版：Build options / Properties 第二轮逐项对齐 Code::Blocks —— 启用联动规则、Build options 严格对齐（去 Extensions/自定义变量/Dist-clean/Silent）、additionalLibs 写入 Other linker options（整串 + 反向勾选 + 冲突询问）、工程级 Linker executable 隐藏、构建脚本红字、变量键值对话框、覆盖层 OK/Cancel、编译器切换三重询问、Set Programs' Arguments 换行归一、Selected file properties 三页重写与 customBuild 可用、类型切换改写扩展名/前缀（含宏名、不受自动勾选影响）、目标命名校验、列表点击修复、Import/Definition 占位符、脚本校验 CB 三行文案与换行、左对齐与文案/tooltip/红字分行/↑↓语义/双击入口 |
| [0.8.154](../release/0.8.154.md) | 功能/健壮性批次：Workspace 生命周期（Save Project As / Save·Close·Open default workspace）、`.workspace` 外部修改检测、无工程编译 GBK 编码、原子写、单元路径 XML 转义、package.json 调试属性 i18n、New Build Target/File、指令级步进/Examine Memory、Backtick Cache 管理器、Copy Strings、Profiler (gprof)、SymTab 跨库符号、Makefile CompileFile/DistClean |
| [0.8.155](../release/0.8.155.md) | P3 架构批次：WebView nonce CSP + 公共运行时（`src/ui/webview/common.ts`）、`.cbp` 未知节点/未知 Unit Option 透传、`detect.autoOpen=off` 跳过激活期全量扫描 + 激活耗时日志、compile/link 单节点增量刷新、`features/{toolCommands,workspaceCommands,newProjectCommands,debugCommands}.ts` 四批拆分、架构文档 |
| [0.8.156](../release/0.8.156.md) | Profiler 完整化（call graph、`gprof -A` 源码注解、CSV/HTML 导出）、AutoVersioning（`.cbp` 配置 + `version.h` 构建钩子 + 三个命令）、TCC/BCC/DMC/ARM/PowerPC 编译器资源、推荐扩展双语文档 |
| [0.8.157](../release/0.8.157.md) | AutoVersioning/Profiler 正确性（mtime 跳过、构建会话去重、do_auto_increment、SVN、旧 gmon 拒绝、`--separate-files` 回退）、编译器元数据加载与 CB 全量 XML、OpenWatcom/Cygwin/MSYS2/TDM/D/Fortran 探测 |
| [0.8.158](../release/0.8.158.md) | Profiler 命令编排从 `extension.ts` 拆到 `features/profilerCommands.ts`，依赖注入 + 回归守卫；无用户可见行为变化 |
| [0.8.159](../release/0.8.159.md) | 项目管理 QuickPick 从 `extension.ts` 拆到 `features/projectManager.ts`，依赖注入 + 回归守卫；无用户可见行为变化 |
| [0.8.160](../release/0.8.160.md) | 功能审计修复轮：新建工程覆盖保护、HeaderGuard 仅头文件、`#include` 系统头跳转、TODO 扫描器按语言识别注释、构建日志/调试门控本地化、工程名校验；`test:contract` 通过且无头脚本补断言（F-02/F-03 按决定不执行） |
| [0.9.0](../release/0.9.0.md) | 合入 Agent 控制面（LM Tools 11 + MCP provider + CLI）：构建内核下沉 `build/buildProject.ts` 由 UI/Agent 共用；`engines.vscode` → `^1.102.0`；设置 +2（第 10 分区 Agent） |
| [0.9.1](../release/0.9.1.md) | clangd 重启路径修复：合并器改单飞（不并发叠加）、跳过留痕、客户端未就绪时有限重试、跳过文案对齐 |
| [0.9.2](../release/0.9.2.md) | 合并后九轮复查：目标平台守卫与 `no-build`、构建不再被通知挂起、调试响应归一化 / 断点替换、编辑深拷贝、导出保护、CLI 退出码与 JSON、只读白名单补 debug |

> 当前版本 **0.9.2**（正式版；发布说明见 [release/0.9.2.md](../release/0.9.2.md)，上一版见 [release/0.9.1.md](../release/0.9.1.md)）；测试报告见 [test-report-0.9.2.md](../testing/test-report-0.9.2.md)；无头回归见 `npm test`（另有契约 / E2E / 视觉 / 性能 / 打包 / 宿主分层，见 [测试方案](../testing/strategy.md)）。

> **0.9.2 全量逐项审计 + 修复轮**：E0–E4 证据分级覆盖 136 命令 / 93 设置 / 6 视图 / 34 键位 / 6 语言语法 / 30 DAP / 13 WebView 面 + Agent 11 工具 / CLI / MCP；命令入口冒烟 112→120 并新增分区守卫；发现并修复 D-01…D-13（P3 ×4 / P4 ×9，无 P1/P2）。修复含 Agent 三端运行期校验、`run` 退出码传播、`export out` 限定工程目录、mock Task/terminals，以及 36 条命令与 6 个设置的行为断言；无头 233/0/1、契约 3/0。报告见 [functional-audit-0.9.2.md](../testing/functional-audit-0.9.2.md)（§12 修复记录）。

## 文档：GitHub Release 页面格式统一

- **背景**：Release 页面标题漂移成「`0.8.NNN — 中文主题 / English theme`」，正文也从 0.8.133 起逐步变成英文 / 中英混排，与 `0.8.127`–`0.8.131` 的发布页格式不一致。
- **统一后的格式**：标题 = **纯版本号**；正文 = `# Code::Blocks for VS Code <ver>` + `> 发布日期…｜ 正式版（上一版 → 本版 里程碑汇总）` + `## 概述`（要点 + 规模）+ 主题分节 + `## ✅ 验证` / `## ⚠️ 行为变化与升级提示` / `## 📦 安装` / `## 📬 完整变更`；链接一律绝对 URL。
- **落地**：新增 [`release/pages/`](../release/pages/)（发布页，文件名 = tag；当前 19 条）与生成器/守卫 `tests/contract/gen-release-notes.js`（`--check` / `--emit` / `--all`）；`docs/release/*.md` 的 H1 统一为 `# <ver>`，原副标题保留为 `> **主题**：…`；`0.8.136`–`0.8.141` 的发布日期行补齐「里程碑汇总」；历史 GitHub Release 已按新格式更新（`Latest` 仅最新一版），原正文已备份到 `.cb-tools/releases-backup.json`。
- **约定**：见 [release/00-index.md](../release/00-index.md#github-release-页面pages)（模板 + `gh` 发布步骤）与 [docs/README.md](../README.md) 维护约定。
- **回归**：`npm run test:contract` 全绿（文档一致性 D3/D4/D5 覆盖 `release/pages/**` 的命令、链接与版本标记）；`node tests/contract/gen-release-notes.js --check` 19/19 通过。

## Agent 全控制（feat/agent-control → 0.9.0）

目标：让 Copilot agent / 任意 MCP 客户端 / CI 完整控制工程，并可用设置**一键关闭**。

- **接入**：`engines.vscode` 抬到 `^1.102.0`；11 个 `contributes.languageModelTools`；
  `contributes.mcpServerDefinitionProviders`；随包 `bundle/cb-cli.js` 与 `bundle/cb-mcp.js`。
- **内核**：`src/api/*` 无顶层 vscode 依赖（i18n 惰性回退），承载工程读改、构建/清理、运行、导出、编译器、调试；
  构建内核 `src/build/buildProject.ts` 与 UI 同源（含 main 的链接期诊断定位 `resolveFile`）。
- **开关（本轮新增）**：
  - `codeblocks.agent.enabled`（默认 `true`）：关闭后 LM Tools 不注册、内嵌 MCP 不暴露，
    外部客户端直启的 `cb-mcp.js` 也拒绝调用（`disabled`）；**工作区未受信任一律按关闭处理**；切换即时生效。
  - `codeblocks.agent.readOnly`（默认 `false`）：只放行 `project_read` / `build_status` /
    `compiler list,info` / `workspace info,deps,list` / `debug state`，其余返回 `read-only`。
  - 策略集中在 `src/api/agentPolicy.ts`，由 `invokeTool()` 统一拦截（LM Tools 与 MCP 共用；CLI 不接入）。
  - 审计：每次工具调用向 Code::Blocks 输出通道写一行（工具名 / 结果 / 耗时）。
- **工具（11）**：`project_read` / `project_edit` / `project_file` / `project_target` / `build` / `build_status` /
  `run` / `debug` / `compiler` / `export` / `workspace`。
- **测试**：`test-api-project-edit`（含 query / preserve）/ `test-api-settings-reader` / `test-api-tool-guards` /
  `test-api-build-service` / `test-agent-policy`（开关与只读白名单）/ `test-ai-tools-contract` / `test-cli` /
  `test-mcp-server`（含关闭与只读门控）/ `test-e2e-cli-build`（E2E）/ `host/suite/agent.tests.js`（宿主，含开关切换）。
- **clangd 重载修复**：`withClangdBatch` 合并启动恢复/多选打开的 clangd 生成（不再按工程数重复）；
  `Project opened` 日志补 `Project file:` 便于区分同名工程；`src/tools/clangdRestart.ts`（`decideClangdRestart`）
  在**启动恢复期间仅配置变化**时跳过 `clangd.restart`（避免与 clangd 客户端初始化竞态导致的
  `applyFix already exists` / 连接失败弹窗），回归见 `test-clangd-restart-decision`（16 断言）。
- **文档**：`docs/guide/agent-control.md` / `.en.md`、`settings.md` / `.en.md`（第 10 分区 Agent）、
  README / usage / strategy / decisions / 发布说明同步。
