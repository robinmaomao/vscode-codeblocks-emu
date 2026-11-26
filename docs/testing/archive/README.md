# 测试与验收归档索引

> 本目录保存历史版本的测试报告、功能审计与 E3 手工验收记录；**当前版本**报告在 [`../test-report-0.10.0.md`](../test-report-0.10.0.md)。
> 测试方案见 [`../strategy.md`](../strategy.md)，发布说明索引见 [`../../release/00-index.md`](../../release/00-index.md)。

## 测试报告

| 文件 | 说明 |
|---|---|
| [test-report-0.8.139-full.md](./test-report-0.8.139-full.md) | 0.8.139 完整独立复核（七层、失败/SKIP 取证、ccache 与短路径专项） |
| [test-report-0.8.142-archive.md](./test-report-0.8.142-archive.md) | 0.8.142 链接期错误定位修复 |
| [test-report-0.8.143-agent-control-archive.md](./test-report-0.8.143-agent-control-archive.md) | 0.8.143 分支预发布：Agent 全控制 |
| [test-report-0.8.148-archive.md](./test-report-0.8.148-archive.md) | 0.8.148 Build Log 诊断跳转修复 |
| [test-report-0.8.150-archive.md](./test-report-0.8.150-archive.md) | 0.8.150 Build options / Properties 移植 |
| [test-report-0.8.152-archive.md](./test-report-0.8.152-archive.md) | 0.8.152 Build options / Properties 第二轮对齐（含 0.8.151 追加） |
| [test-report-0.8.155-archive.md](./test-report-0.8.155-archive.md) | 0.8.155 P3 架构批次 |
| [test-report-0.8.156-archive.md](./test-report-0.8.156-archive.md) | 0.8.156 Profiler / AutoVersioning / 编译器资源 |
| [test-report-0.8.157-archive.md](./test-report-0.8.157-archive.md) | 0.8.157 AutoVersioning / Profiler 正确性 |
| [test-report-0.8.158-archive.md](./test-report-0.8.158-archive.md) | 0.8.158 Profiler 命令拆分 |
| [test-report-0.8.159-archive.md](./test-report-0.8.159-archive.md) | 0.8.159 项目管理菜单拆分 |
| [test-report-0.8.160-archive.md](./test-report-0.8.160-archive.md) | 0.8.160 功能审计修复轮 |
| [test-report-0.9.0-archive.md](./test-report-0.9.0-archive.md) | 0.9.0 Agent 控制面合入 |
| [test-report-0.9.1-archive.md](./test-report-0.9.1-archive.md) | 0.9.1 clangd 重启修复 |
| [test-report-0.9.2-archive.md](./test-report-0.9.2-archive.md) | 0.9.2 合并后九轮复查 |
| [test-report-0.9.3-archive.md](./test-report-0.9.3-archive.md) | 0.9.3 Agent 上手体验与安全护栏 |

## 功能审计

| 文件 | 说明 |
|---|---|
| [functional-audit-0.8.159.md](./functional-audit-0.8.159.md) | 0.8.159 独立功能审计（136 命令 / 91 设置 / 34 键位 / 30 DAP） |
| [functional-audit-0.8.159-ledger.md](./functional-audit-0.8.159-ledger.md) | 上述审计的逐项台账（命令/设置/键位/语言/DAP/菜单） |
| [functional-audit-0.9.2.md](./functional-audit-0.9.2.md) | 0.9.2 全量逐项审计与修复（D-01…D-13） |

## 手工验收

| 文件 | 说明 |
|---|---|
| [e3-manual-report-0.9.2.md](./e3-manual-report-0.9.2.md) | 0.9.2 E3 GUI 验收（便携 VS Code + CDP 驱动真实工作台） |

## 说明

- 未单独出报告的版本（如 0.8.145 / 0.8.147 / 0.8.151）可从相邻版本报告或发布说明中查证。
- 归档文件只做脱敏与链接修正，不重写历史结论。
