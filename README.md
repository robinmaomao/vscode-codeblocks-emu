# Code::Blocks for VS Code

原生移植 Code::Blocks 核心功能到 VS Code 的扩展 —— 一个直接驱动 GCC/GDB 的「迷你 IDE 内核」，**不是** `.cbp` → `tasks.json` 的桥接。

直接在 VS Code 中打开 `.cbp` / `.workspace` 工程，即可获得与 Code::Blocks 对齐的构建、调试与工程浏览体验。

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE.md)

## 特性

- 📁 **原生工程解析**：直接加载 `.cbp` / `.workspace`（`fast-xml-parser`），完整还原 `Project` / `BuildTarget` / `ProjectFile` 内存模型，支持虚拟目标与虚拟文件夹。
- 🔨 **真实构建引擎**：不依赖 `tasks.json`。内置 Code::Blocks 的命令模板 + 宏展开（`$compiler $options $includes ...`），直接 `spawn` 编译/链接进程。
- ⚙️ **编译器管理**：完整解析 `options_<id>.xml`（含 `extends` 继承、`<if platform>` 平台分支、`<Common>` 引用），自动探测 GCC / MinGW / Clang / MSVC；支持从 Code::Blocks 的 `default.conf` 读取**用户自定义交叉编译器**（如 RISC-V）。
- 🐞 **GDB 调试**：自研内联 DAP 调试适配器，直接驱动 `gdb -i=mi`，支持断点、单步、变量、调用栈与表达式求值。
- 🚀 **对齐 Code::Blocks 细节**：
  - 增量编译（mtime 比对）、`rebuild` 强制重编译
  - pre/post build 脚本（`.bat` / 命令）
  - 对象目录 `CreateDirRecursively` 自动创建
  - `GetCommonTopLevelPath` 对象路径布局（`Output/obj/<公共顶层>/...`）
  - GBK 输出解码（中文 Windows 下 GCC 报错不乱码）
  - 目标类型数字映射（`type="1"` = 控制台应用，正确区分 `-mwindows`）
- 📊 **辅助工具**：代码统计、TODO 扫描、AStyle 格式化。

## 安装

### 从源码构建

```powershell
# 1. 安装依赖
npm install

# 2. 编译 TypeScript
npx tsc -p ./

# 3. 打包 VSIX
npx vsce package --allow-missing-repository

# 4. 安装
code --install-extension codeblocks-vscode-0.1.0.vsix --force
```

> Windows 下建议使用 `npm.cmd` / `npx.cmd`（PSReadLine 执行策略）。

### 开发调试

```powershell
code --extensionDevelopmentPath="." --disable-extensions --new-window
```

## 使用

1. 打开包含 `.cbp` / `.workspace` 的文件夹，或执行 **`Code::Blocks: Open Project (.cbp)`** 命令。
2. 左侧活动栏的 **Code::Blocks** 面板会显示工程树与构建日志。
3. 用面板工具栏或快捷键触发构建。

### 快捷键（与 Code::Blocks 对齐）

| 功能 | 快捷键 |
|------|--------|
| Build | `Ctrl+F9` |
| Build and Run | `F9` |
| Run | `Ctrl+F10` |
| Rebuild | `Ctrl+F11` |
| Clean | `Ctrl+Shift+F9` |
| Debug / Continue | `F8` |

### 命令

- `Code::Blocks: Open Project (.cbp)`
- `Code::Blocks: Build` / `Rebuild` / `Build and Run` / `Clean` / `Run`
- `Code::Blocks: Select Build Target`
- `Code::Blocks: Detect Compilers`
- `Code::Blocks: Compiler Options`
- `Code::Blocks: Debug`
- `Code::Blocks: Code Statistics` / `TODO List` / `Format with AStyle`

## 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `codeblocks.compilerId` | `gcc` | 默认编译器 ID（对应 `options_<id>.xml`） |
| `codeblocks.masterPath` | `` | 编译器安装根目录（留空则从 PATH 探测） |
| `codeblocks.parallelJobs` | `0` | 并行编译任务数（0 = 自动） |
| `codeblocks.saveBeforeBuild` | `true` | 构建前自动保存 |
| `codeblocks.compilerPrograms` | `{}` | 编译器程序完整路径（交叉编译器由探测自动写入） |
| `codeblocks.astyleOptions` | `["--style=allman", "--indent=spaces=4"]` | AStyle 格式化选项 |

## 架构

```
.cbp / .workspace (XML)
   → model/parser.ts        ProjectParser（.cbp/.workspace 解析）
   → model/types.ts         数据模型（TargetType / Project / BuildTarget / ProjectFile）
   → compiler/optionsLoader.ts   options_<id>.xml 完整解析（extends / 平台条件）
   → compiler/commandGenerator.ts  宏展开 + 命令行生成
   → build/buildEngine.ts    构建引擎（增量编译 + 派生进程 + 对象目录创建）
   → build/outputParser.ts   错误/警告解析 → VS Code Diagnostics
   → debug/gdbDebugAdapter.ts  DAP 调试适配器 → GDB MI
   → ui/projectTreeProvider.ts  工程树视图
```

### 源码结构

```
src/
├── extension.ts             扩展入口
├── model/                   .cbp/.workspace 解析 + 数据模型
├── compiler/                编译器模型 / XML 解析 / 命令生成 / 探测
├── build/                   构建引擎 / 输出解析 / 脚本执行
├── debug/                   GDB MI 会话 / DAP 适配器
├── tools/                   TODO 扫描 / 代码统计 / AStyle
└── ui/                      工程树 / 编译选项面板
```

## 交叉编译器（RISC-V 等）

扩展会从 `%APPDATA%\CodeBlocks\default.conf` 读取 Code::Blocks 的「用户自定义编译器」（`/compiler/user_sets/<id>`），自动解析其 `C_COMPILER` / `LINKER` 等可执行程序路径。因此 `.cbp` 中使用 `compiler="riscv32-v2"` 这类自定义编译器 ID 的工程，无需额外配置即可直接构建。

## 许可证

[GPL v3](LICENSE.md)。本项目从 Code::Blocks 源码（LGPL/GPL v3）移植核心逻辑，`resources/compilers/*.xml` 派生自 GPL v3 源码。
