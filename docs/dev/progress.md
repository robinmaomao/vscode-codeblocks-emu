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

面板 `src/ui/projectPropertiesPanel.ts`，命令 `codeblocks.projectProperties`（**9 个 tab**，左侧竖排导航 + 顶部项目标题栏）：

1. **构建目标**：增删改（标题/类型/输出文件/对象目录/编译器 ID/运行参数/依赖与附加输出/环境变量/高级项），add/copy/remove/上移下移
2. **虚拟目标**：alias + 物理目标多选（All = Debug;Release）
3. **文件**：compilerVar/compile/link/weight(0-100)/virtualFolder/自定义构建命令/目标归属多选
4. **构建选项**：编译选项/链接选项/链接库 + 目标级 **OptionsRelation 关系**（5 个下拉：仅父级/仅目标/前置/追加）
5. **搜索目录**：include/lib/resource 目录（项目级+目标级）
6. **构建脚本**：`<Script file>` + **pre/post build 命令**（`<ExtraCommands><Add before/after>`）
7. **项目设置**：标题/默认编译器/虚拟文件夹/自定义变量/环境变量/平台·PCH·扩展对象名/Makefile 模式
8. **备注**：notes + show_notes（CDATA）
9. **调试器**：search_path + 每目标 `remote_debugging`（项目级默认 + 目标覆盖）

要点（0.8.137 起）：保存不要求"先切到各 tab"（收集函数按元素存在性跳过未渲染表单）；收集/写盘异常显示在顶栏状态区；
目标改名/删除会同步文件归属、虚拟目标与 `remote_debugging`。

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
- 工程树文件节点右键「Edit Custom Build Command...」编辑 `<Option buildCommand>` 写回 `.cbp`（文件属性面板「文件」tab 也支持多行编辑）。

### P3 性能优化 ✅
- 大工程三项缓存：include 依赖缓存（buildEngine）、工程树懒加载（projectTreeProvider）、XML 解析缓存（parser）；缓存 key 盘符归一化 + LRU 容量上限（`src/tools/lru.ts`）。

## 六、构建 / 打包 / 安装命令

```powershell
# 编译（等价 npm run compile；Windows 用 npm.cmd）
npm.cmd run compile

# 打包 VSIX（等价 npx.cmd vsce package）
npm.cmd run package

# 安装（版本号以 package.json 为准）
code --install-extension "codeblocks-vscode-0.8.146.vsix" --force

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
| [0.8.145](../release/0.8.145.md) | 工程内搜索（Project Search）：只搜索已打开 .cbp 工程，文件/内容双模式；UI 对齐 VS Code 内置搜索（字体/行高/codicon/Seti 文件图标、Aa/Ab/.* 输入框内选项），结果按工程分组并默认全展开，搜索后结果固定；搜索/Enter 即写历史且历史面板位于搜索框下方；清空历史走 VS Code 原生模态确认；修复视图 webview 类型、clangd 重启竞态（applyFix 重复注册）与 pre/post-build 同目录批处理解析 |
| [0.8.146](../release/0.8.146.md) | clangd `#ifdef` 关闭区域（inactive regions）不再变暗修复：`LanguageClient.restart()` 复用同客户端/Feature，`clear()` 只 dispose 装饰类型不清空字段 ⇒ 永不重建；改为在客户端停止/启动过渡时清空、Running 时重建并重放区域 |

> 当前版本 **0.8.146**（修复版；发布说明见 [release/0.8.146.md](../release/0.8.146.md)，上一版见 [release/0.8.145.md](../release/0.8.145.md)）；测试报告见 [test-report-0.8.146.md](../testing/test-report-0.8.146.md)；无头回归见 `npm test`（`TOTAL=188 FAIL=0 SKIP=1`，另有契约 / E2E / 视觉 / 性能 / 打包 / 宿主分层，见 [测试方案](../testing/strategy.md)）。

## 文档：GitHub Release 页面格式统一

- **背景**：Release 页面标题漂移成「`0.8.NNN — 中文主题 / English theme`」，正文也从 0.8.133 起逐步变成英文 / 中英混排，与 `0.8.127`–`0.8.131` 的发布页格式不一致。
- **统一后的格式**：标题 = **纯版本号**；正文 = `# Code::Blocks for VS Code <ver>` + `> 发布日期…｜ 正式版（上一版 → 本版 里程碑汇总）` + `## 概述`（要点 + 规模）+ 主题分节 + `## ✅ 验证` / `## ⚠️ 行为变化与升级提示` / `## 📦 安装` / `## 📬 完整变更`；链接一律绝对 URL。
- **落地**：新增 [`release/pages/`](../release/pages/)（12 条发布页，文件名 = tag）与生成器/守卫 `tests/contract/gen-release-notes.js`（`--check` / `--emit` / `--all`）；`docs/release/*.md` 的 H1 统一为 `# <ver>`，原副标题保留为 `> **主题**：…`；`0.8.136`–`0.8.141` 的发布日期行补齐「里程碑汇总」；12 条 GitHub Release 已按新格式更新（`Latest` 仅 0.8.141），原正文已备份到 `.cb-tools/releases-backup.json`。
- **约定**：见 [release/00-index.md](../release/00-index.md#github-release-页面pages)（模板 + `gh` 发布步骤）与 [docs/README.md](../README.md) 维护约定。
- **回归**：`npm run test:contract` 全绿（文档一致性 D3/D4/D5 覆盖 `release/pages/**` 的命令、链接与版本标记）；`node tests/contract/gen-release-notes.js --check` 12/12 通过。
