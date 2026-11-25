# 第三方组件声明（Third-Party Notices）

本扩展发布包中的入口文件 `bundle/extension.js`（esbuild 单文件打包产物）内嵌以下第三方组件：

- **fast-xml-parser** v5 — MIT License
  <https://github.com/NaturalIntelligence/fast-xml-parser>
  用途：解析 Code::Blocks 工程文件（`.cbp` / `.workspace`）与编译器选项 XML。

- **iconv-lite** v0.6 — MIT License
  <https://github.com/ashtuchkin/iconv-lite>
  Copyright (c) 2011 Alexander Shtuchkin
  用途：按系统 ANSI 代码页读写 GBK 等非 UTF-8 工程文件与构建日志（`bundle/extension.js` 内联）。

- **Seti UI 文件图标字体**（`resources/icons/seti.woff`，取自 VS Code 内置 `theme-seti`）— MIT License
  <https://github.com/jesseweed/seti-ui>
  Copyright (c) 2014 Jesse Weed
  用途：工程搜索结果中的文件类型图标，与 VS Code Explorer（Seti 主题）保持一致。

`bundle/cb-cli.js` 与 `bundle/cb-mcp.js`（Agent CLI / MCP server）额外内嵌：

- **@modelcontextprotocol/sdk** v1 — MIT License
  <https://github.com/modelcontextprotocol/typescript-sdk>
  用途：MCP stdio 协议实现（工具列表与调用）。其传递依赖（zod、ajv、express 等）同样以 MIT/Apache-2.0 许可随包内联。

扩展自身源码为 GPL v3（见 [LICENSE.md](./LICENSE.md)）；`resources/compilers/*.xml` 派生自 Code::Blocks（GPL v3）。
