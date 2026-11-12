# release 目录索引

本目录存放**逐版本发布说明**；文件名遵循 `0.8.<版本>[-dev].md`。

## 正式版说明（保留）

| 版本 | 说明 |
|------|------|
| [0.8.11.md](./0.8.11.md) | 早期稳定版汇总（覆盖 0.8.3 → 0.8.11；自 main 分支补回） |
| [0.8.119.md](./0.8.119.md) | 0.8.12-dev → 0.8.119-dev 里程碑汇总 |
| [0.8.127.md](./0.8.127.md) | 0.8.120-dev → 0.8.127-dev 里程碑汇总 |
| [0.8.128.md](./0.8.128.md) | 0.8.127 → 0.8.128 里程碑汇总 |
| [0.8.129.md](./0.8.129.md) | 测试分层体系 + 缺陷 D-01…D-20 与 C-01 收口 |
| [0.8.130.md](./0.8.130.md) | post-build 输出实时化/心跳/超时与杀树 + 并行上限 32 + 诊断批量发布 + clangd 治理 |
| [0.8.131.md](./0.8.131.md) | 工作区检测开销治理 + clangd 设置即时生效 + 设置即时生效收口 |
| [0.8.132.md](./0.8.132.md) | 中英文界面语言切换（i18n） |
| [0.8.133.md](./0.8.133.md) | 构建日志补齐 Code::Blocks 产物体积行 |
| [0.8.134.md](./0.8.134.md) | 构建并发/CPU 守卫 + clangd 与 ccache 修复 |
| [0.8.135.md](./0.8.135.md) | 构建期进程/CPU 收口 + 产物排除写入用户设置 |
| [0.8.136.md](./0.8.136.md) | 工作区路径守卫 + AI 指令扫描治理 |
| [0.8.137.md](./0.8.137.md) | `.cbp` 外部修改检测 + 编译输出编码 + 工程属性面板修复 |
| [0.8.138.md](./0.8.138.md) | ccache 非 ASCII 路径修复（中文/特殊符号工程路径下缓存不生效） |
| [0.8.139.md](./0.8.139.md) | 8.3 短路径拼接修复（windres / Use83Paths）+ CI 回归与全量复核 |
| [0.8.140.md](./0.8.140.md) | 构建性能归因告警改为可选（`build.performanceAdvisor`，默认关闭） |
| [0.8.141.md](./0.8.141.md) | 打开工程后 clangd 不重启（不分析）修复 + 编译错误自动跳转修复 |
| [0.8.142.md](./0.8.142.md) | 链接期错误（undefined reference）定位与跳转修复 |
| [0.8.145.md](./0.8.145.md) | 工程内搜索（Project Search）：只搜索已打开 .cbp 工程，文件/内容双模式 + 历史；由 `feat/project-search` 通过 PR 合并 |
| [0.8.146.md](./0.8.146.md) | clangd `#ifdef` 关闭区域（inactive regions）不再变暗修复：语言客户端原地重启后装饰无法重建 |
| [0.8.147.md](./0.8.147.md) | 工程搜索体验：Text 结果排版对齐内置 Search + Files 模式 Search 按钮/同一行布局 + 切视图后两模式搜索记录保持 + 开关与选项置灰 |
| [0.8.148.md](./0.8.148.md) | Build Log（诊断来源 `build`）错误点击不跳转修复：链接期段名伪路径、`.o/.obj` 对象文件、无源码位置条目与 ANSI 彩色输出 |
| [0.8.150.md](./0.8.150.md) | 工程右键 `Build options…` / `Properties…` 完整移植 Code::Blocks：共享 Build options 视图、Compiler Flags 右键菜单（新建/修改/删除/仅 C/仅 C++/展开折叠）+ 覆盖与自定义参数、Silent build 派生、Selected compiler 自动匹配 |

## 分支预发布版本（branch prerelease）

分支开发默认使用「目标正式版 + 分支名」的 SemVer 预发布版本，便于区分本地/分支构建与正式版：

- 格式：`<目标正式版>-<分支 slug>[.<递增序号>]`；分支名中的 `/` 记为 `.`，其余字符仅保留 `[0-9A-Za-z.-]`。
  例：分支 `feat/project-search` → `0.8.144-feat.project-search`（目标正式版 `0.8.144`）；
  同一分支重复构建时递增末尾序号：`0.8.144-feat.project-search.1`、`.2` …（首个构建可省略 `.0`）。
- 同步位置：`package.json` / `package-lock.json`、`README*.md` 版本标记、`docs/guide/usage*.md` 版本与 VSIX 文件名、
  `CHANGELOG.md` 顶部标题、`docs/dev/progress.md` 当前版本、`docs/testing/test-report-<版本>.md` 文件名与标题、
  `docs/testing/coverage-matrix.md` 数据来源（由 `npm run coverage:matrix` 生成）。
- 分支预发布阶段只提交到功能分支，不创建 GitHub Release；VSIX 由本地 `npm run package` 生成，文件名随版本号带分支后缀。
- 转正式版时版本号回到纯 `x.y.z`，通过 PR 合并到 `main`，再按本文件前述流程生成 `pages/<tag>.md` 与 GitHub Release。

> `0.8.145` 已由 `feat/project-search` 通过 PR 合并到 `main`（正式版说明见 [0.8.145.md](./0.8.145.md)）；`0.8.146` / `0.8.147` / `0.8.148` 为其后的修复与体验版（见 [0.8.146.md](./0.8.146.md)、[0.8.147.md](./0.8.147.md)、[0.8.148.md](./0.8.148.md)）。

## 最近 dev 说明（保留）

- [0.8.129-dev.md](./0.8.129-dev.md)：测试分层体系落地（七层 + CI）+ 测试阶段缺陷修复 + 工具链/CI 加固。
- [0.8.135-dev.md](./0.8.135-dev.md)：构建期进程/CPU 收口 + 系统 CPU 归属采样现场记录。

## 历史归档

- [archive/0.8.2-0.8.46.md](./archive/0.8.2-0.8.46.md)：`0.8.2`–`0.8.46-dev` 逐版说明（原文保留）。
- [archive/0.8.76-0.8.99-dev.md](./archive/0.8.76-0.8.99-dev.md)：`0.8.76-dev`–`0.8.99-dev` 逐版说明（合并归档）。
- [archive/0.8.100-0.8.128-dev.md](./archive/0.8.100-0.8.128-dev.md)：`0.8.100-dev`–`0.8.128-dev` 逐版说明（合并归档）。
- `0.8.47-dev`–`0.8.75-dev` 未单独出发布说明，逐轮记录见 [`docs/dev/progress.md`](../dev/progress.md) 与
  [`docs/archive/progress-history-0.8.89.md`](../archive/progress-history-0.8.89.md)。

## GitHub Release 页面（pages/）

[`pages/`](./pages/) 存放**发布页正文**（每条 release 一个文件，文件名 = tag）。它们与里程碑说明的区别：

| | `release/<ver>.md` | `release/pages/<tag>.md` |
|---|---|---|
| 面向 | 仓库读者（历史与对齐依据） | GitHub Releases 页面访客 |
| 链接 | 相对（可点进仓库） | **绝对 URL**（Release 页面无仓库上下文） |
| 结构 | 自由（现象 / 根因 / 修复 / 验证） | **固定模板**（见下） |

生成与校验（`tests/contract/gen-release-notes.js`）：

```powershell
node tests/contract/gen-release-notes.js --check        # 校验全部发布页（CI/契约用）
node tests/contract/gen-release-notes.js --emit <tag>   # 输出到 .cb-tools/release-body/<tag>.md
node tests/contract/gen-release-notes.js --all          # 批量输出
```

发布页模板（对齐 `0.8.127`–`0.8.131`）：

```markdown
# Code::Blocks for VS Code <ver>

> 发布日期：YYYY-MM-DD ｜ 正式版（<上一版> → <ver> 里程碑汇总）

## 概述            ← 1 段定位 + 3–6 条 emoji 要点 + 「同时包含：…」
## <emoji> <主题>   ← 按主线分节，问题 / 根因 / 修复
## ✅ 验证          ← 分层回归数字 + 真机实测
## ⚠️ 行为变化与升级提示
## 📦 安装          ← 附件名 codeblocks-vscode-<ver>.vsix + VS Code 1.85.0+
## 📬 完整变更      ← 里程碑说明 + 提交对比（绝对链接）
```

发布步骤（`gh` 从仓库根执行）：

```powershell
node tests/contract/gen-release-notes.js --emit 0.8.142
gh release create 0.8.142 "release/codeblocks-vscode-0.8.142.vsix" `
  --title "0.8.142" --notes-file ".cb-tools/release-body/0.8.142.md"
gh release edit 0.8.142 --latest=true
```

约定：**Release 标题 = 纯版本号**（不带主题、不带英文）；正文一律用 `--notes-file` 传入（避免中文 / 反引号转义）；
`Latest` 只给最新一个版本；历史 tag（`v0.8.11-stable`）标题用纯版本号 `0.8.11`。

> 维护约定：新增发布说明用 `0.8.xx-dev.md`；发布后正式版里程碑同步进 [CHANGELOG](../../CHANGELOG.md)；
> 同时补一份 `pages/<tag>.md` 并跑 `--check`；提交日志不写轮次编号。
