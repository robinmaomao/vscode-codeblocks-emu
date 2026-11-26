# Originium IDE for Code::Blocks —— 开发进度快照

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
code --install-extension "originium-ide-0.10.0.vsix" --force

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

逐版本里程碑与发布说明见 [release/00-index.md](../release/00-index.md)，正式版汇总见 [CHANGELOG](../../CHANGELOG.md)。
当前版本 **0.10.0**（更名 Originium IDE for Code::Blocks + Agent 变更审计与一键撤销）。

## Agent 控制（0.9.0 起）

LM Tools ×11、内嵌 MCP server、`cb-cli` 三端共用 `src/api/*`；开关 `codeblocks.agent.enabled` / `readOnly` / `allowScripts`，未受信任工作区按关闭处理。
工具参考、工作流与排障见 [Agent 控制](../guide/agent-control.md)，架构与拆分见 [architecture.md](./architecture.md) §3.5。
