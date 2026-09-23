/**
 * 命令行生成器 —— 对应 compilercommandgenerator.cpp
 *
 * 移植自 codeblocks-src/src/sdk/compilercommandgenerator.cpp（LGPL v3）。
 * 核心：宏展开 + 选项拼接 + 编译/链接命令行生成。
 *
 * 宏替换顺序严格遵守 Code::Blocks 语义（$objects_output_dir 必须在 $object 之前）。
 */
import * as path from 'path';
import { Compiler } from '../compiler/compiler';
import { upperDrive } from '../tools/pathCase';
import {
  Project,
  BuildTarget,
  ProjectFile,
  TargetType,
  OptionsRelation,
  OptionsRelationType,
  CommandType,
} from '../model/types';

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Windows 下转为反斜杠（对齐 Code::Blocks 在 Windows 生成命令行时的原生分隔符） */
function toNative(p: string): string {
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
}

/** 如果字符串含空白则加引号（QuoteStringIfNeeded） */
export function quoteIfNeeded(s: string): string {
  if (!s) return s;
  // 含空白或 cmd 元字符（& | < > ^ ( )）时加引号，避免 shell 二次解析拆断路径
  if (/[ \t&|<>^()]/.test(s) && !s.startsWith('"')) {
    return `"${s}"`;
  }
  return s;
}

/**
 * 计算库输出文件名（对齐 SetupOutputFilenames，compilercommandgenerator.cpp:747 / 773）：
 * prefix_auto（平台默认）时 basename 不以 libPrefix 开头则加 lib 前缀；
 * extension_auto（平台默认）时扩展名不是指定扩展名则追加。
 */
export function computeLibOutput(outputFilename: string, libPrefix: string, extension: string): string {
  const parsed = path.parse(outputFilename);
  let name = parsed.name;
  if (libPrefix && !name.startsWith(libPrefix)) {
    name = libPrefix + name;
  }
  let result = path.join(parsed.dir, name);
  if (!result.endsWith('.' + extension)) {
    result = result + '.' + extension;
  }
  return result;
}

/** 静态库/import 库输出（.a），复用 computeLibOutput */
export function computeStaticOutput(outputFilename: string, switches: { libPrefix: string; libExtension: string }): string {
  return computeLibOutput(outputFilename, switches.libPrefix, switches.libExtension);
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/** 转义正则特殊字符（用于把 flag 当作字面量匹配） */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 选项关系合并 —— 对应 GetOrderedOptions 语义 */
function combineOptions(
  projectOpts: string[],
  targetOpts: string[],
  relation: OptionsRelation,
): string[] {
  switch (relation) {
    case OptionsRelation.UseParentOptionsOnly:
      return [...projectOpts];
    case OptionsRelation.UseTargetOptionsOnly:
      return [...targetOpts];
    case OptionsRelation.PrependToParentOptions:
      return [...targetOpts, ...projectOpts];
    case OptionsRelation.AppendToParentOptions:
    default:
      return [...projectOpts, ...targetOpts];
  }
}

/** 编译单个文件的参数（对应 GenerateCommandLine 的 Params） */
export interface GenerateParams {
  target: BuildTarget | null;
  pf: ProjectFile | null;
  file: string;
  object: string;
  flatObject: string;
  deps: string;
  hasCppFilesToLink?: boolean;
  /** false 时保持正斜杠（供 clangd compile_commands.json 使用，clangd 偏好正斜杠） */
  nativeSep?: boolean;
}

/** 预生成的各目标命令行片段（对应 m_Output/m_CFlags 等缓存） */
interface PregenCache {
  output: string;
  staticOutput: string;
  defOutput: string;
  inc: string;
  lib: string;
  rc: string;
  cFlags: string;
  rcFlags: string;
  ldFlags: string;
  ldAdd: string;
  compilerSearchDirs: string[];
  linkerSearchDirs: string[];
}

export class CommandGenerator {
  private project: Project;
  private compiler: Compiler;
  /** 按 target title 索引的预生成缓存 */
  private cache = new Map<string, PregenCache>();

  constructor(project: Project, compiler: Compiler) {
    this.project = project;
    this.compiler = compiler;
    this.init();
  }

  /** 对应 CompilerCommandGenerator::Init() */
  private init(): void {
    for (const target of this.project.buildTargets) {
      const c: PregenCache = {
        output: this.setupOutputFilenames(target),
        staticOutput: this.setupStaticOutput(target),
        defOutput: this.setupDefOutput(target),
        inc: this.setupIncludeDirs(target),
        lib: this.setupLibDirs(target),
        rc: this.setupResourceIncludeDirs(target),
        cFlags: this.setupCompilerOptions(target),
        rcFlags: this.setupResourceCompilerOptions(target),
        ldFlags: this.setupLinkerOptions(target),
        ldAdd: this.setupLinkLibraries(target),
        compilerSearchDirs: this.getOrderedIncludeDirs(target),
        linkerSearchDirs: this.getOrderedLibDirs(target),
      };
      this.cache.set(target.title, c);
    }
  }

  private rel = OptionsRelationType;

  private getRelation(target: BuildTarget, type: OptionsRelationType): OptionsRelation {
    return target.optionRelations[type] ?? OptionsRelation.AppendToParentOptions;
  }

  private setupOutputFilenames(target: BuildTarget): string {
    // 对齐 CodeBlocks SetupOutputFilenames：保留原生分隔符
    // （FixPathSeparators 仅在 forceFwdSlashes=true 时转正斜杠，默认保持反斜杠）
    return quoteIfNeeded(target.outputFilename);
  }

  private setupStaticOutput(target: BuildTarget): string {
    return quoteIfNeeded(computeStaticOutput(target.outputFilename, this.compiler.switches));
  }

  private setupDefOutput(target: BuildTarget): string {
    // def 文件名同样加 lib 前缀（对齐 SetupOutputFilenames 第 773 行的 fname.SetExt("def")）
    return quoteIfNeeded(computeLibOutput(target.outputFilename, this.compiler.switches.libPrefix, 'def'));
  }

  private setupIncludeDirs(target: BuildTarget): string {
    const dirs = combineOptions(
      this.project.includeDirs,
      target.includeDirs,
      this.getRelation(target, this.rel.IncludeDirs),
    );
    return dirs.map((d) => this.compiler.switches.includeDirs + quoteIfNeeded(d)).join(this.compiler.switches.includeDirSeparator);
  }

  private setupLibDirs(target: BuildTarget): string {
    const dirs = combineOptions(
      this.project.libDirs,
      target.libDirs,
      this.getRelation(target, this.rel.LibDirs),
    );
    return dirs.map((d) => this.compiler.switches.libDirs + quoteIfNeeded(d)).join(this.compiler.switches.libDirSeparator);
  }

  private setupResourceIncludeDirs(target: BuildTarget): string {
    const dirs = combineOptions(
      this.project.resourceIncludeDirs,
      target.resourceIncludeDirs,
      this.getRelation(target, this.rel.ResDirs),
    );
    return dirs.map((d) => this.compiler.switches.includeDirs + quoteIfNeeded(d)).join(this.compiler.switches.includeDirSeparator);
  }

  private setupCompilerOptions(target: BuildTarget): string {
    const opts = combineOptions(
      this.project.compilerOptions,
      target.compilerOptions,
      this.getRelation(target, this.rel.CompilerOptions),
    );
    return opts.join(' ');
  }

  private setupResourceCompilerOptions(target: BuildTarget): string {
    const opts = combineOptions(
      (this.project as any).resourceCompilerOptions ?? [],
      target.resourceCompilerOptions,
      this.getRelation(target, this.rel.CompilerOptions),
    );
    return opts.join(' ');
  }

  private setupLinkerOptions(target: BuildTarget): string {
    const opts = combineOptions(
      this.project.linkerOptions,
      target.linkerOptions,
      this.getRelation(target, this.rel.LinkerOptions),
    );
    return opts.join(' ');
  }

  private setupLinkLibraries(target: BuildTarget): string {
    // 项目级 + 目标级库合并，沿用 linkerOptions 的选项关系（对齐 CodeBlocks SetupLinkLibraries → GetOrderedOptions）
    const libs = combineOptions(
      this.project.linkLibs,
      target.linkLibs,
      this.getRelation(target, this.rel.LinkerOptions),
    );
    const s = this.compiler.switches;
    return libs
      .map((lib) => {
        let name = lib;
        // 去掉路径与扩展，应用 libPrefix/libExtension 规则
        const base = path.basename(unquote(name));
        let stem = base;
        if (s.linkerNeedsLibPrefix) {
          if (!stem.startsWith(s.libPrefix)) stem = s.libPrefix + stem;
        } else if (stem.startsWith(s.libPrefix)) {
          stem = stem.slice(s.libPrefix.length);
        }
        const ext = path.extname(stem);
        if (ext) stem = stem.slice(0, stem.length - ext.length);
        return s.linkLibs + stem;
      })
      .join(' ');
  }

  private getOrderedIncludeDirs(target: BuildTarget): string[] {
    return combineOptions(
      this.project.includeDirs,
      target.includeDirs,
      this.getRelation(target, this.rel.IncludeDirs),
    );
  }

  private getOrderedLibDirs(target: BuildTarget): string[] {
    return combineOptions(
      this.project.libDirs,
      target.libDirs,
      this.getRelation(target, this.rel.LibDirs),
    );
  }

  /** 选择编译/链接器程序（对应 GenerateCommandLine 里的 compExec 逻辑） */
  private pickCompilerProgram(params: GenerateParams): { comp: string; isCpp: boolean } {
    const prog = this.compiler.programs;
    // 汇编源文件（.s/.S/.asm/.ss/.s62）无论 compilerVar 如何都归 C 编译器：
    // 与扩展既有策略一致，避免用 g++ 汇编、并防止 g++ 链接带入 C++ 运行库（嵌入式交叉编译器场景）。
    const ext = path.extname(unquote(params.file)).toLowerCase().replace('.', '');
    if (ext === 's' || ext === 'asm' || ext === 'ss' || ext === 's62') {
      return { comp: prog.C, isCpp: false };
    }
    if (params.pf) {
      if (params.pf.compilerVar === 'CPP') return { comp: prog.CPP, isCpp: true };
      if (params.pf.compilerVar === 'CC') return { comp: prog.C, isCpp: false };
      if (params.pf.compilerVar === 'WINDRES') return { comp: prog.WINDRES, isCpp: false };
    }
    // 按扩展名兜底：.c 归 C 编译器，其余（.cpp/.cc/.cxx 等）归 C++ 编译器
    if (ext === 'c') return { comp: prog.C, isCpp: false };
    return { comp: prog.CPP, isCpp: true };
  }

  private pickLinkerProgram(params: GenerateParams): string {
    const prog = this.compiler.programs;
    const target = params.target;
    const opt = target?.linkerExecutable ?? 0;
    switch (opt) {
      case 1: return prog.C;
      case 2: return prog.CPP;
      case 3: return prog.LD;
      default: {
        // AutoDetect：若默认链接器 == 编译器之一，按内容选择
        if (prog.CPP === prog.LD || prog.C === prog.LD) {
          return params.hasCppFilesToLink ? prog.CPP : prog.C;
        }
        return prog.LD;
      }
    }
  }

  /**
   * 生成命令行 —— 对应 GenerateCommandLine(Result&, Params&)
   * @param commandType 命令类型（决定命令模板）
   */
  generate(commandType: CommandType, params: GenerateParams): string {
    const cache = params.target ? this.cache.get(params.target.title) : undefined;
    if (params.target && !cache) return '';

    const template = this.getCommandTemplate(commandType, path.extname(unquote(params.file)).replace('.', ''));
    if (!template) return '';

    return this.renderTemplate(template, params);
  }

  /** 用任意模板字符串展开宏（供自定义 buildCommand 使用） */
  generateFromTemplate(template: string, params: GenerateParams): string {
    return this.renderTemplate(template, params);
  }

  /** 核心：将命令模板展开为最终命令行 */
  private renderTemplate(template: string, params: GenerateParams): string {
    const cache = params.target ? this.cache.get(params.target.title) : undefined;

    const prog = this.compiler.programs;
    const picked = this.pickCompilerProgram(params);
    const linkerProgram = this.pickLinkerProgram(params);

    // 校验必需程序是否缺失
    if (
      (picked.comp === '' && template.includes('$compiler')) ||
      (linkerProgram === '' && template.includes('$linker'))
    ) {
      return '';
    }

    let cFlags = (cache?.cFlags ?? '').trim();
    const inc = cache?.inc ?? '';
    const resInc = cache?.rc ?? '';
    const lib = cache?.lib ?? '';
    const ldAdd = cache?.ldAdd ?? '';
    const ldFlags = cache?.ldFlags ?? '';
    const rcFlags = cache?.rcFlags ?? '';

    // 按编译类型过滤 C/C++ 专属选项（对应 GenerateCommandLine 的 remFlags 逻辑）
    if (picked.isCpp) {
      cFlags = this.filterOutFlags(cFlags, this.compiler.cOnlyFlags);
    } else {
      cFlags = this.filterOutFlags(cFlags, this.compiler.cppOnlyFlags);
    }

    const file = params.file;
    // 默认将 $file/$file_dir 转为平台原生分隔符（Windows 反斜杠），对齐 Code::Blocks 命令行；
    // nativeSep=false 时保持正斜杠（clangd compile_commands.json 偏好正斜杠）
    const fname = params.nativeSep === false ? unquote(file) : upperDrive(toNative(unquote(file)));
    const ext = path.extname(fname);
    const baseName = path.basename(fname, ext);
    const dirName = path.dirname(fname);
    const fileExt = ext.replace('.', '');

    const object = params.object;
    const flatObject = params.flatObject;
    const deps = params.deps;

    // allObjectsQuoted 构造
    let allObjectsQuoted = object;
    if (allObjectsQuoted && ldAdd) allObjectsQuoted += this.compiler.switches.objectSeparator;
    allObjectsQuoted += ldAdd;
    if (allObjectsQuoted.includes('"')) {
      allObjectsQuoted = '"' + allObjectsQuoted.replace(/"/g, '\\"') + '"';
    }

    let macro = template;

    // 1. 编译器/链接器程序（含空格的路径需加引号，避免 shell 把 "C:\Program" 当命令）
    macro = macro.replace(/\$compiler/g, quoteIfNeeded(picked.comp));
    macro = macro.replace(/\$linker/g, quoteIfNeeded(linkerProgram));
    macro = macro.replace(/\$lib_linker/g, quoteIfNeeded(prog.LIB));
    macro = macro.replace(/\$rescomp/g, quoteIfNeeded(prog.WINDRES));
    // 2. 选项
    macro = macro.replace(/\$options/g, cFlags);
    macro = macro.replace(/\$res_options/g, rcFlags);
    macro = macro.replace(/\$link_options/g, ldFlags);
    macro = macro.replace(/\$includes/g, inc);
    macro = macro.replace(/\$res_includes/g, resInc);
    macro = macro.replace(/\$libdirs/g, lib);
    macro = macro.replace(/\$libs/g, ldAdd);
    // 3. 文件相关
    macro = macro.replace(/\$file_basename/g, baseName);
    macro = macro.replace(/\$file_name/g, baseName);
    macro = macro.replace(/\$file_dir/g, dirName);
    macro = macro.replace(/\$file_ext/g, fileExt);
    macro = macro.replace(/\$file/g, quoteIfNeeded(fname));
    macro = macro.replace(/\$dep_object/g, quoteIfNeeded(deps));

    // 4. objects_output_dir 必须在 $object 之前
    if (params.target) {
      macro = macro.replace(/\$objects_output_dir/g, toUnix(params.target.objectOutput));
    }
    // 5. object / resource_output
    macro = macro.replace(/\$object/g, quoteIfNeeded(object));
    macro = macro.replace(/\$resource_output/g, quoteIfNeeded(object));
    // 6. exe 输出
    if (params.target) {
      macro = macro.replace(/\$exe_output/g, cache?.output ?? '');
    } else {
      // 单文件编译：从 object 推导 exe
      const outObj = path.parse(unquote(object));
      const exe = outObj.name + (process.platform === 'win32' ? '.exe' : '');
      macro = macro.replace(/\$exe_output/g, quoteIfNeeded(toUnix(path.join(outObj.dir, exe))));
    }
    const exeOut = params.target ? unquote(cache?.output ?? '') : '';
    if (exeOut) {
      const p = path.parse(exeOut);
      macro = macro.replace(/\$exe_name/g, p.name);
      macro = macro.replace(/\$exe_dir/g, toUnix(p.dir));
      macro = macro.replace(/\$exe_ext/g, p.ext.replace('.', ''));
    } else {
      macro = macro.replace(/\$exe_name/g, '').replace(/\$exe_dir/g, '').replace(/\$exe_ext/g, '');
    }

    // 7. 链接对象
    macro = macro.replace(/\$link_resobjects/g, deps);
    macro = macro.replace(/\$link_objects/g, object);
    macro = macro.replace(/\$link_flat_objects/g, flatObject);
    macro = macro.replace(/\$\+link_objects/g, object);
    macro = macro.replace(/\$\-link_objects/g, object);
    macro = macro.replace(/\$\-\+link_objects/g, object);
    macro = macro.replace(/\$\+\-link_objects/g, object);
    macro = macro.replace(/\$all_link_objects_quoted/g, allObjectsQuoted);

    // 8. 静态/动态库特判
    if (params.target) {
      const tt = params.target.targetType;
      if (tt === TargetType.StaticLib || tt === TargetType.DynamicLib) {
        if (tt === TargetType.StaticLib || params.target.createStaticLib) {
          macro = macro.replace(/\$static_output/g, cache?.staticOutput ?? '');
        } else {
          macro = macro.replace(/-Wl,--out-implib=\$static_output/g, '');
          macro = macro.replace(/\$static_output/g, '');
        }
        if (params.target.createDefFile) {
          macro = macro.replace(/\$def_output/g, cache?.defOutput ?? '');
        } else {
          macro = macro.replace(/-Wl,--output-def=\$def_output/g, '');
          macro = macro.replace(/\$def_output/g, '');
        }
      }
    }

    // 8.5 路径转换函数式宏（对齐 macrosmanager.cpp：$TO_WINDOWS_PATH{$x} / $TO_UNIX_PATH{$x}）
    // 必须在 $static_output 等宏展开之后处理（{} 内可能嵌套宏）
    macro = macro.replace(/\$TO_WINDOWS_PATH\{([^}]*)\}/g, (_, p: string) => p.replace(/\//g, '\\'));
    macro = macro.replace(/\$TO_UNIX_PATH\{([^}]*)\}/g, (_, p: string) => p.replace(/\\/g, '/'));

    // 9. 展开 Code::Blocks 构建变量宏（$(TARGET_OBJECT_DIR)、$(PROJECT_NAME) 等）
    if (params.target) {
      macro = expandBuildVars(macro, this.project.basePath, params.target, this.project.title, this.project.filename);
    }
    return macro;
  }

  /** 获取指定 CommandType 的命令模板（按扩展名匹配，通配兜底） */
  private getCommandTemplate(ct: CommandType, fileExt: string): string {
    const vec = this.compiler.commands[ct];
    if (!vec || vec.length === 0) return '';
    let catchAll = '';
    for (const tool of vec) {
      if (tool.extensions.length === 0) {
        catchAll = tool.command;
        continue;
      }
      if (tool.extensions.includes(fileExt)) return tool.command;
    }
    return catchAll;
  }

  /** 从 flags 字符串中过滤掉指定的 flag（对应 GetCPPOnlyFlags/GetCOnlyFlags 移除逻辑） */
  private filterOutFlags(flags: string, toRemove: string[]): string {
    if (!toRemove.length) return flags;
    let out = flags;
    for (const f of toRemove) {
      // 匹配独立 flag（前有空白/行首，后有空白/行尾），避免误删带前缀/带值 flag，也不破坏带引号 flag
      const re = new RegExp(`(^|\\s)${escapeRegExp(f)}(?=\\s|$)`, 'g');
      out = out.replace(re, '$1');
    }
    return out.trim();
  }
}

/** 展开 Code::Blocks 构建变量宏（$(TARGET_OBJECT_DIR)、$(PROJECT_NAME) 等） */
export function expandBuildVars(cmd: string, basePath: string, target: BuildTarget, projectTitle: string, projectFilename: string): string {
  const u = (s: string) => s.replace(/\\/g, '/');
  const out = u(target.outputFilename);
  const outDir = out.includes('/') ? out.slice(0, out.lastIndexOf('/') + 1) : '';
  const baseName = out.includes('/') ? out.slice(out.lastIndexOf('/') + 1) : out;
  const stem = baseName.replace(/\.[^.]+$/, '');

  const vars: Record<string, string> = {
    TARGET_OUTPUT_FILE: out,
    TARGET_OUTPUT_FILENAME: baseName,
    TARGET_OUTPUT_BASENAME: stem,
    TARGET_OUTPUT_DIR: outDir,
    TARGET_NAME: target.title,
    TARGET_OBJECT_DIR: u(target.objectOutput || 'obj/'),
    PROJECT_DIR: basePath,
    PROJECT_DIRECTORY: basePath,
    PROJECT_NAME: projectTitle,
    PROJECTNAME: projectTitle,
    PROJECT_FILENAME: projectFilename,
  };

  let result = cmd;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\$\\(' + key + '\\)', 'g'), value);
    result = result.replace(new RegExp('\\$' + key + '(?![A-Za-z0-9_])', 'g'), value);
  }
  return result;
}
