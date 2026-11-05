/**
 * 增量工程编辑（无 vscode 依赖）。
 *
 * 设计取舍：
 *  - 白名单 + 强校验：未知字段/越权字段直接报错（agent 的典型失败是"以为改了"）。
 *  - 默认 canonical（`serializeProject`）保证写出的 `.cbp` 一定可解析；
 *    `preserve` 只覆盖 `compile` / `link` 两个高频开关（其余自动降级并告警）。
 *  - 所有操作返回 before/after，便于 dryRun 与审计。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { BuildTarget, Project, ProjectFile, VirtualBuildTarget } from '../model/types';
import {
  EditChange,
  EditOp,
  EditOutcome,
  FieldEdit,
  FieldSpec,
  fail,
  fieldSpecs,
} from './types';

export interface EditOptions {
  /** 允许修改构建脚本 / pre-post 命令 / 自定义构建命令 */
  allowScripts?: boolean;
}

/** 统一路径分隔符并去掉 `./` 前缀 */
export function normalizeRelativePath(p: string): string {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function findTarget(project: Project, title: string | undefined): BuildTarget {
  if (!title) fail('invalid-input', 'A target title is required for scope=target');
  const t = project.buildTargets.find((x) => x.title === title);
  if (!t) fail('invalid-input', `Target not found: ${title}`, { targets: project.buildTargets.map((x) => x.title) });
  return t;
}

function findFile(project: Project, file: string | undefined): ProjectFile {
  if (!file) fail('invalid-input', 'A file path is required for scope=file');
  const rel = normalizeRelativePath(file);
  const lower = process.platform === 'win32' ? rel.toLowerCase() : rel;
  const match = project.files.find((f) => {
    const candidate = normalizeRelativePath(f.relativeFilename);
    return (process.platform === 'win32' ? candidate.toLowerCase() : candidate) === lower;
  });
  if (match) return match;
  // 允许传绝对路径
  if (path.isAbsolute(file)) {
    const relFromBase = normalizeRelativePath(path.relative(project.basePath, file));
    const alt = project.files.find((f) => normalizeRelativePath(f.relativeFilename) === relFromBase);
    if (alt) return alt;
  }
  fail('invalid-input', `File not found in project: ${rel}`, {
    hint: 'Use codeblocks_project_read with section=files to list project files.',
  });
}

function specOf(scope: FieldEdit['scope'], field: string): FieldSpec {
  const spec = fieldSpecs(scope).find((s) => s.name === field);
  if (!spec) {
    fail('invalid-input', `Unknown field "${field}" for scope=${scope}`, {
      fields: fieldSpecs(scope).map((s) => s.name),
    });
  }
  return spec!;
}

function checkNumber(spec: FieldSpec, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid-input', `Field "${spec.name}" expects a number`);
  }
  const n = value as number;
  if (spec.values && !spec.values.includes(n)) {
    fail('invalid-input', `Field "${spec.name}" must be one of ${spec.values.join(', ')}`, { got: n });
  }
  if (spec.min !== undefined && n < spec.min) fail('invalid-input', `Field "${spec.name}" must be >= ${spec.min}`);
  if (spec.max !== undefined && n > spec.max) fail('invalid-input', `Field "${spec.name}" must be <= ${spec.max}`);
  return n;
}

function checkStringArray(spec: FieldSpec, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail('invalid-input', `Field "${spec.name}" expects an array of strings`);
  }
  return value as string[];
}

function checkJson(spec: FieldSpec, value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    fail('invalid-input', `Field "${spec.name}" expects an object or array`);
  }
  return value;
}

function validateScalar(spec: FieldSpec, value: unknown): unknown {
  switch (spec.kind) {
    case 'string':
      if (typeof value !== 'string') fail('invalid-input', `Field "${spec.name}" expects a string`);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') fail('invalid-input', `Field "${spec.name}" expects a boolean`);
      return value;
    case 'number':
      return checkNumber(spec, value);
    case 'string[]':
      return checkStringArray(spec, value);
    case 'json':
      return checkJson(spec, value);
  }
  fail('invalid-input', `Unsupported field kind for "${spec.name}"`);
}

/** 应用一条字段编辑（返回变更或 undefined 表示无变化） */
function applyFieldEdit(target: Record<string, unknown>, edit: FieldEdit, opts: EditOptions, changePath: string): EditChange | undefined {
  const spec = specOf(edit.scope, edit.field);
  if (spec.requiresScripts && !opts.allowScripts) {
    fail('invalid-input', `Field "${spec.name}" runs commands; pass allowScripts: true to edit it`);
  }
  const before = target[spec.name] as unknown;
  let after: unknown;
  if (spec.kind === 'string[]') {
    const current = Array.isArray(before) ? (before as string[]).slice() : [];
    if (edit.op === 'set') {
      after = checkStringArray(spec, edit.value);
    } else if (edit.op === 'add') {
      if (typeof edit.value !== 'string' || !edit.value.trim()) {
        fail('invalid-input', `Field "${spec.name}" add expects a non-empty string`);
      }
      after = current.includes(edit.value as string) ? current : [...current, edit.value as string];
    } else {
      if (typeof edit.value !== 'string') {
        fail('invalid-input', `Field "${spec.name}" remove expects a string`);
      }
      after = current.filter((v) => v !== edit.value);
    }
  } else {
    if (edit.op !== 'set') {
      fail('invalid-input', `Field "${spec.name}" only supports op=set`);
    }
    after = validateScalar(spec, edit.value);
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  target[spec.name] = after;
  return { path: changePath, before, after };
}

function cloneTarget(src: BuildTarget, title: string): BuildTarget {
  const { files: _files, ...rest } = src;
  const cloned = JSON.parse(JSON.stringify(rest)) as BuildTarget;
  cloned.title = title;
  cloned.files = [];
  return cloned;
}

function ensureUniqueTargetTitle(project: Project, title: string): void {
  if (!title || !title.trim()) fail('invalid-input', 'Target title must not be empty');
  if (project.buildTargets.some((t) => t.title === title)) {
    fail('invalid-input', `Target already exists: ${title}`);
  }
}

function detachTargetFromFiles(project: Project, title: string): void {
  for (const f of project.files) {
    f.buildTargets = f.buildTargets.filter((t) => t !== title);
    if (f.buildTargets.length === 0) f.explicitTargets = false;
  }
}

/**
 * 就地应用编辑。
 * @returns 变更列表 + 告警（调用方负责序列化落盘）
 */
export function applyEdits(project: Project, ops: EditOp[], opts: EditOptions = {}): EditOutcome {
  if (!Array.isArray(ops) || ops.length === 0) fail('invalid-input', 'ops must be a non-empty array');
  const changed: EditChange[] = [];
  const warnings: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case 'set':
      case 'add':
      case 'remove': {
        if (op.scope === 'project') {
          const change = applyFieldEdit(project as unknown as Record<string, unknown>, op, opts, `project.${op.field}`);
          if (change) changed.push(change);
        } else if (op.scope === 'target') {
          const target = findTarget(project, op.target) as unknown as Record<string, unknown>;
          const change = applyFieldEdit(target, op, opts, `target[${op.target}].${op.field}`);
          if (change) changed.push(change);
        } else if (op.scope === 'file') {
          const file = findFile(project, op.file) as unknown as Record<string, unknown>;
          const change = applyFieldEdit(file, op, opts, `file[${normalizeRelativePath(op.file!)}].${op.field}`);
          if (change) changed.push(change);
        } else {
          const vt = project.virtualTargets.find((v) => v.title === op.target || v.title === op.field);
          if (!vt) fail('invalid-input', `Virtual target not found: ${op.target ?? op.field}`);
          const before = vt!.targets;
          if (op.op === 'set') {
            vt!.targets = checkStringArray(fieldSpecs('virtualTarget')[0], op.value);
          } else if (op.op === 'add') {
            if (typeof op.value !== 'string') fail('invalid-input', 'Virtual target add expects a target title');
            if (!vt!.targets.includes(op.value as string)) vt!.targets = [...vt!.targets, op.value as string];
          } else {
            vt!.targets = vt!.targets.filter((t) => t !== op.value);
          }
          if (JSON.stringify(before) !== JSON.stringify(vt!.targets)) {
            changed.push({ path: `virtualTarget[${vt!.title}].targets`, before, after: vt!.targets });
          }
        }
        break;
      }
      case 'addTarget': {
        ensureUniqueTargetTitle(project, op.title);
        const source = op.copyFrom ? findTarget(project, op.copyFrom) : undefined;
        if (!source && project.buildTargets.length === 0) {
          fail('invalid-input', 'Cannot infer target settings: the project has no build targets');
        }
        const target = source
          ? cloneTarget(source, op.title)
          : cloneTarget(project.buildTargets[0], op.title);
        if (op.targetType !== undefined) {
          target.targetType = checkNumber({ name: 'targetType', kind: 'number', values: [0, 1, 2, 3, 4, 5], description: '' }, op.targetType);
        }
        project.buildTargets.push(target);
        if (source) {
          for (const f of project.files) {
            if (f.buildTargets.includes(source.title)) f.buildTargets = [...f.buildTargets, op.title];
          }
        }
        changed.push({ path: `target[${op.title}]`, after: { copiedFrom: source?.title ?? null } });
        break;
      }
      case 'removeTarget': {
        const target = findTarget(project, op.title);
        project.buildTargets = project.buildTargets.filter((t) => t !== target);
        detachTargetFromFiles(project, op.title);
        for (const vt of project.virtualTargets) vt.targets = vt.targets.filter((t) => t !== op.title);
        changed.push({ path: `target[${op.title}]`, before: { title: op.title } });
        break;
      }
      case 'renameTarget': {
        const target = findTarget(project, op.title);
        if (!op.to || !op.to.trim()) fail('invalid-input', 'New target title must not be empty');
        if (op.to !== op.title && project.buildTargets.some((t) => t.title === op.to)) {
          fail('invalid-input', `Target already exists: ${op.to}`);
        }
        const old = target.title;
        target.title = op.to;
        for (const f of project.files) {
          f.buildTargets = f.buildTargets.map((t) => (t === old ? op.to : t));
        }
        for (const vt of project.virtualTargets) vt.targets = vt.targets.map((t) => (t === old ? op.to : t));
        changed.push({ path: `target[${old}].title`, before: old, after: op.to });
        break;
      }
      case 'addFile': {
        const rel = normalizeRelativePath(op.file);
        if (!rel) fail('invalid-input', 'A file path is required');
        if (project.files.some((f) => normalizeRelativePath(f.relativeFilename) === rel)) {
          fail('invalid-input', `File already belongs to the project: ${rel}`);
        }
        const abs = path.resolve(project.basePath, rel);
        if (!fs.existsSync(abs)) fail('invalid-input', `File does not exist: ${abs}`);
        const targets = (op.targets ?? []).map((t) => findTarget(project, t).title);
        for (const t of targets) {
          const target = project.buildTargets.find((x) => x.title === t)!;
          target.files.push({
            relativeFilename: rel,
            relativeToCommonTopLevelPath: rel,
            absolutePath: abs,
            buildTargets: targets,
            explicitTargets: targets.length > 0,
            compilerVar: '',
            compile: op.compile !== false,
            link: op.link !== false,
            customBuildCommands: {},
            weight: op.weight ?? 50,
            virtualFolder: op.virtualFolder ?? '',
            generatedFiles: [],
          });
        }
        project.files.push({
          relativeFilename: rel,
          relativeToCommonTopLevelPath: rel,
          absolutePath: abs,
          buildTargets: targets,
          explicitTargets: targets.length > 0,
          compilerVar: '',
          compile: op.compile !== false,
          link: op.link !== false,
          customBuildCommands: {},
          weight: op.weight ?? 50,
          virtualFolder: op.virtualFolder ?? '',
          generatedFiles: [],
        });
        changed.push({ path: `file[${rel}]`, after: { targets, compile: op.compile !== false, link: op.link !== false } });
        break;
      }
      case 'removeFile': {
        const rel = normalizeRelativePath(op.file);
        const file = findFile(project, rel);
        project.files = project.files.filter((f) => f !== file);
        for (const t of project.buildTargets) t.files = t.files.filter((f) => f !== file && normalizeRelativePath(f.relativeFilename) !== normalizeRelativePath(file.relativeFilename));
        changed.push({ path: `file[${rel}]`, before: { file: rel } });
        if (!fs.existsSync(path.resolve(project.basePath, rel))) {
          warnings.push(`The file does not exist on disk: ${rel}`);
        }
        break;
      }
      case 'renameFile': {
        const rel = normalizeRelativePath(op.file);
        const to = normalizeRelativePath(op.to);
        if (!to) fail('invalid-input', 'The new file path must not be empty');
        const file = findFile(project, rel);
        const before = file.relativeFilename;
        file.relativeFilename = to;
        file.relativeToCommonTopLevelPath = to;
        file.absolutePath = path.resolve(project.basePath, to);
        for (const t of project.buildTargets) {
          for (const f of t.files) {
            if (normalizeRelativePath(f.relativeFilename) === rel) {
              f.relativeFilename = to;
              f.relativeToCommonTopLevelPath = to;
              f.absolutePath = file.absolutePath;
            }
          }
        }
        changed.push({ path: `file[${rel}].relativeFilename`, before, after: to });
        warnings.push('renameFile only updates the project reference; move the file on disk yourself.');
        break;
      }
      case 'addVirtualTarget': {
        if (!op.alias || !op.alias.trim()) fail('invalid-input', 'Virtual target alias must not be empty');
        if (project.virtualTargets.some((v) => v.title === op.alias)) {
          fail('invalid-input', `Virtual target already exists: ${op.alias}`);
        }
        const targets = op.targets.map((t) => findTarget(project, t).title);
        const vt: VirtualBuildTarget = { title: op.alias, targets };
        project.virtualTargets.push(vt);
        changed.push({ path: `virtualTarget[${op.alias}]`, after: { targets } });
        break;
      }
      case 'removeVirtualTarget': {
        const vt = project.virtualTargets.find((v) => v.title === op.alias);
        if (!vt) fail('invalid-input', `Virtual target not found: ${op.alias}`);
        project.virtualTargets = project.virtualTargets.filter((v) => v !== vt);
        changed.push({ path: `virtualTarget[${op.alias}]`, before: { targets: vt!.targets } });
        break;
      }
      default:
        fail('invalid-input', `Unknown op: ${(op as { op: string }).op}`);
    }
  }
  return { changed, warnings };
}

/** 该组操作是否可以用「定点改写」完成（目前只有 file.compile / file.link） */
export function isPreserveCapable(ops: EditOp[]): boolean {
  return ops.every((op) => op.op === 'set' && op.scope === 'file' && (op.field === 'compile' || op.field === 'link'));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 定点改写 `<Unit>` 的 `compile` / `link` 选项（保留文件其余字节）。
 * 语义对齐扩展内 `setUnitOptionInCbp`（D-09）：启用 = 删除该选项；禁用 = 写 "0"。
 */
export function applyUnitOptionToText(
  text: string,
  relativeFilename: string,
  opt: 'compile' | 'link',
  enable: boolean,
): { text: string; changed: boolean } {
  const escaped = escapeRegExp(relativeFilename);
  const optPat = `<Option ${opt}="[01]"\\s*/>`;
  const pairedRe = new RegExp(`<Unit filename="${escaped}"\\s*>([\\s\\S]*?)</Unit>`, 'g');
  const selfCloseRe = new RegExp(`<Unit filename="${escaped}"\\s*/>`, 'g');

  const m = pairedRe.exec(text);
  if (m) {
    const inner = m[1];
    let newInner: string;
    if (new RegExp(optPat).test(inner)) {
      newInner = enable
        ? inner.replace(new RegExp(`\\s*${optPat}`, 'g'), '')
        : inner.replace(new RegExp(optPat, 'g'), `<Option ${opt}="0" />`);
    } else {
      newInner = enable ? inner : `\n\t\t\t<Option ${opt}="0" />${inner}`;
    }
    const newUnit = newInner.trim()
      ? `<Unit filename="${relativeFilename}">${newInner}</Unit>`
      : `<Unit filename="${relativeFilename}" />`;
    const out = text.replace(pairedRe, newUnit);
    return { text: out, changed: out !== text };
  }

  if (selfCloseRe.test(text)) {
    if (enable) return { text, changed: false };
    const newUnit = `<Unit filename="${relativeFilename}">\n\t\t\t<Option ${opt}="0" />\n\t\t</Unit>`;
    const out = text.replace(selfCloseRe, newUnit);
    return { text: out, changed: out !== text };
  }

  fail('invalid-input', `File "${relativeFilename}" not found in the .cbp`);
}
