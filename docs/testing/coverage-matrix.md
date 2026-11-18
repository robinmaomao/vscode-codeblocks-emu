# 测试覆盖矩阵（自动生成，勿手工编辑）

> 生成方式：`npm run coverage:matrix`（脚本 [`tests/contract/gen-coverage-matrix.js`](../../tests/contract/gen-coverage-matrix.js)）
> 判定口径：契约项 ID（命令/视图/设置键/键位/语言/语法/DAP 能力标记）在对应测试层源码中出现即计为命中；
> 视觉层/性能层不引用命令 ID 字面量，按 `EXPLICIT_HITS`（面/引擎级覆盖）人工补充，明细见脚本内注释。
> 列 `src` 表示实现存在（不算测试覆盖）；`契约/无头/E2E/视觉/性能/宿主` 为六个自动化测试层。
> 数据来源：package.json v0.8.155 + tests/** + src/**

## 汇总

| 契约项 | 总数 | 契约层 | 无头层 | E2E 层 | 视觉层 | 性能层 | 宿主层 | 未覆盖 | 覆盖率 |
|--------|------|--------|--------|--------|--------|--------|--------|--------|--------|
| 命令 | 133 | 3 | 118 | 4 | 12 | 5 | 39 | 0 | 100% |
| 视图 | 6 | 2 | 6 | 1 | 1 | 0 | 5 | 0 | 100% |
| 设置 | 90 | 90 | 78 | 15 | 0 | 1 | 6 | 0 | 100% |
| 快捷键 | 34 | 3 | 32 | 2 | 4 | 2 | 12 | 0 | 100% |
| 语言/语法 | 6 | 0 | 6 | 3 | 2 | 1 | 3 | 0 | 100% |
| DAP 能力 | 30 | 0 | 1 | 30 | 0 | 0 | 5 | 0 | 100% |

## 1. 命令

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.newProject` | Code::Blocks: 新建工程 | ✔ | ✔ | · | · | · | · | ✅ |
| 2 | `codeblocks.newProjectFromTemplate` | Code::Blocks: 从模板新建工程... | · | ✔ | · | · | · | · | ✅ |
| 3 | `codeblocks.newBuildTarget` | Code::Blocks: 新建构建目标... | · | ✔ | · | · | · | · | ✅ |
| 4 | `codeblocks.newFile` | Code::Blocks: 新建文件... | · | ✔ | · | · | · | · | ✅ |
| 5 | `codeblocks.saveProjectAsTemplate` | Code::Blocks: 另存为工程模板... | · | ✔ | · | · | · | · | ✅ |
| 6 | `codeblocks.openProject` | Code::Blocks: 打开工程 (.cbp) | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 7 | `codeblocks.build` | Code::Blocks: 构建 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| 8 | `codeblocks.rebuild` | Code::Blocks: 重新构建 | · | ✔ | · | ✔ | ✔ | ✔ | ✅ |
| 9 | `codeblocks.buildWorkspace` | Code::Blocks: 构建工作区 | · | ✔ | · | · | · | ✔ | ✅ |
| 10 | `codeblocks.build.stop` | Code::Blocks: 停止构建 | · | ✔ | ✔ | · | · | · | ✅ |
| 11 | `codeblocks.installCompilerCache` | Code::Blocks: 安装编译缓存 (ccache/sccache)... | · | ✔ | · | · | · | · | ✅ |
| 12 | `codeblocks.buildAndRun` | Code::Blocks: 构建并运行 | · | ✔ | · | ✔ | · | · | ✅ |
| 13 | `codeblocks.compileFileWithoutProject` | Code::Blocks: 编译文件 (无工程) | · | ✔ | · | · | · | · | ✅ |
| 14 | `codeblocks.buildLog.toggleErrorsOnly` | Code::Blocks: 仅显示错误 (构建日志) | · | ✔ | · | ✔ | · | · | ✅ |
| 15 | `codeblocks.buildLog.showAllMessages` | Code::Blocks: 显示全部消息 (构建日志) | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 16 | `codeblocks.buildLog.clearOutput` | Code::Blocks: 清空构建输出 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 17 | `codeblocks.buildLog.copyMessage` | Code::Blocks: 复制诊断消息 | · | · | · | ✔ | · | · | ✅ |
| 18 | `codeblocks.buildLog.copyDiagnostic` | Code::Blocks: 复制完整诊断 | · | · | · | ✔ | · | · | ✅ |
| 19 | `codeblocks.openRecentProject` | Code::Blocks: 打开最近工程 | · | ✔ | · | · | · | ✔ | ✅ |
| 20 | `codeblocks.resetViewLayout` | Code::Blocks: 重置视图布局 | · | · | · | · | · | ✔ | ✅ |
| 21 | `codeblocks.analysis.refresh` | Code::Blocks: 刷新分析 | · | · | · | · | · | ✔ | ✅ |
| 22 | `codeblocks.analysis.locate` | Code::Blocks: 在 .cbp 中定位 | · | ✔ | · | · | · | · | ✅ |
| 23 | `codeblocks.analysis.copyXml` | Code::Blocks: 复制 .cbp 片段 | · | ✔ | · | · | · | · | ✅ |
| 24 | `codeblocks.clean` | Code::Blocks: 清理 | · | ✔ | · | · | ✔ | ✔ | ✅ |
| 25 | `codeblocks.distClean` | Code::Blocks: 彻底清理 (Dist Clean) | · | ✔ | · | · | · | · | ✅ |
| 26 | `codeblocks.cleanWorkspace` | Code::Blocks: 清理工作区 | · | ✔ | · | · | · | ✔ | ✅ |
| 27 | `codeblocks.rebuildWorkspace` | Code::Blocks: 重新构建工作区 | · | ✔ | · | · | · | ✔ | ✅ |
| 28 | `codeblocks.run` | Code::Blocks: 运行 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 29 | `codeblocks.selectTarget` | Code::Blocks: 选择构建目标 | · | · | · | · | · | ✔ | ✅ |
| 30 | `codeblocks.selectProjectTarget` | Code::Blocks: 为该工程选择构建目标 | · | ✔ | · | · | · | ✔ | ✅ |
| 31 | `codeblocks.detectCompilers` | Code::Blocks: 检测编译器 | · | · | · | · | · | ✔ | ✅ |
| 32 | `codeblocks.workspaceScanReport` | Code::Blocks: 工作区扫描报告 | · | ✔ | · | · | · | · | ✅ |
| 33 | `codeblocks.checkWorkspacePath` | Code::Blocks: 检查工作区路径 | · | ✔ | · | · | · | · | ✅ |
| 34 | `codeblocks.excludeBuildOutputs` | Code::Blocks: 从文件监听/搜索中排除构建产物 | · | ✔ | · | · | · | · | ✅ |
| 35 | `codeblocks.compilerOptions` | 构建选项... | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 36 | `codeblocks.projectProperties` | 属性... | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 37 | `codeblocks.generateCompileCommands` | Code::Blocks: 生成 compile_commands.json (IntelliSense) | · | ✔ | · | · | ✔ | ✔ | ✅ |
| 38 | `codeblocks.cleanClangdConfig` | Code::Blocks: 清理失效的 clangd 配置片段 | · | ✔ | · | · | · | · | ✅ |
| 39 | `codeblocks.restartClangd` | Code::Blocks: 重启 clangd 语言服务器 | · | · | · | · | · | ✔ | ✅ |
| 40 | `codeblocks.clangd.applyQueryDriver` | Code::Blocks: 配置 clangd --query-driver | · | ✔ | · | · | · | · | ✅ |
| 41 | `codeblocks.debug` | Code::Blocks: 调试 | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 42 | `codeblocks.codeStats` | Code::Blocks: 代码统计 | · | · | · | · | · | ✔ | ✅ |
| 43 | `codeblocks.copyStrings` | Code::Blocks: 复制字符串字面量 | · | ✔ | · | · | · | · | ✅ |
| 44 | `codeblocks.profileTarget` | Code::Blocks: 性能分析目标 (gprof) | · | ✔ | · | · | · | · | ✅ |
| 45 | `codeblocks.findSymbolInLibraries` | Code::Blocks: 在库中查找符号... | · | ✔ | · | · | · | · | ✅ |
| 46 | `codeblocks.todoList` | Code::Blocks: TODO 列表 | · | · | · | · | · | ✔ | ✅ |
| 47 | `codeblocks.todo.add` | Code::Blocks: 添加 TODO 项... | · | ✔ | · | · | · | · | ✅ |
| 48 | `codeblocks.bookmarks.toggle` | Code::Blocks: 切换书签 | · | ✔ | · | · | · | · | ✅ |
| 49 | `codeblocks.bookmarks.prev` | Code::Blocks: 上一个书签 | · | ✔ | · | · | · | · | ✅ |
| 50 | `codeblocks.bookmarks.next` | Code::Blocks: 下一个书签 | · | ✔ | · | · | · | · | ✅ |
| 51 | `codeblocks.bookmarks.clearAll` | Code::Blocks: 清除全部书签 | · | ✔ | · | · | · | · | ✅ |
| 52 | `codeblocks.openIncludeFile` | Code::Blocks: 打开包含文件 | ✔ | · | · | · | · | · | ✅ |
| 53 | `codeblocks.format` | Code::Blocks: 使用 AStyle 格式化 | · | ✔ | · | · | · | · | ✅ |
| 54 | `codeblocks.insertHeaderGuard` | Code::Blocks: 插入头文件保护 | · | ✔ | · | · | · | · | ✅ |
| 55 | `codeblocks.tidyComments` | Code::Blocks: 整理注释 | · | ✔ | · | · | · | · | ✅ |
| 56 | `codeblocks.swapHeaderSource` | Code::Blocks: 切换头文件 / 源文件 | · | ✔ | · | · | · | · | ✅ |
| 57 | `codeblocks.runTool` | Code::Blocks: 运行工具 | · | ✔ | · | · | · | · | ✅ |
| 58 | `codeblocks.configureTools` | Code::Blocks: 配置工具... | · | ✔ | · | · | · | · | ✅ |
| 59 | `codeblocks.showCompilerCommands` | Code::Blocks: 显示编译命令 | · | ✔ | · | · | · | ✔ | ✅ |
| 60 | `codeblocks.exportMakefile` | Code::Blocks: 导出 Makefile | · | ✔ | · | · | · | · | ✅ |
| 61 | `codeblocks.workspace.editDependencies` | Code::Blocks: 编辑工作区依赖 | · | ✔ | · | · | · | · | ✅ |
| 62 | `codeblocks.importProject` | Code::Blocks: 导入工程 (Dev-C++ / VC6 / VS2010+) | · | ✔ | · | · | · | · | ✅ |
| 63 | `codeblocks.exportTargetAsProject` | Code::Blocks: 从目标创建工程... | · | ✔ | · | · | · | · | ✅ |
| 64 | `codeblocks.openDefaultConfig` | Code::Blocks: 打开 default.conf | · | ✔ | · | · | · | · | ✅ |
| 65 | `codeblocks.ui.switchLanguage` | Code::Blocks: 切换界面语言… | · | ✔ | · | · | · | · | ✅ |
| 66 | `codeblocks.moveProjectUp` | 上移 | · | ✔ | · | · | · | · | ✅ |
| 67 | `codeblocks.moveProjectDown` | 下移 | · | ✔ | · | · | · | · | ✅ |
| 68 | `codeblocks.removeProject` | 移除工程 | · | ✔ | · | · | · | · | ✅ |
| 69 | `codeblocks.closeProject` | 关闭工程 | · | ✔ | · | · | · | · | ✅ |
| 70 | `codeblocks.saveProject` | 保存工程 | · | ✔ | · | · | · | · | ✅ |
| 71 | `codeblocks.saveProjectAs` | Code::Blocks: 工程另存为... | · | ✔ | · | · | · | · | ✅ |
| 72 | `codeblocks.saveWorkspace` | Code::Blocks: 保存工作区 | · | ✔ | · | · | · | · | ✅ |
| 73 | `codeblocks.saveWorkspaceAs` | Code::Blocks: 工作区另存为... | · | ✔ | · | · | · | · | ✅ |
| 74 | `codeblocks.closeWorkspace` | Code::Blocks: 关闭工作区 | · | ✔ | · | · | · | · | ✅ |
| 75 | `codeblocks.openDefaultWorkspace` | Code::Blocks: 打开默认工作区 | · | ✔ | · | · | · | · | ✅ |
| 76 | `codeblocks.removeFiles` | 移除文件… | · | ✔ | · | · | · | · | ✅ |
| 77 | `codeblocks.projectTree.expandAll` | 全部展开 | · | ✔ | · | · | · | · | ✅ |
| 78 | `codeblocks.projectTree.collapseAll` | 全部折叠 | · | ✔ | · | · | · | · | ✅ |
| 79 | `codeblocks.reloadProject` | Code::Blocks: 从磁盘重新加载工程 | · | ✔ | · | · | · | · | ✅ |
| 80 | `codeblocks.buildProject` | 构建 | · | ✔ | · | · | · | · | ✅ |
| 81 | `codeblocks.rebuildProject` | 重新构建 | · | ✔ | · | · | · | · | ✅ |
| 82 | `codeblocks.cleanProject` | 清理 | · | ✔ | · | · | · | · | ✅ |
| 83 | `codeblocks.addFile` | 添加文件... | · | ✔ | · | · | · | · | ✅ |
| 84 | `codeblocks.addFilesRecursively` | 递归添加文件... | · | ✔ | · | · | · | · | ✅ |
| 85 | `codeblocks.findFile` | 查找文件... | · | ✔ | · | · | · | · | ✅ |
| 86 | `codeblocks.searchProjectFiles` | 工程搜索：查找工程文件 | · | ✔ | · | · | · | · | ✅ |
| 87 | `codeblocks.searchInProjectFiles` | 工程搜索：在工程文件中搜索 | · | ✔ | · | · | · | · | ✅ |
| 88 | `codeblocks.fileProperties` | 属性... | · | ✔ | · | · | · | ✔ | ✅ |
| 89 | `codeblocks.renameFile` | 重命名文件... | · | ✔ | · | · | · | · | ✅ |
| 90 | `codeblocks.newVirtualFolder` | 新建虚拟文件夹... | · | ✔ | · | · | · | · | ✅ |
| 91 | `codeblocks.renameVirtualFolder` | 重命名虚拟文件夹... | · | ✔ | · | · | · | · | ✅ |
| 92 | `codeblocks.deleteVirtualFolder` | 删除虚拟文件夹 | · | ✔ | · | · | · | · | ✅ |
| 93 | `codeblocks.removeFile` | 从工程移除文件 | · | ✔ | · | · | · | · | ✅ |
| 94 | `codeblocks.openContainingFolder` | 打开所在文件夹 | · | ✔ | · | · | · | · | ✅ |
| 95 | `codeblocks.toggleCompile` | 编译文件 | · | ✔ | · | · | · | · | ✅ |
| 96 | `codeblocks.toggleLink` | 链接文件 | · | ✔ | · | · | · | · | ✅ |
| 97 | `codeblocks.compileFile` | 构建文件 | · | ✔ | · | · | ✔ | · | ✅ |
| 98 | `codeblocks.cleanFile` | 清理文件 | · | ✔ | · | · | · | · | ✅ |
| 99 | `codeblocks.editFileBuildCommand` | 编辑自定义构建命令... | · | ✔ | · | · | · | · | ✅ |
| 100 | `codeblocks.nextError` | Code::Blocks: 下一个错误 | · | ✔ | · | · | · | ✔ | ✅ |
| 101 | `codeblocks.prevError` | Code::Blocks: 上一个错误 | · | · | · | · | · | ✔ | ✅ |
| 102 | `codeblocks.compileCurrentFile` | Code::Blocks: 编译当前文件 | · | ✔ | · | · | · | ✔ | ✅ |
| 103 | `codeblocks.clearErrors` | Code::Blocks: 清除全部错误 | · | ✔ | · | · | · | ✔ | ✅ |
| 104 | `codeblocks.activatePriorProject` | Code::Blocks: 激活上一个工程 | · | ✔ | · | · | · | · | ✅ |
| 105 | `codeblocks.activateNextProject` | Code::Blocks: 激活下一个工程 | · | ✔ | · | · | · | · | ✅ |
| 106 | `codeblocks.toggleCategorize` | Code::Blocks: 按文件类型分组显示工程树 | · | ✔ | · | · | · | ✔ | ✅ |
| 107 | `codeblocks.clearRecentProjects` | Code::Blocks: 清除最近工程 | · | ✔ | · | · | · | · | ✅ |
| 108 | `codeblocks.projectNotes` | Code::Blocks: 工程备注 | · | ✔ | · | · | · | · | ✅ |
| 109 | `codeblocks.setProgramArguments` | Code::Blocks: 设置程序参数 | · | ✔ | · | · | · | · | ✅ |
| 110 | `codeblocks.showGlobalVariables` | Code::Blocks: 显示全局变量 | · | ✔ | · | · | · | ✔ | ✅ |
| 111 | `codeblocks.backtickCache` | Code::Blocks: 反引号缓存... | · | ✔ | · | · | · | · | ✅ |
| 112 | `codeblocks.clearBacktickCache` | Code::Blocks: 清除反引号缓存 | · | ✔ | · | · | · | · | ✅ |
| 113 | `codeblocks.keybindings.check` | Code::Blocks: 检查快捷键冲突 | · | · | · | · | · | ✔ | ✅ |
| 114 | `codeblocks.keybindings.apply` | Code::Blocks: 应用快捷键 | · | · | · | · | · | ✔ | ✅ |
| 115 | `codeblocks.keybindings.configure` | Code::Blocks: 配置快捷键... | · | ✔ | · | · | · | · | ✅ |
| 116 | `codeblocks.keybindings.reset` | Code::Blocks: 重置快捷键 | · | · | · | · | · | ✔ | ✅ |
| 117 | `codeblocks.keybindings.panel` | Code::Blocks: 快捷键设置 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 118 | `codeblocks.keybindings.export` | Code::Blocks: 导出快捷键方案 | · | ✔ | · | · | · | · | ✅ |
| 119 | `codeblocks.keybindings.import` | Code::Blocks: 导入快捷键方案 | · | ✔ | · | · | · | · | ✅ |
| 120 | `codeblocks.debug.refreshRegisters` | Code::Blocks: 刷新寄存器 | · | · | · | · | · | ✔ | ✅ |
| 121 | `codeblocks.debug.sendGdbCommand` | Code::Blocks: 发送 GDB 命令... | · | ✔ | · | · | · | · | ✅ |
| 122 | `codeblocks.debug.setNextStatement` | Code::Blocks: 设置下一条语句 | · | ✔ | · | · | · | ✔ | ✅ |
| 123 | `codeblocks.debug.nextInstruction` | Code::Blocks: 单步指令 | · | ✔ | · | · | · | · | ✅ |
| 124 | `codeblocks.debug.stepIntoInstruction` | Code::Blocks: 单步进入指令 | · | ✔ | · | · | · | · | ✅ |
| 125 | `codeblocks.debug.examineMemory` | Code::Blocks: 查看内存... | · | ✔ | · | · | · | · | ✅ |
| 126 | `codeblocks.debug.attachToProcess` | Code::Blocks: 附加到进程... | · | ✔ | · | · | · | · | ✅ |
| 127 | `codeblocks.debug.detach` | Code::Blocks: 分离调试 | · | ✔ | · | · | · | · | ✅ |
| 128 | `codeblocks.debug.addSymbolFile` | Code::Blocks: 添加符号文件... | · | ✔ | · | · | · | · | ✅ |
| 129 | `codeblocks.debug.infoFrame` | Code::Blocks: 调试信息 · 当前栈帧 | · | ✔ | · | · | · | ✔ | ✅ |
| 130 | `codeblocks.debug.infoSharedLibrary` | Code::Blocks: 调试信息 · 已加载库 | · | ✔ | · | · | · | · | ✅ |
| 131 | `codeblocks.debug.infoFiles` | Code::Blocks: 调试信息 · 目标与文件 | · | ✔ | · | · | · | ✔ | ✅ |
| 132 | `codeblocks.debug.infoFloat` | Code::Blocks: 调试信息 · FPU 状态 | · | ✔ | · | · | · | · | ✅ |
| 133 | `codeblocks.debug.infoSignals` | Code::Blocks: 调试信息 · 信号处理 | · | ✔ | · | · | · | · | ✅ |

未覆盖 0 项

## 2. 视图

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.projectTree` | 工程 | ✔ | ✔ | · | ✔ | · | ✔ | ✅ |
| 2 | `codeblocks.search` | 工程搜索 | · | ✔ | · | · | · | · | ✅ |
| 3 | `codeblocks.symbols` | 符号 | · | ✔ | · | · | · | ✔ | ✅ |
| 4 | `codeblocks.analysis` | 分析 | · | ✔ | · | · | · | ✔ | ✅ |
| 5 | `codeblocks.buildLog` | 构建日志 | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 6 | `codeblocks.debug.registers` | 寄存器 | · | ✔ | ✔ | · | · | ✔ | ✅ |

未覆盖 0 项

## 3. 设置项

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.compilerId` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 2 | `codeblocks.compiler.customFlags` |  | ✔ | · | · | · | · | · | ✅ |
| 3 | `codeblocks.compiler.flagOverrides` |  | ✔ | · | · | · | · | · | ✅ |
| 4 | `codeblocks.compiler.languageFlags` |  | ✔ | · | · | · | · | · | ✅ |
| 5 | `codeblocks.masterPath` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 6 | `codeblocks.compilerPrograms` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 7 | `codeblocks.saveBeforeBuild` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 8 | `codeblocks.noProjectCompile.useTaskTerminal` |  | ✔ | · | · | · | · | · | ✅ |
| 9 | `codeblocks.profiler.gprofPath` |  | ✔ | · | · | · | · | · | ✅ |
| 10 | `codeblocks.parallelJobs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 11 | `codeblocks.build.compilerCache` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 12 | `codeblocks.build.compilerCachePath` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 13 | `codeblocks.build.skipIncludeDeps` |  | ✔ | · | ✔ | · | ✔ | · | ✅ |
| 14 | `codeblocks.build.linkInputExtensions` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 15 | `codeblocks.build.verboseOutput` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 16 | `codeblocks.build.profile` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 17 | `codeblocks.build.traceProcesses` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 18 | `codeblocks.build.lowerCompilerPriority` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 19 | `codeblocks.build.autoExcludeOutputs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 20 | `codeblocks.build.sampleSystem` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 21 | `codeblocks.build.performanceAdvisor` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 22 | `codeblocks.build.compileCommandsOnlyTargets` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 23 | `codeblocks.build.scriptExitGraceMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 24 | `codeblocks.build.scriptCommandTimeoutMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 25 | `codeblocks.build.strictQuoting` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 26 | `codeblocks.build.asmUsesCompilerVar` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 27 | `codeblocks.build.responseFile` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 28 | `codeblocks.build.cleanResponseFiles` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 29 | `codeblocks.maxReportedErrors` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 30 | `codeblocks.build.plainCbLog` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 31 | `codeblocks.build.persistLog` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 32 | `codeblocks.build.outputTimestamp` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 33 | `codeblocks.build.saveHtmlLog` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 34 | `codeblocks.build.saveHtmlLogFullCommandLine` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 35 | `codeblocks.log.english` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 36 | `codeblocks.ui.quietSuccess` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 37 | `codeblocks.ui.quietFailure` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 38 | `codeblocks.ui.buildLogAutoFocus` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 39 | `codeblocks.ui.buildLogFocusFirstError` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 40 | `codeblocks.workspace.pathGuard` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 41 | `codeblocks.detect.autoOpen` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 42 | `codeblocks.detect.autoOpenThreshold` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 43 | `codeblocks.detect.checkExternalChanges` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 44 | `codeblocks.projectTree.categorize` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 45 | `codeblocks.gdbTimeoutMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 46 | `codeblocks.debug.initCommands` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 47 | `codeblocks.debug.userArguments` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 48 | `codeblocks.debug.disableInit` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 49 | `codeblocks.debug.printPretty` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 50 | `codeblocks.debug.printElements` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 51 | `codeblocks.debug.disassemblyFlavor` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 52 | `codeblocks.debug.instructionSet` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 53 | `codeblocks.debug.charset` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 54 | `codeblocks.debug.gdbPath` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 55 | `codeblocks.debug.trace` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 56 | `codeblocks.debug.registers` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 57 | `codeblocks.debug.addOtherProjectDirs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 58 | `codeblocks.clangd.enabled` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 59 | `codeblocks.clangd.buildLogDiagnostics` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 60 | `codeblocks.clangd.restartOnActiveProjectSwitch` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 61 | `codeblocks.clangd.forcedIncludes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 62 | `codeblocks.clangd.suppressedWarnings` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 63 | `codeblocks.clangd.suppressHeaderDiagnostics` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 64 | `codeblocks.clangd.unusedIncludes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 65 | `codeblocks.clangd.headerInsertion` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 66 | `codeblocks.clangd.indexBackground` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 67 | `codeblocks.clangd.indexStandardLibrary` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 68 | `codeblocks.clangd.clangTidy` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 69 | `codeblocks.clangd.completionAllScopes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 70 | `codeblocks.clangd.inlayHints` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 71 | `codeblocks.clangd.documentationCommentFormat` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 72 | `codeblocks.clangd.excludeDirs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 73 | `codeblocks.clangd.builtinHeaders` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 74 | `codeblocks.clangd.extraConfig` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 75 | `codeblocks.ui.language` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 76 | `codeblocks.ui.projectToolbar` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 77 | `codeblocks.ui.symbolsView` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 78 | `codeblocks.ui.recentProjectsLimit` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 79 | `codeblocks.ui.findFileOpen` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 80 | `codeblocks.search.scope` |  | ✔ | · | · | · | · | · | ✅ |
| 81 | `codeblocks.search.keepHistory` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 82 | `codeblocks.editor.autoHeaderGuard` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 83 | `codeblocks.editor.headerGuardStyle` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 84 | `codeblocks.editor.tidyCommentWidth` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 85 | `codeblocks.editor.asmHashComment` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 86 | `codeblocks.astyleOptions` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 87 | `codeblocks.todo.keywords` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 88 | `codeblocks.tools` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 89 | `codeblocks.keybindings.cbStyle` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 90 | `codeblocks.keybindings.overrides` |  | ✔ | ✔ | · | · | · | · | ✅ |

未覆盖 0 项

## 4. 快捷键

| # | 标识 | 标题 | 契约 | 无头 | E2E | 视觉 | 性能 | 宿主 | 状态 |
|---|------|------|------|------|------|------|------|------|------|
| 1 | `codeblocks.searchProjectFiles` | ctrl+alt+p | · | ✔ | · | · | · | · | ✅ |
| 2 | `codeblocks.build` | ctrl+f9 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✅ |
| 3 | `codeblocks.buildAndRun` | f9 | · | ✔ | · | ✔ | · | · | ✅ |
| 4 | `codeblocks.run` | ctrl+f10 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 5 | `codeblocks.rebuild` | ctrl+f11 | · | ✔ | · | ✔ | ✔ | ✔ | ✅ |
| 6 | `codeblocks.compileCurrentFile` | ctrl+shift+f9 | · | ✔ | · | · | · | ✔ | ✅ |
| 7 | `codeblocks.debug` | f8 | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 8 | `codeblocks.nextError` | f4 | · | ✔ | · | · | · | ✔ | ✅ |
| 9 | `codeblocks.prevError` | shift+f4 | · | · | · | · | · | ✔ | ✅ |
| 10 | `codeblocks.activatePriorProject` | alt+f5 | · | ✔ | · | · | · | · | ✅ |
| 11 | `codeblocks.activateNextProject` | alt+f6 | · | ✔ | · | · | · | · | ✅ |
| 12 | `codeblocks.prevError` | alt+f1 | · | · | · | · | · | ✔ | ✅ |
| 13 | `codeblocks.nextError` | alt+f2 | · | ✔ | · | · | · | ✔ | ✅ |
| 14 | `workbench.action.quickOpen` | alt+g | · | ✔ | · | · | · | · | ✅ |
| 15 | `codeblocks.bookmarks.toggle` | alt+k | · | ✔ | · | · | · | · | ✅ |
| 16 | `codeblocks.bookmarks.prev` | alt+h | · | ✔ | · | · | · | · | ✅ |
| 17 | `codeblocks.bookmarks.next` | alt+l | · | ✔ | · | · | · | · | ✅ |
| 18 | `codeblocks.projectTree.focus` | shift+f2 | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 19 | `workbench.action.replaceInFiles` | ctrl+shift+r | · | ✔ | · | · | · | · | ✅ |
| 20 | `codeblocks.moveProjectUp` | ctrl+shift+up | · | ✔ | · | · | · | · | ✅ |
| 21 | `codeblocks.moveProjectDown` | ctrl+shift+down | · | ✔ | · | · | · | · | ✅ |
| 22 | `editor.action.addSelectionToNextFindMatch` | ctrl+e | · | ✔ | · | · | · | · | ✅ |
| 23 | `editor.debug.action.toggleBreakpoint` | f5 | · | ✔ | · | · | · | ✔ | ✅ |
| 24 | `workbench.action.debug.stop` | shift+f8 | · | ✔ | · | · | · | · | ✅ |
| 25 | `codeblocks.buildLog.focus` | f2 | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 26 | `editor.action.startFindReplaceAction` | ctrl+r | · | ✔ | · | · | · | · | ✅ |
| 27 | `editor.action.jumpToBracket` | ctrl+shift+b | · | ✔ | · | · | · | · | ✅ |
| 28 | `editor.action.commentLine` | ctrl+shift+c | · | ✔ | · | · | · | · | ✅ |
| 29 | `workbench.action.files.saveAll` | ctrl+shift+s | · | ✔ | · | · | · | · | ✅ |
| 30 | `workbench.action.quit` | ctrl+q | · | ✔ | · | · | · | · | ✅ |
| 31 | `editor.toggleFold` | f12 | · | ✔ | · | · | · | · | ✅ |
| 32 | `workbench.action.debug.stepOver` | f7 | · | ✔ | · | · | · | · | ✅ |
| 33 | `workbench.action.debug.stepInto` | shift+f7 | · | ✔ | · | · | · | · | ✅ |
| 34 | `workbench.action.debug.stepOut` | ctrl+f7 | · | ✔ | · | · | · | · | ✅ |

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
