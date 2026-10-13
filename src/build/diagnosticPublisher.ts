/**
 * Problems 面板诊断发布器 —— 构建期按 URI 归集 + 节流发布 + 结束统一收尾。
 *
 * 背景（实测）：原实现每来一条诊断就 `get` + `set` 一次，而 `set` 会把**整个数组**拷贝并跨进程
 * 提交给渲染进程 ⇒ N 条诊断 = O(N²) 拷贝 + N 次 IPC。
 * 实测（4000 条诊断 / 20 文件）：`set` 调用 4000 次、累计提交 402000 个元素；
 * 按文件归集后只需 20 次、4000 个元素（调用数 0.5%，提交量 1%）。
 *
 * 语义与逐条发布保持一致：
 *  - 同一 URI 的诊断按到达顺序追加（集合在构建开始时已被 clear）；
 *  - 构建期间**节流发布**（默认 200ms），Problems 逐步更新；
 *  - 构建结束（成功/失败/取消）调用 `finish()` 做最终发布并清理定时器。
 *
 * 泛型化 URI/诊断类型，便于无头单测（不需要 vscode 宿主）。
 */

/** 诊断集合的最小接口（`vscode.DiagnosticCollection` 结构兼容） */
export interface DiagnosticSink<U, D> {
  get(uri: U): readonly D[] | undefined;
  set(uri: U, diagnostics: readonly D[]): void;
}

/** 节流发布间隔（毫秒；内部常量，不暴露为设置项） */
export const DIAGNOSTIC_PUBLISH_THROTTLE_MS = 200;

export class DiagnosticPublisher<U, D> {
  private pending = new Map<string, { uri: U; diags: D[] }>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly collection: DiagnosticSink<U, D>,
    private readonly keyOf: (uri: U) => string = (u) => String(u),
    private readonly throttleMs: number = DIAGNOSTIC_PUBLISH_THROTTLE_MS,
  ) {}

  /** 归集一条诊断（不立即写集合；由节流定时器/`finish()` 统一发布） */
  add(uri: U, diag: D): void {
    const key = this.keyOf(uri);
    const entry = this.pending.get(key);
    if (entry) {
      entry.diags.push(diag);
    } else {
      this.pending.set(key, { uri, diags: [diag] });
    }
    if (this.timer === undefined && this.throttleMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.flush();
      }, this.throttleMs);
      // 不阻止宿主退出；构建期宿主存活，定时器照常触发
      this.timer.unref?.();
    }
  }

  /** 发布当前待发布项（追加到各 URI 现有诊断之后，顺序与逐条发布一致） */
  flush(): void {
    if (!this.pending.size) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const { uri, diags } of batch) {
      if (!diags.length) continue;
      const prev = this.collection.get(uri) ?? [];
      this.collection.set(uri, [...prev, ...diags]);
    }
  }

  /** 构建结束（含取消/异常）：清定时器 + 最终发布一次 */
  finish(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.flush();
  }

  /**
   * 丢弃尚未发布的诊断（不写集合）。用于构建进行中用户手动「清除错误/输出」：
   * 逐条发布的旧实现下，清除后不会再出现先前已到达的诊断；批量归集必须同样丢弃，
   * 否则清除动作之后会出现一批「复活」的旧诊断。
   */
  clearPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
  }

  /** 尚有未发布的诊断（测试用） */
  get pendingCount(): number {
    let n = 0;
    for (const e of this.pending.values()) n += e.diags.length;
    return n;
  }
}
