/**
 * 汇编（.s / .S）注释标记动态切换（设置 codeblocks.editor.asmHashComment）。
 *
 * 背景（0.8.128-dev 实测）：
 *  - `//` 行注释仅在「预处理汇编（.S，经 cpp）」中可靠（cpp 负责剥离）；
 *  - 原生 `.s`（GAS 直接汇编）在 RISC-V（binutils 2.28 / 2.43）与 x86 上均拒绝 `//`
 *    （整行 junk / 行尾 illegal operands），`#` 才是 GAS 原生注释（行首/行尾均安全）；
 *  - `.ld` / `.xm` 各自独立语言配置，不受本模块影响。
 *
 * 实现：静态 `language-configurations/asm.json` 默认 `//`；设置开启时由扩展经
 * `vscode.languages.setLanguageConfiguration('asm', …)` 动态注册 `#`
 * （VS Code 中扩展动态注册优先级 100 > 静态文件配置 50；Disposable 释放后自动回退静态配置）。
 */

/** 汇编语言 id（对应 package.json contributes.languages） */
export const ASM_LANGUAGE_ID = 'asm';

/** 设置键（不含 `codeblocks.` 前缀）：开启后汇编行注释改用 GAS 原生 `#` */
export const ASM_HASH_COMMENT_SETTING = 'editor.asmHashComment';

export interface AsmCommentsRule {
  lineComment: string;
  blockComment: [string, string];
}

/**
 * 汇编注释规则：默认 `//`（预处理 .S 安全）；开启设置后 `#`（GAS 原生，原生 .s 可用）。
 * 块注释固定为 C 风格（起止记号见实现；GAS 支持）。
 */
export function asmCommentsRule(useHash: boolean): AsmCommentsRule {
  return {
    lineComment: useHash ? '#' : '//',
    blockComment: ['/*', '*/'],
  };
}
