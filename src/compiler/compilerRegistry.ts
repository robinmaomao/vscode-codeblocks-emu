/**
 * 目标编译器 ID 解析 —— 纯模块（依赖注入，无 vscode 依赖）。
 *
 * 对齐 Code::Blocks：
 *  - `CompilerFactory::GetCompiler`（compilerfactory.cpp:42-58）：大小写不敏感 + 去 `-` 旧 ID 格式二次匹配；
 *  - 工程加载器缺省（projectloader.cpp:396）：工程/目标缺 `compiler` 属性 → 字面 **"gcc"**
 *    （完全无 `<Option>` 节点时沿用 cbProject 构造默认，cbproject.cpp:69）——CB 中编译器 ID 永不为空，
 *    因此空 ID **不应**按「无效编译器」处理；
 *  - 目标继承工程（projectloader.cpp:547/664；扩展侧 parser.ts:439 同语义）。
 *
 * 保护性回退：`"gcc"` 未注册时使用扩展设置默认编译器（`codeblocks.compilerId`，默认亦为 gcc），
 * 保持行为自洽（UI 路径 `getCompiler('')` 亦有 gcc 回退）。
 */

/** 宿主注入的注册查询依赖（extension.ts 接线：扩展设置 / default.conf 用户编译器 / 随包 options_*.xml） */
export interface CompilerRegistryDeps {
  /** 扩展设置 `codeblocks.compilerId`（CB「默认编译器」的等价物；恒返回字符串，默认 'gcc'） */
  configuredId(): string;
  /** 用户自定义/已注册编译器集判定（对齐 codeBlocksConfig.find(id)） */
  isRegistered(id: string): boolean;
  /** 随包编译器资源存在性（options_<id>.xml；调用方在资源目录缺失时应返回 false） */
  hasResourceFile(fileName: string): boolean;
}

/** 候选 ID 序列：原样 → 小写 → 去 `-`（旧 ID 格式二次匹配；去重保序，对齐 compilerfactory.cpp） */
export function compilerIdCandidates(compilerId: string): string[] {
  const out: string[] = [];
  for (const c of [compilerId, compilerId.toLowerCase(), compilerId.replace(/-/g, '')]) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 查找已注册的编译器 ID（命中返回对应候选值；未注册返回 undefined） */
export function findRegisteredCompilerId(compilerId: string, deps: CompilerRegistryDeps): string | undefined {
  const configured = deps.configuredId();
  for (const c of compilerIdCandidates(compilerId)) {
    if (c === configured) return c;
    if (deps.isRegistered(c)) return c;
    if (deps.hasResourceFile(`options_${c}.xml`)) return c;
    const lower = c.toLowerCase();
    if (lower !== c && deps.hasResourceFile(`options_${lower}.xml`)) return c;
  }
  return undefined;
}

/**
 * 解析「有效编译器 ID」：
 * 非空 ID 原样返回；空 ID → 已注册的 `"gcc"`（CB 加载器缺省），否则回退设置 `configuredId()`
 * （不再有可退时返回设置原值，由上层按未注册处理——仅资源与配置同时缺失的极端环境）。
 */
export function resolveEffectiveCompilerId(compilerId: string, deps: CompilerRegistryDeps): string {
  if (compilerId) return compilerId;
  return findRegisteredCompilerId('gcc', deps) ?? deps.configuredId();
}
