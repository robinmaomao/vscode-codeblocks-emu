/**
 * 用户工程模板 —— 对标 Code::Blocks 的 Save project as template / New from template。
 *
 * CB 依据：
 * - `projecttemplateloader.cpp`（用户模板目录 + `CodeBlocks_template_file` 扩展名）；
 * - `newfromtemplatedlg.cpp`（从模板新建对话框）；
 * - `main_menu.xrc:32`（File → New → From template…）、`:87`（File → Save project as template…）。
 *
 * 本扩展的模板格式（自有、文本可审）：
 * ```
 * <模板根>/<id>/
 *   template.json   清单（名称/描述/编译器/骨架文件列表）
 *   project.cbp     工程副本；工程名以占位符 `$(PROJECT_NAME)` 记录（对齐 CB 脚本向导的写法）
 *   main.c …        骨架文件（保持相对路径结构）
 * ```
 * 保存时把标题/输出文件名中的工程名替换为占位符；实例化时再把占位符替换为新工程名。
 *
 * 纯逻辑模块（仅依赖 fs/path），供命令与回归测试共用；不依赖 vscode。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 清单 schema 版本（后续格式变更时递增并做兼容判断） */
export const TEMPLATE_SCHEMA = 1;
/** 工程名占位符（CB 脚本向导同款写法） */
export const PROJECT_NAME_PLACEHOLDER = '$(PROJECT_NAME)';
/** 清单文件名 */
export const TEMPLATE_MANIFEST_FILENAME = 'template.json';
/** 模板内工程文件名（实例化时改名为 `<新工程名>.cbp`） */
export const TEMPLATE_CBP_FILENAME = 'project.cbp';

export interface UserTemplateManifest {
  schema: number;
  id: string;
  name: string;
  description: string;
  compilerId: string;
  /** 模板内 .cbp 文件名（相对模板目录） */
  cbp: string;
  /** 骨架文件（相对模板目录 / 相对工程目录，posix 分隔） */
  files: string[];
  createdAt: string;
}

export interface SaveTemplateOptions {
  /** 模板根目录 */
  root: string;
  /** 模板显示名（同时决定 id） */
  name: string;
  description?: string;
  /** 源工程目录（骨架文件相对基准） */
  projectDir: string;
  /** 源工程 .cbp 路径 */
  cbpPath: string;
  /** 源工程标题（XML 中替换为占位符） */
  projectTitle: string;
  compilerId?: string;
  /** 要收进模板的文件（相对工程目录；不存在的静默跳过） */
  fileRels: string[];
  /** 同名模板已存在时是否覆盖 */
  overwrite?: boolean;
}

/** 归一化为 posix 相对路径（模板内部统一存 posix） */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** XML 属性值转义（与 projectWriter 输出保持一致的常见五项） */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 模板 id：小写、非字母数字（含中文）转 `-`；非法时回退 `template` */
export function slugifyTemplateId(name: string): string {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'template';
}

/** 需要做工程名替换的属性（对齐 .cbp 中承载工程名的字段） */
const NAME_ATTRS = new Set(['title', 'output', 'def', 'imp_lib']);

/** 对指定属性的值做变换（其余属性原样返回） */
function rewriteNamedAttrs(xml: string, transform: (attr: string, value: string) => string): string {
  return xml.replace(/([A-Za-z_][\w:.-]*)="([^"]*)"/g, (whole, attr: string, value: string) => {
    if (!NAME_ATTRS.has(attr)) return whole;
    const next = transform(attr, value);
    return next === value ? whole : `${attr}="${next}"`;
  });
}

/** 保存方向：把工程名替换为占位符（title / output / def / imp_lib 属性内） */
export function replaceProjectNameInXml(xml: string, projectTitle: string): string {
  if (!projectTitle) return xml;
  const forms = new Set([projectTitle, escapeXml(projectTitle)]);
  return rewriteNamedAttrs(xml, (_attr, value) => {
    let out = value;
    for (const f of forms) {
      if (f && out.includes(f)) out = out.split(f).join(PROJECT_NAME_PLACEHOLDER);
    }
    return out;
  });
}

/** 实例化方向：把占位符替换为新工程名（必要时做 XML 转义） */
export function applyTemplateNameToXml(xml: string, newName: string): string {
  const escaped = escapeXml(newName);
  return rewriteNamedAttrs(xml, (_attr, value) => {
    if (!value.includes(PROJECT_NAME_PLACEHOLDER)) return value;
    return value.split(PROJECT_NAME_PLACEHOLDER).join(escaped);
  });
}

/** 读取模板清单（非法返回 undefined，供列表过滤） */
function readManifest(tplDir: string): UserTemplateManifest | undefined {
  try {
    const raw = fs.readFileSync(path.join(tplDir, TEMPLATE_MANIFEST_FILENAME), 'utf-8');
    const m = JSON.parse(raw) as UserTemplateManifest;
    if (!m || m.schema !== TEMPLATE_SCHEMA || !m.id || !m.cbp) return undefined;
    return m;
  } catch {
    return undefined;
  }
}

/** 列出模板根下全部有效模板（按显示名排序） */
export function listUserTemplates(root: string): UserTemplateManifest[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: UserTemplateManifest[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = readManifest(path.join(root, e.name));
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 读取单个模板清单（不存在/非法返回 undefined） */
export function getUserTemplate(root: string, id: string): UserTemplateManifest | undefined {
  return readManifest(path.join(root, String(id ?? '')));
}

/**
 * 把现有工程保存为模板。
 * - 工程名 → `$(PROJECT_NAME)` 占位符（标题与输出文件名）；
 * - 骨架文件按 `fileRels` 收编（缺失跳过；目录结构保留）；
 * - 同名模板存在且未允许覆盖时抛错。
 */
export function saveAsUserTemplate(opts: SaveTemplateOptions): UserTemplateManifest {
  const name = String(opts.name ?? '').trim();
  if (!name) throw new Error('模板名称不能为空');
  const id = slugifyTemplateId(name);
  const tplDir = path.join(opts.root, id);
  if (fs.existsSync(tplDir) && !opts.overwrite) throw new Error(`模板已存在：${name}（${id}）`);

  const xml = fs.readFileSync(opts.cbpPath, 'utf-8');
  const files: string[] = [];
  const collected: { rel: string; abs: string }[] = [];
  for (const rel of opts.fileRels ?? []) {
    const norm = toPosix(String(rel ?? ''));
    if (!norm || norm.startsWith('..') || path.isAbsolute(rel)) continue;
    const abs = path.join(opts.projectDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    collected.push({ rel: norm, abs });
    files.push(norm);
  }

  fs.mkdirSync(tplDir, { recursive: true });
  // 清空旧内容（覆盖场景下避免残留过期骨架文件）
  for (const e of fs.readdirSync(tplDir)) {
    fs.rmSync(path.join(tplDir, e), { recursive: true, force: true });
  }
  for (const c of collected) {
    const dest = path.join(tplDir, c.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(c.abs, dest);
  }
  fs.writeFileSync(
    path.join(tplDir, TEMPLATE_CBP_FILENAME),
    replaceProjectNameInXml(xml, opts.projectTitle),
    'utf-8',
  );

  const manifest: UserTemplateManifest = {
    schema: TEMPLATE_SCHEMA,
    id,
    name,
    description: String(opts.description ?? '').trim(),
    compilerId: String(opts.compilerId ?? ''),
    cbp: TEMPLATE_CBP_FILENAME,
    files,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(tplDir, TEMPLATE_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

export interface InstantiateResult {
  manifest: UserTemplateManifest;
  projectDir: string;
  cbpPath: string;
  /** 实际落盘的骨架文件数（顺带统计缺失者） */
  copiedFiles: number;
  missingFiles: string[];
}

/** 校验新工程名（与新建向导同一口径） */
export function isValidProjectName(name: string): string | undefined {
  const v = String(name ?? '');
  if (!v.trim()) return '工程名不能为空';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(v)) return '工程名含非法字符';
  return undefined;
}

/** 从模板实例化工程：复制骨架 + 写出 `<新名>.cbp`（占位符 → 新工程名） */
export function instantiateUserTemplate(
  root: string,
  id: string,
  newName: string,
  basePath: string,
): InstantiateResult {
  const manifest = getUserTemplate(root, id);
  if (!manifest) throw new Error(`模板不存在：${id}`);
  const bad = isValidProjectName(newName);
  if (bad) throw new Error(bad);
  const name = newName.trim();
  const tplDir = path.join(root, manifest.id);
  const projectDir = path.join(basePath, name);
  fs.mkdirSync(projectDir, { recursive: true });

  let copied = 0;
  const missing: string[] = [];
  for (const rel of manifest.files ?? []) {
    const src = path.join(tplDir, rel);
    if (!fs.existsSync(src)) { missing.push(rel); continue; }
    const dest = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied++;
  }
  const cbpSrc = path.join(tplDir, manifest.cbp);
  if (!fs.existsSync(cbpSrc)) throw new Error(`模板工程文件缺失：${manifest.cbp}`);
  const cbpPath = path.join(projectDir, `${name}.cbp`);
  fs.writeFileSync(cbpPath, applyTemplateNameToXml(fs.readFileSync(cbpSrc, 'utf-8'), name), 'utf-8');
  return { manifest, projectDir, cbpPath, copiedFiles: copied, missingFiles: missing };
}
