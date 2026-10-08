/**
 * 构建阶段计时探针（M0 性能基准）—— 环境变量 `CB_BUILD_PROFILE=1` 启用。
 *
 * 目的：量化构建各阶段耗时（环境准备 / 收集（增量判定·命令生成）/ 首编译 spawn 延迟 /
 * 编译墙钟 / 宿主输出解析 / 链接 / 脚本），为编译速度优化提供「优化前 → 优化后」对比基线。
 *
 * 行为约定：
 * - 默认关闭：不创建实例、不产生任何输出、无行为变化；
 * - 数据仅驻留内存，构建结束时由 BuildEngine.emitBuildProfile() 渲染为输出通道的 `[profile]` 块；
 * - 键名约定 `'<组>/<相位>'`：组为空 = 全局；`'项目/…'` = 项目级；`'<目标名>/…'` = 目标级。
 */

/** 单条时序/计数条目（插入顺序即渲染顺序） */
interface ProfileEntry {
  key: string;
  ms: number;
  count: number;
}

/** 显示宽度（CJK 全角按 2 列计，用于对齐输出列） */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    w += (c >= 0x1100 && (
      c <= 0x115f
      || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe4f)
      || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6)
    )) ? 2 : 1;
  }
  return w;
}

/** 字节数格式化（计数类条目名含「字节」时使用） */
function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export class BuildProfiler {
  /** 是否启用（环境变量 CB_BUILD_PROFILE=1；每次调用实时读取，便于测试） */
  static enabled(): boolean {
    return process.env.CB_BUILD_PROFILE === '1';
  }

  private entries: ProfileEntry[] = [];
  private byKey = new Map<string, ProfileEntry>();
  private counters = new Map<string, number>();

  /** 累加一个相位的耗时（count 自增；同键多次调用自动累计） */
  add(key: string, ms: number): void {
    let e = this.byKey.get(key);
    if (!e) {
      e = { key, ms: 0, count: 0 };
      this.byKey.set(key, e);
      this.entries.push(e);
    }
    e.ms += ms;
    e.count += 1;
  }

  /** 从起始时间戳记录一次耗时（便捷封装） */
  mark(key: string, startMs: number): void {
    this.add(key, Date.now() - startMs);
  }

  /** 计数类条目累加（spawn 次数 / 输出字节等） */
  count(key: string, n = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + n);
  }

  /** 同步代码块计时（返回块内结果，异常同样计入） */
  time<T>(key: string, fn: () => T): T {
    const t0 = Date.now();
    try {
      return fn();
    } finally {
      this.add(key, Date.now() - t0);
    }
  }

  /** 异步代码块计时（返回块内结果，异常同样计入） */
  async timeAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this.add(key, Date.now() - t0);
    }
  }

  /** 渲染为输出行（全局组置顶，其余按插入顺序；组内单列对齐） */
  render(): string[] {
    interface Row { group: string; name: string; value: string }
    const rows: Row[] = [];
    for (const e of this.entries) {
      const i = e.key.indexOf('/');
      const group = i < 0 ? '' : e.key.slice(0, i);
      const name = i < 0 ? e.key : e.key.slice(i + 1);
      rows.push({ group, name, value: `${e.ms.toFixed(1)} ms${e.count > 1 ? `（×${e.count}）` : ''}` });
    }
    for (const [key, n] of this.counters) {
      const i = key.indexOf('/');
      const group = i < 0 ? '' : key.slice(0, i);
      const name = i < 0 ? key : key.slice(i + 1);
      rows.push({ group, name, value: name.includes('字节') ? formatBytes(n) : String(n) });
    }
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const list = groups.get(r.group);
      if (list) list.push(r);
      else groups.set(r.group, [r]);
    }
    const out: string[] = ['构建阶段计时（CB_BUILD_PROFILE=1）'];
    const orderedGroups = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
    for (const g of orderedGroups) {
      if (g) out.push(`── ${g} ──`);
      const list = groups.get(g)!;
      const width = Math.max(...list.map((r) => displayWidth(r.name)));
      for (const r of list) {
        const pad = ' '.repeat(Math.max(1, width - displayWidth(r.name) + 2));
        out.push(`${g ? '   ' : '  '}${r.name}${pad}${r.value}`);
      }
    }
    return out;
  }
}
