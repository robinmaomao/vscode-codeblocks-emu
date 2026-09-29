# 链接输入 .xm 增量编译「重新编译」现象分析报告

> 日期：2026-09-29 ｜ 触发版本：0.8.108-dev ｜ 状态：**分析完毕，待用户确认实施项**

## 1. 现象描述

开启 `codeblocks.build.linkInputExtensions`（默认 `["xm"]`）后，修改工程内 `.xm` 文件再增量编译，
用户观察到「工作区文件重新编译」。本文核查该现象的真实机制。

## 2. 结论（先给结论）

**修改 `.xm` 后增量编译，扩展不会重编译任何 C/C++ 源文件**（探针实证 + 代码链路双证）。
真正发生的是以下之一或叠加，全部为**重链接/重打包**或 **CB 一致性行为**：

| 场景 | 实际行为 | CB 对照 |
|---|---|---|
| `.xm` 默认不编译（无 `<Option compile>`） | touch 后仅强制**重链接**（日志 `链接输入 "app.xm" 有更新，重新链接` + `Linking`） | 扩展保护性增强（CB 对 .xm 无此识别） |
| `.xm` `compile="1"` 无命令 | **每次**构建都强制重链接（日志 `含 1 个过期且无可执行命令的编译文件…强制链接`）——与是否 touch 无关 | CB 条目计数强制（directcommands.cpp:585），一致 |
| `.xm` `compile="1"` + 真实自定义命令 | **每次**构建执行该自定义命令，日志显示 `[Compiled] app.xm`、`编译完成 1 个文件` → **看起来像重新编译** | CB 同：对象永不产生 → IsObjectOutdated 恒真 → 每次执行命令（directcommands.cpp:558/1164-1169） |
| 工作区多工程（lib + app 依赖） | touch lib 的 .xm → lib 重打包 → app 因外部依赖更新**重链接**（级联） | CB 外部依赖新鲜度链路，一致 |

## 3. 代码链路证据（src/build/buildEngine.ts）

- `linkInputsOutdated()`（:1515）只做一件事：白名单扩展名文件 mtime 比输出新 → 返回文件路径。
- 三处调用全部只设 `forceLink` / `forceArchive`，**不触碰编译循环**：
  - :899 早退分支（`linkInputForce` 仅阻止 `Nothing to be done` 提前返回）；
  - :1003 链接块（`newerLinkInput → forceLink = true`）；
  - :1111 静态库块（`forceArchive = true`）。
- 编译决策独立：`isUpToDate()`（:1310）只比较 **源文件 + #include 头文件 mtime vs 对象 mtime**；
  `.xm` 修改不影响任何源文件判定。
- 场景 2/3 的「每次构建」行为来源：`.xm` 的预期对象 `<对象目录>/appxm.o` 永不产生 →
  `isUpToDate` 恒假 → 计入 `staleNoopFiles`（无命令）或进入编译单元（自定义命令）→ `totalUnits>0` 条目计数强制链接（:1018，对齐 directcommands.cpp:585）。

## 4. 探针实证（.cb-tools/xm-recompile-probe.js / xm-workspace-probe.js）

单工程 4 配置 × 4 轮（build#1 → #2 无修改 → #3 touch .xm → #4 touch main.c），真实 gcc：

| 配置 | #2 无修改 | #3 touch .xm | #4 touch main.c |
|---|---|---|---|
| A compile=1 无命令 | 零编译，强制重链 | 零编译，重链 | 仅 main.c 重编 |
| B compile=1 + no-op 命令（efuse 风格） | 零编译，强制重链 | 零编译，重链 | 仅 main.c 重编 |
| C compile=1 + 真实命令 | 仅执行 app.xm 命令（`[Compiled] app.xm`），重链 | 同左 | 执行 app.xm 命令 + 仅 main.c 重编 |
| D 默认不编译 | Nothing to be done | 仅重链（`重新链接`） | 仅 main.c 重编 |

场景 C build#1 全量日志（关键证据）：
```
cmd /c echo gen-xm                 ← .xm 自定义命令执行（每次构建）
[Compiled] 1-3 app.xm (0.1s)      ← 该条目计入「编译完成 N 个文件」与条目计数强制链接
gcc -c main.c → [Compiled] 2-3
gcc -c util.c → [Compiled] 3-3
编译完成 3 个文件 (0.5s)
Linking console executable
```

工作区（dep-lib 静态库 + dep-app 可执行，app 经 external_deps 依赖 lib）：
- #2 无修改：lib/app 均 `Nothing to be done`；
- #3 touch lib.xm：lib `重新打包`（Linking static library）→ app 因 libdep-lib.a 更新而重链接；
- **全程零源文件重编译**（main.o 等对象 mtime 不变，仅输出文件时间更新）。

## 5. CB 源码对照（codeblocks-src）

- `GetTargetCompileCommands`（directcommands.cpp:536-588）：
  - :558 `if (force || IsObjectOutdated(target, pfd, &err))` → 才产出编译条目；
  - :585 `GetLinkCommands(target, ret.GetCount() != counter)` → 编译阶段任何条目即强制链接；
  - :576-578 else 分支：源缺失 `!err.IsEmpty()` 也计入 WARNING 条目（扩展 missingSourceFiles 对齐）。
- `IsObjectOutdated`（:1164-1200）：对象缺失 → 过期；源/头新于对象 → 过期；否则最新。
  → `.xm` 自定义命令的对象永不产生 → **CB 每次构建都执行该命令**。
- `GetCompileFileCommand`（:348-364）：空白命令 → `Skipping file (no compiler program set)` 条目；
  真实命令 → clogSimple 日志 `Compiling: app.xm` 并执行。→ **CB 同样每次都打 "Compiling: app.xm"**。

## 6. 「看到重新编译」的可能来源（按可能性排序）

1. **场景 3 的 `[Compiled] app.xm` + `编译完成 1 个文件`**：`.xm` 带真实自定义命令时，该命令每次构建执行
   （CB 一致），日志用词是「编译」→ 最像「文件被重新编译」。
2. **场景 2 的强制链接日志文案**：`目标 "Debug" 含 1 个过期且无可执行命令的编译文件（app.xm），强制链接`
   每轮都打印，含「编译文件」字样，易误读。
3. **工作区级联重链接**：lib 重打包 → 依赖工程 `Linking` 行接连出现。
4. 对象文件缺失/被 Clean（与 .xm 无关）→ 才会真正全量重编译。

## 7. 待确认实施项

| 编号 | 内容 | 风险 |
|---|---|---|
| **P1a** | 场景 2 文案改为「过期且无可执行命令的**构建条目**」并注明「不重编译、仅强制链接」 | 低（纯日志） |
| **P1b** | 场景 3 自定义命令条目标记与普通编译区分（如 `[Executed]` 而非 `[Compiled]`，`编译完成 N 个文件` 排除自定义命令） | 低（纯日志；注：CB 日志仍写 "Compiling:"，此为扩展自有前缀优化） |
| **P1c** | touch 场景双日志（`链接输入有更新` + `条目计数强制`）合并为一条 | 低 |
| **P2** | 文档补充（使用说明 Link Input Extensions 段 + FAQ）：`.xm` compile=1 时每次构建必重链接/自定义命令每次执行（CB 一致） | 无 |
| **P3** | 若确观察到**源文件**重编译（非以上来源），请提供 Build Log 片段复现，定向分析 | — |

请回复确认：**P1a/P1b/P1c/P2 勾选 + P3 是否提供日志**；或「全部不实施」（维持现状，行为与 CB 一致）。

---

# 附：真实工程定位（app.cbp / xcfg.xm，2026-09-29 用户提供 .cbp + 构建日志）

## 现象

修改 `Output/bin/xcfg.xm` 后增量构建，241 个源文件全部重新编译（84.1s）。

## 真实机制（已定位，与 Link Input Extensions 设置无关）

```
修改 xcfg.xm
  → 每次构建都执行的项目 pre-build（CB bsProjectPreBuild，compilergcc.cpp:2375-2380/:2511；扩展 build() 开头同款）
  → prebuild.bat → riscv32-elf-xmaker -b xcfg.xm
  → 日志证据："make hfile xcfg.h successful" / "copy file ../../xcfg.h successful"
  → 工程根 xcfg.h 被重写（mtime 更新；该文件在工程 Unit 列表且几乎全部源文件直接/间接 #include）
  → 编译循环 isUpToDate（buildEngine.ts:1310）→ depsNewestMtime 递归扫描 #include 链
  → xcfg.h 比 241 个对象文件新 → 全部依赖它的源文件重编译
```

这是**正确构建语义，CB 行为一致**：CB `IsObjectOutdated`（directcommands.cpp:1181-1196）同样「源文件或任一被包含头文件比对象新 → 重编译」（1184-1196 `depsScanForHeaders` + `timeNewest > timeObj`）。

**Link Input Extensions 设置与重编译无关**：它只设 `forceLink`（重链接），不参与编译判定。xcfg.xm 因 `compile="1"` + 空白自定义命令（`buildCommand=" "`）走 CB 条目计数 → 每次构建强制重链接（日志 `含…无可执行命令的编译文件（xcfg.xm），强制链接（对齐 CB 条目计数）`），该行同样与重编译无关。

## 探针复现（.cb-tools/xcfg-probe.js，用户五种 xm 配置原样）

- 3 个空白命令 xm（res/download/xcfg）均计入条目计数强制 → 探针日志列 3 个（用户日志列 1 个，属环境差异：其余两个可能被其它分支计入或对象残留，**不影响重编译结论**）；
- 模拟 prebuild 重写 xcfg.h → 下一轮 `main.c/util.c` 全部重编译 → **头文件再生链复现成立**。

## 修复选项（请确认）

| 编号 | 内容 | 评价 |
|---|---|---|
| **A 不修（推荐）** | 行为与 CB 一致；xcfg.xm 是全局配置头的生成源，改了本就该全量重编 | 零风险 |
| **B 工程侧** | 改 prebuild 脚本：xmaker 在内容不变时**不覆盖** xcfg.h（res.xm 分支已有 "has no change" 检查，xcfg 分支没有——日志可见）→ 未改内容时 mtime 不变 → 不触发重编 | 根治，但属工程侧脚本，扩展不改代码；可提供脚本写法建议 |
| **C 扩展设置** | 开启 `codeblocks.build.skipIncludeDeps: true`（对齐 CB `/skip_include_deps`，directcommands.cpp:1185）→ 任何头文件修改都不触发重编 | 立即可用但覆盖面大（会漏掉正常头文件变更） |
| **D 保护性增强（不推荐）** | 头文件按内容哈希豁免 mtime 变化 | 偏离 CB、每次构建读全部头文件开销大 |

