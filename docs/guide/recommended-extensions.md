# 推荐的 VS Code 扩展（Code::Blocks 功能的补充）

> 语言：**中文** ｜ [English](./recommended-extensions.en.md)
>
> 适用版本：0.8.156+ ｜ 对应决策：[未实现功能待办](../dev/backlog.md) §2

Code::Blocks 的部分功能与 IDE 框架强绑定，或已有成熟的 VS Code 扩展。本扩展遵循「**有成熟替代就不重复实现**」的原则，不再内置这些功能，避免维护两套 UI、调试器和配置格式。下面按用途列出推荐扩展、扩展 ID 与使用要点。

> ⚠️ 以下均为第三方社区/厂商扩展，**不由本扩展提供、捆绑或背书**。安装前请自行查看其许可证、下载量、最近更新时间和权限；扩展 ID 以 VS Code Marketplace / Open VSX 的当前页面为准。

## 1. Doxygen 注释（对应 DoxyBlocks）

| 推荐扩展 | 扩展 ID | 适用场景 |
|---|---|---|
| Doxygen Documentation Generator | `cschlosser.doxdocgen` | 在函数/类上方输入 `/**` 自动生成 `@brief` / `@param` / `@return` 等模板；支持 C/C++/C#/Java 等 |
| Doxygen | `bbenoist.Doxygen` | 在 VS Code 内运行 Doxygen、查看生成文档；适合需要从 IDE 直接生成 HTML/LaTeX 的工程 |

使用建议：

- 本扩展负责**编译/调试**，Doxygen 扩展负责**文档生成**；两者互不依赖。
- DoxyBlocks 的 `Doxyfile` 仍可放在工程根目录；用 `bbenoist.Doxygen` 直接读取，不需要 `.cbp` 配置。
- 若工程已有 `Doxyfile`，建议把 `OUTPUT_DIRECTORY` 指到工作区外或 `.gitignore` 的目录，避免被本扩展的文件监视器当作源文件。

## 2. 打印（对应 File → Print）

| 推荐扩展 | 扩展 ID | 说明 |
|---|---|---|
| Nifty Print | `nifty.nifty-print` | 通过浏览器打印当前文件/选区，保留语法高亮 |
| Print2Paper | `appliedmedia.print2paper4vscode` | 面向纸张排版的打印/导出 |

VS Code 没有稳定的原生打印 API，本扩展不模拟 Code::Blocks 的打印对话框。需要打印时优先用上述扩展，或 `File → Print`（VS Code 内置命令，若当前版本提供）。

## 3. Modern Fortran（对应 Fortran 工程）

| 推荐扩展 | 扩展 ID | 说明 |
|---|---|---|
| Modern Fortran | `fortran-lang.linter-gfortran` | Fortran 语言支持、gfortran 诊断、补全与格式化；由 fortran-lang 社区维护 |
| Fortran Language Server | `cesiumlang.zfls` | 基于语言服务器的 Fortran 补全/跳转/悬停 |

Code::Blocks 的 Fortran 工程本质仍是「编译器 + 命令模板」。可在本扩展中把工程编译器设为 GCC/gfortran 兼容项，或使用 `codeblocks.compilerPrograms` 指向 `gfortran`；语法分析与补全交给上述扩展。

## 4. 环境变量（对应 Environment variables）

| 推荐扩展 | 扩展 ID | 说明 |
|---|---|---|
| Dotenv | `dotenv.dotenv-vscode` | `.env` 语法高亮、按文件注入环境变量；适合把敏感配置放在工作区外 |
| Env Sync | `nolindnaidoo.envsync-le` | 在多个工作区/机器之间同步环境变量配置 |

本扩展已经支持 `.cbp` 的 `<Environment><Variable>`（构建/运行时注入）和 `codeblocks.env` 设置。**不建议**再用第三方扩展重复注入同一变量：两处同时设置时，以本扩展的工程/目标环境变量为准。第三方扩展更适合 IDE 级（终端、任务、其他扩展）共享的变量。

## 5. 单库符号 / 反汇编查看（对应 SymTab 的单库模式）

| 推荐扩展 | 扩展 ID | 说明 |
|---|---|---|
| Nm tool | `wibren-wiersma.nm-tool` | 对单个 `.a` / `.o` / 可执行文件运行 `nm`，按符号类型浏览 |
| vscode-binutils | `sqlpassion.vscode-binutils` | `nm` / `objdump` 等 binutils 的图形化封装（**仅 Marketplace**，Open VSX 可能未同步） |

本扩展的 **Tools → Find Symbol in Libraries…** 面向「当前工程/目标链接的所有库」做跨库搜索；如果只想看某一个库的完整符号表，用上述扩展更直接。两者可以并用。

## 6. Profiler / Valgrind（可选，替代 callgrind 场景）

本扩展已内置 **Profile Target (gprof)**：运行目标 → `gmon.out` → gprof flat profile/call graph/源码注解/CSV·HTML 导出。以下扩展适合 **Valgrind/Callgrind** 生态，不替代 gprof：

| 推荐扩展 | 扩展 ID | 说明 |
|---|---|---|
| Blacksmith | `lucasalvcoutinho.blacksmith` | 在 VS Code 中运行/查看 Callgrind 结果（需要本机安装 Valgrind） |
| Valgrind Task Integration | `1nVitr0.valgrind-task-integration` | 把 Valgrind 工具接入 VS Code 任务/问题面板 |

在 Windows 上 Valgrind 通常不可用；Linux/macOS 工程如需 cachegrind/callgrind 的细粒度数据，可把本扩展的构建命令与上述扩展配合使用。

## 7. 代码分析 / 正则（既有推荐）

这两项已在 [使用说明 §16.1](./usage.md#161-建议用-vscode-扩展替代本扩展不另行实现) 中列出，这里保留索引：

| 用途 | 推荐扩展 ID |
|---|---|
| Cppcheck / 静态分析 | `cppchecksolutionsab.cppcheck-official` · `jbenden.c-cpp-flylint` · `emielestivenartentity.cppcheck-turbo` |
| 正则测试 | `chrmarti.regex` · `louiswt.regexp-preview` |

使用 Cppcheck 前，建议先执行本扩展的 **Build → Export compile_commands.json…**，让分析器使用与 Code::Blocks 相同的 `-I` / `-D` / 标准选项。

## 8. 选择原则

1. **本扩展负责**：`.cbp` / `.workspace` 解析、构建、调试、工程树、构建日志、gprof、跨库符号搜索。
2. **第三方扩展负责**：文档生成、打印、语言级补全/诊断（Fortran 等）、Valgrind、IDE 级环境变量同步。
3. **不重复实现**：同一能力已有稳定扩展时，本扩展只提供入口/文档，不复制其 UI 与配置。
4. **配置归属**：构建/调试相关变量优先放在 `.cbp` 或本扩展设置中；纯 IDE 级配置交给对应扩展，避免「两处都改、只生效一处」。

> 如果你发现表中扩展已停止维护或扩展 ID 变更，欢迎提交 Issue 更新本文档。
