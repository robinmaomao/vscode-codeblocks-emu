/**
 * 运行时界面语言核心（0.8.132-dev）：纯逻辑，无 vscode 依赖（便于无头单测）。
 *
 * 约定（与 package.nls.json「英文默认」一致）：
 *  - **英文为源串**：代码里写 `t('Build finished')`，中文译义放 `strings.zh-cn.json`（英文源串为键）；
 *  - 语言取值：设置 `codeblocks.ui.language` = `auto` / `en` / `zh-cn`；`auto` 跟随 VS Code 显示语言；
 *  - 词条缺失一律回退源串（英文），不会出现空白或键名泄漏；
 *  - 占位符 `{0}` / `{1}` … 与 `vscode.l10n.t` 一致；参数缺失时保留占位符原样（便于定位漏参）。
 *
 * 静态贡献（命令标题 / 设置描述 / 视图名）无法运行时改语言，走 `package.nls.*.json`
 * 跟随 VS Code 显示语言；本模块只负责**运行时文案**（弹窗、QuickPick、状态栏、WebView 面板）。
 */

/** 实际生效的语言（词条文件的语言标识） */
export type UiLanguage = 'en' | 'zh-cn';

/** 设置 `codeblocks.ui.language` 的取值（`auto` = 跟随 VS Code 显示语言） */
export type UiLanguageSetting = 'auto' | UiLanguage;

/** 设置键（不含 `codeblocks.` 前缀） */
export const LANGUAGE_SETTING = 'ui.language';

/** 设置键（含前缀，用于 getConfiguration / affectsConfiguration） */
export const LANGUAGE_SETTING_FULL = 'codeblocks.ui.language';

/** 设置的合法取值（顺序即 QuickPick 展示顺序） */
export const UI_LANGUAGE_VALUES: readonly UiLanguageSetting[] = ['auto', 'en', 'zh-cn'];

/** 判定设置值是否合法（非法值按 `auto` 处理） */
export function isUiLanguageSetting(value: unknown): value is UiLanguageSetting {
  return typeof value === 'string' && (UI_LANGUAGE_VALUES as readonly string[]).includes(value);
}

/**
 * 由设置值与 VS Code 显示语言解析生效语言。
 * `auto`：显示语言以 `zh` 开头（zh-cn / zh-tw / zh-hans…）取 `zh-cn`，其余一律 `en`。
 * 显示语言**缺失**（无宿主 stub / headless 单测未提供 `env.language`）时取 `zh-cn`：
 * 生产环境 VS Code 一定有值，此分支只影响测试基线（与既有中文断言、中文优先文档一致）。
 */
export function resolveLanguage(setting: unknown, envLanguage: unknown): UiLanguage {
  const value = isUiLanguageSetting(setting) ? setting : 'auto';
  if (value !== 'auto') return value;
  const env = String(envLanguage ?? '').toLowerCase();
  if (!env) return 'zh-cn';
  return env.startsWith('zh') ? 'zh-cn' : 'en';
}

/** 占位符替换（`{0}`/`{1}`…；参数缺失或为 null/undefined 时保留占位符原样） */
export function formatSource(source: string, args: readonly unknown[]): string {
  if (!args.length) return source;
  return source.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const arg = args[Number(index)];
    return arg === undefined || arg === null ? whole : String(arg);
  });
}

/** 词条表类型（英文源串 → 目标语言文案） */
export type Translations = Readonly<Record<string, string>>;

/** 按语言取模板（英文 = 源串；其它语言查词条，缺失回退源串） */
export function lookupTemplate(translations: Translations, language: UiLanguage, source: string): string {
  if (language === 'en') return source;
  const hit = translations[source];
  return typeof hit === 'string' && hit.trim().length > 0 ? hit : source;
}

/** 翻译 + 占位符替换（纯函数入口，供单测直接调用） */
export function translate(
  translations: Translations,
  language: UiLanguage,
  source: string,
  args: readonly unknown[],
): string {
  return formatSource(lookupTemplate(translations, language, source), args);
}