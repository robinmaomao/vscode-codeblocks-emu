/**
 * F5 / launch.json 接入（R5）：让「没有 launch.json 的 F5」也能按 Code::Blocks 语义启动调试。
 *
 * VS Code 机制（1.8x 源码核对结论）：
 *  - 无 launch.json 按 F5 → `debugService.createSession` → `adapterManager.guessDebugger`：
 *      · 有活动编辑器、且该语言只有唯一「感兴趣的调试器」→ 直接选中它（**不弹选择框**）；
 *      · 否则弹 `Select debugger`（候选 = 有 initialConfigurations / 动态 / 静态 provider 的调试器）。
 *  - 之后 `configurationManager.resolveConfigurationByProviders` **只询问扩展注册的
 *    `DebugConfigurationProvider`**；扩展一个都没注册时解析结果为空（连 `type` 都没有），
 *    `createSession` 的 `configByProviders.type` 判据失败 → 直接跳过创建会话，**无任何提示**。
 *  - 因此这里提供两组 provider：
 *      · Initial：`resolveDebugConfiguration`（F5 空配置 → 按活动工程目标推导）+ `provideDebugConfigurations`（创建 launch.json）；
 *      · Dynamic：`provideDebugConfigurations`（`Select and Start Debugging` / 「More … options」动态列表）。
 *
 * 推导本身（工程/目标 → 可执行文件、GDB、运行目录、参数、环境、源目录、远程目标）由宿主注入
 * （extension.ts 中的 `deriveDebugLaunchConfig`，与 F8 / `Code::Blocks: Debug` 完全同源）。
 */
import * as fs from 'fs';
import * as vscode from 'vscode';

/** 推导结果：成功给出完整启动配置；失败给出可直接展示的中文错误文案 */
export type DerivedLaunchConfig = { config: vscode.DebugConfiguration } | { error: string };

/** 宿主回调（由 extension.ts 注入；单测可用假实现替换） */
export interface DebugConfigProviderHost {
  /** 用「活动工程 + 活动/默认目标」推导完整 launch 配置 */
  deriveLaunchConfig(): Promise<DerivedLaunchConfig>;
  /** 推导失败时的占位模板（与 package.json `initialConfigurations` 对齐） */
  fallbackLaunchConfig(): vscode.DebugConfiguration;
  /** 展示错误（沿用 F8 路径文案） */
  showError(message: string): void;
  /** 输出通道日志（可选） */
  log?(message: string): void;
  /** 文件存在性判断（默认 fs.existsSync，单测可注入） */
  exists?(file: string): boolean;
}

/** 调试器类型（与 package.json contributes.debuggers[0].type 一致） */
export const DEBUGGER_TYPE = 'codeblocks';
const DEFAULT_NAME = 'Debug (Code::Blocks)';
const ATTACH_NAME = 'Attach (Code::Blocks)';

/** 补齐 VS Code 解析配置所需的最小字段（`type` 缺失会让 createSession 判据失败而静默跳过） */
function ensureBase(config: vscode.DebugConfiguration | undefined): vscode.DebugConfiguration {
  // F5 空配置路径下 VS Code 传入的对象没有 type（API 类型声明为必填，故此处断言）
  const cfg = { ...(config ?? {}) } as vscode.DebugConfiguration;
  if (!cfg.type) cfg.type = DEBUGGER_TYPE;
  if (!cfg.request) cfg.request = 'launch';
  return cfg;
}

export function createDebugConfigurationProviders(host: DebugConfigProviderHost): {
  initial: vscode.DebugConfigurationProvider;
  dynamic: vscode.DebugConfigurationProvider;
} {
  const exists = host.exists ?? ((file: string) => fs.existsSync(file));

  /**
   * 用活动工程推导并合并：用户显式给出的字段优先（如 launch.json 只写了 cwd/args 时其余仍取推导值）。
   * 推导失败直接中止启动（返回 undefined）并给出明确提示，绝不静默。
   */
  async function deriveAndMerge(cfg: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
    const derived = await host.deriveLaunchConfig();
    if ('error' in derived) {
      host.showError(derived.error);
      return undefined;
    }
    const merged: vscode.DebugConfiguration = { ...derived.config, ...cfg };
    merged.type = DEBUGGER_TYPE;
    merged.request = cfg.request ?? 'launch';
    if (!merged.name) merged.name = derived.config.name ?? DEFAULT_NAME;
    return merged;
  }

  async function provideConfigs(): Promise<vscode.DebugConfiguration[]> {
    const derived = await host.deriveLaunchConfig();
    if ('error' in derived) {
      host.log?.(`调试配置推导失败：${derived.error}（回退到占位模板）`);
      return [host.fallbackLaunchConfig()];
    }
    return [derived.config];
  }

  const initial: vscode.DebugConfigurationProvider = {
    // 「添加配置」/「创建 launch.json」：给出当前工程真实目标输出，而不是占位路径
    provideDebugConfigurations: provideConfigs,

    // F5（无 launch.json 空配置）与 launch.json 启动都会经过这里
    async resolveDebugConfiguration(_folder, config) {
      const cfg = ensureBase(config);
      if (cfg.request === 'attach') {
        if (!cfg.name) cfg.name = ATTACH_NAME;
        return cfg;
      }
      if (typeof cfg.program === 'string' && cfg.program.trim()) {
        if (!cfg.name) cfg.name = DEFAULT_NAME;
        return cfg; // 用户已显式给出 program：尊重之（变量替换后再做存在性兜底）
      }
      return await deriveAndMerge(cfg);
    },

    /**
     * 变量替换后的兜底：program 指向的文件不存在时回退到活动工程目标输出。
     * 覆盖「手写/陈旧 launch.json 的 program 失效」场景（含 manifest 占位模板被创建出来的情况）。
     */
    async resolveDebugConfigurationWithSubstitutedVariables(_folder, config) {
      if (!config || config.request !== 'launch') return config;
      const program = typeof config.program === 'string' ? config.program.trim() : '';
      if (program && exists(program)) return config;
      const derived = await host.deriveLaunchConfig();
      if ('error' in derived) {
        host.log?.(`program 不存在（${program || '未设置'}）且无法从活动工程推导，交由调试适配器处理`);
        return config;
      }
      const next: vscode.DebugConfiguration = { ...config, program: derived.config.program };
      if (!next.cwd) next.cwd = derived.config.cwd;
      if (!next.gdbPath) next.gdbPath = derived.config.gdbPath;
      host.log?.(`program 不存在（${program || '未设置'}）→ 已回退到活动工程目标输出：${derived.config.program}`);
      return next;
    },
  };

  const dynamic: vscode.DebugConfigurationProvider = {
    // 动态配置（Select and Start Debugging / 「More Code::Blocks GDB options...」列表）
    provideDebugConfigurations: provideConfigs,
  };

  return { initial, dynamic };
}
