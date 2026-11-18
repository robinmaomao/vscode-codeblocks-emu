# 测试执行报告（0.8.156 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.152 测试报告](./test-report-0.8.152-archive.md)；本版发布说明见 [release/0.8.156.md](../release/0.8.156.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 725 断言 |
| 无头层（unit） | `npm test` | **TOTAL=210 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；新增 profiler call graph/CSV/HTML、AutoVersioning 配置与构建钩子、TCC/BCC/DMC/ARM/PowerPC 编译器资源测试 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套；本机指纹走跨环境容差分支 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.156 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（25 用例）** | 真实 VS Code 1.85.0 宿主；**25 pass / 0 fail / 0 skip** |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| Profiler | `test-profiler-parse.js` **19 断言**（flat profile + call graph 条目/调用者边、CSV 转义、HTML 自包含与转义） | 本机 gprof 目标分析；-A 输出通道、QuickPick 导出路径 |
| AutoVersioning | `test-autoversioning.js` **23 断言**、`test-autoversioning-commands.js` **14 断言**（XML 往返、header 生成/解析、递增规则、构建前生成与构建后计数、命令接线） | 临时工程配置后执行 Build，检查 `version.h` 与 `BUILDS_COUNT` |
| 编译器资源 | `test-more-compilers.js` **33 断言**（5 套 XML 加载、命令模板、PATH 探测） | 本机无 BCC/DMC 安装，使用伪工具链验证探测路径 |
| 命令/设置 | `test-settings-structure.js` 38 断言；覆盖矩阵 136/91 | Settings 页面核对新增 profiler 设置 |
| 文档 | D1/D1b/D2/D3/D4/D5；新增推荐扩展页链接检查 | README / usage §16.1 / backlog 互链 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 136 | 136 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 91 | 91 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，数据来源 package.json v0.8.156）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | Profiler 完整化、AutoVersioning 子集、TCC/BCC/DMC/ARM/PowerPC 编译器资源、推荐扩展文档 |
| Profiler | call graph 解析/格式化、`gprof -A` 源码注解输出通道、CSV/HTML 导出、完成后 QuickPick |
| AutoVersioning | `.cbp <Extensions><AutoVersioning>` 读写、三个命令、构建前生成 `version.h`、成功后递增 `BUILDS_COUNT` |
| 编译器 | `options_{tcc,bcc,dmc,arm-elf-gcc,powerpc-eabi}.xml` + 对应 `compiler_*.xml`；PATH/常见目录探测 |
| 命令/设置规模 | 新增 3 个命令与 1 个设置项（136 / 91 / 6 / 34） |
| 新增测试 | `test-profiler-parse.js` 扩展、`test-autoversioning.js`、`test-autoversioning-commands.js`、`test-more-compilers.js` |
| 文档 | [release/0.8.156.md](../release/0.8.156.md)、发布页、推荐扩展双语文档、README / usage / progress / CHANGELOG / backlog 同步 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 单元测试 | call graph 根条目无 `called` 字段时未被解析 | 条目正则将 called 设为可选，根条目回退 `-` |
| 2 | 单元测试 | AutoVersioning 头文件生成出现双空格（对齐 CB 模板时遗留） | 统一单空格，测试覆盖 C/C++ 两种输出 |
| 3 | 契约测试 | 新增设置导致设置总数/文档覆盖失败 | 更新 `test-settings-structure`/`test-settings-contract` 期望并补 settings.md 行 |
| 4 | 覆盖矩阵 | 新命令未在测试层引用，3 项未覆盖 | 新增 `test-autoversioning-commands.js` 引用命令 ID + 接线断言，矩阵 100% |

## 5. 结论

- 单元 **210** / 契约 **3/3** / E2E **6/6** / 视觉 **26/26** / 性能 **13/13** / 打包 **15 断言** / 宿主 **25/25** 全部通过，无遗留失败。
- 命令 136 / 设置 91 / 视图 6 / 快捷键 34，覆盖率 100%。
- 有成熟替代的 Doxygen/打印/Fortran/环境变量/单库 nm/Valgrind 不内置，见 [推荐扩展](../guide/recommended-extensions.md)。
