/**
 * 构建日志偏好（设置项）：
 * - codeblocks.build.plainCbLog：true 关闭扩展日志增强（脚本编号/单行完成式/Emoji 汇总块/最慢 Top3），对齐 CB 纯日志
 * - codeblocks.log.english：true 时 msg() 返回英文文案（对齐 CB 原文）
 * - codeblocks.build.strictQuoting：true 时引号规则对齐 CB（仅空格加引号）
 * 通过惰性 require('vscode') 读取；无 vscode 宿主（headless 单测）安全回退默认值。
 */

let cache: { plain: boolean; english: boolean; strict: boolean } | undefined;

export function buildLogPrefs(): { plain: boolean; english: boolean; strict: boolean } {
  if (cache) return cache;
  let plain = false;
  let english = false;
  let strict = false;
  try {
    const vs: typeof import('vscode') = require('vscode');
    const cfg = vs.workspace.getConfiguration('codeblocks');
    plain = cfg.get<boolean>('build.plainCbLog', false) === true;
    english = cfg.get<boolean>('log.english', false) === true;
    strict = cfg.get<boolean>('build.strictQuoting', false) === true;
  } catch {
    // headless：保持默认
  }
  cache = { plain, english, strict };
  return cache;
}

/** 中英文案切换（codeblocks.log.english=true 返回 en，否则 zh） */
export function msg(zh: string, en: string): string {
  return buildLogPrefs().english ? en : zh;
}

/** 严格引号模式（codeblocks.build.strictQuoting=true 时仅空格加引号，对齐 CB） */
export function strictQuoting(): boolean {
  return buildLogPrefs().strict;
}
