# Code::Blocks 对话框移植经验（Build options / Properties）

> 适用场景：继续对齐 Code::Blocks 的其它对话框（Compiler settings、Debugger settings、New project…）时复用本文的方法与结论。
> 事实来源是仓库根目录的 `codeblocks-src/`（Code::Blocks 25.03 源码的**只读快照，不修改、不提交**）；本文只记录「已验证过的事实 + 踩过的坑 + 下次怎么做」。
> 对齐矩阵见 [guide/alignment.md](../guide/alignment.md)，逐版改动见 [release/](../release/00-index.md)，缺陷处置见 [decisions.md](./decisions.md)。

## 1. 三条铁律

1. **源码是唯一事实来源**：XRC 决定布局（控件顺序、跨列、标题、可见性），`*dlg.cpp` 决定语义（启用条件、写入顺序、提示文案），`sdk/` 决定通用控件行为。永远不要凭记忆或截图猜 CB 的行为。
2. **语义差异逐条记录，不顺手「修 CB」**：CB 自身的数据丢失缺陷（下文 3.1 的 `use_console_runner`）只在心里记住「不复刻」，并写进发布说明。「有意差异」必须留下理由（见 §4），否则下一轮复核会把它当成 bug 改回去。
3. **每条结论都要有回归**：源码级断言（快）+ 真实 DOM 交互断言（准）+ 视觉基线（稳）。只写其中一层，下一轮必然回退。

## 2. CB 源码地图

| 主题 | CB 源码 | 关键函数 / 资源 | 本仓库实现 |
| --- | --- | --- | --- |
| Build options 布局 | `plugins/compilergcc/resources/compiler_options.xrc` | 6 个子页：Compiler settings / Linker settings / Search directories / Pre/post build steps / Custom variables / `"Make" commands` | [buildOptionsView.ts](../../src/ui/buildOptionsView.ts) |
| Build options 语义 | `plugins/compilergcc/compileroptionsdlg.cpp` | `OnTreeSelectionChange`、`DoTargetChange`、`DoBeforeTargetChange`、`OptionsToText`、`TextToOptions`、`OnCompilerChanged` | 同上 |
| Properties 布局 | `src/src/resources/project_options.xrc` | 4 个核心页 + 插件页 | [projectPropertiesPanel.ts](../../src/ui/projectPropertiesPanel.ts) |
| Properties 语义 | `src/src/projectoptionsdlg.cpp` | `OnProjectTypeChanged`、`ValidateTargetName`、`DoCheckScripts`、`OnCheckScripts`、`OnAdd/Copy/EditBuildTargetClick`、`DoTargetChange` | 同上 |
| 键值对话框 | `sdk/editpairdlg.cpp` | 键名正则、值浏览、含空格加引号询问 | `pairDialog()`（buildOptionsView） |
| 目标选择 + 运行参数 | `sdk/resources/select_target.xrc`、`sdk/selecttargetdlg.cpp` | `SetExecParameters` | [runTargetsPanel.ts](../../src/ui/runTargetsPanel.ts) |
| 文件属性 | `sdk/projectfileoptionsdlg.cpp` | 隐藏 `staticIncludedFiles*`、glob 行仅 `IsGlobValid()` 时显示 | `projectPropertiesPanel.ts` 文件属性模态 |
| 扩展名规则 | `sdk/filefilters.cpp` | Windows：`a` / `dll` / `exe` / `sys` | `applyTargetTypeRules()` |
| 通用输入框 | `sdk/globals.cpp` | `cbGetTextFromUser`、`wxFileName::SetExt/SetName` 语义 | `askText()`、`splitName/setExt/stripPrefix/addPrefix` |

查找方法（比逐行读文件快得多）：

```powershell
# 1) 先定位控件 id 与几何
Select-String -Path codeblocks-src/src/src/resources/project_options.xrc -Pattern 'chkAutoGenExt|txtOutput'
# 2) 再用控件 id 反查事件与联动
Select-String -Path codeblocks-src/src/src/projectoptionsdlg.cpp -Pattern 'chkAutoGenExt' -Context 3,8
# 3) 最后确认资源字符串（提示文案必须原文照抄）
Select-String -Path codeblocks-src/src/src/projectoptionsdlg.cpp -Pattern 'wxString::Format|_T\('
```

## 3. 已确认的 CB 语义（可直接复用，不必重查）

### 3.1 Build options

- **`additionalLibs` 是整串，不是按空格拆分**：`OptionsToText` 把已勾选 flag 的 `additionalLibs` **整串** `Insert(..., 0)` 进 `Other linker options`；`TextToOptions` 载入时按整串匹配反向勾选，并从文本中移除。当用户取消了勾选但文本里仍留着该串时，CB 弹 `Enable compiler flags?`（是＝保留文本，否＝移除）。
  - 实现：`syncAdditionalLibs()` + `absorbedLibSet()`；**不要**写进 Link libraries，也不要拆分。
- **`Linker executable` 只在目标作用域出现**：`OnTreeSelectionChange` 末尾 `Show(m_pTarget != nullptr)`，工程与全局作用域整行隐藏。
  - 实现：`renderLinker()` 里 `isProject() ? '' : …`。
- **切换编译器前先处理未保存改动**：`OnCompilerChanged` 先问「应用改动后再切换？」，取消则回滚下拉值；工程作用域再问「是否同步到所有目标」，最后提示需要完整重建；目标作用域直接提示重建。
  - 实现：`onCompilerPicked()`（dirty → `choiceBox`，工程作用域二次 `choiceBox`）。
- **构建脚本红字提示**：工程或任一目标存在构建脚本时显示 `lblBuildScriptsNote`（构建命令可能被脚本覆盖）。
  - 实现：宿主计算 `hasBuildScripts`，视图按 `DATA.hasBuildScripts` 显隐。
- **CB 25.03 的数据丢失缺陷（不复刻）**：`DoTargetChange` 会无条件 `SetUseConsoleRunner(...)`，切换目标会把非 Console 目标的开关写成 `false`。我们只在 Console 目标回填，其余保留原值。

### 3.2 Properties

- **类型切换无条件改写文件名**（`OnProjectTypeChanged`）：GUI/Console → `.exe`、Dynamic → `.dll` + `libExtension` + `.def`、Static → `libExtension` + `lib` 前缀、Native → `.sys`；非动态类型清空 Import/Definition。CB **不看**「自动生成前缀 / 扩展名」复选框，因此我们的实现也不加守卫。
  - 幂等性由生成器保证：`withPlatformExtension` 仅在**无扩展名**时补 `.exe`；`computeLibOutput` 仅在 `extensionAuto && ext !== libExtension` 时追加；前缀仅在缺失时补。因此显式写入不会产生双扩展名/双前缀。
  - 宏名（`$(...)`）同样按 `wxFileName` 语义在**末尾**追加扩展名，不做跳过。
- **Import / Definition 的“空”就是空**：`DoTargetChange` 直接 `SetValue(target->GetDynamicLibImportFilename())`，未设置时为空，**没有默认宏**。我们只在输入框上给灰色 `placeholder`（`$(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)`）提示，保存仍写用户实际输入，占位符不落盘。
- **`ValidateTargetName` 规则**：拒绝空名（视为取消）、与已有目标重名、与虚拟目标同名、含 `; , ! @ # $ % ^ & * " ' ~ = ? \ > <` 或反引号的名称。新增/复制/重命名都先 `cbGetTextFromUser`（复制默认 `Copy of <title>`，重命名预填当前名）。
- **新增目标默认值**（`AddBuildTarget`）：输出文件名 = 工程输出名、执行目录 `.`、对象输出 `.objs`、依赖输出 `.deps`、编译器随工程。
- **脚本校验文案**（`DoCheckScripts`）三行：`Invalid build script: <file>` / `First seen in: <scope>` / `Error:\n  <msg>`；全通过为 `All scripts seem to be valid!`。CB 遇错即停，我们一次列出全部问题并把多行结果保留换行（`.scr-status { white-space: pre-line }`）。
- **文件属性页省略两项**：`staticIncludedFiles*` 由 CB 自身隐藏；glob 行仅在 `pf->IsGlobValid()` 时出现，普通 `.cbp` 看不到。

### 3.3 通用控件

- **`EditPairDlg`**：键名需匹配 `^[[:alnum:]_]+$` 才启用「确定」；值可浏览目录；`QuoteString` 在值含空格时询问是否加引号。
- **`SetExecParameters`**：保存「程序参数」时把 `\n` 全部替换为空格 —— 否则 `.cbp` 会写出多行 `parameters`。
- **`useConsoleRunner` 默认 `true`**（读 `.cbp` 时缺省值不是 `false`），与 3.1 的丢失缺陷相关。

## 4. 有意保留的差异（改回去之前先读这节）

| 差异 | 原因 | 备注 |
| --- | --- | --- |
| 底部按钮 `保存 / 保存并关闭 / 还原设置`（CB 为 `OK / Cancel`） | VS Code WebView 面板没有「模态对话框」语义，独立面板需要「保存不关闭」 | 覆盖层已对齐为 `确定 / 取消` |
| 属性面板固定 6 页签 | CB 的插件页（如 Debugger）在扩展里合并为固定页签 | 页签名与 CB 保持一致 |
| Build options 两种入口共用同一视图 | 工程右键独立面板 + Properties 内覆盖层 | 数据源由 `extension.ts` 的 `buildOptionsDataFor()` 统一供给 |
| 未安装编译器：红字 + 禁用页面（CB 弹选择框） | WebView 内无法可靠阻塞等待宿主选择 | 红字文案沿用 CB |
| 不复刻 `use_console_runner` 丢失缺陷 | 数据安全优先 | 见 3.1 |
| 脚本校验一次列出全部问题（CB 遇错即停） | 一次跑完对用户更有用 | 三行文案与成功文案已对齐 |
| 占位符代替「空」 | WebView 输入框空着无法自解释 | 占位符不落盘，保存语义与 CB 一致 |

## 5. 实现踩坑（按代价排序）

1. **TS 模板字符串里写前端 JS**：WebView 页面由 `buildOptionsPage()` / `projectPropertiesPage()` / `runTargetsPage()` 返回的反引号模板拼出，内部 JS 的换行必须写 `\\n`、反斜杠写 `\\\\`、`${` 会被 TS 插值、注释里的反引号会截断模板（曾直接导致 TS 语法错误）。改完必跑 `test-webview-panels.js`（它会把内联脚本按中英两态真实编译一次）。
2. **WebView iframe 沙箱没有 `allow-modals`**：`window.prompt` / `window.confirm` 静默失效且不报错。统一改用面板内 `askText()` / `confirmBox()` / `choiceBox()`。
3. **`change` 里重建列表会吞掉下一次点击**：编辑字段后不失焦直接点另一个目标，`change → collectTargetForm → renderList` 的重渲染把第一次点击吃掉。原则：`change` 只更新草稿，**不要**重渲染列表。
4. **i18n 双表是严格校验**：`i18n.t()` 走 `strings.zh-cn.json`，`i18n.tr()` 走 `strings.zh-cn.webview.json`；新增/删除键必须两边同步（`test-i18n-*` 会报缺失与孤儿）。用脚本增删时**保持插入顺序、不要排序**，否则 diff 会膨胀到上千行。
5. **改写要幂等**：扩展名/前缀生成器都要「已有就不重复加」，否则类型来回切换会长出 `liblibfoo.a.a`。
6. **`placeholder` ≠ 默认值**：CB 显示空的地方，占位符只做提示；写默认宏会改变 `.cbp` 内容与 CB 的往返一致性。
7. **多行文本必须 `white-space: pre-line`**：`textContent` 里的 `\n` 在默认 CSS 下会被折叠成一行（脚本校验结果曾被挤成一行）。
8. **Windows 编码坑**：PowerShell 管道传中文给 `node -` 会乱码（用 `create` 写 UTF-8 脚本再 `node <file>`）；`Set-Content -Encoding UTF8` 会加 BOM（用 `[Text.UTF8Encoding]::new($false)` 写回）；`.gitignore` 里曾残留 GBK 乱码注释。
9. **视觉基线**：任何文案/间距/控件结构变化都要 `npm run visual:baseline` 重生成并**逐张目检**，否则基线会掩盖真实回退。
10. **测试脚本要自己造环境**：Playwright 交互测试直接加载 `dist/` + `tests/visual/fixtures/rich.cbp`，用 `tests/visual/themes.js` 的 `prepareHtml()` + `acquireVsCodeApi` shim（`window.__posted`）拦截消息。

## 6. 测试放哪一层

| 变更类型 | 应加的回归 | 现有例子 |
| --- | --- | --- |
| 规则/联动（启用状态、改写、校验函数） | 源码级断言（读文件内容 + 正则/结构断言） | `test-properties-enable-rules.js`（42）、`test-build-options-enable-rules.js`（32） |
| 真实交互（点击、切换、对话框、消息往返） | Playwright DOM 断言（在 unit 组内跑，约 +2s） | `test-properties-interactions.js`（24）、`test-build-options-interactions.js`（15） |
| 版式/文案/间距 | 视觉基线 + 目检 | `tests/visual/test-visual.js`（26 张，dark/light） |
| 宿主数据与保存协议 | 纯逻辑单测 | `test-project-properties-save.js`、`test-compiler-options-apply.js` |
| 文档与版本标记 | 契约层 | `test-contract.js`、`test-doc-consistency.js`、`gen-release-notes.js --check` |

断言写法约定：源码级断言报错信息里带上「CB 函数名」，让后来人知道为什么必须这样写（例：`CB TextToOptions: additionalLibs 必须整串匹配`）。

## 7. 对齐一个新对话框的清单

1. 在 `codeblocks-src/` 里找到 XRC 与 `*dlg.cpp`，确认这是**当前版本**的源码（不被 `codeblocks-src/` 里的构建产物误导）。
2. 抄控件清单：id、类型、标题、跨列/分组、默认值、可见性条件。
3. 找联动函数（`On*`、`Do*`、`Update*`），逐条记录：**启用条件、写入顺序、是否去重、是否整串、是否幂等**。
4. 确认「空」与「默认值」的差别（CB 有没有默认宏/默认布尔）。
5. 找提示文案原文（含标点），错误路径的文案也要抄（`DoCheckScripts` 这类多行文案尤其容易漏）。
6. 复用现有控件体系：`.bo-*` 样式、`askText` / `confirmBox` / `choiceBox`、`pairDialog`；新写一套视觉必然漂移。
7. 宿主侧补齐数据：`extension.ts` 的 `*DataFor()` / `*RuntimeFor()` 只传视图需要的字段，不在视图里读设置。
8. i18n：`i18n.t()` / `i18n.tr()` 两条表同步新增，保持插入顺序。
9. 写回归：源码级断言 + 至少一条真实交互断言。
10. `npm run visual:baseline` 重生成并逐张目检；确认 dark/light 都正常。
11. 跑 `npm test` → `test:contract` → `test:e2e` → `test:visual` → `test:pack`。
12. 更新文档：`docs/release/<ver>.md`、`pages/<tag>.md`（`--check`）、`CHANGELOG.md`、`docs/dev/progress.md`、必要时本文 §3/§4。

## 8. 反模式

- ❌ 在 WebView 里调用 `window.prompt/confirm/alert`（沙箱静默失效）。
- ❌ 用 `change` 事件重渲染列表（吞点击）。
- ❌ 视图里直接读 `workspace.getConfiguration()`（应由宿主传入，便于测试与即时生效）。
- ❌ 只改 `dist/` 不重新 `npm run bundle`（交互测试加载的是 `dist/`）。
- ❌ 在 `change`/`input` 里做 `.trim()` 并把结果写回输入框（打断中文输入与光标位置）。
- ❌ 把 CB 的缺陷当规范复刻（先判断是不是缺陷：会造成数据丢失/异常行为的一律不复刻，并记录在 §4）。

## 9. 相关文件

- 实现：[buildOptionsView.ts](../../src/ui/buildOptionsView.ts)、[buildOptionsPanel.ts](../../src/ui/buildOptionsPanel.ts)、[projectPropertiesPanel.ts](../../src/ui/projectPropertiesPanel.ts)、[runTargetsPanel.ts](../../src/ui/runTargetsPanel.ts)
- 宿主：[extension.ts](../../src/extension.ts)（`buildOptionsDataFor` / `buildOptionsRuntimeFor` / `openRunTargetsPanel`）
- 测试：[tests/test-properties-interactions.js](../../tests/test-properties-interactions.js)、[tests/test-build-options-interactions.js](../../tests/test-build-options-interactions.js)、[tests/test-properties-enable-rules.js](../../tests/test-properties-enable-rules.js)、[tests/test-build-options-enable-rules.js](../../tests/test-build-options-enable-rules.js)
- 对齐矩阵：[guide/alignment.md](../guide/alignment.md)｜版式与文案细节：[release/0.8.150.md](../release/0.8.150.md)、[release/0.8.151.md](../release/0.8.151.md)、[release/0.8.152.md](../release/0.8.152.md)
