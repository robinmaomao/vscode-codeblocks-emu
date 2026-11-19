/**
 * 工程编辑服务（无 vscode 依赖）：把「读 → 改 → 校验 → 写」收敛成一个入口。
 */
import { Project } from '../model/types';
import { serializeProject } from '../model/projectWriter';
import { applyEdits, applyUnitOptionToText, isPreserveCapable } from './projectEdit';
import { captureSignature, loadProject, readProjectText, saveProject, signatureChanged, writeTextAtomic } from './projectStore';
import type { EditChange, EditOp, WriteFormat } from './types';
import { fail } from './types';

export interface EditProjectOptions {
  dryRun?: boolean;
  format?: WriteFormat;
  allowScripts?: boolean;
  force?: boolean;
  /** 写前保护（扩展内传 projectChangeTracker.hasChanged） */
  isExternallyModified?: (file: string) => boolean;
}

export interface EditProjectResult {
  ok: boolean;
  cbp: string;
  format: WriteFormat;
  written: boolean;
  changed: EditChange[];
  warnings: string[];
  /** dryRun 时返回序列化后的 XML，便于审阅 diff */
  preview?: string;
}

/** 对工程应用一组编辑 */
export function editProject(cbp: string, ops: EditOp[], opts: EditProjectOptions = {}): EditProjectResult {
  const format: WriteFormat = opts.format === 'preserve' ? 'preserve' : 'canonical';
  const guard = captureSignature(cbp);

  if (format === 'preserve' && isPreserveCapable(ops)) {
    const { text, encoding } = readProjectText(cbp);
    let next = text;
    const changed: EditChange[] = [];
    for (const op of ops) {
      if (op.op !== 'set' || op.scope !== 'file') continue;
      const rel = String(op.file ?? '').replace(/\\/g, '/');
      const result = applyUnitOptionToText(next, rel, op.field as 'compile' | 'link', op.value === true);
      if (result.changed) {
        changed.push({ path: `file[${rel}].${op.field}`, after: op.value });
        next = result.text;
      }
    }
    if (!opts.dryRun && next !== text) {
      if (!opts.force && signatureChanged(cbp, guard)) {
        fail('external-modified', `The project file was modified while editing: ${cbp}`);
      }
      writeTextAtomic(cbp, next, encoding);
    }
    return { ok: true, cbp, format, written: !opts.dryRun && next !== text, changed, warnings: [] };
  }

  const project: Project = loadProject(cbp);
  const outcome = applyEdits(project, ops, { allowScripts: opts.allowScripts });
  const warnings = [...outcome.warnings];
  if (format === 'preserve' && !isPreserveCapable(ops)) {
    warnings.push('preserve mode only supports file compile/link edits; falling back to canonical rewrite.');
  }
  if (!opts.dryRun && outcome.changed.length > 0) {
    if (!opts.force && (opts.isExternallyModified?.(project.filename) || signatureChanged(cbp, guard))) {
      fail('external-modified', `The project file was modified outside the editor: ${project.filename}`, {
        hint: 'Re-open the project in VS Code, or pass force: true to overwrite.',
      });
    }
    saveProject(project, { force: true });
  }
  return {
    ok: true,
    cbp,
    format: opts.dryRun ? format : (format === 'preserve' ? 'canonical' : format),
    written: !opts.dryRun && outcome.changed.length > 0,
    changed: outcome.changed,
    warnings,
    preview: opts.dryRun ? serializeProject(project) : undefined,
  };
}
