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
import * as vscode from 'vscode';
import { LANGUAGE_SETTING, resolveLanguage, translate, UiLanguage, Translations } from './core';
import zhCn from './strings.zh-cn.json';

export * from './core';

const translations: Translations = zhCn;

/** 缓存的生效语言（undefined = 未解析，读取时按当前设置为准） */
let cached: UiLanguage | undefined;

/** 当前生效语言（设置 `auto` 时读 VS Code 显示语言） */
export function uiLanguage(): UiLanguage {
  if (cached === undefined) {
    const setting = vscode.workspace.getConfiguration('codeblocks').get<string>(LANGUAGE_SETTING, 'auto');
    cached = resolveLanguage(setting, vscode.env.language);
  }
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
