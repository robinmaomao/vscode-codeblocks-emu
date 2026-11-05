# 测试覆盖矩阵（自动生成，勿手工编辑）

> 生成方式：`npm run coverage:matrix`（脚本 [`tests/contract/gen-coverage-matrix.js`](../../tests/contract/gen-coverage-matrix.js)）
> 判定口径：契约项 ID（命令/视图/设置键/键位/语言/语法/DAP 能力标记）在对应测试层源码中出现即计为命中；
> 视觉层/性能层不引用命令 ID 字面量，按 `EXPLICIT_HITS`（面/引擎级覆盖）人工补充，明细见脚本内注释。
> 列 `src` 表示实现存在（不算测试覆盖）；`契约/无头/E2E/视觉/性能/宿主` 为六个自动化测试层。
> 数据来源：package.json v0.8.139 + tests/** + src/**

## 汇总

| 契约项 | 总数 | 契约层 | 无头层 | E2E 层 | 视觉层 | 性能层 | 宿主层 | 未覆盖 | 覆盖率 |
|--------|------|--------|--------|--------|--------|--------|--------|--------|--------|
| 命令 | 110 | 3 | 96 | 4 | 12 | 5 | 37 | 1 | 99% |
| 视图 | 5 | 2 | 5 | 1 | 1 | 0 | 5 | 0 | 100% |
| 设置 | 82 | 82 | 76 | 15 | 0 | 1 | 6 | 0 | 100% |
| 快捷键 | 33 | 3 | 31 | 2 | 4 | 2 | 12 | 0 | 100% |
| 语言/语法 | 6 | 0 | 6 | 3 | 2 | 1 | 3 | 0 | 100% |
| DAP 能力 | 30 | 0 | 1 | 30 | 0 | 0 | 5 | 0 | 100% |

## 1. 命令

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.newProject` | Code::Blocks: 新建工程 | ✔ | ✔ | · | · | · | · | ✅ |
| 2 | `codeblocks.newProjectFromTemplate` | Code::Blocks: 从模板新建工程... | · | ✔ | · | · | · | · | ✅ |
| 3 | `codeblocks.saveProjectAsTemplate` | Code::Blocks: 另存为工程模板... | · | ✔ | · | · | · | · | ✅ |
| 4 | `codeblocks.openProject` | Code::Blocks: 打开工程 (.cbp) | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 5 | `codeblocks.build` | Code::Blocks: 构建 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| 6 | `codeblocks.rebuild` | Code::Blocks: 重新构建 | · | ✔ | · | ✔ | ✔ | ✔ | ✅ |
| 7 | `codeblocks.buildWorkspace` | Code::Blocks: 构建工作区 | · | ✔ | · | · | · | ✔ | ✅ |
| 8 | `codeblocks.build.stop` | Code::Blocks: 停止构建 | · | ✔ | ✔ | · | · | · | ✅ |
| 9 | `codeblocks.installCompilerCache` | Code::Blocks: 安装编译缓存 (ccache/sccache)... | · | ✔ | · | · | · | · | ✅ |
| 10 | `codeblocks.buildAndRun` | Code::Blocks: 构建并运行 | · | ✔ | · | ✔ | · | · | ✅ |
| 11 | `codeblocks.compileFileWithoutProject` | Code::Blocks: 编译文件 (无工程) | · | ✔ | · | · | · | · | ✅ |
| 12 | `codeblocks.buildLog.toggleErrorsOnly` | Code::Blocks: 仅显示错误 (构建日志) | · | ✔ | · | ✔ | · | · | ✅ |
| 13 | `codeblocks.buildLog.showAllMessages` | Code::Blocks: 显示全部消息 (构建日志) | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 14 | `codeblocks.buildLog.clearOutput` | Code::Blocks: 清空构建输出 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 15 | `codeblocks.buildLog.copyMessage` | Code::Blocks: 复制诊断消息 | · | · | · | ✔ | · | · | ✅ |
| 16 | `codeblocks.buildLog.copyDiagnostic` | Code::Blocks: 复制完整诊断 | · | · | · | ✔ | · | · | ✅ |
| 17 | `codeblocks.openRecentProject` | Code::Blocks: 打开最近工程 | · | ✔ | · | · | · | ✔ | ✅ |
| 18 | `codeblocks.resetViewLayout` | Code::Blocks: 重置视图布局 | · | · | · | · | · | ✔ | ✅ |
| 19 | `codeblocks.analysis.refresh` | Code::Blocks: 刷新分析 | · | · | · | · | · | ✔ | ✅ |
| 20 | `codeblocks.analysis.locate` | Code::Blocks: 在 .cbp 中定位 | · | ✔ | · | · | · | · | ✅ |
| 21 | `codeblocks.analysis.copyXml` | Code::Blocks: 复制 .cbp 片段 | · | ✔ | · | · | · | · | ✅ |
| 22 | `codeblocks.clean` | Code::Blocks: 清理 | · | ✔ | · | · | ✔ | ✔ | ✅ |
| 23 | `codeblocks.cleanWorkspace` | Code::Blocks: 清理工作区 | · | ✔ | · | · | · | ✔ | ✅ |
| 24 | `codeblocks.rebuildWorkspace` | Code::Blocks: 重新构建工作区 | · | ✔ | · | · | · | ✔ | ✅ |
| 25 | `codeblocks.run` | Code::Blocks: 运行 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 26 | `codeblocks.selectTarget` | Code::Blocks: 选择构建目标 | · | · | · | · | · | ✔ | ✅ |
| 27 | `codeblocks.selectProjectTarget` | Code::Blocks: 为该工程选择构建目标 | · | ✔ | · | · | · | ✔ | ✅ |
| 28 | `codeblocks.detectCompilers` | Code::Blocks: 检测编译器 | · | · | · | · | · | · | ⚠ 未覆盖 |
| 29 | `codeblocks.workspaceScanReport` | Code::Blocks: 工作区扫描报告 | · | ✔ | · | · | · | · | ✅ |
| 30 | `codeblocks.checkWorkspacePath` | Code::Blocks: 检查工作区路径 | · | ✔ | · | · | · | · | ✅ |
| 31 | `codeblocks.excludeBuildOutputs` | Code::Blocks: 从文件监听/搜索中排除构建产物 | · | ✔ | · | · | · | · | ✅ |
| 32 | `codeblocks.compilerOptions` | Code::Blocks: 编译器选项 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 33 | `codeblocks.projectProperties` | Code::Blocks: 工程属性 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 34 | `codeblocks.generateCompileCommands` | Code::Blocks: 生成 compile_commands.json (IntelliSense) | · | ✔ | · | · | ✔ | ✔ | ✅ |
| 35 | `codeblocks.cleanClangdConfig` | Code::Blocks: 清理失效的 clangd 配置片段 | · | ✔ | · | · | · | · | ✅ |
| 36 | `codeblocks.clangd.applyQueryDriver` | Code::Blocks: 配置 clangd --query-driver | · | ✔ | · | · | · | · | ✅ |
| 37 | `codeblocks.debug` | Code::Blocks: 调试 | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 38 | `codeblocks.codeStats` | Code::Blocks: 代码统计 | · | · | · | · | · | ✔ | ✅ |
| 39 | `codeblocks.todoList` | Code::Blocks: TODO 列表 | · | · | · | · | · | ✔ | ✅ |
| 40 | `codeblocks.todo.add` | Code::Blocks: 添加 TODO 项... | · | ✔ | · | · | · | · | ✅ |
| 41 | `codeblocks.bookmarks.toggle` | Code::Blocks: 切换书签 | · | ✔ | · | · | · | · | ✅ |
| 42 | `codeblocks.bookmarks.prev` | Code::Blocks: 上一个书签 | · | ✔ | · | · | · | · | ✅ |
| 43 | `codeblocks.bookmarks.next` | Code::Blocks: 下一个书签 | · | ✔ | · | · | · | · | ✅ |
| 44 | `codeblocks.bookmarks.clearAll` | Code::Blocks: 清除全部书签 | · | ✔ | · | · | · | · | ✅ |
| 45 | `codeblocks.openIncludeFile` | Code::Blocks: 打开包含文件 | ✔ | · | · | · | · | · | ✅ |
| 46 | `codeblocks.format` | Code::Blocks: 使用 AStyle 格式化 | · | ✔ | · | · | · | · | ✅ |
| 47 | `codeblocks.insertHeaderGuard` | Code::Blocks: 插入头文件保护 | · | ✔ | · | · | · | · | ✅ |
| 48 | `codeblocks.tidyComments` | Code::Blocks: 整理注释 | · | ✔ | · | · | · | · | ✅ |
| 49 | `codeblocks.swapHeaderSource` | Code::Blocks: 切换头文件 / 源文件 | · | ✔ | · | · | · | · | ✅ |
| 50 | `codeblocks.runTool` | Code::Blocks: 运行工具 | · | ✔ | · | · | · | · | ✅ |
| 51 | `codeblocks.configureTools` | Code::Blocks: 配置工具... | · | ✔ | · | · | · | · | ✅ |
| 52 | `codeblocks.showCompilerCommands` | Code::Blocks: 显示编译命令 | · | ✔ | · | · | · | ✔ | ✅ |
| 53 | `codeblocks.exportMakefile` | Code::Blocks: 导出 Makefile | · | ✔ | · | · | · | · | ✅ |
| 54 | `codeblocks.workspace.editDependencies` | Code::Blocks: 编辑工作区依赖 | · | ✔ | · | · | · | · | ✅ |
| 55 | `codeblocks.importProject` | Code::Blocks: 导入工程 (Dev-C++ / VC6 / VS2010+) | · | ✔ | · | · | · | · | ✅ |
| 56 | `codeblocks.exportTargetAsProject` | Code::Blocks: 从目标创建工程... | · | ✔ | · | · | · | · | ✅ |
| 57 | `codeblocks.openDefaultConfig` | Code::Blocks: 打开 default.conf | · | ✔ | · | · | · | · | ✅ |
| 58 | `codeblocks.ui.switchLanguage` | Code::Blocks: 切换界面语言… | · | ✔ | · | · | · | · | ✅ |
| 59 | `codeblocks.moveProjectUp` | 上移 | · | ✔ | · | · | · | · | ✅ |
| 60 | `codeblocks.moveProjectDown` | 下移 | · | ✔ | · | · | · | · | ✅ |
| 61 | `codeblocks.removeProject` | 移除工程 | · | ✔ | · | · | · | · | ✅ |
| 62 | `codeblocks.reloadProject` | Code::Blocks: 从磁盘重新加载工程 | · | ✔ | · | · | · | · | ✅ |
| 63 | `codeblocks.buildProject` | 构建 | · | ✔ | · | · | · | · | ✅ |
| 64 | `codeblocks.rebuildProject` | 重新构建 | · | ✔ | · | · | · | · | ✅ |
| 65 | `codeblocks.cleanProject` | 清理 | · | ✔ | · | · | · | · | ✅ |
| 66 | `codeblocks.addFile` | 添加文件... | · | ✔ | · | · | · | · | ✅ |
| 67 | `codeblocks.addFilesRecursively` | 递归添加文件... | · | ✔ | · | · | · | · | ✅ |
| 68 | `codeblocks.findFile` | 查找文件... | · | ✔ | · | · | · | · | ✅ |
| 69 | `codeblocks.fileProperties` | 属性... | · | ✔ | · | · | · | ✔ | ✅ |
| 70 | `codeblocks.renameFile` | 重命名文件... | · | ✔ | · | · | · | · | ✅ |
| 71 | `codeblocks.newVirtualFolder` | 新建虚拟文件夹... | · | ✔ | · | · | · | · | ✅ |
| 72 | `codeblocks.renameVirtualFolder` | 重命名虚拟文件夹... | · | ✔ | · | · | · | · | ✅ |
| 73 | `codeblocks.deleteVirtualFolder` | 删除虚拟文件夹 | · | ✔ | · | · | · | · | ✅ |
| 74 | `codeblocks.removeFile` | 从工程移除文件 | · | ✔ | · | · | · | · | ✅ |
| 75 | `codeblocks.openContainingFolder` | 打开所在文件夹 | · | ✔ | · | · | · | · | ✅ |
| 76 | `codeblocks.toggleCompile` | 编译文件 | · | ✔ | · | · | · | · | ✅ |
| 77 | `codeblocks.toggleLink` | 链接文件 | · | ✔ | · | · | · | · | ✅ |
| 78 | `codeblocks.compileFile` | 构建文件 | · | ✔ | · | · | ✔ | · | ✅ |
| 79 | `codeblocks.cleanFile` | 清理文件 | · | ✔ | · | · | · | · | ✅ |
| 80 | `codeblocks.editFileBuildCommand` | 编辑自定义构建命令... | · | ✔ | · | · | · | · | ✅ |
| 81 | `codeblocks.nextError` | Code::Blocks: 下一个错误 | · | ✔ | · | · | · | ✔ | ✅ |
| 82 | `codeblocks.prevError` | Code::Blocks: 上一个错误 | · | · | · | · | · | ✔ | ✅ |
| 83 | `codeblocks.compileCurrentFile` | Code::Blocks: 编译当前文件 | · | ✔ | · | · | · | ✔ | ✅ |
| 84 | `codeblocks.clearErrors` | Code::Blocks: 清除全部错误 | · | ✔ | · | · | · | ✔ | ✅ |
| 85 | `codeblocks.activatePriorProject` | Code::Blocks: 激活上一个工程 | · | ✔ | · | · | · | · | ✅ |
| 86 | `codeblocks.activateNextProject` | Code::Blocks: 激活下一个工程 | · | ✔ | · | · | · | · | ✅ |
| 87 | `codeblocks.toggleCategorize` | Code::Blocks: 按文件类型分组显示工程树 | · | ✔ | · | · | · | ✔ | ✅ |
| 88 | `codeblocks.clearRecentProjects` | Code::Blocks: 清除最近工程 | · | ✔ | · | · | · | · | ✅ |
| 89 | `codeblocks.projectNotes` | Code::Blocks: 工程备注 | · | ✔ | · | · | · | · | ✅ |
| 90 | `codeblocks.setProgramArguments` | Code::Blocks: 设置程序参数 | · | ✔ | · | · | · | · | ✅ |
| 91 | `codeblocks.showGlobalVariables` | Code::Blocks: 显示全局变量 | · | ✔ | · | · | · | ✔ | ✅ |
| 92 | `codeblocks.clearBacktickCache` | Code::Blocks: 清除反引号缓存 | · | ✔ | · | · | · | · | ✅ |
| 93 | `codeblocks.keybindings.check` | Code::Blocks: 检查快捷键冲突 | · | · | · | · | · | ✔ | ✅ |
| 94 | `codeblocks.keybindings.apply` | Code::Blocks: 应用快捷键 | · | · | · | · | · | ✔ | ✅ |
| 95 | `codeblocks.keybindings.configure` | Code::Blocks: 配置快捷键... | · | ✔ | · | · | · | · | ✅ |
| 96 | `codeblocks.keybindings.reset` | Code::Blocks: 重置快捷键 | · | · | · | · | · | ✔ | ✅ |
| 97 | `codeblocks.keybindings.panel` | Code::Blocks: 快捷键设置 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 98 | `codeblocks.keybindings.export` | Code::Blocks: 导出快捷键方案 | · | ✔ | · | · | · | · | ✅ |
| 99 | `codeblocks.keybindings.import` | Code::Blocks: 导入快捷键方案 | · | ✔ | · | · | · | · | ✅ |
| 100 | `codeblocks.debug.refreshRegisters` | Code::Blocks: 刷新寄存器 | · | · | · | · | · | ✔ | ✅ |
| 101 | `codeblocks.debug.sendGdbCommand` | Code::Blocks: 发送 GDB 命令... | · | ✔ | · | · | · | · | ✅ |
| 102 | `codeblocks.debug.setNextStatement` | Code::Blocks: 设置下一条语句 | · | ✔ | · | · | · | ✔ | ✅ |
| 103 | `codeblocks.debug.attachToProcess` | Code::Blocks: 附加到进程... | · | ✔ | · | · | · | · | ✅ |
| 104 | `codeblocks.debug.detach` | Code::Blocks: 分离调试 | · | ✔ | · | · | · | · | ✅ |
| 105 | `codeblocks.debug.addSymbolFile` | Code::Blocks: 添加符号文件... | · | ✔ | · | · | · | · | ✅ |
| 106 | `codeblocks.debug.infoFrame` | Code::Blocks: 调试信息 · 当前栈帧 | · | ✔ | · | · | · | ✔ | ✅ |
| 107 | `codeblocks.debug.infoSharedLibrary` | Code::Blocks: 调试信息 · 已加载库 | · | ✔ | · | · | · | · | ✅ |
| 108 | `codeblocks.debug.infoFiles` | Code::Blocks: 调试信息 · 目标与文件 | · | ✔ | · | · | · | ✔ | ✅ |
| 109 | `codeblocks.debug.infoFloat` | Code::Blocks: 调试信息 · FPU 状态 | · | ✔ | · | · | · | · | ✅ |
| 110 | `codeblocks.debug.infoSignals` | Code::Blocks: 调试信息 · 信号处理 | · | ✔ | · | · | · | · | ✅ |

未覆盖 1 项：`codeblocks.detectCompilers`

## 2. 视图

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.projectTree` | 工程 | ✔ | ✔ | · | ✔ | · | ✔ | ✅ |
| 2 | `codeblocks.symbols` | 符号 | · | ✔ | · | · | · | ✔ | ✅ |
| 3 | `codeblocks.analysis` | 分析 | · | ✔ | · | · | · | ✔ | ✅ |
| 4 | `codeblocks.buildLog` | 构建日志 | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 5 | `codeblocks.debug.registers` | 寄存器 | · | ✔ | ✔ | · | · | ✔ | ✅ |

未覆盖 0 项

## 3. 设置项

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.compilerId` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 2 | `codeblocks.masterPath` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 3 | `codeblocks.compilerPrograms` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 4 | `codeblocks.saveBeforeBuild` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 5 | `codeblocks.parallelJobs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 6 | `codeblocks.build.compilerCache` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 7 | `codeblocks.build.compilerCachePath` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 8 | `codeblocks.build.skipIncludeDeps` |  | ✔ | · | ✔ | · | ✔ | · | ✅ |
| 9 | `codeblocks.build.linkInputExtensions` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 10 | `codeblocks.build.verboseOutput` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 11 | `codeblocks.build.profile` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 12 | `codeblocks.build.traceProcesses` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 13 | `codeblocks.build.lowerCompilerPriority` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 14 | `codeblocks.build.autoExcludeOutputs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 15 | `codeblocks.build.sampleSystem` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 16 | `codeblocks.build.compileCommandsOnlyTargets` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 17 | `codeblocks.build.scriptExitGraceMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 18 | `codeblocks.build.scriptCommandTimeoutMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 19 | `codeblocks.build.strictQuoting` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 20 | `codeblocks.build.asmUsesCompilerVar` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 21 | `codeblocks.build.responseFile` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 22 | `codeblocks.build.cleanResponseFiles` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 23 | `codeblocks.maxReportedErrors` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 24 | `codeblocks.build.plainCbLog` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 25 | `codeblocks.build.persistLog` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 26 | `codeblocks.build.outputTimestamp` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 27 | `codeblocks.build.saveHtmlLog` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 28 | `codeblocks.build.saveHtmlLogFullCommandLine` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 29 | `codeblocks.log.english` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 30 | `codeblocks.ui.quietSuccess` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 31 | `codeblocks.ui.quietFailure` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 32 | `codeblocks.ui.buildLogAutoFocus` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 33 | `codeblocks.ui.buildLogFocusFirstError` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 34 | `codeblocks.workspace.pathGuard` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 35 | `codeblocks.detect.autoOpen` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 36 | `codeblocks.detect.autoOpenThreshold` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 37 | `codeblocks.detect.checkExternalChanges` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 38 | `codeblocks.projectTree.categorize` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 39 | `codeblocks.gdbTimeoutMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 40 | `codeblocks.debug.initCommands` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 41 | `codeblocks.debug.userArguments` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 42 | `codeblocks.debug.disableInit` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 43 | `codeblocks.debug.printPretty` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 44 | `codeblocks.debug.printElements` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 45 | `codeblocks.debug.disassemblyFlavor` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 46 | `codeblocks.debug.instructionSet` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 47 | `codeblocks.debug.charset` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 48 | `codeblocks.debug.gdbPath` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 49 | `codeblocks.debug.trace` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 50 | `codeblocks.debug.registers` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 51 | `codeblocks.debug.addOtherProjectDirs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 52 | `codeblocks.clangd.enabled` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 53 | `codeblocks.clangd.buildLogDiagnostics` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 54 | `codeblocks.clangd.restartOnActiveProjectSwitch` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 55 | `codeblocks.clangd.forcedIncludes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 56 | `codeblocks.clangd.suppressedWarnings` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 57 | `codeblocks.clangd.suppressHeaderDiagnostics` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 58 | `codeblocks.clangd.unusedIncludes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 59 | `codeblocks.clangd.headerInsertion` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 60 | `codeblocks.clangd.indexBackground` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 61 | `codeblocks.clangd.indexStandardLibrary` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 62 | `codeblocks.clangd.clangTidy` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 63 | `codeblocks.clangd.completionAllScopes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 64 | `codeblocks.clangd.inlayHints` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 65 | `codeblocks.clangd.documentationCommentFormat` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 66 | `codeblocks.clangd.excludeDirs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 67 | `codeblocks.clangd.builtinHeaders` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 68 | `codeblocks.clangd.extraConfig` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 69 | `codeblocks.ui.language` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 70 | `codeblocks.ui.projectToolbar` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 71 | `codeblocks.ui.symbolsView` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 72 | `codeblocks.ui.recentProjectsLimit` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 73 | `codeblocks.ui.findFileOpen` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 74 | `codeblocks.editor.autoHeaderGuard` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 75 | `codeblocks.editor.headerGuardStyle` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 76 | `codeblocks.editor.tidyCommentWidth` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 77 | `codeblocks.editor.asmHashComment` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 78 | `codeblocks.astyleOptions` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 79 | `codeblocks.todo.keywords` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 80 | `codeblocks.tools` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 81 | `codeblocks.keybindings.cbStyle` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 82 | `codeblocks.keybindings.overrides` |  | ✔ | ✔ | · | · | · | · | ✅ |

未覆盖 0 项

## 4. 快捷键

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.build` | ctrl+f9 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| 2 | `codeblocks.buildAndRun` | f9 | · | ✔ | · | ✔ | · | · | ✅ |
| 3 | `codeblocks.run` | ctrl+f10 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 4 | `codeblocks.rebuild` | ctrl+f11 | · | ✔ | · | ✔ | ✔ | ✔ | ✅ |
| 5 | `codeblocks.compileCurrentFile` | ctrl+shift+f9 | · | ✔ | · | · | · | ✔ | ✅ |
| 6 | `codeblocks.debug` | f8 | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 7 | `codeblocks.nextError` | f4 | · | ✔ | · | · | · | ✔ | ✅ |
| 8 | `codeblocks.prevError` | shift+f4 | · | · | · | · | · | ✔ | ✅ |
| 9 | `codeblocks.activatePriorProject` | alt+f5 | · | ✔ | · | · | · | · | ✅ |
| 10 | `codeblocks.activateNextProject` | alt+f6 | · | ✔ | · | · | · | · | ✅ |
| 11 | `codeblocks.prevError` | alt+f1 | · | · | · | · | · | ✔ | ✅ |
| 12 | `codeblocks.nextError` | alt+f2 | · | ✔ | · | · | · | ✔ | ✅ |
| 13 | `workbench.action.quickOpen` | alt+g | · | ✔ | · | · | · | · | ✅ |
| 14 | `codeblocks.bookmarks.toggle` | alt+k | · | ✔ | · | · | · | · | ✅ |
| 15 | `codeblocks.bookmarks.prev` | alt+h | · | ✔ | · | · | · | · | ✅ |
| 16 | `codeblocks.bookmarks.next` | alt+l | · | ✔ | · | · | · | · | ✅ |
| 17 | `codeblocks.projectTree.focus` | shift+f2 | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 18 | `workbench.action.replaceInFiles` | ctrl+shift+r | · | ✔ | · | · | · | · | ✅ |
| 19 | `codeblocks.moveProjectUp` | ctrl+shift+up | · | ✔ | · | · | · | · | ✅ |
| 20 | `codeblocks.moveProjectDown` | ctrl+shift+down | · | ✔ | · | · | · | · | ✅ |
| 21 | `editor.action.addSelectionToNextFindMatch` | ctrl+e | · | ✔ | · | · | · | · | ✅ |
| 22 | `editor.debug.action.toggleBreakpoint` | f5 | · | ✔ | · | · | · | ✔ | ✅ |
| 23 | `workbench.action.debug.stop` | shift+f8 | · | ✔ | · | · | · | · | ✅ |
| 24 | `codeblocks.buildLog.focus` | f2 | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 25 | `editor.action.startFindReplaceAction` | ctrl+r | · | ✔ | · | · | · | · | ✅ |
| 26 | `editor.action.jumpToBracket` | ctrl+shift+b | · | ✔ | · | · | · | · | ✅ |
| 27 | `editor.action.commentLine` | ctrl+shift+c | · | ✔ | · | · | · | · | ✅ |
| 28 | `workbench.action.files.saveAll` | ctrl+shift+s | · | ✔ | · | · | · | · | ✅ |
| 29 | `workbench.action.quit` | ctrl+q | · | ✔ | · | · | · | · | ✅ |
| 30 | `editor.toggleFold` | f12 | · | ✔ | · | · | · | · | ✅ |
| 31 | `workbench.action.debug.stepOver` | f7 | · | ✔ | · | · | · | · | ✅ |
| 32 | `workbench.action.debug.stepInto` | shift+f7 | · | ✔ | · | · | · | · | ✅ |
| 33 | `workbench.action.debug.stepOut` | ctrl+f7 | · | ✔ | · | · | · | · | ✅ |

未覆盖 0 项

## 5. 语言与语法

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `ld` |  | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 2 | `asm` |  | · | ✔ | ✔ | ✔ | · | ✔ | ✅ |
| 3 | `xm` |  | · | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| 4 | `source.ld` |  | · | ✔ | · | · | · | · | ✅ |
| 5 | `source.asm` |  | · | ✔ | · | · | · | · | ✅ |
| 6 | `source.xm` |  | · | ✔ | · | · | · | · | ✅ |

未覆盖 0 项

## 6. 调试（DAP）能力

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `initialize` |  | · | · | ✔ | · | · | · | ✅ |
| 2 | `launch/attach` |  | · | · | ✔ | · | · | · | ✅ |
| 3 | `setBreakpoints` |  | · | · | ✔ | · | · | · | ✅ |
| 4 | `setFunctionBreakpoints` |  | · | · | ✔ | · | · | · | ✅ |
| 5 | `setConditionalBreakpoints` |  | · | · | ✔ | · | · | · | ✅ |
| 6 | `hitCondition` |  | · | · | ✔ | · | · | · | ✅ |
| 7 | `logMessage` |  | · | · | ✔ | · | · | · | ✅ |
| 8 | `setDataBreakpoints` |  | · | · | ✔ | · | · | · | ✅ |
| 9 | `setExceptionBreakpoints` |  | · | · | ✔ | · | · | · | ✅ |
| 10 | `setInstructionBreakpoints` |  | · | · | ✔ | · | · | · | ✅ |
| 11 | `configurationDone` |  | · | · | ✔ | · | · | · | ✅ |
| 12 | `continue` |  | · | · | ✔ | · | · | ✔ | ✅ |
| 13 | `next` |  | · | · | ✔ | · | · | · | ✅ |
| 14 | `stepIn` |  | · | · | ✔ | · | · | · | ✅ |
| 15 | `stepOut` |  | · | · | ✔ | · | · | · | ✅ |
| 16 | `pause/stop` |  | · | · | ✔ | · | · | · | ✅ |
| 17 | `threads` |  | · | · | ✔ | · | · | ✔ | ✅ |
| 18 | `stackTrace` |  | · | · | ✔ | · | · | ✔ | ✅ |
| 19 | `scopes` |  | · | · | ✔ | · | · | ✔ | ✅ |
| 20 | `variables` |  | · | · | ✔ | · | · | ✔ | ✅ |
| 21 | `setVariable` |  | · | · | ✔ | · | · | · | ✅ |
| 22 | `evaluate` |  | · | · | ✔ | · | · | · | ✅ |
| 23 | `disassemble` |  | · | · | ✔ | · | · | · | ✅ |
| 24 | `readMemory` |  | · | · | ✔ | · | · | · | ✅ |
| 25 | `writeMemory` |  | · | · | ✔ | · | · | · | ✅ |
| 26 | `modules` |  | · | · | ✔ | · | · | · | ✅ |
| 27 | `gotoTargets` |  | · | · | ✔ | · | · | · | ✅ |
| 28 | `loadedSources` |  | · | · | ✔ | · | · | · | ✅ |
| 29 | `terminate` |  | · | · | ✔ | · | · | · | ✅ |
| 30 | `disconnect/detach` |  | · | ✔ | ✔ | · | · | · | ✅ |

未覆盖 0 项
