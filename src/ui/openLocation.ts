/**
 * 打开文件并定位到行列 —— Build Log 诊断 / 符号树的统一跳转入口。
 *
 * 为什么不用 `vscode.open` + `{ selection: Range }`：命令参数跨进程走 JSON 序列化，
 * `Range.toJSON()` 返回 `[start, end]`、`Position.toJSON()` 返回 `{ line, character }`，
 * 主进程拿到的 `options.selection` 不是 `IRange` ⇒ 只会打开文件、不定位
 * （目标文件本来就打开时，用户看到的就是"点了没反应"）。
 * `showTextDocument` 的 options 由扩展宿主自行转换，定位可靠；再显式 revealRange 兜底滚动。
 */
import * as vscode from 'vscode';

/** 打开文件并定位（返回是否成功；文件不存在/不可读 → false，由调用方决定提示或换下一条） */
export async function openFileAtLocation(
  file: string,
  line = 1,
  column = 1,
  opts: { preview?: boolean } = {},
): Promise<boolean> {
  if (!file) return false;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    // 诊断行号可能因文件已改动而越界：钳制到合法范围，避免 openTextDocument 后抛错
    const lastLine = Math.max(0, (typeof doc.lineCount === 'number' ? doc.lineCount : 1) - 1);
    const lineIdx = Math.max(0, Math.min((line > 0 ? line : 1) - 1, lastLine));
    let lineEnd = Number.MAX_SAFE_INTEGER;
    try {
      const ln = doc.lineAt(lineIdx);
      if (ln?.range?.end) lineEnd = ln.range.end.character;
    } catch {
      // 行信息不可用（非文本/桩对象）：不钳制列号
    }
    const pos = new vscode.Position(lineIdx, Math.max(0, Math.min((column > 0 ? column : 1) - 1, lineEnd)));
    const range = new vscode.Range(pos, pos);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: opts.preview !== false,
      selection: range,
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    return true;
  } catch {
    return false;
  }
}
