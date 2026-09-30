/**
 * 编译器实例缓存工具（P6）——纯模块（无 vscode 依赖），便于单测。
 *
 * 背景：CompilerOptionsLoader.load 每次调用都会重新读取并解析编译器 XML
 * （含 extends 链，约 8 个文件）；一遍构建/清理会经 getCompiler 重复触发数次至十几次。
 * 缓存键包含所有影响结果的输入（编译器 ID / masterPath / compilerPrograms），
 * 配置变化自动换键重建；compilerResultCache 用有界容器防无界增长。
 */

/**
 * 组装编译器结果缓存键。
 * @param id 编译器 ID（如 gcc / riscv32-v2）
 * @param masterPath codeblocks.masterPath 设置
 * @param programs codeblocks.compilerPrograms 设置（探测到的完整程序路径）
 */
export function buildCompilerCacheKey(
  id: string,
  masterPath: string,
  programs: Record<string, string> | undefined,
): string {
  let programsKey: string;
  try {
    programsKey = JSON.stringify(programs ?? {});
  } catch {
    programsKey = ''; // 不可序列化（循环引用等）时不参与键
  }
  return `${id}\u0000${masterPath}\u0000${programsKey}`;
}

/** 简易有界 Map（FIFO 淘汰；键空间小，无需 LRU 计龄） */
export class BoundedMap<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
