# 第三方组件声明（Third-Party Notices）

本扩展发布包中的入口文件 `bundle/extension.js`（esbuild 单文件打包产物）内嵌以下第三方组件：

- **fast-xml-parser** v4 — MIT License
  <https://github.com/NaturalIntelligence/fast-xml-parser>
  用途：解析 Code::Blocks 工程文件（`.cbp` / `.workspace`）与编译器选项 XML。

`bundle/cb-cli.js` 与 `bundle/cb-mcp.js`（Agent CLI / MCP server）额外内嵌：

- **@modelcontextprotocol/sdk** v1 — MIT License
  <https://github.com/modelcontextprotocol/typescript-sdk>
  用途：MCP stdio 协议实现（工具列表与调用）。其传递依赖（zod、ajv、express 等）同样以 MIT/Apache-2.0 许可随包内联。

扩展自身源码为 GPL v3（见 [LICENSE.md](./LICENSE.md)）；`resources/compilers/*.xml` 派生自 Code::Blocks（GPL v3）。
