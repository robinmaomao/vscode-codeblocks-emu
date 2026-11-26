# 功能审计逐项台账（0.8.159）

> 本文件是 [功能审计报告](./functional-audit-0.8.159.md) 的附录，记录 136 条命令、91 个设置、34 个键位、3 种语言、30 项 DAP 能力与 9 个菜单的逐项证据。
> 证据等级：E0 不可达 / E1 仅静态 / E2 无头执行 / E3 真实工具链 / E4 真实宿主 / E5 人工。
> 命令合并结果：behavior E2 72 / E3 2 / E4 10 / E1 52；入口执行 E2+ 136 / 136。
> 原始证据：`.cb-tools/audit-0.8.159/`（gitignored）。
> 修复轮结果（F-01/F-04/F-05/F-07…F-13 已实施；F-02/F-03/F-06 按用户决定不执行）见主报告 §11–§12。

## A. 命令证据（136）

`behavior` = 既有测试/分域探针是否断言命令入口效果；`entry` = 命令入口是否被实际执行（mock 冒烟 / 宿主）。`final` 取两者较高者。

| # | 命令 | 域 | behavior | entry | final | 探针 | mock | 宿主无工程 | 宿主有工程 |
|---|------|----|----------|-------|-------|------|------|------------|------------|
| 1 | `codeblocks.newProject` | 工程 | E2 | E2 | **E2** | new-project-wizard / new-project-overwrite | ok | skipped | skipped |
| 2 | `codeblocks.newProjectFromTemplate` | 工程 | E2 | E2 | **E2** | new-project-wizard / user-template-overwrite | ok | skipped | skipped |
| 3 | `codeblocks.newBuildTarget` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 4 | `codeblocks.newFile` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 5 | `codeblocks.saveProjectAsTemplate` | 工程 | E2 | E2 | **E2** | new-project-wizard | ok | skipped | skipped |
| 6 | `codeblocks.openProject` | 工程 | E3 | E2 | **E3** | — | ok | skipped | skipped |
| 7 | `codeblocks.build` | 构建运行 | E4 | E2 | **E4** | — | ok | skipped | skipped |
| 8 | `codeblocks.rebuild` | 构建运行 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 9 | `codeblocks.buildWorkspace` | 构建运行 | E2 | E2 | **E2** | command-sweep / run-flows | ok | skipped | skipped |
| 10 | `codeblocks.build.stop` | 构建运行 | E3 | E2 | **E3** | — | ok | ok | ok |
| 11 | `codeblocks.installCompilerCache` | 构建运行 | E2 | E2 | **E2** | test-install-guide | ok | ok | ok |
| 12 | `codeblocks.buildAndRun` | 构建运行 | E2 | E2 | **E2** | command-sweep / run-flows | ok | skipped | skipped |
| 13 | `codeblocks.compileFileWithoutProject` | 构建运行 | E2 | E2 | **E2** | — | ok | ok | ok |
| 14 | `codeblocks.buildLog.toggleErrorsOnly` | 构建运行 | E1 | E2 | **E2** | — | ok | ok | ok |
| 15 | `codeblocks.buildLog.showAllMessages` | 构建运行 | E1 | E2 | **E2** | — | ok | ok | ok |
| 16 | `codeblocks.buildLog.clearOutput` | 构建运行 | E1 | E2 | **E2** | — | ok | ok | ok |
| 17 | `codeblocks.buildLog.copyMessage` | 构建运行 | E2 | E2 | **E2** | misc-commands | ok | ok | ok |
| 18 | `codeblocks.buildLog.copyDiagnostic` | 构建运行 | E2 | E2 | **E2** | misc-commands | ok | ok | ok |
| 19 | `codeblocks.openRecentProject` | 工程 | E4 | E2 | **E4** | — | ok | ok | ok |
| 20 | `codeblocks.resetViewLayout` | 界面/键位 | E4 | E4 | **E4** | host-commands（真实宿主已应用） | ok | ok | ok |
| 21 | `codeblocks.analysis.refresh` | 其它 | E1 | E2 | **E2** | — | ok | ok | ok |
| 22 | `codeblocks.analysis.locate` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 23 | `codeblocks.analysis.copyXml` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 24 | `codeblocks.clean` | 构建运行 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 25 | `codeblocks.distClean` | 构建运行 | E2 | E2 | **E2** | makefile-project | ok | skipped | skipped |
| 26 | `codeblocks.cleanWorkspace` | 构建运行 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 27 | `codeblocks.rebuildWorkspace` | 构建运行 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 28 | `codeblocks.run` | 构建运行 | E2 | E2 | **E2** | command-sweep / run-flows | ok | skipped | skipped |
| 29 | `codeblocks.selectTarget` | 构建运行 | E1 | E2 | **E2** | — | ok | ok | ok |
| 30 | `codeblocks.selectProjectTarget` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 31 | `codeblocks.detectCompilers` | 工程 | E1 | E2 | **E2** | — | ui-pending | ok | ok |
| 32 | `codeblocks.workspaceScanReport` | 工程 | E2 | E2 | **E2** | — | ok | pending | pending |
| 33 | `codeblocks.checkWorkspacePath` | 工程 | E1 | E2 | **E2** | — | ok | ok | ok |
| 34 | `codeblocks.excludeBuildOutputs` | 工程 | E1 | E2 | **E2** | — | ok | ok | ok |
| 35 | `codeblocks.compilerOptions` | 构建运行 | E4 | E2 | **E4** | — | deferred | ok | ok |
| 36 | `codeblocks.projectProperties` | 工程 | E4 | E2 | **E4** | — | deferred | ok | ok |
| 37 | `codeblocks.generateCompileCommands` | clangd | E4 | E2 | **E4** | — | ok | ok | ok |
| 38 | `codeblocks.cleanClangdConfig` | 构建运行 | E2 | E2 | **E2** | — | ok | dialog-refused | ok |
| 39 | `codeblocks.restartClangd` | 其它 | E4 | E2 | **E4** | — | ok | ok | ok |
| 40 | `codeblocks.clangd.applyQueryDriver` | clangd | E2 | E2 | **E2** | — | ok | ok | ok |
| 41 | `codeblocks.debug` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 42 | `codeblocks.codeStats` | 编辑器工具 | E1 | E2 | **E2** | — | ok | ok | ok |
| 43 | `codeblocks.copyStrings` | 编辑器工具 | E1 | E2 | **E2** | — | ok | ok | ok |
| 44 | `codeblocks.profileTarget` | 版本/分析 | E2 | E2 | **E2** | profiler-command | ok | skipped | skipped |
| 45 | `codeblocks.autoVersioning` | 版本/分析 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 46 | `codeblocks.bumpVersion` | 版本/分析 | E1 | E2 | **E2** | — | ok | ok | ok |
| 47 | `codeblocks.generateVersionHeader` | 版本/分析 | E1 | E2 | **E2** | — | ok | ok | ok |
| 48 | `codeblocks.findSymbolInLibraries` | 其它 | E1 | E2 | **E2** | — | ok | ok | pending |
| 49 | `codeblocks.todoList` | 编辑器工具 | E1 | E2 | **E2** | — | ok | ok | ok |
| 50 | `codeblocks.todo.add` | 编辑器工具 | E2 | E2 | **E2** | language-comment-defects | ok | ok | ok |
| 51 | `codeblocks.bookmarks.toggle` | 编辑器工具 | E2 | E2 | **E2** | — | ok | ok | ok |
| 52 | `codeblocks.bookmarks.prev` | 编辑器工具 | E2 | E2 | **E2** | — | ok | ok | ok |
| 53 | `codeblocks.bookmarks.next` | 编辑器工具 | E2 | E2 | **E2** | — | ok | ok | ok |
| 54 | `codeblocks.bookmarks.clearAll` | 编辑器工具 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 55 | `codeblocks.openIncludeFile` | 搜索诊断 | E2 | E2 | **E2** | open-include（发现缺陷） | ok | ok | ok |
| 56 | `codeblocks.format` | 编辑器工具 | E2 | E2 | **E2** | — | ok | ok | ok |
| 57 | `codeblocks.insertHeaderGuard` | 其它 | E2 | E2 | **E2** | language-comment-defects（发现缺陷） | ok | ok | ok |
| 58 | `codeblocks.tidyComments` | 编辑器工具 | E1 | E2 | **E2** | — | ok | ok | ok |
| 59 | `codeblocks.swapHeaderSource` | 编辑器工具 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 60 | `codeblocks.runTool` | 构建运行 | E1 | E2 | **E2** | — | ok | ok | ok |
| 61 | `codeblocks.configureTools` | 编辑器工具 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 62 | `codeblocks.showCompilerCommands` | 编辑器工具 | E1 | E2 | **E2** | — | ok | ok | ok |
| 63 | `codeblocks.exportMakefile` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 64 | `codeblocks.workspace.editDependencies` | 工程 | E1 | E2 | **E2** | — | ok | ok | ok |
| 65 | `codeblocks.importProject` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 66 | `codeblocks.exportTargetAsProject` | 工程 | E2 | E2 | **E2** | — | ok | skipped | skipped |
| 67 | `codeblocks.openDefaultConfig` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 68 | `codeblocks.ui.switchLanguage` | 界面/键位 | E1 | E2 | **E2** | — | ok | ok | ok |
| 69 | `codeblocks.moveProjectUp` | 工程 | E2 | E2 | **E2** | — | ok | ok | ok |
| 70 | `codeblocks.moveProjectDown` | 工程 | E2 | E2 | **E2** | — | ok | ok | ok |
| 71 | `codeblocks.removeProject` | 工程 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 72 | `codeblocks.closeProject` | 工程 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 73 | `codeblocks.saveProject` | 工程 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 74 | `codeblocks.saveProjectAs` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 75 | `codeblocks.saveWorkspace` | 工程 | E1 | E2 | **E2** | — | ok | ok | pending |
| 76 | `codeblocks.saveWorkspaceAs` | 工程 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 77 | `codeblocks.closeWorkspace` | 工程 | E1 | E2 | **E2** | — | ok | ok | ok |
| 78 | `codeblocks.openDefaultWorkspace` | 工程 | E1 | E2 | **E2** | — | ok | dialog-refused | dialog-refused |
| 79 | `codeblocks.removeFiles` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 80 | `codeblocks.projectTree.expandAll` | 工程 | E1 | E2 | **E2** | — | ok | ok | ok |
| 81 | `codeblocks.projectTree.collapseAll` | 工程 | E1 | E2 | **E2** | — | ok | ok | ok |
| 82 | `codeblocks.reloadProject` | 工程 | E2 | E2 | **E2** | — | ok | ok | ok |
| 83 | `codeblocks.buildProject` | 构建运行 | E2 | E2 | **E2** | — | ok | ok | ok |
| 84 | `codeblocks.rebuildProject` | 构建运行 | E2 | E2 | **E2** | — | ok | skipped | skipped |
| 85 | `codeblocks.cleanProject` | 构建运行 | E2 | E2 | **E2** | — | ok | skipped | skipped |
| 86 | `codeblocks.addFile` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 87 | `codeblocks.addFilesRecursively` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | skipped | skipped |
| 88 | `codeblocks.findFile` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 89 | `codeblocks.searchProjectFiles` | 搜索诊断 | E1 | E2 | **E2** | — | ok | ok | ok |
| 90 | `codeblocks.searchInProjectFiles` | 搜索诊断 | E1 | E2 | **E2** | — | ok | ok | ok |
| 91 | `codeblocks.fileProperties` | 工程 | E2 | E2 | **E2** | — | ok | ok | ok |
| 92 | `codeblocks.renameFile` | 工程 | E2 | E2 | **E2** | — | ok | skipped | skipped |
| 93 | `codeblocks.newVirtualFolder` | 工程 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 94 | `codeblocks.renameVirtualFolder` | 工程 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 95 | `codeblocks.deleteVirtualFolder` | 工程 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 96 | `codeblocks.removeFile` | 工程 | E2 | E2 | **E2** | destructive-commands | ok | skipped | skipped |
| 97 | `codeblocks.openContainingFolder` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 98 | `codeblocks.toggleCompile` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 99 | `codeblocks.toggleLink` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 100 | `codeblocks.compileFile` | 构建运行 | E1 | E2 | **E2** | — | ok | ok | ok |
| 101 | `codeblocks.cleanFile` | 构建运行 | E2 | E2 | **E2** | — | ok | ok | ok |
| 102 | `codeblocks.editFileBuildCommand` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 103 | `codeblocks.nextError` | 搜索诊断 | E1 | E2 | **E2** | — | ok | ok | ok |
| 104 | `codeblocks.prevError` | 搜索诊断 | E1 | E2 | **E2** | — | ok | ok | ok |
| 105 | `codeblocks.compileCurrentFile` | 构建运行 | E2 | E2 | **E2** | misc-commands | ok | ok | ok |
| 106 | `codeblocks.clearErrors` | 其它 | E1 | E2 | **E2** | — | ok | ok | ok |
| 107 | `codeblocks.activatePriorProject` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 108 | `codeblocks.activateNextProject` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 109 | `codeblocks.toggleCategorize` | 界面/键位 | E1 | E2 | **E2** | — | ok | ok | ok |
| 110 | `codeblocks.clearRecentProjects` | 界面/键位 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 111 | `codeblocks.projectNotes` | 工程 | E2 | E2 | **E2** | lifecycle-commands | ok | ok | ok |
| 112 | `codeblocks.setProgramArguments` | 其它 | E2 | E2 | **E2** | — | ok | ok | ok |
| 113 | `codeblocks.showGlobalVariables` | 其它 | E1 | E2 | **E2** | — | ok | ok | ok |
| 114 | `codeblocks.backtickCache` | 其它 | E2 | E2 | **E2** | test-backticks-and-owner | ok | ok | ok |
| 115 | `codeblocks.clearBacktickCache` | 其它 | E2 | E2 | **E2** | test-backticks-and-owner | ok | ok | ok |
| 116 | `codeblocks.keybindings.check` | 界面/键位 | E1 | E2 | **E2** | — | ok | ok | ok |
| 117 | `codeblocks.keybindings.apply` | 界面/键位 | E4 | E2 | **E4** | — | deferred | ok | ok |
| 118 | `codeblocks.keybindings.configure` | 界面/键位 | E2 | E2 | **E2** | — | ok | ok | ok |
| 119 | `codeblocks.keybindings.reset` | 界面/键位 | E4 | E2 | **E4** | — | deferred | ok | ok |
| 120 | `codeblocks.keybindings.panel` | 界面/键位 | E4 | E2 | **E4** | — | deferred | ok | ok |
| 121 | `codeblocks.keybindings.export` | 界面/键位 | E2 | E2 | **E2** | — | ok | skipped | skipped |
| 122 | `codeblocks.keybindings.import` | 界面/键位 | E2 | E2 | **E2** | — | ok | skipped | skipped |
| 123 | `codeblocks.debug.refreshRegisters` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 124 | `codeblocks.debug.sendGdbCommand` | 调试 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 125 | `codeblocks.debug.setNextStatement` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 126 | `codeblocks.debug.nextInstruction` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 127 | `codeblocks.debug.stepIntoInstruction` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 128 | `codeblocks.debug.examineMemory` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 129 | `codeblocks.debug.attachToProcess` | 调试 | E2 | E2 | **E2** | misc-commands | deferred | skipped | skipped |
| 130 | `codeblocks.debug.detach` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 131 | `codeblocks.debug.addSymbolFile` | 调试 | E1 | E2 | **E2** | — | ok | skipped | skipped |
| 132 | `codeblocks.debug.infoFrame` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 133 | `codeblocks.debug.infoSharedLibrary` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 134 | `codeblocks.debug.infoFiles` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 135 | `codeblocks.debug.infoFloat` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |
| 136 | `codeblocks.debug.infoSignals` | 调试 | E1 | E2 | **E2** | — | ok | ok | ok |

### A.1 命令入口 / 菜单 / 键位 / 测试证据

| 命令 | 状态栏菜单 | 默认键位 | 执行证据（测试/探针） |
|------|------------|----------|------------------------|
| `codeblocks.newProject` | File/New Project… | — | new-project-wizard / new-project-overwrite |
| `codeblocks.newProjectFromTemplate` | File/From Template… | — | new-project-wizard / user-template-overwrite |
| `codeblocks.newBuildTarget` | File/New Build Target… [P] | — | lifecycle-commands |
| `codeblocks.newFile` | File/New File… [P] | — | lifecycle-commands |
| `codeblocks.saveProjectAsTemplate` | File/Save Project as Template… [P] | — | new-project-wizard |
| `codeblocks.openProject` | File/Open Project… | — | `tests/test-clangd-commands.js`<br>`tests/test-clangd-settings-sync.js`<br>`tests/test-command-handlers-file.js`<br>`tests/test-command-handlers-project.js`<br>`tests/test-d10-d11-regression.js`<br>`tests/e2e/test-e2e-boundary.js` |
| `codeblocks.build` | Build/Build [P] | `ctrl+f9` | `tests/e2e/test-e2e-boundary.js`<br>`tests/host/suite/build.tests.js`<br>`tests/host/suite/toolchain.tests.js` |
| `codeblocks.rebuild` | Build/Rebuild [P] | `ctrl+f11` | destructive-commands |
| `codeblocks.buildWorkspace` | Build/Build Workspace [P] | — | command-sweep / run-flows |
| `codeblocks.build.stop` | Build/Abort | — | `tests/e2e/test-e2e-boundary.js` |
| `codeblocks.installCompilerCache` | — | — | test-install-guide |
| `codeblocks.buildAndRun` | Build/Build and Run [P] | `f9` | command-sweep / run-flows |
| `codeblocks.compileFileWithoutProject` | — | — | `tests/test-command-handlers-editor.js` |
| `codeblocks.buildLog.toggleErrorsOnly` | — | — | mock sweep |
| `codeblocks.buildLog.showAllMessages` | — | — | mock sweep |
| `codeblocks.buildLog.clearOutput` | — | — | mock sweep |
| `codeblocks.buildLog.copyMessage` | — | — | misc-commands |
| `codeblocks.buildLog.copyDiagnostic` | — | — | misc-commands |
| `codeblocks.openRecentProject` | — | — | `tests/host/suite/build.tests.js`<br>`tests/host/suite/toolchain.tests.js`<br>`tests/host/suite/webview.tests.js` |
| `codeblocks.resetViewLayout` | View/Reset View Layout | — | host-commands（真实宿主已应用） |
| `codeblocks.analysis.refresh` | — | — | mock sweep |
| `codeblocks.analysis.locate` | — | — | `tests/test-command-handlers-editor.js` |
| `codeblocks.analysis.copyXml` | — | — | `tests/test-command-handlers-editor.js` |
| `codeblocks.clean` | Build/Clean [P] | — | destructive-commands |
| `codeblocks.distClean` | Build/Dist Clean [P] | — | makefile-project |
| `codeblocks.cleanWorkspace` | Build/Clean Workspace [P] | — | destructive-commands |
| `codeblocks.rebuildWorkspace` | Build/Rebuild Workspace [P] | — | destructive-commands |
| `codeblocks.run` | Build/Run [P] | `ctrl+f10` | command-sweep / run-flows |
| `codeblocks.selectTarget` | Build/Select Target… [P] | — | mock sweep |
| `codeblocks.selectProjectTarget` | — | — | `tests/test-external-changes.js` |
| `codeblocks.detectCompilers` | Tools/Detect Compilers… | — | — |
| `codeblocks.workspaceScanReport` | — | — | `tests/test-project-detect-scan.js` |
| `codeblocks.checkWorkspacePath` | — | — | mock sweep |
| `codeblocks.excludeBuildOutputs` | — | — | mock sweep |
| `codeblocks.compilerOptions` | Project/Build Options… [P] | — | `tests/test-compiler-options-apply.js`<br>`tests/host/suite/webview.tests.js` |
| `codeblocks.projectProperties` | File/Project Properties… [P]<br>Project/Properties… [P] | — | `tests/test-project-properties-save.js`<br>`tests/host/suite/webview.tests.js` |
| `codeblocks.generateCompileCommands` | Build/Export compile_commands.json… [P] | — | `tests/host/suite/build.tests.js` |
| `codeblocks.cleanClangdConfig` | Settings/Clean Stale clangd Config… | — | `tests/test-clangd-commands.js` |
| `codeblocks.restartClangd` | Settings/Restart clangd Language Server | — | `tests/host/suite/extension.tests.js` |
| `codeblocks.clangd.applyQueryDriver` | Settings/Configure clangd --query-driver… | — | `tests/test-clangd-commands.js` |
| `codeblocks.debug` | Debug/Start / Continue [P] | `f8` | mock sweep |
| `codeblocks.codeStats` | Tools/Code Statistics… [P] | — | mock sweep |
| `codeblocks.copyStrings` | Tools/Copy Strings | — | mock sweep |
| `codeblocks.profileTarget` | Tools/Profile Target [P] | — | profiler-command |
| `codeblocks.autoVersioning` | Tools/AutoVersioning… [P] | — | mock sweep |
| `codeblocks.bumpVersion` | Tools/Bump Version [P] | — | mock sweep |
| `codeblocks.generateVersionHeader` | Tools/Generate Version Header [P] | — | mock sweep |
| `codeblocks.findSymbolInLibraries` | Tools/Find Symbol in Libraries… [P] | — | mock sweep |
| `codeblocks.todoList` | View/TODO List [P] | — | mock sweep |
| `codeblocks.todo.add` | Edit/Add Todo Item… | — | `tests/test-command-handlers-editor.js` |
| `codeblocks.bookmarks.toggle` | Edit/Toggle Bookmark | `alt+k` | `tests/test-command-handlers-editor.js`<br>`tests/_harness/extensionActivation.js` |
| `codeblocks.bookmarks.prev` | Edit/Previous Bookmark | `alt+h` | `tests/test-command-handlers-editor.js` |
| `codeblocks.bookmarks.next` | Edit/Next Bookmark | `alt+l` | `tests/test-command-handlers-editor.js` |
| `codeblocks.bookmarks.clearAll` | Edit/Clear All Bookmarks | — | `tests/test-command-handlers-editor.js` |
| `codeblocks.openIncludeFile` | Search/Open Include File… | — | open-include（发现缺陷） |
| `codeblocks.format` | Tools/Format with AStyle | — | `tests/test-command-handlers-editor.js` |
| `codeblocks.insertHeaderGuard` | Edit/Insert Header Guard | — | language-comment-defects（发现缺陷） |
| `codeblocks.tidyComments` | Edit/Tidy Comments | — | mock sweep |
| `codeblocks.swapHeaderSource` | Edit/Swap Header / Source | — | lifecycle-commands |
| `codeblocks.runTool` | — | — | mock sweep |
| `codeblocks.configureTools` | Tools/Configure Tools… | — | mock sweep |
| `codeblocks.showCompilerCommands` | Tools/Show Compiler Commands… | — | mock sweep |
| `codeblocks.exportMakefile` | Build/Export Makefile… [P] | — | lifecycle-commands |
| `codeblocks.workspace.editDependencies` | Project/Workspace Dependencies… [P] | — | mock sweep |
| `codeblocks.importProject` | File/Import Project… | — | lifecycle-commands |
| `codeblocks.exportTargetAsProject` | Project/Create Project from Target… [P] | — | `tests/test-command-handlers-project.js` |
| `codeblocks.openDefaultConfig` | Settings/Default Config… | — | lifecycle-commands |
| `codeblocks.ui.switchLanguage` | — | — | mock sweep |
| `codeblocks.moveProjectUp` | Project/Move Project Up [P] | `ctrl+shift+up` | `tests/test-command-handlers-project.js` |
| `codeblocks.moveProjectDown` | Project/Move Project Down [P] | `ctrl+shift+down` | `tests/test-command-handlers-project.js` |
| `codeblocks.removeProject` | — | — | `tests/test-clangd-commands.js`<br>`tests/test-clangd-settings-sync.js`<br>`tests/test-command-handlers-project.js` |
| `codeblocks.closeProject` | File/Close Project [P] | — | destructive-commands |
| `codeblocks.saveProject` | File/Save Project [P] | — | destructive-commands |
| `codeblocks.saveProjectAs` | File/Save Project As… [P] | — | lifecycle-commands |
| `codeblocks.saveWorkspace` | File/Save Workspace | — | mock sweep |
| `codeblocks.saveWorkspaceAs` | File/Save Workspace As… | — | mock sweep |
| `codeblocks.closeWorkspace` | File/Close Workspace | — | mock sweep |
| `codeblocks.openDefaultWorkspace` | File/Open default workspace | — | mock sweep |
| `codeblocks.removeFiles` | Project/Remove Files… [P] | — | lifecycle-commands |
| `codeblocks.projectTree.expandAll` | — | — | mock sweep |
| `codeblocks.projectTree.collapseAll` | — | — | mock sweep |
| `codeblocks.reloadProject` | Project/Reload Project from Disk [P] | — | `tests/test-compiler-options-apply.js`<br>`tests/test-external-changes.js` |
| `codeblocks.buildProject` | — | — | `tests/test-command-handlers-project.js` |
| `codeblocks.rebuildProject` | — | — | `tests/test-command-handlers-project.js` |
| `codeblocks.cleanProject` | — | — | `tests/test-command-handlers-project.js` |
| `codeblocks.addFile` | Project/Add Files… [P] | — | lifecycle-commands |
| `codeblocks.addFilesRecursively` | Project/Add Files Recursively… [P] | — | lifecycle-commands |
| `codeblocks.findFile` | Project/Find File… | — | lifecycle-commands |
| `codeblocks.searchProjectFiles` | Search/Find Project Files… | `ctrl+alt+p` | mock sweep |
| `codeblocks.searchInProjectFiles` | Search/Search in Project Files… | — | mock sweep |
| `codeblocks.fileProperties` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.renameFile` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.newVirtualFolder` | Project/Add New Virtual Folder… [P] | — | mock sweep |
| `codeblocks.renameVirtualFolder` | — | — | mock sweep |
| `codeblocks.deleteVirtualFolder` | — | — | destructive-commands |
| `codeblocks.removeFile` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.openContainingFolder` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.toggleCompile` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.toggleLink` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.compileFile` | — | — | mock sweep |
| `codeblocks.cleanFile` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.editFileBuildCommand` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.nextError` | Build/Next Error | `f4`<br>`alt+f2` | mock sweep |
| `codeblocks.prevError` | Build/Previous Error | `shift+f4`<br>`alt+f1` | mock sweep |
| `codeblocks.compileCurrentFile` | Build/Compile Current File | `ctrl+shift+f9` | misc-commands |
| `codeblocks.clearErrors` | Build/Clear All Errors | — | mock sweep |
| `codeblocks.activatePriorProject` | Project/Activate Prior Project [P] | `alt+f5` | lifecycle-commands |
| `codeblocks.activateNextProject` | Project/Activate Next Project [P] | `alt+f6` | lifecycle-commands |
| `codeblocks.toggleCategorize` | Project/Categorize by File Types | — | mock sweep |
| `codeblocks.clearRecentProjects` | — | — | lifecycle-commands |
| `codeblocks.projectNotes` | Project/Notes… [P] | — | lifecycle-commands |
| `codeblocks.setProgramArguments` | Project/Set Programs' Arguments… [P] | — | `tests/test-external-changes.js` |
| `codeblocks.showGlobalVariables` | Settings/Global Variables… | — | mock sweep |
| `codeblocks.backtickCache` | Settings/Backtick Cache… | — | test-backticks-and-owner |
| `codeblocks.clearBacktickCache` | — | — | test-backticks-and-owner |
| `codeblocks.keybindings.check` | — | — | mock sweep |
| `codeblocks.keybindings.apply` | — | — | `tests/host/suite/extension.tests.js`<br>`tests/host/suite/webview.tests.js` |
| `codeblocks.keybindings.configure` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.keybindings.reset` | — | — | `tests/host/suite/extension.tests.js`<br>`tests/host/suite/webview.tests.js` |
| `codeblocks.keybindings.panel` | Settings/Keybindings… | — | `tests/host/suite/webview.tests.js` |
| `codeblocks.keybindings.export` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.keybindings.import` | — | — | `tests/test-command-handlers-file.js` |
| `codeblocks.debug.refreshRegisters` | — | — | mock sweep |
| `codeblocks.debug.sendGdbCommand` | Debug/Send GDB Command… [D] | — | mock sweep |
| `codeblocks.debug.setNextStatement` | Debug/Set Next Statement [D] | — | mock sweep |
| `codeblocks.debug.nextInstruction` | Debug/Next Instruction [D] | — | mock sweep |
| `codeblocks.debug.stepIntoInstruction` | Debug/Step Into Instruction [D] | — | mock sweep |
| `codeblocks.debug.examineMemory` | Debug/Examine Memory… [D] | — | mock sweep |
| `codeblocks.debug.attachToProcess` | Debug/Attach to Process… | — | misc-commands |
| `codeblocks.debug.detach` | Debug/Detach [D] | — | mock sweep |
| `codeblocks.debug.addSymbolFile` | Debug/Add Symbol File… [D] | — | mock sweep |
| `codeblocks.debug.infoFrame` | Debug/Current Stack Frame [D] | — | mock sweep |
| `codeblocks.debug.infoSharedLibrary` | Debug/Loaded Libraries [D] | — | mock sweep |
| `codeblocks.debug.infoFiles` | Debug/Targets and Files [D] | — | mock sweep |
| `codeblocks.debug.infoFloat` | Debug/FPU Status [D] | — | mock sweep |
| `codeblocks.debug.infoSignals` | Debug/Signal Handling [D] | — | mock sweep |

## B. 设置项（91）

`读取` = 源码中的读取点数量；`声明式` = package.json `when` 中 `config.<key>` 的直接使用；`测试` = 引用键名的测试文件数。

| # | 设置键 | 类型 / 默认 | 读取 | 声明式 | 测试 | 标记 |
|---|--------|-------------|------|--------|------|------|
| 1 | `codeblocks.compilerId` | string / "gcc" | 4 | 0 | 4 | — |
| 2 | `codeblocks.compiler.customFlags` | object / {} | 2 | 0 | 1 | — |
| 3 | `codeblocks.compiler.flagOverrides` | object / {} | 3 | 0 | 0 | not-in-tests |
| 4 | `codeblocks.compiler.languageFlags` | object / {} | 2 | 0 | 0 | not-in-tests |
| 5 | `codeblocks.masterPath` | string / "" | 4 | 0 | 5 | — |
| 6 | `codeblocks.compilerPrograms` | object / {} | 4 | 0 | 9 | — |
| 7 | `codeblocks.saveBeforeBuild` | boolean / true | 1 | 0 | 1 | — |
| 8 | `codeblocks.noProjectCompile.useTaskTerminal` | boolean / false | 2 | 0 | 0 | not-in-tests |
| 9 | `codeblocks.profiler.gprofPath` | string / "" | 1 | 0 | 0 | not-in-tests |
| 10 | `codeblocks.profiler.annotatedSource` | boolean / true | 1 | 0 | 0 | not-in-tests |
| 11 | `codeblocks.parallelJobs` | number / 8 | 5 | 0 | 7 | — |
| 12 | `codeblocks.build.compilerCache` | string / "none" | 3 | 0 | 5 | — |
| 13 | `codeblocks.build.compilerCachePath` | string / "" | 3 | 0 | 5 | — |
| 14 | `codeblocks.build.skipIncludeDeps` | boolean / false | 1 | 0 | 2 | — |
| 15 | `codeblocks.build.linkInputExtensions` | array / ["xm"] | 1 | 0 | 2 | — |
| 16 | `codeblocks.build.verboseOutput` | boolean / false | 1 | 0 | 2 | — |
| 17 | `codeblocks.build.profile` | boolean / false | 1 | 0 | 2 | — |
| 18 | `codeblocks.build.traceProcesses` | boolean / false | 2 | 0 | 1 | — |
| 19 | `codeblocks.build.lowerCompilerPriority` | boolean / false | 2 | 0 | 2 | — |
| 20 | `codeblocks.build.autoExcludeOutputs` | boolean / true | 1 | 0 | 2 | — |
| 21 | `codeblocks.build.sampleSystem` | boolean / false | 2 | 0 | 1 | — |
| 22 | `codeblocks.build.performanceAdvisor` | boolean / false | 2 | 0 | 1 | — |
| 23 | `codeblocks.build.compileCommandsOnlyTargets` | boolean / false | 1 | 0 | 1 | — |
| 24 | `codeblocks.build.scriptExitGraceMs` | number / 1500 | 1 | 0 | 1 | — |
| 25 | `codeblocks.build.scriptCommandTimeoutMs` | number / 0 | 1 | 0 | 1 | — |
| 26 | `codeblocks.build.strictQuoting` | boolean / false | 2 | 0 | 1 | — |
| 27 | `codeblocks.build.asmUsesCompilerVar` | boolean / false | 1 | 0 | 1 | — |
| 28 | `codeblocks.build.responseFile` | string / "safe" | 1 | 0 | 1 | — |
| 29 | `codeblocks.build.cleanResponseFiles` | boolean / false | 1 | 0 | 2 | — |
| 30 | `codeblocks.maxReportedErrors` | number / 50 | 1 | 0 | 1 | — |
| 31 | `codeblocks.build.plainCbLog` | boolean / false | 2 | 0 | 3 | — |
| 32 | `codeblocks.build.persistLog` | boolean / false | 3 | 0 | 8 | — |
| 33 | `codeblocks.build.outputTimestamp` | boolean / false | 2 | 0 | 2 | — |
| 34 | `codeblocks.build.saveHtmlLog` | boolean / false | 2 | 0 | 2 | — |
| 35 | `codeblocks.build.saveHtmlLogFullCommandLine` | boolean / false | 2 | 0 | 1 | — |
| 36 | `codeblocks.log.english` | boolean / false | 2 | 0 | 2 | — |
| 37 | `codeblocks.ui.quietSuccess` | boolean / false | 2 | 0 | 1 | — |
| 38 | `codeblocks.ui.quietFailure` | boolean / false | 1 | 0 | 2 | — |
| 39 | `codeblocks.ui.buildLogAutoFocus` | string / "errors" | 1 | 0 | 2 | — |
| 40 | `codeblocks.ui.buildLogFocusFirstError` | boolean / true | 1 | 0 | 2 | — |
| 41 | `codeblocks.workspace.pathGuard` | string / "prompt" | 2 | 0 | 1 | — |
| 42 | `codeblocks.detect.autoOpen` | string / "all" | 1 | 0 | 2 | — |
| 43 | `codeblocks.detect.autoOpenThreshold` | number / 20 | 1 | 0 | 2 | — |
| 44 | `codeblocks.detect.checkExternalChanges` | string / "prompt" | 1 | 0 | 1 | — |
| 45 | `codeblocks.projectTree.categorize` | boolean / true | 2 | 0 | 1 | — |
| 46 | `codeblocks.gdbTimeoutMs` | number / 30000 | 1 | 0 | 2 | — |
| 47 | `codeblocks.debug.initCommands` | array / [] | 1 | 0 | 1 | — |
| 48 | `codeblocks.debug.userArguments` | string / "" | 1 | 0 | 1 | — |
| 49 | `codeblocks.debug.disableInit` | boolean / true | 1 | 0 | 3 | — |
| 50 | `codeblocks.debug.printPretty` | boolean / false | 1 | 0 | 1 | — |
| 51 | `codeblocks.debug.printElements` | number / 0 | 1 | 0 | 2 | — |
| 52 | `codeblocks.debug.disassemblyFlavor` | string / "default" | 1 | 0 | 1 | — |
| 53 | `codeblocks.debug.instructionSet` | string / "" | 1 | 0 | 1 | — |
| 54 | `codeblocks.debug.charset` | string / "" | 1 | 0 | 1 | — |
| 55 | `codeblocks.debug.gdbPath` | string / "" | 2 | 0 | 2 | — |
| 56 | `codeblocks.debug.trace` | boolean / false | 2 | 0 | 1 | — |
| 57 | `codeblocks.debug.registers` | boolean / false | 2 | 0 | 4 | — |
| 58 | `codeblocks.debug.addOtherProjectDirs` | boolean / false | 1 | 0 | 1 | — |
| 59 | `codeblocks.clangd.enabled` | boolean / true | 2 | 0 | 7 | — |
| 60 | `codeblocks.clangd.buildLogDiagnostics` | string / "build" | 1 | 0 | 2 | — |
| 61 | `codeblocks.clangd.restartOnActiveProjectSwitch` | boolean / true | 1 | 0 | 2 | — |
| 62 | `codeblocks.clangd.forcedIncludes` | array / ["global.h"] | 2 | 0 | 1 | — |
| 63 | `codeblocks.clangd.suppressedWarnings` | array / ["-Wunused-function","redefinition_different_typedef"] | 2 | 0 | 2 | — |
| 64 | `codeblocks.clangd.suppressHeaderDiagnostics` | boolean / true | 2 | 0 | 1 | — |
| 65 | `codeblocks.clangd.unusedIncludes` | string / "none" | 2 | 0 | 2 | — |
| 66 | `codeblocks.clangd.headerInsertion` | string / "never" | 2 | 0 | 2 | — |
| 67 | `codeblocks.clangd.indexBackground` | string / "default" | 2 | 0 | 2 | — |
| 68 | `codeblocks.clangd.indexStandardLibrary` | string / "default" | 2 | 0 | 2 | — |
| 69 | `codeblocks.clangd.clangTidy` | string / "default" | 2 | 0 | 2 | — |
| 70 | `codeblocks.clangd.completionAllScopes` | string / "default" | 2 | 0 | 2 | — |
| 71 | `codeblocks.clangd.inlayHints` | string / "default" | 2 | 0 | 2 | — |
| 72 | `codeblocks.clangd.documentationCommentFormat` | string / "default" | 2 | 0 | 2 | — |
| 73 | `codeblocks.clangd.excludeDirs` | array / [] | 2 | 0 | 2 | — |
| 74 | `codeblocks.clangd.builtinHeaders` | string / "clangd" | 1 | 0 | 2 | — |
| 75 | `codeblocks.clangd.extraConfig` | string / "" | 2 | 0 | 2 | — |
| 76 | `codeblocks.ui.language` | string / "auto" | 6 | 0 | 12 | — |
| 77 | `codeblocks.ui.projectToolbar` | array / ["buildWorkspace","rebuildWorkspace","cleanWorkspace"] | 2 | 0 | 1 | — |
| 78 | `codeblocks.ui.symbolsView` | boolean / true | 0 | 1 | 2 | declarative-when |
| 79 | `codeblocks.ui.recentProjectsLimit` | number / 8 | 1 | 0 | 1 | — |
| 80 | `codeblocks.ui.findFileOpen` | boolean / false | 1 | 0 | 1 | — |
| 81 | `codeblocks.search.scope` | string / "openProjects" | 1 | 0 | 0 | not-in-tests |
| 82 | `codeblocks.search.keepHistory` | boolean / true | 2 | 0 | 1 | — |
| 83 | `codeblocks.editor.autoHeaderGuard` | boolean / false | 2 | 0 | 1 | — |
| 84 | `codeblocks.editor.headerGuardStyle` | string / "ifndef" | 1 | 0 | 1 | — |
| 85 | `codeblocks.editor.tidyCommentWidth` | number / 80 | 1 | 0 | 1 | — |
| 86 | `codeblocks.editor.asmHashComment` | boolean / false | 2 | 0 | 2 | — |
| 87 | `codeblocks.astyleOptions` | array / ["--style=allman","--indent=spaces=4"] | 1 | 0 | 1 | — |
| 88 | `codeblocks.todo.keywords` | array / ["TODO","FIXME","NOTE","HACK","XXX"] | 1 | 0 | 1 | — |
| 89 | `codeblocks.tools` | array / [] | 5 | 0 | 2 | — |
| 90 | `codeblocks.keybindings.cbStyle` | boolean / false | 2 | 12 | 2 | declarative-when |
| 91 | `codeblocks.keybindings.overrides` | object / {} | 3 | 0 | 4 | — |

## C. 快捷键（34）

| # | 键位 | 命令 | 类型 | when |
|---|------|------|------|------|
| 1 | `ctrl+alt+p` | `codeblocks.searchProjectFiles` | declared | `` |
| 2 | `ctrl+f9` | `codeblocks.build` | declared | `editorTextFocus` |
| 3 | `f9` | `codeblocks.buildAndRun` | declared | `editorTextFocus && !inDebugMode` |
| 4 | `ctrl+f10` | `codeblocks.run` | declared | `editorTextFocus` |
| 5 | `ctrl+f11` | `codeblocks.rebuild` | declared | `editorTextFocus` |
| 6 | `ctrl+shift+f9` | `codeblocks.compileCurrentFile` | declared | `editorTextFocus` |
| 7 | `f8` | `codeblocks.debug` | declared | `editorTextFocus` |
| 8 | `f4` | `codeblocks.nextError` | declared | `editorTextFocus` |
| 9 | `shift+f4` | `codeblocks.prevError` | declared | `editorTextFocus` |
| 10 | `alt+f5` | `codeblocks.activatePriorProject` | declared | `` |
| 11 | `alt+f6` | `codeblocks.activateNextProject` | declared | `` |
| 12 | `alt+f1` | `codeblocks.prevError` | declared | `editorTextFocus` |
| 13 | `alt+f2` | `codeblocks.nextError` | declared | `editorTextFocus` |
| 14 | `alt+g` | `workbench.action.quickOpen` | internal | `` |
| 15 | `alt+k` | `codeblocks.bookmarks.toggle` | declared | `editorTextFocus` |
| 16 | `alt+h` | `codeblocks.bookmarks.prev` | declared | `editorTextFocus` |
| 17 | `alt+l` | `codeblocks.bookmarks.next` | declared | `editorTextFocus` |
| 18 | `shift+f2` | `codeblocks.projectTree.focus` | internal | `` |
| 19 | `ctrl+shift+r` | `workbench.action.replaceInFiles` | internal | `!inSearchEditor` |
| 20 | `ctrl+shift+up` | `codeblocks.moveProjectUp` | declared | `focusedView == codeblocks.projectTree` |
| 21 | `ctrl+shift+down` | `codeblocks.moveProjectDown` | declared | `focusedView == codeblocks.projectTree` |
| 22 | `ctrl+e` | `editor.action.addSelectionToNextFindMatch` | internal | `editorTextFocus` |
| 23 | `f5` | `editor.debug.action.toggleBreakpoint` | internal | `config.codeblocks.keybindings.cbStyle && editorTextFocus` |
| 24 | `shift+f8` | `workbench.action.debug.stop` | internal | `config.codeblocks.keybindings.cbStyle && inDebugMode` |
| 25 | `f2` | `codeblocks.buildLog.focus` | internal | `config.codeblocks.keybindings.cbStyle` |
| 26 | `ctrl+r` | `editor.action.startFindReplaceAction` | internal | `config.codeblocks.keybindings.cbStyle && editorTextFocus` |
| 27 | `ctrl+shift+b` | `editor.action.jumpToBracket` | internal | `config.codeblocks.keybindings.cbStyle && editorTextFocus` |
| 28 | `ctrl+shift+c` | `editor.action.commentLine` | internal | `config.codeblocks.keybindings.cbStyle && editorTextFocus` |
| 29 | `ctrl+shift+s` | `workbench.action.files.saveAll` | internal | `config.codeblocks.keybindings.cbStyle` |
| 30 | `ctrl+q` | `workbench.action.quit` | internal | `config.codeblocks.keybindings.cbStyle` |
| 31 | `f12` | `editor.toggleFold` | internal | `config.codeblocks.keybindings.cbStyle && editorTextFocus` |
| 32 | `f7` | `workbench.action.debug.stepOver` | internal | `config.codeblocks.keybindings.cbStyle && inDebugMode` |
| 33 | `shift+f7` | `workbench.action.debug.stepInto` | internal | `config.codeblocks.keybindings.cbStyle && inDebugMode` |
| 34 | `ctrl+f7` | `workbench.action.debug.stepOut` | internal | `config.codeblocks.keybindings.cbStyle && inDebugMode` |

## D. 语言 / 语法（3 + 3）

| 语言 | 扩展名 | 语法 | 语言配置 | 测试文件 |
|------|--------|------|----------|----------|
| `ld` | `.ld`, `.lcf` | ./syntaxes/ld.tmLanguage.json (存在) | ./language-configurations/ld.json (存在) | 4 |
| `asm` | `.S`, `.s` | ./syntaxes/asm.tmLanguage.json (存在) | ./language-configurations/asm.json (存在) | 4 |
| `xm` | `.xm` | ./syntaxes/xm.tmLanguage.json (存在) | ./language-configurations/xm.json (存在) | 4 |

## E. DAP 能力（30）

| # | 能力 | 适配器实现 | E2E 证据 | 宿主证据 |
|---|------|------------|----------|----------|
| 1 | `initialize` | ✔ | 1 | 0 |
| 2 | `launch/attach` | ✔ | 1 | 2 |
| 3 | `setBreakpoints` | ✔ | 1 | 0 |
| 4 | `setFunctionBreakpoints` | ✔ | 1 | 0 |
| 5 | `setConditionalBreakpoints` | — | 1 | 0 |
| 6 | `hitCondition` | ✔ | 1 | 0 |
| 7 | `logMessage` | ✔ | 1 | 0 |
| 8 | `setDataBreakpoints` | ✔ | 1 | 0 |
| 9 | `setExceptionBreakpoints` | ✔ | 1 | 0 |
| 10 | `setInstructionBreakpoints` | ✔ | 1 | 0 |
| 11 | `configurationDone` | ✔ | 1 | 0 |
| 12 | `continue` | ✔ | 3 | 4 |
| 13 | `next` | ✔ | 1 | 1 |
| 14 | `stepIn` | ✔ | 1 | 0 |
| 15 | `stepOut` | ✔ | 1 | 0 |
| 16 | `pause/stop` | — | 1 | 0 |
| 17 | `threads` | ✔ | 1 | 1 |
| 18 | `stackTrace` | ✔ | 1 | 1 |
| 19 | `scopes` | ✔ | 1 | 1 |
| 20 | `variables` | ✔ | 1 | 1 |
| 21 | `setVariable` | ✔ | 1 | 0 |
| 22 | `evaluate` | ✔ | 1 | 0 |
| 23 | `disassemble` | ✔ | 1 | 0 |
| 24 | `readMemory` | ✔ | 1 | 0 |
| 25 | `writeMemory` | ✔ | 1 | 0 |
| 26 | `modules` | ✔ | 3 | 3 |
| 27 | `gotoTargets` | ✔ | 1 | 0 |
| 28 | `loadedSources` | ✔ | 1 | 0 |
| 29 | `terminate` | ✔ | 1 | 1 |
| 30 | `disconnect/detach` | — | 1 | 0 |

## F. 菜单（9 顶级 / 186 项 / 171 叶子）

| 顶级菜单 | 图标 | 直接子项 | 叶子命令 | 未注册命令 |
|----------|------|----------|----------|------------|
| File | `file` | 26 | 24 | 0 |
| Edit | `edit` | 32 | 36 | 0 |
| View | `eye` | 12 | 9 | 0 |
| Search | `search` | 17 | 15 | 0 |
| Project | `project` | 15 | 17 | 0 |
| Build | `tools` | 19 | 17 | 0 |
| Debug | `bug` | 29 | 29 | 0 |
| Tools | `wrench` | 11 | 11 | 0 |
| Settings | `gear` | 11 | 13 | 0 |

Code::Blocks 引用 `codeblocks.*` 叶子：99；未在 package.json 声明的命令：0。

## G. 文档 / NLS

| 项 | 结果 |
|----|------|
| 文档引用的命令 | 136 / 136 |
| 文档引用的设置 | 91 / 91 |
| settings.md / settings.en.md 表格行 | 91 / 91 |
| NLS 占位符 / en / zh | 307 / 307 / 307 |
| NLS 缺失 / 多余 | en 缺失 0、zh 缺失 0、en 多余 0、zh 多余 0 |
| 相对链接失效 | 0 |

## H. 测试脚本质量

| 分类 | 数量 |
|------|------|
| contract | 5 |
| e2e | 7 |
| host | 9 |
| pack | 1 |
| perf | 4 |
| unit-behavioral | 119 |
| unit-source-assertion | 82 |
| unit-print-only | 12 |
| visual | 5 |

### H.1 无断言 / 仅打印脚本

| 脚本 | 行数 | checks | 说明 |
|------|------|--------|------|
| `tests/test-dirs-settings-edit.js` | 48 | 0 | 仅打印，始终 exit 0 |
| `tests/test-file-edit.js` | 57 | 0 | 仅打印，始终 exit 0 |
| `tests/test-html-syntax.js` | 78 | 0 | 语法检查（new Function），非行为断言 |
| `tests/test-keybinding-panel-html.js` | 42 | 0 | 语法检查（new Function），非行为断言 |
| `tests/test-options-edit.js` | 42 | 0 | 仅打印，始终 exit 0 |
| `tests/test-relation-extracommands-edit.js` | 36 | 0 | 仅打印，始终 exit 0 |
| `tests/test-scripts-notes-edit.js` | 44 | 0 | 仅打印，始终 exit 0 |
| `tests/test-static-prefix.js` | 70 | 0 | 仅打印，始终 exit 0 |
| `tests/test-target-edit.js` | 92 | 0 | 仅打印，始终 exit 0 |
| `tests/test-vfolder-sim.js` | 87 | 0 | 仅打印，始终 exit 0 |
| `tests/test-vfolder.js` | 44 | 0 | 仅打印，始终 exit 0 |
| `tests/test-virtualtarget-edit.js` | 28 | 0 | 仅打印，始终 exit 0 |

## I. 静态风险扫描

| 项 | 数量 |
|----|------|
| 空 catch（含说明） | 120 |
| 无注释空 catch | 0 |
| readFileSync 未显式 encoding | 5 |
| spawn(..., shell:true) | 5 |
| exec 插值 | 1 |
| taskkill 调用点 | 14 |
| 键位冲突 | 0 |
| watcher 创建点 | 2 |
| XML 转义函数调用点 | 13 |

> `readFileSync` 未显式 encoding 的 5 处均交给 `decodeTextWithEncoding` / `decodeText` 处理（ANSI/UTF-8 自适应），不是缺陷。
> `spawn(..., shell:true)` 的 5 处为构建回退路径、用户自定义工具、宿主程序运行（用户可配置命令，语义即 shell）与 `shellSplit` 注释；均需保持 shell 语义。

## J. 证据文件索引

| 文件 | 内容 |
|------|------|
| `env.json` | 环境与工具链 |
| `baseline/*.log` | 7 层基线原始输出 |
| `ledger/commands.json` | 命令静态台账 |
| `ledger/settings.json` | 设置台账 |
| `ledger/keybindings.json` | 键位台账 |
| `ledger/languages.json` | 语言/语法台账 |
| `ledger/dap.json` | DAP 能力台账 |
| `ledger/menus.json` | 菜单台账 |
| `ledger/docs-claims.json` | 文档/NLS 核对 |
| `ledger/tests-quality.json` | 测试脚本质量分级 |
| `ledger/final-evidence.json` | 命令证据合并矩阵 |
| `results/command-sweep.json` | 136 命令 mock 冒烟 |
| `results/lifecycle-commands.json` | 生命周期命令探针（22 断言） |
| `results/destructive-commands.json` | 破坏性命令探针（13 断言） |
| `results/new-project-wizard.json` | 新建工程/用户模板探针（13 断言） |
| `results/new-project-overwrite.json` | 新建工程覆盖证据 |
| `results/user-template-overwrite.json` | 用户模板覆盖证据 |
| `results/language-comment-defects.json` | ld/todo/header guard 证据 |
| `results/open-include.json` | Open Include File 证据 |
| `results/makefile-project.json` | Makefile 项目 Build/Clean/DistClean |
| `results/misc-commands.json` | 复制诊断/编译当前文件/附加进程 |
| `results/profiler-command.json` | gprof 命令探针 |
| `host/results/host-commands.json` | 真实宿主 136 命令结果 |
| `host/results/host-run.log` | 宿主运行日志 |
| `parity/menu-parity.json` | CB main_menu.xrc 菜单对照 |
| `risk/scan.json` | 静态风险扫描 |

## K. 已知测试缺口（非产品缺陷）

- `tests/host/suite` 示例套件未覆盖 `vscode.languages.setLanguageConfiguration`（`editor.asmHashComment=true` 时 mock 宿主会抛错）；真实宿主 API 存在，属测试桩缺口。
- `profileTarget` 在短命程序上 gprof 无采样（`no time accumulated`），命令正确提示；需要长跑程序或 `-pg` 采样校准。
- `detectCompilers` 使用 `createQuickPick` 等待用户操作；mock 无 `onDidHide`，宿主内需 `workbench.action.closeQuickOpen`。
- `openDefaultWorkspace` / `cleanClangdConfig` 的模态确认在宿主测试模式下被 DialogService 拒绝（测试环境限制，不是产品行为）。
- `resetViewLayout` 的日志随 `ui.language` 翻译；测试需同时匹配中英文（本审计已修正探针）。
