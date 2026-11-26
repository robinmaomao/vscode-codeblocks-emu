# docs 目录索引

> 文档导航、命名规范与维护约定。目录按用途分组，文件名统一使用 **英文 kebab-case**，正文保持中文；英文版以 `.en.md` 结尾。
> 当前版本：**0.10.0**（Originium IDE for Code::Blocks）。

## 目录结构

```text
docs/
  README.md                目录索引（本文件）
  guide/                   面向使用者
    usage.md / .en.md      用户手册
    settings.md / .en.md   设置项完整参考
    alignment.md           与 Code::Blocks 对齐对照
    agent-control.md        Agent 控制（Copilot / MCP / CLI）
    agent-recipes.md        Agent 可复制示例
    agent-history.md        Agent 变更历史与撤销
    recommended-extensions.md 推荐替代扩展
  dev/                     面向贡献者
    architecture.md        模块地图、数据流、Feature 约定
    setup.md / .en.md      开发环境配置
    i18n.md / .en.md       国际化约定
    cb-porting-lessons.md  对话框移植经验
    backlog.md             未实现功能与不移植清单
    decisions.md           遗留问题决策
    progress.md            当前开发快照
  testing/                 测试与验收
    strategy.md            分层测试方案
    coverage-matrix.md     覆盖矩阵（自动生成）
    performance-baseline.md 性能基准（自动生成）
    manual-acceptance.md   手工验收清单
    test-report-0.10.0.md  当前版本测试报告
    archive/               历史报告 / 审计 / E3（含 README 索引）
  release/                 逐版本发布说明
    00-index.md            版本索引与 Release 页面模板
    <ver>.md               里程碑说明（详细）
    pages/<tag>.md         GitHub Release 正文（摘要，链接绝对）
    archive/               合并后的旧 dev 说明与根因报告
  images/                  文档截图与 GIF
```

## 入门与参考

| 文档 | 用途 |
|------|------|
| [guide/usage.md](./guide/usage.md) | 用户手册：安装、界面、构建、调试、快捷键、设置、FAQ、已知限制｜[English](./guide/usage.en.md) |
| [guide/settings.md](./guide/settings.md) | 设置项完整参考（10 个分区）｜[English](./guide/settings.en.md) |
| [guide/alignment.md](./guide/alignment.md) | 与 Code::Blocks 25.03 的逐项对齐依据与有意差异 |
| [guide/agent-control.md](./guide/agent-control.md) | Agent 控制：工具参考、工作流、开关与排障｜[English](./guide/agent-control.en.md) |
| [guide/agent-recipes.md](./guide/agent-recipes.md) | Agent 可复制示例｜[English](./guide/agent-recipes.en.md) |
| [guide/agent-history.md](./guide/agent-history.md) | Agent 变更历史与撤销｜[English](./guide/agent-history.en.md) |
| [guide/recommended-extensions.md](./guide/recommended-extensions.md) | 推荐替代扩展（打印、Doxygen、Fortran 等）｜[English](./guide/recommended-extensions.en.md) |

## 开发文档

| 文档 | 用途 |
|------|------|
| [dev/architecture.md](./dev/architecture.md) | 架构、模块地图、Feature 拆分约定 |
| [dev/setup.md](./dev/setup.md) | 开发环境（Node / w64devkit / 分层测试）｜[English](./dev/setup.en.md) |
| [dev/i18n.md](./dev/i18n.md) | 双语约定与实现｜[English](./dev/i18n.en.md) |
| [dev/cb-porting-lessons.md](./dev/cb-porting-lessons.md) | Build options / Properties 移植经验与踩坑 |
| [dev/backlog.md](./dev/backlog.md) | 唯一“未实现 / 不移植”清单 |
| [dev/decisions.md](./dev/decisions.md) | 历史核查项的处置结论 |
| [dev/progress.md](./dev/progress.md) | 当前进度快照、构建命令、关键踩坑 |

## 测试与验收

| 文档 | 用途 |
|------|------|
| [testing/test-report-0.10.0.md](./testing/test-report-0.10.0.md) | 当前版本测试报告（滚动更新） |
| [testing/strategy.md](./testing/strategy.md) | 分层测试体系（L-1…L5 + CI） |
| [testing/coverage-matrix.md](./testing/coverage-matrix.md) | 命令/视图/设置/键位/语法/DAP 覆盖台账（自动生成） |
| [testing/performance-baseline.md](./testing/performance-baseline.md) | 性能基准与趋势（自动生成） |
| [testing/manual-acceptance.md](./testing/manual-acceptance.md) | 不可自动化的手工验收项 |
| [testing/archive/README.md](./testing/archive/README.md) | 历史测试报告、功能审计、E3 验收索引 |

## 发布说明

- 索引与发布流程：[release/00-index.md](./release/00-index.md)。
- 当前版本：[release/0.10.0.md](./release/0.10.0.md)；GitHub 页面：[release/pages/0.10.0.md](./release/pages/0.10.0.md)。
- 历史 dev 说明合并归档：[release/archive/](./release/archive/)。
- 更名：0.10.0 起产品名为 **Originium IDE for Code::Blocks**，扩展 ID `robinmaomao.originium-ide`，VSIX 前缀 `originium-ide-`；`codeblocks.*` 命名空间不变。

## 命名与归档规范

- 文件名小写英文 kebab-case；英文版 `.en.md`；版本号原样保留（`0.8.137.md`、`0.8.129-dev.md`）。
- 带日期的归档用 `YYYY-MM-DD-` 前缀（`2026-11-04-rg-storm-root-cause.md`）。
- 目录职责：`guide/` 用户，`dev/` 开发过程，`testing/` 测试与验收（历史进 `archive/`），`release/` 发布说明（`pages/` 只放摘要，`archive/` 放合并历史）。
- 新报告在结论并入 release / decisions 后移入对应 `archive/`，不再堆在顶层。

## 维护约定

- **文档一致性**：`tests/contract/test-doc-consistency.js`（随 `npm run test:contract`）校验命令存在、相对链接有效、覆盖矩阵/性能基准计数与版本标记（D1–D5）。
- **覆盖矩阵**：新增/调整用例后 `npm run coverage:matrix`，并与当版测试报告 §2 台账一致。
- **性能基准**：构建链路变化后 `npm run perf:baseline`，再用 `npm run perf:report` 更新文档。
- **视觉基线**：UI/WebView 变化后 `npm run visual:baseline`，随 PR 附基线 PNG。
- **Release 页面**：新增/修改 `pages/<tag>.md` 后跑 `node tests/contract/gen-release-notes.js --check`；正文用 `--notes-file` 发布，标题只用纯版本号。

## 敏感信息约定

- 文档、注释、测试夹具中**禁止**出现真实个人目录（如 `E:\<私人目录>\...`）、内部项目/SDK 代号、个人机器名或硬件指纹。
- 统一占位符：`D:\work\demo-workspace`、`[demo]project`、`SDK_DEMO_BOARD_TEST_20260101`、`D:\tools`、`demo workspace`。
- 测试需要覆盖空格/方括号/盘符等语义时，用上述占位符构造，不要复制真实工程路径。
- 提交前用 `git grep -n "\[内部\]"` 查内部标记；示例路径只使用上方占位符，出现真实盘符目录或机器名即需替换。