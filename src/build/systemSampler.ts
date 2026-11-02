/**
 * 构建期系统 CPU 归属采样（`codeblocks.build.sampleSystem`；`[profile]` 开启时也会自动启用）。
 *
 * 目的只有一个：回答「构建时 CPU 到底被谁吃了」——是**编辑器/扩展宿主**自己在空转、
 * 是**第三方安全软件**在扫每个目标文件、还是**本次构建的工具链 + 其它程序/系统**。
 *
 * 为什么不精确到每个编译器进程：
 * 1. `gcc → cc1 → as` 单条链只活 0.2~1 s。用「1 s 快照 + 同一 PID 相邻两次都在才作差」的口径
 *    会把它们整个漏掉（实测：60 个单元 5 s 编完时编译器恒为 0%）；要抓住就得 250 ms 一次，
 *    而 `Get-Process.CPU` 每次要 OpenProcess 二十来个进程，实测自身要吃掉 ~0.1 个核 ——
 *    观测者污染观测（它消耗的 CPU 还会被算进「其它程序」）。
 * 2. 真正需要的判别其实不需要它：`编辑器 + 扩展宿主` 与 `安全软件` 都是常驻进程，低频采样准确；
 *    剩下的「其它」就是工具链 + 其它程序 + 系统。若编辑器占比很低而整机跑满，就说明
 *    **满载来自编译工具链**，而不是本扩展在空转。
 *
 * 采样协议（每行一个窗口）：
 *
 *   S;<逻辑核数>;<窗口毫秒>;<整机% 或 -1>;<进程名>=<CPU毫秒>;...;<__self>=<CPU毫秒>
 *
 * 为什么不 `Get-Process | %{$_.CPU}` 全量枚举：实测 308 个进程取 `.CPU` 要 **2.5 s**
 *（每个进程都要 OpenProcess）。按名字过滤后只有二十来个进程（约 0.1 s）；整机百分比用
 * `PerformanceCounter`（初始化一次性约 1 s CPU，之后每次 <15 ms）。
 *
 * 归一在 TypeScript 侧完成（`aggregateSamples`），便于单元测试与跨平台复用：
 * 百分比按任务管理器口径 —— 100% = 全部逻辑核跑满。
 */

/** 一次采样（一行 = 一个采样窗口） */
export interface SystemSample {
  /** 逻辑核数（PS 的 `[Environment]::ProcessorCount`） */
  cores: number;
  /** 采样窗口实际毫秒数 */
  elapsedMs: number;
  /** 进程名（小写、去 .exe）→ 该窗口内消耗的 CPU 毫秒 */
  byName: Map<string, number>;
  /** 整机 CPU 利用率（%，100 = 全部逻辑核跑满）；计数器不可用时为 undefined */
  totalPct?: number;
  /** 采样器自身在该窗口消耗的 CPU 毫秒（从 other 中扣除，避免「观测者污染观测」） */
  selfMs?: number;
}

export type ProcessGroup = 'editor' | 'security' | 'scanner' | 'other';

/**
 * VS Code 的「文件扫描/控制台」辅助进程：`rg.exe`（`workspace.findFiles` 的 ripgrep）
 * 与 `conhost.exe`（每个派生控制台的宿主）。
 *
 * 为什么要单列：构建向工作区内写入几十个目标文件时，VS Code 核心会反复刷新全工作区索引，
 * 每次刷新派生一个 `rg --files` + 一个 conhost。隔离实验里这两个名字合起来峰值 **281+282** 个进程，
 * 它们都不是 `Code.exe`，所以在旧口径里被归进「其它」，看起来像「编译器吃了 79% CPU」，
 * 从而掩盖真凶（实测编译器链每单元只有 16~31 ms CPU：`gcc`/`cc1`/`as` 合计约 1.8 核 × 0.17 s）。
 */
export const SCANNER_PROCESS_NAMES: readonly string[] = ['rg', 'conhost'];

/** 已知安全软件 / 实时防护进程名（小写、去 .exe）：用于把「卡顿」归因到具体的第三方软件 */
export const SECURITY_PROCESS_NAMES: readonly string[] = [
  // 腾讯电脑管家 / QQ 电脑管家
  'qqpcmgr', 'qqpctray', 'qqpcrtp', 'qqpcrealmon', 'qqpcnetflow', 'qqpcrealtimespeedup', 'qqpcsoftmgr',
  // 360 安全卫士 / 杀毒
  '360tray', '360sd', '360safe', '360rp', '360se', 'zhudongfangyu', 'qhsafe', 'qhsafetray', 'qhactray', 'leakrepair',
  // 火绒
  'hipstray', 'usysdiag', 'sysdiag', 'hrsword',
  // 微软 Defender
  'msmpeng', 'nissrv', 'mpcmdrun', 'smartscreen', 'securityhealthservice',
  // 卡巴斯基 / ESET / 诺顿 / 迈克菲 / Avast / 小红伞 / Bitdefender / 趋势 / 金山
  'avp', 'avpui', 'kavfs', 'egui', 'ekrn', 'ccsvchst', 'navw32', 'mcshield', 'mcuicnt',
  'avastui', 'avastsvc', 'asdsvc', 'avgnt', 'avguard', 'bdagent', 'vsserv', 'tmccsf', 'tmbmsrv', 'pccntmon',
  'kxetray', 'kxe', 'kavstart', 'kwsprotect64',
];

/** 编辑器自身进程名（VS Code / Code - Insiders / Cursor …；扩展宿主就是其中一个 `Code.exe`） */
export const EDITOR_PROCESS_NAMES: readonly string[] = [
  'Code', 'Code - Insiders', 'Code - OSS', 'VSCodium', 'Cursor',
];

/** 采样名（编辑器 + 已知安全软件 + VS Code 扫描器；都是常驻或成批出现的进程） */
export const SAMPLED_PROCESS_PATTERNS: readonly string[] = [
  ...EDITOR_PROCESS_NAMES, ...SECURITY_PROCESS_NAMES, ...SCANNER_PROCESS_NAMES,
];

/** 进程名归一：小写、去 `.exe`、去空白 */
export function normalizeProcessName(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/, '');
}

/** 进程归类（编辑器 / 安全软件 / VS Code 扫描器 / 其它） */
export function categorizeProcess(name: string): ProcessGroup {
  const n = normalizeProcessName(name);
  if (!n) return 'other';
  if (EDITOR_PROCESS_NAMES.some((x) => normalizeProcessName(x) === n)) return 'editor';
  if (SECURITY_PROCESS_NAMES.includes(n)) return 'security';
  if (SCANNER_PROCESS_NAMES.includes(n)) return 'scanner';
  return 'other';
}

/**
 * 解析一行采样输出：`S;<cores>;<elapsedMs>;<totalPct 或 -1>;<name=cpuMs>;...`。
 * 非法行（空行 / 非 `S` 前缀 / 数值异常）返回 undefined —— 采样进程异常退出时不应污染统计。
 * `__self` 项单独记为 `selfMs`，不进进程表。
 */
export function parseSampleLine(line: string): SystemSample | undefined {
  const text = line.trim();
  if (!text.startsWith('S;')) return undefined;
  const parts = text.split(';');
  if (parts.length < 4) return undefined;
  const cores = Number(parts[1]);
  const elapsedMs = Number(parts[2]);
  if (!Number.isFinite(cores) || cores <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return undefined;
  const raw = Number(parts[3]);
  const totalPct = Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  const byName = new Map<string, number>();
  let selfMs: number | undefined;
  for (let i = 4; i < parts.length; i++) {
    const eq = parts[i].lastIndexOf('=');
    if (eq <= 0) continue;
    const name = normalizeProcessName(parts[i].slice(0, eq));
    const cpu = Number(parts[i].slice(eq + 1));
    if (!name || !Number.isFinite(cpu) || cpu < 0) continue;
    if (name === '__self') { selfMs = (selfMs ?? 0) + cpu; continue; }
    byName.set(name, (byName.get(name) ?? 0) + cpu);
  }
  return { cores, elapsedMs, byName, totalPct, selfMs };
}

export interface SystemSummary {
  /** 参与统计的采样窗口数 */
  samples: number;
  /** 采样覆盖的总毫秒数 */
  elapsedMs: number;
  /** 整机 CPU 利用率（%，任务管理器口径；无计数器数据时为各组之和） */
  totalPct: number;
  /** 整机利用率是否来自系统计数器（false = 退化为「受关注进程之和」） */
  totalFromCounter: boolean;
  /** 各分组 CPU 利用率（%） */
  groupPct: Record<ProcessGroup, number>;
  /** 消耗 CPU 最多的受关注进程（降序，最多 5 个） */
  top: { name: string; pct: number }[];
  /** 命中的安全软件进程（按 CPU 降序） */
  security: { name: string; pct: number }[];
}

/**
 * 汇总采样。
 *
 * 百分比 = 进程 CPU 毫秒 / Σ(窗口毫秒 × 逻辑核数) × 100（任务管理器口径）。
 * `other` = 整机 − 编辑器 − 安全软件 − VS Code 扫描器 − 采样器自身：**它包含编译器工具链、其它应用与系统**，
 * 这正是「CPU 满时到底是编译器在干活还是扩展在空转」的判据 —— 要看的是编辑器那一项是否很低。
 * `scanner` 单列的理由见 `SCANNER_PROCESS_NAMES`：它是「构建写目标文件 → 全工作区枚举」这条放大链的直接证据。
 */
export function aggregateSamples(samples: SystemSample[]): SystemSummary {
  const valid = samples.filter((s) => s.cores > 0 && s.elapsedMs > 0);
  const groupMs: Record<ProcessGroup, number> = { editor: 0, security: 0, scanner: 0, other: 0 };
  const nameMs = new Map<string, number>();
  let coresWeightedMs = 0;
  let elapsedMs = 0;
  let counterSum = 0;
  let counterCount = 0;
  let selfMs = 0;
  for (const s of valid) {
    elapsedMs += s.elapsedMs;
    coresWeightedMs += s.elapsedMs * s.cores;
    if (typeof s.totalPct === 'number' && Number.isFinite(s.totalPct)) {
      counterSum += s.totalPct;
      counterCount += 1;
    }
    if (typeof s.selfMs === 'number' && Number.isFinite(s.selfMs) && s.selfMs > 0) selfMs += s.selfMs;
    for (const [name, cpu] of s.byName) {
      groupMs[categorizeProcess(name)] += cpu;
      nameMs.set(name, (nameMs.get(name) ?? 0) + cpu);
    }
  }
  const pct = (cpuMs: number): number => (coresWeightedMs > 0 ? (cpuMs / coresWeightedMs) * 100 : 0);
  const editorPct = pct(groupMs.editor);
  const securityPct = pct(groupMs.security);
  const scannerPct = pct(groupMs.scanner);
  const selfPct = pct(selfMs);
  const totalFromCounter = counterCount > 0;
  const totalPct = totalFromCounter ? counterSum / counterCount : editorPct + securityPct + scannerPct;
  const top = [...nameMs.entries()]
    .map(([name, cpu]) => ({ name, pct: pct(cpu) }))
    .sort((a, b) => (b.pct - a.pct) || a.name.localeCompare(b.name))
    .slice(0, 5);
  return {
    samples: valid.length,
    elapsedMs,
    totalPct,
    totalFromCounter,
    groupPct: {
      editor: editorPct,
      security: securityPct,
      scanner: scannerPct,
      other: totalFromCounter ? Math.max(0, totalPct - editorPct - securityPct - scannerPct - selfPct) : 0,
    },
    top,
    security: top.filter((t) => categorizeProcess(t.name) === 'security'),
  };
}

/**
 * 采样脚本（PowerShell 5.1 兼容，`-EncodedCommand` 传入避免引号转义地狱）。
 *
 * 每 ~1 s 输出一行 `S;cores;elapsedMs;totalPct;name=cpuMs;...`：
 * - 整机百分比走 `PerformanceCounter('Processor','% Processor Time','_Total')`：
 *   首次 `NextValue()` 需要初始化（实测约 1 s CPU，一次性），之后每次 <15 ms；
 * - 受关注进程（编辑器 + 安全软件，约 20 个）按名字过滤后取 `.CPU`（累计处理器秒）差值；
 * - 新进程首窗口按 0 计（避免把「启动前的累计时间」算进窗口）；
 * - 进程退出导致的负差值按 0 计；`__self` 记录采样器自身消耗（第二个窗口起）；
 * - 循环上限 36000 轮（约 10 小时）防僵尸，构建结束由宿主 kill。
 */
export const SAMPLE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$cores=[Environment]::ProcessorCount',
  '$pc=$null',
  "try{$pc=New-Object System.Diagnostics.PerformanceCounter('Processor','% Processor Time','_Total');$null=$pc.NextValue()}catch{$pc=$null}",
  `$names=@(${SAMPLED_PROCESS_PATTERNS.map((n) => `'${n}'`).join(',')})`,
  '$prev=@{}',
  '$psS=0.0',
  '$first=1',
  '$last=[DateTime]::UtcNow',
  'for($i=0;$i -lt 36000;$i++){',
  'Start-Sleep -Milliseconds 1000',
  '$now=[DateTime]::UtcNow',
  '$el=[int](($now-$last).TotalMilliseconds)',
  '$last=$now',
  'if($el -le 0){continue}',
  '$tot=-1',
  'if($pc){try{$tot=[int]$pc.NextValue()}catch{$tot=-1}}',
  '$cur=@{}',
  'foreach($p in Get-Process -Name $names){$cur[$p.Id]=@($p.ProcessName,[double]$p.CPU)}',
  '$parts=@()',
  'foreach($k in $cur.Keys){',
  'if($prev.ContainsKey($k)){',
  '$d=$cur[$k][1]-$prev[$k][1]',
  'if($d -gt 0){$parts+="$($cur[$k][0])=$([long]($d*1000))"}',
  '}',
  '}',
  '$prev=$cur',
  '$sp=0.0',
  'try{$sp=(Get-Process -Id $PID).CPU}catch{$sp=0.0}',
  'if($first -eq 0){',
  '$sd=$sp-$psS',
  'if($sd -gt 0){$parts+=("__self="+[long]($sd*1000))}',
  '}',
  '$psS=$sp',
  '$first=0',
  "Write-Output ('S;'+$cores+';'+$el+';'+$tot+';'+($parts -join ';'))",
  '}',
].join('; ');

/** UTF-16LE + base64（PowerShell `-EncodedCommand` 要求） */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}
