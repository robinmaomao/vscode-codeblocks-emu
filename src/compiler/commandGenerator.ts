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

/** 如果字符串含空白则加引号（QuoteStringIfNeeded） */
function quoteIfNeeded(s: string): string {
  if (!s) return s;
  if (/[ \t]/.test(s) && !s.startsWith('"')) {
    return `"${s}"`;
  }
  return s;
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
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
    const out = target.outputFilename;
    const ext = path.extname(out);
    const base = out.slice(0, out.length - ext.length);
    return quoteIfNeeded(base + '.' + this.compiler.switches.libExtension);
  }

  private setupDefOutput(target: BuildTarget): string {
    const out = target.outputFilename;
    const ext = path.extname(out);
    const base = out.slice(0, out.length - ext.length);
    return quoteIfNeeded(base + '.def');
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
    const libs = target.linkLibs.length ? target.linkLibs : this.project.linkLibs;
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
    if (params.pf) {
      if (params.pf.compilerVar === 'CPP') return { comp: prog.CPP, isCpp: true };
      if (params.pf.compilerVar === 'CC') return { comp: prog.C, isCpp: false };
      if (params.pf.compilerVar === 'WINDRES') return { comp: prog.WINDRES, isCpp: false };
    }
    // 按扩展名
    const ext = path.extname(unquote(params.file)).toLowerCase().replace('.', '');
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
    const fname = unquote(file);
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
    macro = macro.replace(/\$file/g, quoteIfNeeded(file));
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

    // 9. 展开 Code::Blocks 构建变量宏（$(TARGET_OBJECT_DIR)、$(PROJECT_NAME) 等）
    if (params.target) {
      macro = expandBuildVars(macro, this.project.basePath, params.target);
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
    const parts = flags.split(' ').filter(Boolean);
    const removeSet = new Set(toRemove);
    return parts.filter((p) => !removeSet.has(p)).join(' ');
  }
}

/** 展开 Code::Blocks 构建变量宏（$(TARGET_OBJECT_DIR)、$(PROJECT_NAME) 等） */
export function expandBuildVars(cmd: string, basePath: string, target: BuildTarget): string {
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
    PROJECT_NAME: target.title,
    PROJECTNAME: target.title,
    PROJECT_FILENAME: out,
  };

  let result = cmd;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\$\\(' + key + '\\)', 'g'), value);
    result = result.replace(new RegExp('\\$' + key + '(?![A-Za-z0-9_])', 'g'), value);
  }
  return result;
}
