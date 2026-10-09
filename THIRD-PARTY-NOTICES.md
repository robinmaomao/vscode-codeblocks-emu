# 第三方组件声明（Third-Party Notices）

本扩展发布包中的入口文件 `bundle/extension.js`（esbuild 单文件打包产物）内嵌以下第三方组件：

- **fast-xml-parser** v4 — MIT License
  <https://github.com/NaturalIntelligence/fast-xml-parser>
  用途：解析 Code::Blocks 工程文件（`.cbp` / `.workspace`）与编译器选项 XML。

扩展自身源码为 GPL v3（见 [LICENSE.md](./LICENSE.md)）；`resources/compilers/*.xml` 派生自 Code::Blocks（GPL v3）。
