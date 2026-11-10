# 第三方组件声明（Third-Party Notices）

本扩展发布包中的入口文件 `bundle/extension.js`（esbuild 单文件打包产物）内嵌以下第三方组件：

- **fast-xml-parser** v4 — MIT License
  <https://github.com/NaturalIntelligence/fast-xml-parser>
  用途：解析 Code::Blocks 工程文件（`.cbp` / `.workspace`）与编译器选项 XML。

- **Seti UI 文件图标字体**（`resources/icons/seti.woff`，取自 VS Code 内置 `theme-seti`）— MIT License
  <https://github.com/jesseweed/seti-ui>
  Copyright (c) 2014 Jesse Weed
  用途：工程搜索结果中的文件类型图标，与 VS Code Explorer（Seti 主题）保持一致。

扩展自身源码为 GPL v3（见 [LICENSE.md](./LICENSE.md)）；`resources/compilers/*.xml` 派生自 Code::Blocks（GPL v3）。
