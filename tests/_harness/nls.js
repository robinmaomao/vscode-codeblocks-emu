// nls 解析辅助：package.json 的静态贡献文案已改为 %key%（见 docs/国际化.md），
// 测试断言「命令标题 / 设置描述 / 视图名」时应先用本模块还原，而不是断言 %key% 原文。
//
// 语言选择（与 VS Code 一致）：
//   · 中文显示语言 → package.nls.zh-cn.json
//   · 其余 → package.nls.json（英文默认）
// 也可用 setLanguage('en'|'zh-cn') 显式切换；CB_NLS_LANG 环境变量可指定初始语言（默认 zh-cn）。
// 用法：
//   const { cmdTitle, nlsText } = require('./_harness/nls');
//   cmdTitle('codeblocks.newProject')          // → 'Code::Blocks: 新建工程'
//   nlsText('%key%')                           // → 解析后的文案
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8'));
const pkg = readJson('package.json');
const en = readJson('package.nls.json');
const zh = readJson('package.nls.zh-cn.json');

let language = process.env.CB_NLS_LANG === 'en' ? 'en' : 'zh-cn';

/** 切换解析语言（'en' | 'zh-cn'）；返回生效语言 */
function setLanguage(lang) {
  language = lang === 'en' ? 'en' : 'zh-cn';
  return language;
}

/** 解析 %key%（非占位符原样返回；键缺失也原样返回，便于暴露漏译） */
function nlsText(value) {
  const s = String(value ?? '');
  const m = /^%([A-Za-z0-9_.\-]+)%$/.exec(s);
  if (!m) return s;
  const table = language === 'en' ? en : zh;
  return table[m[1]] ?? s;
}

/** 命令标题（按 command id 查 package.json → 解析 nls） */
function cmdTitle(commandId) {
  const cmd = (pkg.contributes.commands || []).find((c) => c.command === commandId);
  return cmd ? nlsText(cmd.title) : undefined;
}

/** 设置描述（description / markdownDescription，均解析 nls） */
function settingDescription(settingKey) {
  const blocks = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
  for (const b of blocks) {
    const def = (b.properties || {})[settingKey];
    if (def) return { description: nlsText(def.description), markdownDescription: nlsText(def.markdownDescription) };
  }
  return undefined;
}

module.exports = { pkg, setLanguage, currentLanguage: () => language, nlsText, cmdTitle, settingDescription };
