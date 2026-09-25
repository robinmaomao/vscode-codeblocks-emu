/**
 * 命令行生成器 —— 对应 compilercommandgenerator.cpp
 *
 * 移植自 codeblocks-src/src/sdk/compilercommandgenerator.cpp（LGPL v3）。
 * 核心：宏展开 + 选项拼接 + 编译/链接命令行生成。
 *
 * 宏替换顺序严格遵守 Code::Blocks 语义（$objects_output_dir 必须在 $object 之前）。
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { Compiler } from '../compiler/compiler';
import { upperDrive, shortPathWin } from '../tools/pathCase';
import { replaceCbMacros, cbBuiltinVars } from './cbMacros';
import {
  Project,
  BuildTarget,
  ProjectFile,
  TargetType,
  OptionsRelation,
  OptionsRelationType,
  CommandType,
} from '../model/types';

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
 * 计算库输出文件名（对齐 SetupOutputFilenames，compilercommandgenerator.cpp:648）：
 * prefixAuto（平台默认）时 basename 不以 libPrefix 开头则加 lib 前缀；
 * extensionAuto（平台默认）时扩展名不是指定扩展名则追加（对齐 CB：追加到完整文件名，
 * multi-dot 安全——foo.d → libfoo.d.a；Windows 扩展名比较大小写不敏感，Linux 敏感）。
 */
export function computeLibOutput(
  outputFilename: string,
  libPrefix: string,
  extension: string,
  prefixAuto = true,
  extensionAuto = true,
): string {
  const dir = path.dirname(outputFilename);
  let fullName = path.basename(outputFilename);
  const name = path.basename(fullName, path.extname(fullName));
  const curExt = path.extname(fullName).replace('.', '');
  // 前缀策略（对齐 CB：检查 GetName() 是否以 libPrefix 开头）
  if (prefixAuto && libPrefix && !name.startsWith(libPrefix)) {
    fullName = libPrefix + fullName;
  }
  // 扩展名策略（对齐 CB：Windows IsSameAs(ext, false) 大小写不敏感，其余大小写敏感）
  if (extensionAuto && extension) {
    const same = process.platform === 'win32'
      ? curExt.toLowerCase() === extension.toLowerCase()
      : curExt === extension;
    if (!same) {
      fullName += '.' + extension;
    }
  }
  return path.join(dir, fullName);
}

/** 静态库/import 库输出（.a），复用 computeLibOutput（策略默认平台默认，ttDynamicLib 调用方强制） */
export function computeStaticOutput(
  outputFilename: string,
  switches: { libPrefix: string; libExtension: string },
  prefixAuto = true,
  extensionAuto = true,
): string {
  return computeLibOutput(outputFilename, switches.libPrefix, switches.libExtension, prefixAuto, extensionAuto);
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

/** 反引号命令缓存（对齐 globals.cpp m_Backticks：全局共享，CB 从不清理） */
const backticksCache = new Map<string, string>();

/**
 * 反引号展开 —— 对齐 cbExpandBackticks（globals.cpp:867-927）：
 * 逐对 `` `cmd` `` 执行 `cmd /c cmd`（Windows）并把输出（逐行 trim 后空格拼接）替换回原位置；
 * 结果按 cmd 全局缓存（m_Backticks）。onOutput 收到每条展开输出（对齐 SearchDirsFromBackticks 扫描源）。
 */
export function expandBackticks(str: string, onOutput?: (bt: string) => void): string {
  if (!str.includes('`')) return str;
  let out = str;
  let guard = 0;
  while (guard++ < 32) {
    const start = out.indexOf('`');
    if (start < 0) break;
    const end = out.indexOf('`', start + 1);
    if (end < 0) break;
    const cmd = out.slice(start + 1, end).trim();
    if (!cmd) break;
    let bt = backticksCache.get(cmd);
    if (bt === undefined) {
      try {
        const r = spawnSync(cmd, { shell: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
        const text = (r.stdout ?? '').replace(/\r/g, '');
        bt = text.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
      } catch {
        bt = '';
      }
      backticksCache.set(cmd, bt);
    }
    if (bt && onOutput) onOutput(bt);
    out = out.slice(0, start) + bt + out.slice(end + 1);
  }
  return out;
}

export class CommandGenerator {
  private project: Project;
  private compiler: Compiler;
  /** 按 target title 索引的预生成缓存 */
  private cache = new Map<string, PregenCache>();
  /** 反引号派生搜索目录（SearchDirsFromBackticks 语义，供 deps 扫描） */
  private backtickDirs = new Map<string, { inc: string[]; lib: string[] }>();

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

  /** 对齐 FixPathSeparators（compilercommandgenerator.cpp:629）：forceFwdSlashes 时 \→/（跳过 "\ " 转义空格） */
  private fixSep(s: string): string {
    return this.compiler.switches.forceFwdSlashes ? s.replace(/\\(?! )/g, '/') : s;
  }

  private getRelation(target: BuildTarget, type: OptionsRelationType): OptionsRelation {
    return target.optionRelations[type] ?? OptionsRelation.AppendToParentOptions;
  }

  /** 内置构建宏（目标上下文） */
  private cbVars(target: BuildTarget): Record<string, string> {
    return cbBuiltinVars(
      this.project.basePath,
      target.outputFilename,
      target.title,
      target.objectOutput,
      this.project.title,
      this.project.filename,
    );
  }

  /** 对齐 CB ReplaceMacros（含 $(#var)、日期/时间、env 回退、反转义；compilercommandgenerator.cpp:579/806-1163） */
  private expandCb(s: string, target: BuildTarget): string {
    return replaceCbMacros(s, { vars: this.cbVars(target), customVars: this.project.customVariables ?? {} });
  }

  private setupOutputFilenames(target: BuildTarget): string {
    // 对齐 CodeBlocks SetupOutputFilenames（compilercommandgenerator.cpp:654-656 先 ReplaceMacros，Quote 后 FixPathSeparators）：
    // 保留原生分隔符（forceFwdSlashes=true 时 \ → /，默认保持反斜杠）
    return quoteIfNeeded(this.fixSep(this.expandCb(target.outputFilename, target)));
  }

  private setupStaticOutput(target: BuildTarget): string {
    // DynamicLib import 库：优先自定义 imp_lib，否则由 output 推导（对齐 GetDynamicLibImportFilename，673 先 ReplaceMacros）；
    // 对齐 SetupOutputFilenames：ttDynamicLib 的 import 库**强制**平台默认前缀/扩展（策略无视）；Quote 后 FixPathSeparators
    const force = target.targetType === TargetType.DynamicLib;
    const base = this.expandCb(target.impLib || target.outputFilename, target);
    return quoteIfNeeded(this.fixSep(computeStaticOutput(
      base,
      this.compiler.switches,
      force ? true : target.prefixAuto,
      force ? true : target.extensionAuto,
    )));
  }

  private setupDefOutput(target: BuildTarget): string {
    // def 文件名：优先自定义 def_file，否则由 output 推导（对齐 GetDynamicLibDefFilename，700 先 ReplaceMacros）；前缀/扩展按目标策略；Quote 后 FixPathSeparators
    const base = this.expandCb(target.defFile || target.outputFilename, target);
    return quoteIfNeeded(this.fixSep(computeLibOutput(
      base,
      this.compiler.switches.libPrefix,
      'def',
      target.prefixAuto,
      target.extensionAuto,
    )));
  }

  private setupIncludeDirs(target: BuildTarget): string {
    const dirs = combineOptions(
      this.project.includeDirs,
      target.includeDirs,
      this.getRelation(target, this.rel.IncludeDirs),
    );
    // 追加编译器全局目录（对齐 GetOrderedIncludeDirs：项目/目标后追加 compiler->GetIncludeDirs()）
    dirs.push(...(this.compiler.includeDirs ?? []));
    return dirs
      .map((d) => this.compiler.switches.includeDirs + quoteIfNeeded(this.finalizeDir(d, target)))
      .join(this.compiler.switches.includeDirSeparator);
  }

  private setupLibDirs(target: BuildTarget): string {
    const dirs = combineOptions(
      this.project.libDirs,
      target.libDirs,
      this.getRelation(target, this.rel.LibDirs),
    );
    dirs.push(...(this.compiler.libDirs ?? []));
    return dirs
      .map((d) => this.compiler.switches.libDirs + quoteIfNeeded(this.finalizeDir(d, target)))
      .join(this.compiler.switches.libDirSeparator);
  }

  private setupResourceIncludeDirs(target: BuildTarget): string {
    const dirs = combineOptions(
      this.project.resourceIncludeDirs,
      target.resourceIncludeDirs,
      this.getRelation(target, this.rel.ResDirs),
    );
    dirs.push(...(this.compiler.resIncludeDirs ?? []));
    return dirs
      .map((d) => this.compiler.switches.includeDirs + quoteIfNeeded(this.finalizeDir(d, target)))
      .join(this.compiler.switches.includeDirSeparator);
  }

  /**
   * 目录宏展开 + 平台处理 —— 对齐 GetOrdered*Dirs 尾部循环：
   * ReplaceMacros（含项目自定义变量）→ Use83Paths 短路径（目录存在时）→ 保留原生分隔符。
   */
  private finalizeDir(dir: string, target: BuildTarget): string {
    // 对齐 GetOrdered*Dirs 尾部循环：ReplaceMacros（含 $(#var)/项目自定义变量）→ Use83Paths → 原生分隔符
    let out = this.expandCb(dir, target);
    if (process.platform === 'win32' && this.compiler.switches.use83Paths) {
      const unquoted = unquote(out);
      if (fs.existsSync(unquoted)) {
        out = shortPathWin(unquoted);
      }
    }
    // FixPathSeparators（对齐 GetOrdered*Dirs 尾部循环）
    return this.fixSep(out);
  }

  private setupCompilerOptions(target: BuildTarget): string {
    const opts = combineOptions(
      this.project.compilerOptions,
      target.compilerOptions,
      this.getRelation(target, this.rel.CompilerOptions),
    );
    // 追加编译器全局选项（对齐 SetupCompilerOptions:1017：关系合并后追加 compiler->GetCompilerOptions()）
    opts.push(...(this.compiler.compilerOptions ?? []));
    // 对齐 SetupCompilerOptions:1019-1022：合并后整体 ReplaceMacros → cbExpandBackticks → SearchDirsFromBackticks
    const expanded = this.expandCb(opts.join(' '), target);
    return expandBackticks(expanded, (bt) => this.collectBacktickDirs(target, bt));
  }

  private setupResourceCompilerOptions(target: BuildTarget): string {
    const opts = combineOptions(
      (this.project as any).resourceCompilerOptions ?? [],
      target.resourceCompilerOptions,
      this.getRelation(target, this.rel.CompilerOptions),
    );
    // 追加编译器全局资源选项（对齐 SetupResourceCompilerOptions:1161）
    opts.push(...(this.compiler.resourceCompilerOptions ?? []));
    // 对齐 SetupResourceCompilerOptions:1163-1166：合并后整体 ReplaceMacros → cbExpandBackticks → SearchDirsFromBackticks
    const expanded = this.expandCb(opts.join(' '), target);
    return expandBackticks(expanded, (bt) => this.collectBacktickDirs(target, bt));
  }

  private setupLinkerOptions(target: BuildTarget): string {
    const opts = combineOptions(
      this.project.linkerOptions,
      target.linkerOptions,
      this.getRelation(target, this.rel.LinkerOptions),
    );
    // 追加编译器全局链接选项（对齐 SetupLinkerOptions:1046）
    opts.push(...(this.compiler.linkerOptions ?? []));
    // 对齐 SetupLinkerOptions:1048-1051：合并后整体 ReplaceMacros → cbExpandBackticks → SearchDirsFromBackticks
    const expanded = this.expandCb(opts.join(' '), target);
    return expandBackticks(expanded, (bt) => this.collectBacktickDirs(target, bt));
  }

  /**
   * 链接库构造 —— 对齐 SetupLinkLibraries（compilercommandgenerator.cpp:1106）：
   * 项目+目标（选项关系）→ 追加编译器全局库 → FixupLinkLibraries → PathSearch（需要时）→ 逐库引号。
   */
  private setupLinkLibraries(target: BuildTarget): string {
    // 项目级 + 目标级库合并，沿用 linkerOptions 的选项关系（对齐 SetupLinkLibraries → GetOrderedOptions）
    const libs = combineOptions(
      this.project.linkLibs,
      target.linkLibs,
      this.getRelation(target, this.rel.LinkerOptions),
    );
    // 追加编译器全局链接库（对齐 SetupLinkLibraries：compiler->GetLinkLibs()）
    libs.push(...(this.compiler.linkLibs ?? []));
    const s = this.compiler.switches;
    let result = '';
    for (const lib of libs) {
      if (!lib) continue;
      let tmp = this.fixupLinkLibrary(lib);
      // 需要时用库目录解析库全路径（对齐 SetupLinkLibraries 的 PathSearch）
      if (s.linkerNeedsPathResolved) {
        tmp = this.pathSearchLibrary(tmp, target);
      }
      if (result) result += s.objectSeparator;
      result += quoteIfNeeded(tmp);
    }
    return result;
  }

  /** 单个链接库名修复 —— 对齐 FixupLinkLibraries（compilercommandgenerator.cpp:1055） */
  private fixupLinkLibrary(lib: string): string {
    if (!lib) return '';
    const s = this.compiler.switches;
    let result = quoteIfNeeded(lib);
    // 含路径的库原样保留（不做前缀/扩展处理，不加 -l）
    if (result.includes('/') || result.includes('\\')) {
      return result;
    }
    // 剥 lib 前缀（linkerNeedsLibPrefix=false 时）
    let hadLibPrefix = false;
    if (!s.linkerNeedsLibPrefix && s.libPrefix && result.startsWith(s.libPrefix)) {
      result = result.slice(s.libPrefix.length);
      hadLibPrefix = true;
    }
    // 扩展处理（对齐 CB：剥前缀后才剥扩展；needsLibExtension 时补扩展）
    if (!s.linkerNeedsLibExtension && result.length > s.libExtension.length && result.endsWith('.' + s.libExtension)) {
      if (hadLibPrefix) result = result.slice(0, result.length - (s.libExtension.length + 1));
    } else if (s.linkerNeedsLibExtension && s.libExtension) {
      if (result.length <= s.libExtension.length || !result.endsWith('.' + s.libExtension)) {
        result += '.' + s.libExtension;
      }
    }
    return s.linkLibs + result;
  }

  /** 库目录解析库全路径 —— 对齐 SetupLinkLibraries 的 PathSearch（linkerNeedsPathResolved 时） */
  private pathSearchLibrary(lib: string, target: BuildTarget): string {
    let name = unquote(lib);
    if (!name) return lib;
    const linkSwitch = this.compiler.switches.linkLibs;
    if (linkSwitch && name.startsWith(linkSwitch)) name = name.slice(linkSwitch.length);
    // 已带路径或绝对路径：无需解析
    if (name.includes('/') || name.includes('\\') || path.isAbsolute(name)) return lib;
    const dirs = combineOptions(
      this.project.libDirs,
      target.libDirs,
      this.getRelation(target, this.rel.LibDirs),
    );
    dirs.push(...(this.compiler.libDirs ?? []));
    for (const d of dirs) {
      const base = path.isAbsolute(d) ? d : path.join(this.project.basePath, d);
      const cand = path.join(base, name);
      if (fs.existsSync(cand)) return quoteIfNeeded(cand);
    }
    return lib;
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

  /**
   * 反引号输出中的 -I/-L 目录扫描 —— 对齐 SearchDirsFromBackticks（compilercommandgenerator.cpp:1286-1337）：
   * 按 includeDirs/libDirs 开关定位，取其后至空格为止的 token 作为搜索目录（不含开关本身）。
   * 结果并入该目标的编译器搜索目录（DepsSearchStart 使用）。
   */
  private collectBacktickDirs(target: BuildTarget, bt: string): void {
    const scan = (sw: string): string[] => {
      const out: string[] = [];
      if (!sw) return out;
      let pos = 0;
      while ((pos = bt.indexOf(sw, pos)) !== -1) {
        pos += sw.length;
        const space = bt.indexOf(' ', pos);
        const token = (space === -1 ? bt.slice(pos) : bt.slice(pos, space)).trim();
        if (token) out.push(token);
        pos++;
      }
      return out;
    };
    let entry = this.backtickDirs.get(target.title);
    if (!entry) {
      entry = { inc: [], lib: [] };
      this.backtickDirs.set(target.title, entry);
    }
    entry.inc.push(...scan(this.compiler.switches.includeDirs));
    entry.lib.push(...scan(this.compiler.switches.libDirs));
  }

  /** 目标的 deps 扫描目录 = 关系合并后的有序 include 目录 + 反引号派生目录（对齐 m_CompilerSearchDirs） */
  getCompilerSearchDirs(targetTitle: string): string[] {
    const c = this.cache.get(targetTitle);
    const extra = this.backtickDirs.get(targetTitle);
    if (!c) return [];
    return [...c.compilerSearchDirs, ...(extra?.inc ?? [])];
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

    // 校验必需程序是否缺失（对齐 GenerateCommandLine:332-341：四个宏对应的程序任一为空且模板用到该宏 → 清空命令）
    if (
      (picked.comp === '' && template.includes('$compiler')) ||
      (linkerProgram === '' && template.includes('$linker')) ||
      (prog.LIB === '' && template.includes('$lib_linker')) ||
      (prog.WINDRES === '' && template.includes('$rescomp'))
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
    let fname = params.nativeSep === false ? unquote(file) : upperDrive(toNative(unquote(file)));
    // Use83Paths 源文件短路径（对齐 GenerateCommandLine:417，仅 Windows 且文件存在）
    if (process.platform === 'win32' && this.compiler.switches.use83Paths) {
      const raw = unquote(fname);
      if (fs.existsSync(raw)) fname = shortPathWin(raw);
    }
    // FixPathSeparators（对齐 GenerateCommandLine：forceFwdSlashes 时 \→/，跳过 "\ "）
    fname = this.fixSep(fname);
    const ext = path.extname(fname);
    const baseName = path.basename(fname, ext);
    // 对齐 wxFileName::GetPath()：无目录（根目录下的文件）返回空串而非 "."
    let dirName = path.dirname(fname);
    if (dirName === '.') dirName = '';
    const fileExt = ext.replace('.', '');

    const object = this.fixSep(params.object);
    const flatObject = this.fixSep(params.flatObject);
    const deps = this.fixSep(params.deps);

    // allObjectsQuoted 构造
    let allObjectsQuoted = object;
    if (allObjectsQuoted && ldAdd) allObjectsQuoted += this.compiler.switches.objectSeparator;
    allObjectsQuoted += ldAdd;
    if (allObjectsQuoted.includes('"')) {
      allObjectsQuoted = '"' + allObjectsQuoted.replace(/"/g, '\\"') + '"';
    }

    let macro = template;

    // 1. 编译器/链接器程序（含空格的路径需加引号，避免 shell 把 "C:\Program" 当命令）
    macro = macro.replace(/\$compiler/g, quoteIfNeeded(this.fixSep(picked.comp)));
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

    // 4. objects_output_dir 必须在 $object 之前（对齐 CB：GetObjectOutput + FixPathSeparators，原生分隔符）
    if (params.target) {
      macro = macro.replace(/\$objects_output_dir/g, this.fixSep(params.target.objectOutput));
    }
    // 5. object / resource_output
    macro = macro.replace(/\$object/g, quoteIfNeeded(object));
    macro = macro.replace(/\$resource_output/g, quoteIfNeeded(object));
    // 6. exe 输出
    let singleExeOut = '';
    if (params.target) {
      macro = macro.replace(/\$exe_output/g, cache?.output ?? '');
    } else {
      // 单文件编译：从 object 推导 exe（对齐 GenerateCommandLine:506-516：SetExt(EXECUTABLE_EXT)→GetFullPath→Quote→FixPathSeparators）
      const outObj = path.parse(unquote(object));
      const exe = outObj.name + (process.platform === 'win32' ? '.exe' : '');
      singleExeOut = toNative(path.join(outObj.dir, exe));
      macro = macro.replace(/\$exe_output/g, this.fixSep(quoteIfNeeded(singleExeOut)));
    }
    const exeOut = params.target ? unquote(cache?.output ?? '') : singleExeOut;
    if (exeOut) {
      const p = path.parse(exeOut);
      macro = macro.replace(/\$exe_name/g, p.name);
      // 对齐 wxFileName::GetPath()：原生分隔符 + 无目录归一为空（对齐 GenerateCommandLine:522-524）
      let exeDir = p.dir;
      if (exeDir === '.') exeDir = '';
      macro = macro.replace(/\$exe_dir/g, exeDir);
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

    // 9. 对齐 GenerateCommandLine:579：最终命令整体 ReplaceMacros
    // （内置宏 + 项目自定义变量 + $(#全局编译器变量) + 环境变量回退 + $$/%% 反转义）
    if (params.target) {
      macro = replaceCbMacros(macro, {
        vars: this.cbVars(params.target),
        customVars: this.project.customVariables ?? {},
      });
    }
    // 10. 对齐 compilergcc.cpp:1402：命令执行前整体 cbExpandBackticks
    // （覆盖命令模板/自定义 buildCommand/脚本命令里直接书写的反引号；选项里的反引号已在 setup* 阶段展开）
    return expandBackticks(macro);
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

  /**
   * 静态库 $±link_objects prependHack 前缀 —— 对齐 GetTargetLinkCommands:724-742：
   * 扫描 LinkStaticCmd 模板中的 $([-+]+)link_objects（bcc/dmc 等链接器要求对象前加 -/+），
   * 返回捕获的前缀（无此宏时为空串）。buildEngine 静态库打包时逐对象加前缀。
   */
  linkObjectsPrependHack(): string {
    const tpl = this.getCommandTemplate(CommandType.LinkStaticCmd, '');
    const m = tpl.match(/\$([-+]+)link_objects/);
    return m ? m[1] : '';
  }

  /** 从 flags 字符串中过滤掉指定的 flag（对应 GetCPPOnlyFlags/GetCOnlyFlags 移除逻辑） */
  private filterOutFlags(flags: string, toRemove: string[]): string {
    if (!toRemove.length) return flags;
    let out = flags;
    for (const f of toRemove) {
      // 对齐 CB GetCPPOnlyFlags/GetCOnlyFlags 过滤（aCflags.Index + RemoveAt）：仅移除首个匹配；
      // 匹配独立 flag（前有空白/行首，后有空白/行尾），避免误删带前缀/带值 flag，也不破坏带引号 flag
      const re = new RegExp(`(^|\\s)${escapeRegExp(f)}(?=\\s|$)`);
      const m = out.match(re);
      if (m && m.index !== undefined) {
        out = out.slice(0, m.index + m[1].length) + out.slice(m.index + m[0].length);
      }
    }
    return out.trim();
  }
}

/** 展开 Code::Blocks 构建变量宏（$(TARGET_OBJECT_DIR)、$(PROJECT_NAME) 等） */
export function expandBuildVars(cmd: string, basePath: string, target: BuildTarget, projectTitle: string, projectFilename: string): string {
  // Windows 下宏值用原生分隔符 + 大写盘符（= CB UnixFilename 后 FixPathSeparators 的净效果）
  const win = process.platform === 'win32';
  const toNative = (s: string): string => (win ? s.replace(/\//g, '\\') : s);
  const out = toNative(target.outputFilename);
  const sepIdx = Math.max(out.lastIndexOf('/'), out.lastIndexOf('\\'));
  const outDir = sepIdx >= 0 ? out.slice(0, sepIdx + 1) : '';
  const baseName = sepIdx >= 0 ? out.slice(sepIdx + 1) : out;
  const stem = baseName.replace(/\.[^.]+$/, '');

  const vars: Record<string, string> = {
    TARGET_OUTPUT_FILE: out,
    TARGET_OUTPUT_FILENAME: baseName,
    TARGET_OUTPUT_BASENAME: stem,
    TARGET_OUTPUT_DIR: outDir,
    TARGET_NAME: target.title,
    TARGET_OBJECT_DIR: toNative(target.objectOutput || '.objs/'),
    // 项目根目录宏：对齐 Code::Blocks GetBasePath()（wxPATH_GET_SEPARATOR，带结尾分隔符）+ 原生分隔符
    PROJECT_DIR: (win ? upperDrive(basePath) : basePath).replace(/[\\/]$/, '') + (win ? '\\' : '/'),
    PROJECT_DIRECTORY: (win ? upperDrive(basePath) : basePath).replace(/[\\/]$/, '') + (win ? '\\' : '/'),
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
