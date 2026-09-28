# 第七十二轮 buildlog.html 默认生成核查分析报告

> 核查日期：2026-09-28 ｜ 基线版本：0.8.95-dev ｜ **只读审计（用户要求：不执行修复）**
> 触发问题：确认扩展在当前**默认配置**下是否还会生成 `buildlog.html`。

---

## 1. 结论（先说结论）

1. **不会。** 自 **0.8.93-dev**（第六十九轮修复，commit `c7edb4a`）起，任何默认配置下都不会再生成 `buildlog.html`：
   - 全仓库 `buildlog.html` **字面量为 0 命中**（src/dist/tests）；
   - 唯一 HTML 写入点被 `codeblocks.build.saveHtmlLog`（**默认 false**）**提前 return 门控**，且文件名模板固定为 **`<工程文件名>_build_log.html`**（工作区构建为 `<工作区文件名>_build_log.html`），不存在旧名 `buildlog.html` 的生成路径；
   - 当前已安装的 0.8.93-dev / 0.8.94-dev / 0.8.95-dev 三个产物均核对：**无旧写入逻辑、有门控、有新命名模板**。
2. **历史影响区间**：`buildlog.html` 自动写入是 **0.8.56-dev**（commit `8098406`，2026-09-26，"E7 SaveBuildLog：finishBuildSummary 自动写 buildlog.html"）引入的，**0.8.56-dev ～ 0.8.92-dev 的已安装产物全部"含写入且无门控"**——默认配置即会写文件。用户此前看到的现象来自该区间版本。
3. **残留说明**：旧版本遗留的 `buildlog.html` 文件扩展**不会生成、也不会自动删除**，需手工清理。当前 `test-project` 及仓库源码区已无任何此类残留。

---

## 2. 核查方法

| # | 方法 | 说明 |
|---|------|------|
| 1 | **静态扫描** | ① `src`/`dist`/`tests` 全量 `buildlog\.html` 字面量扫描；② 所有 `writeFileSync`/`.html` 写入点扫描；③ `saveHtmlBuildLog` 门控函数体逐行取证；④ package.json 默认值与设置计数 |
| 2 | **产物核对** | 本机 `~/.vscode/extensions` 下全部 72 个 `robinmaomao.codeblocks-vscode-*` 目录逐版本扫描（是否含旧写入 / 门控 / 新模板）+ `.obsolete` 生效状态 |
| 3 | **磁盘/运行时状态** | 仓库（含 `test-project`）全量 `*.html` 残留扫描；参考当日多轮 headless 真机构建后的磁盘状态 |

工具（只读，已被 `.gitignore` 忽略）：`.cb-audit.js` / `.cb-audit2.js` → 输出 `.cb-audit.txt` / `.cb-audit2.txt`。

---

## 3. 默认配置与门控取证

### 3.1 默认配置（`package.json`）

| 设置 | 默认值 | 位置 |
|---|---|---|
| `codeblocks.build.saveHtmlLog` | **`false`** | `package.json:596-600` |
| `codeblocks.build.saveHtmlLogFullCommandLine` | **`false`**（仅从属于上一项） | `package.json:601-605` |

### 3.2 唯一写入路径（`src/extension.ts`）

```
5754: function saveHtmlBuildLog(buildStartMs, scope, project?): void {
5755:   if (!vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.saveHtmlLog', false)) return;   ← 默认即在此返回
...
5789:   const file = path.join(dir, `${base}_build_log.html`);     ← 文件名模板（CB 对齐命名）
5790:   fs.writeFileSync(file, html, 'utf-8');                     ← 唯一的 HTML 写入点
```

- 调用点仅两处：`extension.ts:4712`（Build Workspace 收尾）、`:4800`（单工程构建收尾）——**都在函数门控之后**，默认不会走到任何目录/文件名计算与写盘。
- 名称推导：`buildLogBaseName()`（`src/build/htmlBuildLog.ts:17`，剥离扩展名）→ 例：`hello-cb.cbp` → `hello-cb_build_log.html`；`.workspace` → `<工作区文件名>_build_log.html`。**与旧名 `buildlog.html` 无关**。
- 渲染模块 `src/build/htmlBuildLog.ts` 为**纯函数（只拼字符串，不写文件）**；`renderHtmlBuildLog` 只在上述门控内被调用（另有测试直接调用做字符串断言）。

### 3.3 全仓字面量扫描结果

| 范围 | `buildlog.html` 字面量 |
|---|---|
| `src/**/*.ts` | **0 命中** |
| `dist/**/*.js`（编译产物） | **0 命中** |
| `tests/**/*.js` | **0 命中**（`test-html-build-log.js` 仅做渲染字符串断言，不写文件） |
| 仓库根 `.js` 脚本 | 仅 2 个**审计脚本自身**的说明文字（`.cb-audit*.js`，已忽略，非扩展代码） |

其它易混淆项（均非日志生成）：
- `resources/buildlog.svg` —— Build Log **面板图标**静态资源（非日志文件）；
- `extension.ts:2939` 的 `installation.html` —— clangd 官网外链 URL（不写文件）。

---

## 4. 磁盘与运行时状态

| 检查 | 结果 |
|---|---|
| `test-project/**/*.html` | **0 个**（当日多轮 headless 真机构建之后）；`buildlog.html` / `*_build_log.html` 均不存在 |
| 仓库整体（除 node_modules/.git/codeblocks-src/dist） | 无 `buildlog.html` / `*_build_log.html` 文件 |
| `.gitignore` | 保留两条历史规则：`test-project/buildlog.html`、`test-project/*_build_log.html`（防回归，无害） |

即：**默认配置下运行构建不会在工程目录产生任何 HTML 文件**（与门控静态结论一致）。

---

## 5. 已安装版本谱（关键证据）

对 `~/.vscode/extensions` 下 72 个版本目录逐一扫描 `dist/extension.js`：

| 版本区间（按已安装目录） | 含 `buildlog.html` 写入 | 含门控 | 含 `_build_log.html` 模板 | 默认配置行为 |
|---|---|---|---|---|
| 0.8.11 ～ 0.8.55-dev | 否 | 否 | 否 | 不生成 HTML 日志（功能未引入） |
| **0.8.56-dev ～ 0.8.92-dev** | **是** | **否** | 否 | **每次构建写 `buildlog.html`（缺陷区间）** |
| **0.8.93-dev ～ 0.8.95-dev** | **否** | **是** | **是** | 默认不生成；开启 `saveHtmlLog` 后写 `<名>_build_log.html` |

- 引入：commit `8098406`（2026-09-26，package.json 版本 `0.8.56-dev`，第 35 轮 E7 项"finishBuildSummary 自动写 buildlog.html"）。
- 修复：commit `c7edb4a`（2026-09-28，`0.8.93-dev`，第六十九轮；对齐 CB `/save_html_build_log` 默认关 → 新增设置，命名改 CB 规范）。
- 生效状态（`.obsolete`）：71 个目录已标记 obsolete；**0.8.94-dev 与 0.8.95-dev 当前均未标记**（0.8.95-dev 安装后尚未重载窗口，运行中的可能是 0.8.94-dev）。**两者行为一致：都不会生成 `buildlog.html`**；为避免歧义，建议 Reload Window 完成切换到 0.8.95-dev。
- 附带发现（记录，不处理）：磁盘累积了 72 个历史版本目录（VS Code 已按 `.obsolete` 忽略），可择机清理旧目录释放空间。

---

## 6. 边界与风险（仅记录，未修复）

1. **手动开启 `saveHtmlLog` 属预期功能**：开启后会生成 `<工程文件名>_build_log.html`（CB 规范命名），**不是** `buildlog.html`；再开 `saveHtmlLogFullCommandLine` 只影响内容（追加命令行块），不改变生成条件。
2. **历史残留不清理**：≤0.8.92 时代写出的 `buildlog.html` 仍可能留在老工程目录，扩展不会自动删除（无任何删除逻辑；全仓库 `unlink/rm` 均与日志无关）。
3. **0.8.94/0.8.95 双目录并存期间**：因未重载，扩展宿主可能仍加载 0.8.94-dev；两版本均含门控，无风险。
4. 本次为**只读核查**，未做任何代码/配置改动；上述第 5 节"可清理旧安装目录"如需处理请另行确认。

---

## 7. 复核证据清单（可复跑）

- 脚本：`.cb-audit.js`（默认值/字面量/磁盘/安装目录总扫）、`.cb-audit2.js`（已安装谱 + `.obsolete` + 门控函数体）；输出 `.cb-audit.txt`、`.cb-audit2.txt`。
- 关键行号：`package.json:596-605`；`src/extension.ts:5754-5755 / 5789-5790 / 4712 / 4800`；`src/build/htmlBuildLog.ts:17`。
- 提交证据：`8098406`（引入）、`c7edb4a`（修复）；`docs/release/0.8.93-dev.md`。
