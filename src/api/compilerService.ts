/**
 * 编译器服务（无 vscode 依赖）：与扩展 getCompiler / resolveTargetCompiler 同源的 CLI/MCP 版本。
 */
import * as fs from 'fs';
import * as path from 'path';
import { Compiler } from '../compiler/compiler';
import { CompilerOptionsLoader } from '../compiler/optionsLoader';
import { CodeBlocksConfig } from '../compiler/codeblocksConfig';
import { buildCompilerInstance, CompilerSettingsLike } from '../compiler/compilerFactory';
import { BoundedMap, buildCompilerCacheKey } from '../compiler/compilerCache';
import { languageFlagsKey, normalizeLanguageFlags, pickLanguageFlags } from '../compiler/languageFlags';
import { resolveProgramsForCompiler } from '../compiler/compilerPrograms';
import { CompilerRegistryDeps, findRegisteredCompilerId, resolveEffectiveCompilerId } from '../compiler/compilerRegistry';

export interface CompilerProviderOptions {
  /** 扩展安装目录下的 resources/compilers（CLI 可指向仓库 resources/compilers） */
  resourcesDir: string;
  settings: CompilerSettingsLike;
  /** Code::Blocks default.conf 路径（缺省按平台自动探测） */
  defaultConfPath?: string;
}

export interface CompilerProvider {
  getCompiler(compilerId?: string): Compiler;
  resolveTargetCompiler(compilerId: string): Compiler | undefined;
  /** 是否为已注册编译器（XML 资源或用户自定义），不做默认回退 */
  isRegisteredCompiler(compilerId: string): boolean;
  /** 随包编译器资源目录 */
  resourcesDir: string;
}

export function createCompilerProvider(opts: CompilerProviderOptions): CompilerProvider {
  const loader = new CompilerOptionsLoader(opts.resourcesDir);
  const codeBlocksConfig = new CodeBlocksConfig();
  try {
    codeBlocksConfig.load(opts.defaultConfPath);
  } catch {
    // default.conf 损坏/不可读时按「无用户编译器」继续（与扩展启动路径一致）
  }
  const cache = new BoundedMap<string, Compiler>(24);
  // 与宿主一致：「仅 C / 仅 C++ 参数」的用户覆盖必须先于编译器装配生效，
  // 否则 CLI/MCP 构建会静默回落到 XML <Sort> 基线，产物与 UI 不同。
  const languageStore = normalizeLanguageFlags(opts.settings.get<unknown>('compiler.languageFlags', {}));

  const registryDeps = (): CompilerRegistryDeps => ({
    configuredId: () => opts.settings.get<string>('compilerId', 'gcc'),
    isRegistered: (id) => !!codeBlocksConfig.find(id),
    hasResourceFile: (name) => fs.existsSync(path.join(opts.resourcesDir, name)),
  });

  const getCompiler = (compilerId?: string): Compiler => {
    const id = compilerId ?? opts.settings.get<string>('compilerId', 'gcc');
    const masterPath = opts.settings.get<string>('masterPath', '');
    const programs = resolveProgramsForCompiler(
      opts.settings.get<unknown>('compilerPrograms', {}),
      id,
      opts.settings.get<string>('compilerId', 'gcc'),
    );
    const cacheKey = buildCompilerCacheKey(id, masterPath, programs, languageFlagsKey(id, languageStore));
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const built = buildCompilerInstance(id, masterPath, opts.settings, {
      loader,
      codeBlocksConfig,
      languageFlags: (compilerId2, baseline) => pickLanguageFlags(compilerId2, baseline, languageStore),
    });
    cache.set(cacheKey, built);
    return built;
  };

  const resolveTargetCompiler = (compilerId: string): Compiler | undefined => {
    const deps = registryDeps();
    const id = findRegisteredCompilerId(resolveEffectiveCompilerId(compilerId, deps), deps);
    return id ? getCompiler(id) : undefined;
  };

  /** 注册判定：未知 id 必须显式报错，而不是用默认编译器合成一个「看起来存在」的实例 */
  const isRegisteredCompiler = (compilerId: string): boolean => !!findRegisteredCompilerId(compilerId, registryDeps());

  return { getCompiler, resolveTargetCompiler, isRegisteredCompiler, resourcesDir: opts.resourcesDir };
}
