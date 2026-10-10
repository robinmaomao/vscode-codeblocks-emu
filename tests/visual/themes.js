// 视觉回归主题：把 WebView HTML 里引用的 --vscode-* 变量替换为确定性的调色板，
// 模拟 VS Code 内置主题（Dark+ / Light Modern 的关键色）。颜色值固定，不随系统主题变化。
// 另含确定性基础样式（禁动画/禁用光标/隐藏滚动条/固定字体栈）。

const SIZE_VARS = `
  --vscode-font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  --vscode-font-size: 13px;
  --vscode-editor-font-family: Consolas, "Courier New", monospace;
  --vscode-editor-font-size: 12px;
`;

const THEMES = {
  dark: {
    kind: 'dark',
    vars: `
      --vscode-foreground: #cccccc;
      --vscode-descriptionForeground: #9d9d9d;
      --vscode-disabledForeground: #6e6e6e;
      --vscode-errorForeground: #f48771;
      --vscode-editor-background: #1f1f1f;
      --vscode-editor-foreground: #cccccc;
      --vscode-sideBar-background: #181818;
      --vscode-sideBarSectionHeader-background: #181818;
      --vscode-panel-background: #181818;
      --vscode-panel-border: #2b2b2b;
      --vscode-widget-border: #313131;
      --vscode-focusBorder: #0078d4;
      --vscode-input-background: #313131;
      --vscode-input-foreground: #cccccc;
      --vscode-input-border: #3c3c3c;
      --vscode-input-placeholderForeground: #989898;
      --vscode-button-background: #0078d4;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #026ec1;
      --vscode-button-secondaryBackground: #313131;
      --vscode-button-secondaryForeground: #cccccc;
      --vscode-button-secondaryHoverBackground: #3c3c3c;
      --vscode-badge-background: #616161;
      --vscode-badge-foreground: #f8f8f8;
      --vscode-list-hoverBackground: #2a2d2e;
      --vscode-list-activeSelectionBackground: #04395e;
      --vscode-list-activeSelectionForeground: #ffffff;
      --vscode-list-inactiveSelectionBackground: #37373d;
      --vscode-editorWidget-background: #202020;
      --vscode-editorWidget-border: #454545;
      --vscode-textCodeBlock-background: #2b2b2b;
      --vscode-textLink-foreground: #4daafc;
      --vscode-textLink-activeForeground: #4daafc;
      --vscode-scrollbarSlider-background: #4e4e4e66;
      --vscode-editor-selectionBackground: #264f78;
      --vscode-editorWarning-foreground: #cca700;
      --vscode-charts-yellow: #d7ba7d;
      --vscode-charts-orange: #d18616;
      --vscode-charts-red: #f14c4c;
      --vscode-charts-green: #89d185;
      --vscode-charts-blue: #3794ff;
      --vscode-icon-foreground: #cccccc;
    `,
  },
  light: {
    kind: 'light',
    vars: `
      --vscode-foreground: #3b3b3b;
      --vscode-descriptionForeground: #717171;
      --vscode-disabledForeground: #8c8c8c;
      --vscode-errorForeground: #a1260d;
      --vscode-editor-background: #ffffff;
      --vscode-editor-foreground: #3b3b3b;
      --vscode-sideBar-background: #f8f8f8;
      --vscode-sideBarSectionHeader-background: #f8f8f8;
      --vscode-panel-background: #f8f8f8;
      --vscode-panel-border: #e5e5e5;
      --vscode-widget-border: #cecece;
      --vscode-focusBorder: #005fb8;
      --vscode-input-background: #ffffff;
      --vscode-input-foreground: #3b3b3b;
      --vscode-input-border: #cecece;
      --vscode-input-placeholderForeground: #767676;
      --vscode-button-background: #005fb8;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #0258a8;
      --vscode-button-secondaryBackground: #e5e5e5;
      --vscode-button-secondaryForeground: #3b3b3b;
      --vscode-button-secondaryHoverBackground: #cccccc;
      --vscode-badge-background: #cccccc;
      --vscode-badge-foreground: #3b3b3b;
      --vscode-list-hoverBackground: #e8e8e8;
      --vscode-list-activeSelectionBackground: #e4e6f1;
      --vscode-list-activeSelectionForeground: #000000;
      --vscode-list-inactiveSelectionBackground: #e4e6f1;
      --vscode-editorWidget-background: #f8f8f8;
      --vscode-editorWidget-border: #c8c8c8;
      --vscode-textCodeBlock-background: #f2f2f2;
      --vscode-textLink-foreground: #005fb8;
      --vscode-textLink-activeForeground: #005fb8;
      --vscode-scrollbarSlider-background: #64646466;
      --vscode-editor-selectionBackground: #add6ff;
      --vscode-editorWarning-foreground: #bf8803;
      --vscode-charts-yellow: #bf8803;
      --vscode-charts-orange: #d18616;
      --vscode-charts-red: #e51400;
      --vscode-charts-green: #107c10;
      --vscode-charts-blue: #005fb8;
      --vscode-icon-foreground: #3b3b3b;
    `,
  },
};

const DETERMINISM_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
  img { image-rendering: -webkit-optimize-contrast; }
`;

// 确定性脚本 + acquireVsCodeApi shim：必须在面板内联脚本之前执行。
// 注意：Playwright 的 addInitScript 不作用于 page.setContent()，因此直接注入 HTML 头部。
const SHIM_SCRIPT = `<script id="__cb-visual-shim">
  (() => {
    const FIXED = 1767225600000; // 2026-01-01T00:00:00Z
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...a) { super(...(a.length ? a : [FIXED])); }
      static now() { return FIXED; }
    }
    window.Date = FakeDate;
    if (window.performance) { try { performance.now = () => 0; } catch (e) {} }
    let seed = 42;
    Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    window.__posted = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => { window.__posted.push(m); },
      getState: () => undefined,
      setState: () => undefined,
    });
  })();
</script>`;

/** 把主题变量、确定性样式与 shim 注入到 HTML 的 <head>（无 head 时包一层） */
function prepareHtml(html, themeName) {
  const theme = THEMES[themeName] || THEMES.dark;
  const style = `<style id="__cb-visual-theme">:root {${theme.kind === 'light' ? 'color-scheme: light;' : 'color-scheme: dark;'}${SIZE_VARS}${theme.vars}}\n${DETERMINISM_CSS}</style>`;
  const inject = SHIM_SCRIPT + '\n' + style;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + '\n' + inject);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${inject}</head><body>${html}</body></html>`;
}

module.exports = { THEMES, prepareHtml, DETERMINISM_CSS, SHIM_SCRIPT };
