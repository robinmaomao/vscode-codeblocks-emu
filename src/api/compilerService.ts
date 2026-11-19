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
    const cacheKey = buildCompilerCacheKey(id, masterPath, programs);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const built = buildCompilerInstance(id, masterPath, opts.settings, { loader, codeBlocksConfig });
    cache.set(cacheKey, built);
    return built;
  };

  const resolveTargetCompiler = (compilerId: string): Compiler | undefined => {
    const deps = registryDeps();
    const id = findRegisteredCompilerId(resolveEffectiveCompilerId(compilerId, deps), deps);
    return id ? getCompiler(id) : undefined;
  };

  return { getCompiler, resolveTargetCompiler, resourcesDir: opts.resourcesDir };
}
