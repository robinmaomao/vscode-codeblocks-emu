/**
 * .workspace 依赖写回（C1）—— 文本手术（保留用户文件格式与未知节点）。
 *
 * 格式（对齐 Code::Blocks workspaceloader.cpp）：
 *   <CodeBlocks_workspace_file><Workspace title="...">
 *     <Project filename="app/app.cbp" active="1"><Depends filename="lib/lib.cbp" /></Project>
 *   </Workspace></CodeBlocks_workspace_file>
 *
 * 纯函数（无 vscode 依赖），供 extension.ts 依赖编辑与回归测试共用。
 */

/** 路径归一化（斜杠 + 大小写不敏感，供比较用） */
function norm(s: string): string {
  return String(s).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 设置指定工程在 .workspace 中的 <Depends> 列表（文本手术）：
 * - 已有 <Depends> 行整行替换（保留其它节点与缩进风格）；
 * - 自闭合 `<Project ... />` 无依赖时展开为带子节点的形式；
 * - deps 为空 → 删除全部 <Depends> 行；
 * - 未找到工程节点 → 返回 null（文件视为未修改）。
 */
export function setProjectDependencies(text: string, projectFilename: string, deps: string[]): string | null {
  const re = /<Project\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[0];
    const fm = tag.match(/\bfilename\s*=\s*"([^"]*)"/);
    if (!fm || norm(fm[1]) !== norm(projectFilename)) continue;

    const tagStart = m.index;
    const tagEnd = tagStart + tag.length;
    // 行首缩进（保留原文件缩进风格）
    const lineStart = text.lastIndexOf('\n', tagStart) + 1;
    const indentMatch = text.slice(lineStart, tagStart).match(/^[ \t]*/);
    const indent = indentMatch ? indentMatch[0] : '';

    const selfClose = tag.endsWith('/>');
    if (selfClose && !deps.length) return text; // 本来就没有依赖且不新增 → 不变

    if (selfClose) {
      const openTag = tag.slice(0, -2).replace(/\s+$/, '') + '>';
      const childIndent = indent + '\t';
      const body = deps.map((d) => `${childIndent}<Depends filename="${escAttr(d)}" />`).join('\n');
      return text.slice(0, tagStart) + openTag + '\n' + body + '\n' + indent + '</Project>' + text.slice(tagEnd);
    }

    // 常规开标签：定位对应的 </Project>（.workspace 中 Project 不嵌套）
    const closeIdx = text.indexOf('</Project>', tagEnd);
    if (closeIdx === -1) return null;
    const inner = text.slice(tagEnd, closeIdx);
    const kept: string[] = [];
    let childIndent = '';
    for (const line of inner.split('\n')) {
      if (/^\s*<Depends\b[^>]*\/>\s*$/.test(line)) {
        if (!childIndent) childIndent = (line.match(/^[ \t]*/) ?? [''])[0];
        continue;
      }
      kept.push(line);
    }
    while (kept.length && !kept[0].trim()) kept.shift();
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    if (!childIndent) childIndent = indent + '\t';

    const depLines = deps.map((d) => `${childIndent}<Depends filename="${escAttr(d)}" />`);
    const keptBlock = kept.join('\n');
    let newInner: string;
    if (depLines.length) {
      newInner = '\n' + depLines.join('\n') + (keptBlock ? '\n' + keptBlock : '') + '\n' + indent;
    } else {
      newInner = keptBlock ? '\n' + keptBlock + '\n' + indent : '\n' + indent;
    }
    return text.slice(0, tagEnd) + newInner + text.slice(closeIdx);
  }
  return null;
}

/**
 * 依赖图环路检测：若在 deps[from] 中加入 to 是否会形成环
 * （self-check：to == from；或 to 沿依赖可达 from → 加边成环）。
 */
export function wouldCreateCycle(deps: Record<string, string[]>, from: string, to: string): boolean {
  const nf = norm(from);
  const nt = norm(to);
  if (nf === nt) return true;
  const adj = new Map<string, string[]>();
  for (const [k, vs] of Object.entries(deps ?? {})) {
    adj.set(norm(k), (vs ?? []).map(norm));
  }
  const stack = [nt];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === nf) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of adj.get(cur) ?? []) stack.push(nx);
  }
  return false;
}
