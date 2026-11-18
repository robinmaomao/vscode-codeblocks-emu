/**
 * Code::Blocks compiler metadata (`compiler_<id>.xml`) —— 显示名与 master 路径提示。
 *
 * 只读取 root 的 `name`/`id` 与 `<Path type="master">` 下的 `Search path` / `Fallback`；
 * registry / `envVar` / 外部命令探测仍交给 detector，避免在纯模块里执行系统命令。
 */
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

export interface CompilerMetadata {
  id: string;
  name: string;
  masterPaths: string[];
  weight?: number;
  platform?: string;
}

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | undefined {
  const node = Array.isArray(value) ? value[0] : value;
  return node && typeof node === 'object' ? node as XmlNode : undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function expandEnv(value: string): string {
  return value
    .replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? '')
    .replace(/\$\(([^)]+)\)/g, (_m, name: string) => process.env[name] ?? '')
    .replace(/\$\{([^}]+)\}/g, (_m, name: string) => process.env[name] ?? '');
}

function collectPaths(value: unknown, out: string[]): void {
  for (const item of asArray(value)) {
    const node = asNode(item);
    if (!node) continue;
    const raw = node['@_path'];
    if (typeof raw === 'string' && raw.trim()) {
      const expanded = expandEnv(raw.trim());
      if (expanded && !expanded.includes('%') && !out.includes(expanded)) out.push(expanded);
    }
    collectPaths(node.Add, out);
    collectPaths(node.Search, out);
    collectPaths(node.Fallback, out);
    collectPaths(node.if, out);
    collectPaths(node.else, out);
  }
}

export class CompilerMetadataIndex {
  private cache = new Map<string, CompilerMetadata | null>();
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });

  constructor(private readonly resourcesDir: string) {}

  /** 读取 `compiler_<id>.xml`；不存在/损坏时返回 null，不影响 options 加载。 */
  get(id: string): CompilerMetadata | null {
    const key = id.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const file = path.join(this.resourcesDir, `compiler_${id}.xml`);
    let metadata: CompilerMetadata | null = null;
    try {
      const root = this.parser.parse(fs.readFileSync(file, 'utf-8'))?.CodeBlocks_compiler;
      const node = asNode(root);
      if (node) {
        const name = typeof node['@_name'] === 'string' ? node['@_name'].trim() : '';
        const metaId = typeof node['@_id'] === 'string' ? node['@_id'].trim() : id;
        const masterPaths: string[] = [];
        for (const p of asArray(node.Path)) {
          const pathNode = asNode(p);
          if (!pathNode || pathNode['@_type'] !== 'master') continue;
          collectPaths(pathNode.Search, masterPaths);
          collectPaths(pathNode.Fallback, masterPaths);
          collectPaths(pathNode.if, masterPaths);
          collectPaths(pathNode.else, masterPaths);
        }
        metadata = {
          id: metaId || id,
          name: name || id,
          masterPaths,
          weight: Number(node['@_weight']) || undefined,
          platform: typeof node['@_platform'] === 'string' ? node['@_platform'] : undefined,
        };
      }
    } catch {
      metadata = null;
    }
    this.cache.set(key, metadata);
    return metadata;
  }
}
