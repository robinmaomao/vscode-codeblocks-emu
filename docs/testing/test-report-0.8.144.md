# 测试执行报告（0.8.144 · 滚动更新）

> 生成时间：2026-11-07 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.144.md](../release/0.8.144.md)；上一版发布说明见 [release/0.8.142.md](../release/0.8.142.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 686 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=187 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具）；新增 7 个工程搜索测试脚本 + `test-clangd-restart.js`（clangd 重启合并） |
| L3 视觉 | `npm run test:visual` | **24/24** | 现有面板布局未改动；搜索视图为 WebviewView，HTML 结构/i18n 由单元层覆盖 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 构建/调试链未改动；沿用 0.8.142 真实工具链结论 |
| L4 性能 | `npm run test:perf` | **13 项** | 搜索为按需触发，不引入常驻扫描；沿用既有基线 |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.144 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警；worker 单独产物已生成 |
| L2 宿主 | `npm run test:host` | **24/24（0 fail / 0 skip）** | 沿用 0.8.140 复核；本版为新增视图/命令，未改动构建/调试适配层 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 文件搜索纯逻辑（`src/search/projectSearch.ts`） | `tests/test-project-search.js` **31 断言**：条目构建/活动工程优先/跨工程去重/子树、空查询、token AND、子序列、签名、字面量/正则/非法正则、0-based 行列、预览偏移、零宽/超长行、UTF-16 BOM/二进制、字节预算 LRU、并发与中止 | 测试工程多工程排序；空查询浏览 |
| 内容搜索任务 + worker（`textSearchTasks.ts` / `textSearchWorker.ts`） | `tests/test-project-search-tasks.js` **16 断言**（UTF-16/二进制/大文件/脏文本/缓存/取消/全局上限）+ `tests/test-search-worker.js` **5 断言**（真实 Worker 启动、复用、进度、非法正则） | 真实 `bundle/search-worker.js` 冒烟（临时文件命中/0-based 行列） |
| 历史（`searchHistory.ts`） | `tests/test-search-history.js` **17 断言**：去重置顶、每模式 20 条、上次结果、重复搜索保留上次结果、精确匹配、损坏/版本回退、负坐标清理 | 视图内开关/点击/清空手工验收 |
| HTML / i18n | `tests/test-project-search-view-html.js` **13 断言**：CSP、历史栏顺序、switch、主题变量、无 `innerHTML`、无 `${}`、脚本可编译、消息协议、窄栏；`test-i18n-webview.js` 新增中英渲染与 55 个反查词条（21 断言全绿） | 深/浅主题、200px 窄侧栏 |
| Provider 协议 | `tests/test-project-search-view-provider.js` **18 断言**：ready/state、文件结果、活动工程、打开文件/匹配（0-based）、历史写入/上次结果、历史跳转、关闭保留历史、清空、状态持久化、子树范围、工程树定位 | 命令面板 / C::B Search 菜单 / 工程树右键 |
| 命令注册 | `tests/test-project-search-commands.js` **8 断言**：两个命令 ID 注册、`onView` 激活事件、视图声明 `type:"webview"`、进入 subscriptions、视图未解析时不抛错、工程树子树入口、dispose 幂等 | 命令面板实际调用；侧边栏实际渲染 |
| clangd 重启竞态 | `tests/test-clangd-restart.js` **22 断言**：合并窗口、最小间隔、取消、同步/异步异常安全、自定义参数；客户端状态门（无状态/Stopped/Starting→Running/超时/稳定期内停止）；`test-build-cpu-guards` 12 断言（含「自动重启仅两个请求入口 + 优先 `LanguageClient.restart()`」） | 修复 `command 'clangd.applyFix' already exists` → 打开工程不再中断语言服务器 |
| 回归安全 | `test-keybindings`（19 默认键）、`test-keybinding-config`（31 托管项）、`test-settings-structure`（85 设置）、`test-settings-coverage`（无死配置）、`test-menu-structure`、`test-bundle-packaging`（worker 产物/预发布顺序）全绿 | — |
| 文档与版本标记 | `test-contract.js` G1/G2/G3、`test-doc-consistency.js` D1/D1b/D3/D4/D5；`gen-release-notes.js --check` | `npm run coverage:matrix` 重新生成（命令 113 / 视图 6 / 设置 85 / 快捷键 34） |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 113 | 111 | 98% |
| 视图 | 6 | 6 | **100%** |
| 设置项 | 85 | 85 | **100%** |
| 快捷键 | 34 | 34 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 命令缺口 2 个：`codeblocks.detectCompilers`（交互式并行探测）、`codeblocks.restartClangd`（排障转发）。新增的两个搜索命令由 Provider/HTML/纯逻辑/命令注册测试覆盖。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | `codeblocks.search.scope`、`codeblocks.search.keepHistory`（设置项总数 83 → **85**） |
| 新增命令 | `codeblocks.searchProjectFiles`、`codeblocks.searchInProjectFiles`（命令总数 111 → **113**） |
| 新增视图 | `codeblocks.search`（视图总数 5 → **6**） |
| 新增快捷键 | `codeblocks.searchProjectFiles` → `Ctrl+Alt+P`（快捷键总数 33 → **34**） |
| 行为变更 | 新增工程内搜索，不替换内置搜索；`Reset View Layout` 侧栏顺序加入 Search；不提升 `UI_LAYOUT_VERSION` |
| 新增测试 | `test-project-search.js`、`test-search-history.js`、`test-project-search-tasks.js`、`test-search-worker.js`、`test-project-search-view-html.js`、`test-project-search-view-provider.js`、`test-project-search-commands.js` |
| 文档 | 新增 [release/0.8.144.md](../release/0.8.144.md) 与 [release/pages/0.8.144.md](../release/pages/0.8.144.md)；usage/settings/alignment/progress/manual-acceptance 同步；覆盖矩阵重新生成 |
| 行为边界 | 只搜索 `.cbp` 列出的文件；不写 `search.exclude`、不建 watcher、不调用 `workspace.findFiles` |

## 4. 缺陷与处置（本轮发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | 文件模式历史只在 `updateLastResult` 更新、未先 `addHistoryEntry` | 文件搜索打开结果后历史为空 | 打开结果时先新增历史，再写上次位置 |
| 2 | 内容搜索新请求取消旧请求时，旧 catch 可能继续回退扫描 | 旧结果/额外 CPU | 请求序号校验，过期请求直接返回 |
| 3 | 空查询时文件排序把活动工程权重乘 0 | 活动工程未置顶 | 排序增加 `isActive` 显式 tie-break |
| 4 | UTF-16 文本含 NUL，若先判二进制会被跳过 | UTF-16 工程内容搜索不到 | BOM 判定先于 NUL 检查 |
| 5 | WebviewView 未就绪时 `postMessage` 丢失 | 首次激活不聚焦 | `ready` 后重放状态与 `activated` |
| 6 | 新增设置用常量读取，设置覆盖扫描无法识别 | `test-settings-coverage` 失败 | 改为字面量 `.get('search.*')` |

## 5. 待办与已知限制

- **人工验收**：打开 `test-project`，按 [手工验收清单](./manual-acceptance.md) §9 执行文件/内容搜索、范围 chip、历史开关/点击跳转/重跑/清空、中英与深浅主题、窄侧栏。
- **已记录限制**：内容搜索逐文件扫描、无全工作区索引；超大工程建议使用更精确的查询或内置搜索；`Ctrl+Alt+P` 若被系统/其它扩展占用，可在快捷键面板改键。
