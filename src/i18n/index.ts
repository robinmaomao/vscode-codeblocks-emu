/**
 * 运行时界面语言（0.8.132-dev）——扩展侧入口：解析设置、缓存生效语言、提供 `t()`。
 *
 * 词条文件 `strings.zh-cn.json` 以**英文源串为键**（与 package.nls.json「英文默认」约定一致），
 * 由 `resolveJsonModule` 内联进 dist / bundle，无运行时文件 IO。
 * 设置变更（`codeblocks.ui.language`）后调用 `refreshUiLanguage()` 即时生效，无需重载窗口。
 *
 * 静态贡献（命令标题 / 设置描述 / 视图名）无法运行时改语言，走 package.nls.*.json
 * 跟随 VS Code 显示语言；两者语义边界见 docs/国际化.md。
 */
import { LANGUAGE_SETTING, resolveLanguage, translate, UiLanguage, Translations } from './core';
import zhCn from './strings.zh-cn.json';
import zhCnWebview from './strings.zh-cn.webview.json';

export * from './core';

const translations: Translations = zhCn;
/** WebView 面板反查表（中文原文 → 英文源串；由模板 `tr()` 插桩使用） */
const webviewTranslations: Translations = zhCnWebview;

/** 缓存的生效语言（undefined = 未解析，读取时按当前设置为准） */
let cached: UiLanguage | undefined;

/**
 * 解析当前生效语言。
 * 惰性 `require('vscode')`：纯逻辑模块（model / tools / build）在**无宿主单测**下也会引入 i18n，
 * 此时 vscode 不存在，回退中文态（与既有中文断言、mock 默认显示语言一致）。
 */
function resolveFromHost(): UiLanguage {
  try {
    const vs: typeof import('vscode') = require('vscode');
    const setting = vs.workspace.getConfiguration('codeblocks').get<string>(LANGUAGE_SETTING, 'auto');
    return resolveLanguage(setting, vs.env.language);
  } catch {
    return 'zh-cn';
  }
}

/** 当前生效语言（设置 `auto` 时读 VS Code 显示语言） */
export function uiLanguage(): UiLanguage {
  if (cached === undefined) cached = resolveFromHost();
  return cached;
}

/** 设置变更后重新解析语言；返回值 = 新的生效语言 */
export function refreshUiLanguage(): UiLanguage {
  cached = undefined;
  return uiLanguage();
}

/** 翻译（英文源串 → 当前语言文案；`{0}`/`{1}` 依次取 args） */
export function t(source: string, ...args: unknown[]): string {
  return translate(translations, uiLanguage(), source, args);
}

/** 词条表（只读；供漂移测试与调试使用） */
export function translationsTable(): Translations {
  return translations;
}

/** WebView `<html lang>` 属性值（面板正文语言在打开时固定，与 UI 文案同源） */
export function htmlLang(): string {
  return uiLanguage() === 'zh-cn' ? 'zh-CN' : 'en';
}

/**
 * WebView 面板文案：源代码级插桩 `tr('<中文原文>')`。
 *
 * 面板模板里的中文（含内联 `<style>`/`<script>` 文本）在**源**上包成 `tr(...)`，
 * 中文原文即键；英文态按下面的反查表换成英文源串，中文态原样返回。
 * 这样既不依赖渲染后的整段替换（会误伤「工程名/备注」等数据），也不需要 WebView 内做语言判断。
 * @param zh 中文原文（模板里的字面文本）
 */
export function tr(zh: string): string {
  if (uiLanguage() !== 'en') return zh;
  return webviewTranslations[zh] ?? zh;
}

/** WebView 面板反查表（中文原文 → 英文源串；只读，守卫用） */
export function webviewTranslationsTable(): Translations {
  return webviewTranslations;
}
