# 测试覆盖矩阵（自动生成，勿手工编辑）

> 生成方式：`npm run coverage:matrix`（脚本 [`tests/contract/gen-coverage-matrix.js`](../../tests/contract/gen-coverage-matrix.js)）
> 判定口径：契约项 ID（命令/视图/设置键/键位/语言/语法/DAP 能力标记）在对应测试层源码中出现即计为命中；
> 视觉层/性能层不引用命令 ID 字面量，按 `EXPLICIT_HITS`（面/引擎级覆盖）人工补充，明细见脚本内注释。
> 列 `src` 表示实现存在（不算测试覆盖）；`契约/无头/E2E/视觉/性能/宿主` 为六个自动化测试层。
> 数据来源：package.json v0.9.2 + tests/** + src/**

## 汇总

| 契约项 | 总数 | 契约层 | 无头层 | E2E 层 | 视觉层 | 性能层 | 宿主层 | 未覆盖 | 覆盖率 |
|--------|------|--------|--------|--------|--------|--------|--------|--------|--------|
| 命令 | 136 | 3 | 127 | 4 | 12 | 5 | 39 | 0 | 100% |
| 视图 | 6 | 2 | 6 | 1 | 1 | 0 | 5 | 0 | 100% |
| 设置 | 93 | 93 | 81 | 15 | 0 | 1 | 7 | 0 | 100% |
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
| 31 | `codeblocks.detectCompilers` | Code::Blocks: 检测编译器 | · | ✔ | · | · | · | ✔ | ✅ |
| 32 | `codeblocks.workspaceScanReport` | Code::Blocks: 工作区扫描报告 | · | ✔ | · | · | · | · | ✅ |
| 33 | `codeblocks.checkWorkspacePath` | Code::Blocks: 检查工作区路径 | · | ✔ | · | · | · | · | ✅ |
| 34 | `codeblocks.excludeBuildOutputs` | Code::Blocks: 从文件监听/搜索中排除构建产物 | · | ✔ | · | · | · | · | ✅ |
| 35 | `codeblocks.compilerOptions` | 构建选项... | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 36 | `codeblocks.projectProperties` | 属性... | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 37 | `codeblocks.generateCompileCommands` | Code::Blocks: 生成 compile_commands.json (IntelliSense) | · | ✔ | · | · | ✔ | ✔ | ✅ |
| 38 | `codeblocks.cleanClangdConfig` | Code::Blocks: 清理失效的 clangd 配置片段 | · | ✔ | · | · | · | · | ✅ |
| 39 | `codeblocks.restartClangd` | Code::Blocks: 重启 clangd 语言服务器 | · | ✔ | · | · | · | ✔ | ✅ |
| 40 | `codeblocks.clangd.applyQueryDriver` | Code::Blocks: 配置 clangd --query-driver | · | ✔ | · | · | · | · | ✅ |
| 41 | `codeblocks.debug` | Code::Blocks: 调试 | · | ✔ | ✔ | · | · | ✔ | ✅ |
| 42 | `codeblocks.codeStats` | Code::Blocks: 代码统计 | · | · | · | · | · | ✔ | ✅ |
| 43 | `codeblocks.copyStrings` | Code::Blocks: 复制字符串字面量 | · | ✔ | · | · | · | · | ✅ |
| 44 | `codeblocks.profileTarget` | Code::Blocks: 性能分析目标 (gprof) | · | ✔ | · | · | · | · | ✅ |
| 45 | `codeblocks.autoVersioning` | Code::Blocks: 自动版本管理... | · | ✔ | · | · | · | · | ✅ |
| 46 | `codeblocks.bumpVersion` | Code::Blocks: 递增版本 | · | ✔ | · | · | · | · | ✅ |
| 47 | `codeblocks.generateVersionHeader` | Code::Blocks: 生成版本头文件 | · | ✔ | · | · | · | · | ✅ |
| 48 | `codeblocks.findSymbolInLibraries` | Code::Blocks: 在库中查找符号... | · | ✔ | · | · | · | · | ✅ |
| 49 | `codeblocks.todoList` | Code::Blocks: TODO 列表 | · | ✔ | · | · | · | ✔ | ✅ |
| 50 | `codeblocks.todo.add` | Code::Blocks: 添加 TODO 项... | · | ✔ | · | · | · | · | ✅ |
| 51 | `codeblocks.bookmarks.toggle` | Code::Blocks: 切换书签 | · | ✔ | · | · | · | · | ✅ |
| 52 | `codeblocks.bookmarks.prev` | Code::Blocks: 上一个书签 | · | ✔ | · | · | · | · | ✅ |
| 53 | `codeblocks.bookmarks.next` | Code::Blocks: 下一个书签 | · | ✔ | · | · | · | · | ✅ |
| 54 | `codeblocks.bookmarks.clearAll` | Code::Blocks: 清除全部书签 | · | ✔ | · | · | · | · | ✅ |
| 55 | `codeblocks.openIncludeFile` | Code::Blocks: 打开包含文件 | ✔ | ✔ | · | · | · | · | ✅ |
| 56 | `codeblocks.format` | Code::Blocks: 使用 AStyle 格式化 | · | ✔ | · | · | · | · | ✅ |
| 57 | `codeblocks.insertHeaderGuard` | Code::Blocks: 插入头文件保护 | · | ✔ | · | · | · | · | ✅ |
| 58 | `codeblocks.tidyComments` | Code::Blocks: 整理注释 | · | ✔ | · | · | · | · | ✅ |
| 59 | `codeblocks.swapHeaderSource` | Code::Blocks: 切换头文件 / 源文件 | · | ✔ | · | · | · | · | ✅ |
| 60 | `codeblocks.runTool` | Code::Blocks: 运行工具 | · | ✔ | · | · | · | · | ✅ |
| 61 | `codeblocks.configureTools` | Code::Blocks: 配置工具... | · | ✔ | · | · | · | · | ✅ |
| 62 | `codeblocks.showCompilerCommands` | Code::Blocks: 显示编译命令 | · | ✔ | · | · | · | ✔ | ✅ |
| 63 | `codeblocks.exportMakefile` | Code::Blocks: 导出 Makefile | · | ✔ | · | · | · | · | ✅ |
| 64 | `codeblocks.workspace.editDependencies` | Code::Blocks: 编辑工作区依赖 | · | ✔ | · | · | · | · | ✅ |
| 65 | `codeblocks.importProject` | Code::Blocks: 导入工程 (Dev-C++ / VC6 / VS2010+) | · | ✔ | · | · | · | · | ✅ |
| 66 | `codeblocks.exportTargetAsProject` | Code::Blocks: 从目标创建工程... | · | ✔ | · | · | · | · | ✅ |
| 67 | `codeblocks.openDefaultConfig` | Code::Blocks: 打开 default.conf | · | ✔ | · | · | · | · | ✅ |
| 68 | `codeblocks.ui.switchLanguage` | Code::Blocks: 切换界面语言… | · | ✔ | · | · | · | · | ✅ |
| 69 | `codeblocks.moveProjectUp` | 上移 | · | ✔ | · | · | · | · | ✅ |
| 70 | `codeblocks.moveProjectDown` | 下移 | · | ✔ | · | · | · | · | ✅ |
| 71 | `codeblocks.removeProject` | 移除工程 | · | ✔ | · | · | · | · | ✅ |
| 72 | `codeblocks.closeProject` | 关闭工程 | · | ✔ | · | · | · | · | ✅ |
| 73 | `codeblocks.saveProject` | 保存工程 | · | ✔ | · | · | · | · | ✅ |
| 74 | `codeblocks.saveProjectAs` | Code::Blocks: 工程另存为... | · | ✔ | · | · | · | · | ✅ |
| 75 | `codeblocks.saveWorkspace` | Code::Blocks: 保存工作区 | · | ✔ | · | · | · | · | ✅ |
| 76 | `codeblocks.saveWorkspaceAs` | Code::Blocks: 工作区另存为... | · | ✔ | · | · | · | · | ✅ |
| 77 | `codeblocks.closeWorkspace` | Code::Blocks: 关闭工作区 | · | ✔ | · | · | · | · | ✅ |
| 78 | `codeblocks.openDefaultWorkspace` | Code::Blocks: 打开默认工作区 | · | ✔ | · | · | · | · | ✅ |
| 79 | `codeblocks.removeFiles` | 移除文件… | · | ✔ | · | · | · | · | ✅ |
| 80 | `codeblocks.projectTree.expandAll` | 全部展开 | · | ✔ | · | · | · | · | ✅ |
| 81 | `codeblocks.projectTree.collapseAll` | 全部折叠 | · | ✔ | · | · | · | · | ✅ |
| 82 | `codeblocks.reloadProject` | Code::Blocks: 从磁盘重新加载工程 | · | ✔ | · | · | · | · | ✅ |
| 83 | `codeblocks.buildProject` | 构建 | · | ✔ | · | · | · | · | ✅ |
| 84 | `codeblocks.rebuildProject` | 重新构建 | · | ✔ | · | · | · | · | ✅ |
| 85 | `codeblocks.cleanProject` | 清理 | · | ✔ | · | · | · | · | ✅ |
| 86 | `codeblocks.addFile` | 添加文件... | · | ✔ | · | · | · | · | ✅ |
| 87 | `codeblocks.addFilesRecursively` | 递归添加文件... | · | ✔ | · | · | · | · | ✅ |
| 88 | `codeblocks.findFile` | 查找文件... | · | ✔ | · | · | · | · | ✅ |
| 89 | `codeblocks.searchProjectFiles` | 工程搜索：查找工程文件 | · | ✔ | · | · | · | · | ✅ |
| 90 | `codeblocks.searchInProjectFiles` | 工程搜索：在工程文件中搜索 | · | ✔ | · | · | · | · | ✅ |
| 91 | `codeblocks.fileProperties` | 属性... | · | ✔ | · | · | · | ✔ | ✅ |
| 92 | `codeblocks.renameFile` | 重命名文件... | · | ✔ | · | · | · | · | ✅ |
| 93 | `codeblocks.newVirtualFolder` | 新建虚拟文件夹... | · | ✔ | · | · | · | · | ✅ |
| 94 | `codeblocks.renameVirtualFolder` | 重命名虚拟文件夹... | · | ✔ | · | · | · | · | ✅ |
| 95 | `codeblocks.deleteVirtualFolder` | 删除虚拟文件夹 | · | ✔ | · | · | · | · | ✅ |
| 96 | `codeblocks.removeFile` | 从工程移除文件 | · | ✔ | · | · | · | · | ✅ |
| 97 | `codeblocks.openContainingFolder` | 打开所在文件夹 | · | ✔ | · | · | · | · | ✅ |
| 98 | `codeblocks.toggleCompile` | 编译文件 | · | ✔ | · | · | · | · | ✅ |
| 99 | `codeblocks.toggleLink` | 链接文件 | · | ✔ | · | · | · | · | ✅ |
| 100 | `codeblocks.compileFile` | 构建文件 | · | ✔ | · | · | ✔ | · | ✅ |
| 101 | `codeblocks.cleanFile` | 清理文件 | · | ✔ | · | · | · | · | ✅ |
| 102 | `codeblocks.editFileBuildCommand` | 编辑自定义构建命令... | · | ✔ | · | · | · | · | ✅ |
| 103 | `codeblocks.nextError` | Code::Blocks: 下一个错误 | · | ✔ | · | · | · | ✔ | ✅ |
| 104 | `codeblocks.prevError` | Code::Blocks: 上一个错误 | · | · | · | · | · | ✔ | ✅ |
| 105 | `codeblocks.compileCurrentFile` | Code::Blocks: 编译当前文件 | · | ✔ | · | · | · | ✔ | ✅ |
| 106 | `codeblocks.clearErrors` | Code::Blocks: 清除全部错误 | · | ✔ | · | · | · | ✔ | ✅ |
| 107 | `codeblocks.activatePriorProject` | Code::Blocks: 激活上一个工程 | · | ✔ | · | · | · | · | ✅ |
| 108 | `codeblocks.activateNextProject` | Code::Blocks: 激活下一个工程 | · | ✔ | · | · | · | · | ✅ |
| 109 | `codeblocks.toggleCategorize` | Code::Blocks: 按文件类型分组显示工程树 | · | ✔ | · | · | · | ✔ | ✅ |
| 110 | `codeblocks.clearRecentProjects` | Code::Blocks: 清除最近工程 | · | ✔ | · | · | · | · | ✅ |
| 111 | `codeblocks.projectNotes` | Code::Blocks: 工程备注 | · | ✔ | · | · | · | · | ✅ |
| 112 | `codeblocks.setProgramArguments` | Code::Blocks: 设置程序参数 | · | ✔ | · | · | · | · | ✅ |
| 113 | `codeblocks.showGlobalVariables` | Code::Blocks: 显示全局变量 | · | ✔ | · | · | · | ✔ | ✅ |
| 114 | `codeblocks.backtickCache` | Code::Blocks: 反引号缓存... | · | ✔ | · | · | · | · | ✅ |
| 115 | `codeblocks.clearBacktickCache` | Code::Blocks: 清除反引号缓存 | · | ✔ | · | · | · | · | ✅ |
| 116 | `codeblocks.keybindings.check` | Code::Blocks: 检查快捷键冲突 | · | · | · | · | · | ✔ | ✅ |
| 117 | `codeblocks.keybindings.apply` | Code::Blocks: 应用快捷键 | · | ✔ | · | · | · | ✔ | ✅ |
| 118 | `codeblocks.keybindings.configure` | Code::Blocks: 配置快捷键... | · | ✔ | · | · | · | · | ✅ |
| 119 | `codeblocks.keybindings.reset` | Code::Blocks: 重置快捷键 | · | ✔ | · | · | · | ✔ | ✅ |
| 120 | `codeblocks.keybindings.panel` | Code::Blocks: 快捷键设置 | · | ✔ | · | ✔ | · | ✔ | ✅ |
| 121 | `codeblocks.keybindings.export` | Code::Blocks: 导出快捷键方案 | · | ✔ | · | · | · | · | ✅ |
| 122 | `codeblocks.keybindings.import` | Code::Blocks: 导入快捷键方案 | · | ✔ | · | · | · | · | ✅ |
| 123 | `codeblocks.debug.refreshRegisters` | Code::Blocks: 刷新寄存器 | · | · | · | · | · | ✔ | ✅ |
| 124 | `codeblocks.debug.sendGdbCommand` | Code::Blocks: 发送 GDB 命令... | · | ✔ | · | · | · | · | ✅ |
| 125 | `codeblocks.debug.setNextStatement` | Code::Blocks: 设置下一条语句 | · | ✔ | · | · | · | ✔ | ✅ |
| 126 | `codeblocks.debug.nextInstruction` | Code::Blocks: 单步指令 | · | ✔ | · | · | · | · | ✅ |
| 127 | `codeblocks.debug.stepIntoInstruction` | Code::Blocks: 单步进入指令 | · | ✔ | · | · | · | · | ✅ |
| 128 | `codeblocks.debug.examineMemory` | Code::Blocks: 查看内存... | · | ✔ | · | · | · | · | ✅ |
| 129 | `codeblocks.debug.attachToProcess` | Code::Blocks: 附加到进程... | · | ✔ | · | · | · | · | ✅ |
| 130 | `codeblocks.debug.detach` | Code::Blocks: 分离调试 | · | ✔ | · | · | · | · | ✅ |
| 131 | `codeblocks.debug.addSymbolFile` | Code::Blocks: 添加符号文件... | · | ✔ | · | · | · | · | ✅ |
| 132 | `codeblocks.debug.infoFrame` | Code::Blocks: 调试信息 · 当前栈帧 | · | ✔ | · | · | · | ✔ | ✅ |
| 133 | `codeblocks.debug.infoSharedLibrary` | Code::Blocks: 调试信息 · 已加载库 | · | ✔ | · | · | · | · | ✅ |
| 134 | `codeblocks.debug.infoFiles` | Code::Blocks: 调试信息 · 目标与文件 | · | ✔ | · | · | · | ✔ | ✅ |
| 135 | `codeblocks.debug.infoFloat` | Code::Blocks: 调试信息 · FPU 状态 | · | ✔ | · | · | · | · | ✅ |
| 136 | `codeblocks.debug.infoSignals` | Code::Blocks: 调试信息 · 信号处理 | · | ✔ | · | · | · | · | ✅ |

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
| 4 | `codeblocks.compiler.languageFlags` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 5 | `codeblocks.masterPath` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 6 | `codeblocks.compilerPrograms` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 7 | `codeblocks.saveBeforeBuild` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 8 | `codeblocks.noProjectCompile.useTaskTerminal` |  | ✔ | · | · | · | · | · | ✅ |
| 9 | `codeblocks.profiler.gprofPath` |  | ✔ | · | · | · | · | · | ✅ |
| 10 | `codeblocks.profiler.annotatedSource` |  | ✔ | · | · | · | · | · | ✅ |
| 11 | `codeblocks.parallelJobs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 12 | `codeblocks.build.compilerCache` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 13 | `codeblocks.build.compilerCachePath` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 14 | `codeblocks.build.skipIncludeDeps` |  | ✔ | · | ✔ | · | ✔ | · | ✅ |
| 15 | `codeblocks.build.linkInputExtensions` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 16 | `codeblocks.build.verboseOutput` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 17 | `codeblocks.build.profile` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 18 | `codeblocks.build.traceProcesses` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 19 | `codeblocks.build.lowerCompilerPriority` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 20 | `codeblocks.build.autoExcludeOutputs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 21 | `codeblocks.build.sampleSystem` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 22 | `codeblocks.build.performanceAdvisor` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 23 | `codeblocks.build.compileCommandsOnlyTargets` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 24 | `codeblocks.build.scriptExitGraceMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 25 | `codeblocks.build.scriptCommandTimeoutMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 26 | `codeblocks.build.strictQuoting` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 27 | `codeblocks.build.asmUsesCompilerVar` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 28 | `codeblocks.build.responseFile` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 29 | `codeblocks.build.cleanResponseFiles` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 30 | `codeblocks.maxReportedErrors` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 31 | `codeblocks.build.plainCbLog` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 32 | `codeblocks.build.persistLog` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 33 | `codeblocks.build.outputTimestamp` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 34 | `codeblocks.build.saveHtmlLog` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 35 | `codeblocks.build.saveHtmlLogFullCommandLine` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 36 | `codeblocks.log.english` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 37 | `codeblocks.ui.quietSuccess` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 38 | `codeblocks.ui.quietFailure` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 39 | `codeblocks.ui.buildLogAutoFocus` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 40 | `codeblocks.ui.buildLogFocusFirstError` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 41 | `codeblocks.workspace.pathGuard` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 42 | `codeblocks.detect.autoOpen` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 43 | `codeblocks.detect.autoOpenThreshold` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 44 | `codeblocks.detect.checkExternalChanges` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 45 | `codeblocks.projectTree.categorize` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 46 | `codeblocks.gdbTimeoutMs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 47 | `codeblocks.debug.initCommands` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 48 | `codeblocks.debug.userArguments` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 49 | `codeblocks.debug.disableInit` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 50 | `codeblocks.debug.printPretty` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 51 | `codeblocks.debug.printElements` |  | ✔ | ✔ | ✔ | · | · | · | ✅ |
| 52 | `codeblocks.debug.disassemblyFlavor` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 53 | `codeblocks.debug.instructionSet` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 54 | `codeblocks.debug.charset` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 55 | `codeblocks.debug.gdbPath` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 56 | `codeblocks.debug.trace` |  | ✔ | · | ✔ | · | · | · | ✅ |
| 57 | `codeblocks.debug.registers` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 58 | `codeblocks.debug.addOtherProjectDirs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 59 | `codeblocks.clangd.enabled` |  | ✔ | ✔ | ✔ | · | · | ✔ | ✅ |
| 60 | `codeblocks.clangd.buildLogDiagnostics` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 61 | `codeblocks.clangd.restartOnActiveProjectSwitch` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 62 | `codeblocks.clangd.forcedIncludes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 63 | `codeblocks.clangd.suppressedWarnings` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 64 | `codeblocks.clangd.suppressHeaderDiagnostics` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 65 | `codeblocks.clangd.unusedIncludes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 66 | `codeblocks.clangd.headerInsertion` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 67 | `codeblocks.clangd.indexBackground` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 68 | `codeblocks.clangd.indexStandardLibrary` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 69 | `codeblocks.clangd.clangTidy` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 70 | `codeblocks.clangd.completionAllScopes` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 71 | `codeblocks.clangd.inlayHints` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 72 | `codeblocks.clangd.documentationCommentFormat` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 73 | `codeblocks.clangd.excludeDirs` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 74 | `codeblocks.clangd.builtinHeaders` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 75 | `codeblocks.clangd.extraConfig` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 76 | `codeblocks.ui.language` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |
| 77 | `codeblocks.ui.projectToolbar` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 78 | `codeblocks.ui.symbolsView` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 79 | `codeblocks.ui.recentProjectsLimit` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 80 | `codeblocks.ui.findFileOpen` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 81 | `codeblocks.search.scope` |  | ✔ | · | · | · | · | · | ✅ |
| 82 | `codeblocks.search.keepHistory` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 83 | `codeblocks.editor.autoHeaderGuard` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 84 | `codeblocks.editor.headerGuardStyle` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 85 | `codeblocks.editor.tidyCommentWidth` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 86 | `codeblocks.editor.asmHashComment` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 87 | `codeblocks.astyleOptions` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 88 | `codeblocks.todo.keywords` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 89 | `codeblocks.tools` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 90 | `codeblocks.keybindings.cbStyle` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 91 | `codeblocks.keybindings.overrides` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 92 | `codeblocks.agent.enabled` |  | ✔ | ✔ | · | · | · | · | ✅ |
| 93 | `codeblocks.agent.readOnly` |  | ✔ | ✔ | · | · | · | ✔ | ✅ |

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
