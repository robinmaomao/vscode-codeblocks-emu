/**
 * 编译器实例装配（无 vscode 依赖）—— 从 extension.ts 的 `buildCompilerInstance` 抽出。
 *
 * 宿主差异只有两处，通过参数注入：
 *  - 设置读取：扩展传 `vscode.WorkspaceConfiguration`（结构上满足 {@link CompilerSettingsLike}）；
 *    CLI/MCP 传 `settingsReader` 生成的等价对象。
 *  - 编译器资源：扩展传 `CompilerOptionsLoader(resources/compilers)`；CLI 传同一目录。
 *
 * 这样「面板/命令行/Agent」选出的编译器程序路径、全局搜索目录、用户正则完全一致。
 */
import * as path from 'path';
import { Compiler } from './compiler';
import { CompilerOptionsLoader } from './optionsLoader';
import { CodeBlocksConfig } from './codeblocksConfig';
import { resolveProgramsForCompiler } from './compilerPrograms';
import { queryCompilerVersionString } from './compilerVersion';

/** 与 `vscode.WorkspaceConfiguration` 的结构子集（只取编译装配用到的部分） */
export interface CompilerSettingsLike {
  get<T>(section: string, defaultValue: T): T;
}

export interface CompilerFactoryDeps {
  /** 编译器 XML 加载器（resources/compilers） */
  loader?: CompilerOptionsLoader;
  /** Code::Blocks default.conf 用户配置（可选；无则跳过用户编译器） */
  codeBlocksConfig?: CodeBlocksConfig;
}

/** 构建编译器实例（无缓存；调用方按需缓存） */
export function buildCompilerInstance(
  id: string,
  masterPath: string,
  cfg: CompilerSettingsLike,
  deps: CompilerFactoryDeps,
): Compiler {
  const codeBlocksConfig = deps.codeBlocksConfig;
  // 编译器全局搜索目录 + 链接库（default.conf /compiler_sets/<id>，对齐 Compiler::LoadSettings）
  const applyGlobalDirs = (compiler: Compiler): Compiler => {
    const uc = codeBlocksConfig?.find(id);
    if (uc?.name) compiler.name = uc.name; // 显示名对齐 CB（取 default.conf 中用户编译器的 NAME）
    const sd = codeBlocksConfig?.searchDirs(id);
    if (sd) {
      compiler.includeDirs = sd.includeDirs;
      compiler.libDirs = sd.libDirs;
      compiler.resIncludeDirs = sd.resIncludeDirs;
      compiler.linkLibs = sd.linkLibs;
      compiler.extraPaths = sd.extraPaths;
      compiler.includePrjCwd = codeBlocksConfig?.includePrjCwd() ?? false;
      compiler.includeFileCwd = codeBlocksConfig?.includeFileCwd() ?? false;
      compiler.compilerOptions = sd.compilerOptions;
      compiler.linkerOptions = sd.linkerOptions;
      compiler.resourceCompilerOptions = sd.resourceCompilerOptions;
    }
    // 用户自定义错误正则按索引覆盖/追加（对齐 Compiler::LoadSettings:699-737）
    codeBlocksConfig?.applyUserRegexes(id, compiler.regexes);
    return compiler;
  };

  if (deps.loader) {
    const compiler = deps.loader.load(id);
    compiler.masterPath = masterPath;

    // 优先：CodeBlocks 用户自定义编译器（如交叉编译器）——从 default.conf 解析程序路径
    const userPrograms = codeBlocksConfig?.resolvePrograms(id);
    if (userPrograms) {
      compiler.programs = {
        ...compiler.programs,
        C: userPrograms.C,
        CPP: userPrograms.CPP,
        LD: userPrograms.LD,
        LIB: userPrograms.LIB,
        WINDRES: compiler.programs.WINDRES || '',
        MAKE: compiler.programs.MAKE || '',
        DBGconfig: compiler.programs.DBGconfig || 'gdb_debugger:Default',
      };
      compiler.masterPath = userPrograms.masterPath;
      return applyGlobalDirs(compiler);
    }

    // 次优：探测到的完整程序路径（交叉编译器如 RISC-V）——只作用于本家族（D-20）
    const programs = resolveProgramsForCompiler(
      cfg.get<unknown>('compilerPrograms', {}),
      id,
      cfg.get<string>('compilerId', 'gcc'),
    );
    if (programs && programs.C) {
      compiler.programs = { ...compiler.programs, ...programs } as unknown as Compiler['programs'];
    }
    // PCH include 前置需要 gcc 主版本号（对齐 Compiler::m_VersionString），惰性查询一次并缓存
    if (compiler.switches.supportsPCH && !compiler.versionString) {
      compiler.versionString = queryCompilerVersionString(compiler);
    }
    return applyGlobalDirs(compiler);
  }

  // 回退：内置 GCC
  const { createGccCompiler } = require('./compiler') as typeof import('./compiler');
  return applyGlobalDirs(createGccCompiler(process.platform, masterPath));
}

/** 资源目录下的编译器 XML 路径（供宿主与 CLI 共用） */
export function compilerResourcesDirOf(extensionRoot: string): string {
  return path.join(extensionRoot, 'resources', 'compilers');
}
