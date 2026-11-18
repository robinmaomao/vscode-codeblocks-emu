/**
 * WebView 公共运行时 —— 统一 CSP nonce、HTML 转义与脚本内 JSON 注入。
 *
 * 目标：
 *  - 内联脚本使用 nonce，不再依赖 `script-src 'unsafe-inline'`；
 *  - 动态数据注入脚本前转义 `<`/`>`/`&` 与行分隔符，避免 `</script>` 截断；
 *  - 面板共享同一套 HTML 转义实现，减少重复与转义不一致。
 */
import * as crypto from 'crypto';

/** 生成 CSP nonce（仅 base64url 字符，避免属性/策略解析问题） */
export function createNonce(): string {
  return crypto.randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '');
}

/**
 * 构造 CSP meta。
 * @param nonce 内联脚本 nonce
 * @param extra 额外策略（需自带前导空格与结尾分号，如 ` font-src ...;`）
 */
export function cspMeta(nonce: string, extra = ''): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';${extra}">`;
}

/** HTML 文本/属性转义 */
export function escapeHtml(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 注入内联脚本的 JSON（转义 `<`/`>`/`&` 与 U+2028/U+2029，防止脚本被截断） */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
