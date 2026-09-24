/**
 * 简单 LRU（最近最少使用）缓存 —— 为跨构建/跨会话的模块级缓存提供容量上限，
 * 超出容量时淘汰最久未访问的条目，避免无界增长。
 *
 * 基于 Map 的插入顺序实现：get 命中时 delete + set 把条目移到末尾（最新），
 * 因此 Map 第一个 key 即最久未使用项。
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('LruCache 容量必须 ≥ 1');
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // 命中：移到末尾（最新）
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // 淘汰最久未使用（Map 第一个）
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
