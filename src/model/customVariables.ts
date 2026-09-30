/**
 * 项目自定义变量写回（C3）—— .cbp <Extensions><codeblocks_project_custom_variables>
 *
 * 每个变量一个子元素：元素名 = 变量名，value 属性 = 值
 * （对齐 Code::Blocks cbproject.cpp SaveExtendedData / 本仓 parser.ts parseProjectCustomVariables）。
 * 纯函数（无 vscode 依赖），供 extension.ts 保存与回归测试共用。
 */

/** 变量名合法性：将作为 XML 元素名（不能含空白等；CB 同款限制） */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export interface CustomVariablesResult {
  /** 处理后的 Extensions 节点（已替换 / 删除 codeblocks_project_custom_variables） */
  extensions: Record<string, unknown>;
  /** 写入的变量表（供 project.customVariables） */
  variables: Record<string, string>;
  /** 因名字非法被跳过的变量名 */
  skipped: string[];
}

/**
 * 应用项目自定义变量到 Extensions 原始节点：
 * - 非空 → 重建 codeblocks_project_custom_variables 节点（元素名 = 变量名）
 * - 空 → 移除该节点
 * - 名字非法（不能作 XML 元素名，如含空格）→ 跳过并计入 skipped
 */
export function applyCustomVariables(
  extensions: unknown,
  vars: { name: string; value: string }[],
): CustomVariablesResult {
  const variables: Record<string, string> = {};
  const skipped: string[] = [];
  for (const v of vars ?? []) {
    const name = String(v?.name ?? '').trim();
    if (!name) continue;
    if (!VALID_NAME.test(name)) {
      skipped.push(name);
      continue;
    }
    variables[name] = String(v?.value ?? '');
  }
  const ext = (extensions && typeof extensions === 'object' && !Array.isArray(extensions))
    ? (extensions as Record<string, unknown>)
    : {};
  const node: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(variables)) {
    node[name] = { '@_value': value };
  }
  if (Object.keys(node).length) {
    ext['codeblocks_project_custom_variables'] = node;
  } else {
    delete ext['codeblocks_project_custom_variables'];
  }
  return { extensions: ext, variables, skipped };
}
