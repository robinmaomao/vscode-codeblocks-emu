/**
 * .cbp / .workspace 解析器 —— 对应 projectloader.cpp / workspaceloader.cpp
 *
 * 移植自 codeblocks-src/src/sdk/projectloader.cpp（LGPL v3）。
 * 用 fast-xml-parser 替代 TinyXML，保留 XML 结构与加载顺序语义。
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as path from 'path';
import * as fs from 'fs';
import {
  Project,
  BuildTarget,
  ProjectFile,
  Workspace,
  VirtualBuildTarget,
  TargetType,
  OptionsRelation,
  OptionsRelationType,
  LinkerExecutableOption,
  EnvVariable,
} from './types';
import { fileTypeOf, defaultCompilerVar, defaultCompile, defaultLink } from './fileTypes';
import { upperDrive } from '../tools/pathCase';
import { LruCache } from '../tools/lru';

/** XML 解析结果缓存条目 */
interface XmlCacheEntry {
  mtimeMs: number;
  size: number;
  result: any;
}

/**
 * XML 解析缓存：.cbp/.workspace 的 readFile + fast-xml-parser 解析是最昂贵步骤。
 * Parser 每次调用均新建实例（extension.ts 中 new ProjectParser()），故用模块级缓存，
 * 按绝对路径（盘符归一化）+ mtime + size 失效，命中时直接复用 XML 解析结果（只读透传，不回写）。
 * ProjectParser 与 WorkspaceParser 的 XMLParser 配置不同，故分别用独立缓存；LRU 上限防无界增长。
 */
const projectXmlCache = new LruCache<string, XmlCacheEntry>(128);
const workspaceXmlCache = new LruCache<string, XmlCacheEntry>(128);

function parseXmlCached(filename: string, parser: XMLParser, cache: LruCache<string, XmlCacheEntry>): any {
  // 盘符归一化（e:\ → E:\），让同一文件以不同大小写盘符访问时命中同一缓存条目
  const key = upperDrive(path.resolve(filename));
  let st: fs.Stats;
  try {
    st = fs.statSync(key);
  } catch {
    // 保持原行为：文件不可读时让 readFileSync 抛出原始错误
    return parser.parse(fs.readFileSync(key, 'utf-8'));
  }
  const entry = cache.get(key);
  if (entry && entry.mtimeMs === st.mtimeMs && entry.size === st.size) {
    return entry.result;
  }
  const raw = fs.readFileSync(key, 'utf-8');
  const result = parser.parse(raw);
  cache.set(key, { mtimeMs: st.mtimeMs, size: st.size, result });
  return result;
}

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 对齐 CodeBlocks 的 UnixFilename(filename, wxPATH_NATIVE)：
 * Windows 转反斜杠，其余平台转正斜杠。
 * <Add directory>/<Add library> 路径在 Windows 上必须用反斜杠，否则链接器把 -L 目录
 * 原样写入 map.txt 时斜杠会与 CodeBlocks 不一致。
 */
function toNativeSeparator(p: string): string {
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/');
}

function unixJoin(base: string, rel: string): string {
  return toUnix(path.join(base, rel));
}

/** 默认选项关系（与 Code::Blocks 默认一致：目标追加到项目选项） */
function defaultRelations(): Record<OptionsRelationType, OptionsRelation> {
  return {
    [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
  };
}

/** 解析 TargetType 字符串或数字（.cbp 中 type 既可能是 "console" 也可能是数字 "1"） */
function parseTargetType(s: string | undefined): TargetType {
  const v = (s ?? '').trim();
  // 数字形式：ttExecutable=0, ttConsoleOnly=1, ttStaticLib=2, ttDynamicLib=3, ttCommandsOnly=4, ttNative=5
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n >= 0 && n <= 5) return n as TargetType;
    return TargetType.Executable;
  }
  switch (v.toLowerCase()) {
    case 'console': return TargetType.ConsoleOnly;
    case 'static library': case 'staticlibrary': return TargetType.StaticLib;
    case 'dynamic library': case 'dynamiclibrary': return TargetType.DynamicLib;
    case 'commands only': case 'commandsonly': return TargetType.CommandsOnly;
    case 'native': return TargetType.Native;
    default: return TargetType.Executable;
  }
}

/** 从 XML 元素提取所有 <Add option="..."/> 的 option 值 */
function collectAddOptions(parent: any): string[] {
  const out: string[] = [];
  if (!parent) return out;
  let node = parent.Add;
  if (node === undefined) return out;
  if (!Array.isArray(node)) node = [node];
  for (const n of node) {
    const opt = n['@_option'];
    if (opt !== undefined && opt !== '') out.push(String(opt));
  }
  return out;
}

/** 分号分隔列表（对齐 wx GetArrayFromString：去引号、忽略空项） */
function splitList(v: string): string[] {
  return v.split(';').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

/** 平台属性解析 —— 对齐 globals.cpp GetPlatformsFromString（子串语义：含 All 或 W+U+M → spAll，否则按含 Windows/Unix/Mac 置位） */
function parsePlatforms(s: string): number {
  const pW = s.includes('Windows');
  const pU = s.includes('Unix');
  const pM = s.includes('Mac');
  if (s.includes('All') || (pW && pU && pM)) return 0xff;
  return (pW ? 0x04 : 0) | (pU ? 0x02 : 0) | (pM ? 0x01 : 0);
}

/** 从 <Compiler>/<Linker> 的 <Add directory="..."/> 提取目录（对应 DoCompilerOptions/DoLinkerOptions） */
function collectAddDirectories(parent: any): string[] {
  const out: string[] = [];
  if (!parent) return out;
  let node = parent.Add;
  if (node === undefined) return out;
  if (!Array.isArray(node)) node = [node];
  for (const n of node) {
    const dir = n['@_directory'];
    if (dir !== undefined && dir !== '') out.push(toNativeSeparator(String(dir)));
  }
  return out;
}

/** 从 <Linker> 的 <Add library="..."/> 提取库名（对应 DoLinkerOptions） */
function collectAddLibraries(parent: any): string[] {
  const out: string[] = [];
  if (!parent) return out;
  let node = parent.Add;
  if (node === undefined) return out;
  if (!Array.isArray(node)) node = [node];
  for (const n of node) {
    const lib = n['@_library'];
    if (lib !== undefined && lib !== '') out.push(toNativeSeparator(String(lib)));
  }
  return out;
}

export class ProjectParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      // CDATA 内容（错误正则）保留为文本
      cdataPropName: '__cdata',
      trimValues: false,
    });
  }

  /** 解析 .cbp 文件 */
  parse(filename: string): Project {
    const result = parseXmlCached(filename, this.parser, projectXmlCache);

    const root = result.CodeBlocks_project_file;
    if (!root) throw new Error('不是有效的 .cbp 文件：缺少 <CodeBlocks_project_file> 根节点');

    const basePath = path.dirname(filename);
    const project: Project = {
      title: String(root.Project?.['@_title'] ?? path.basename(filename, '.cbp')),
      basePath,
      commonTopLevelPath: basePath,
      pchMode: 1,
      extendedObjNames: false,
      platforms: 0xff,
      filename,
      compilerId: '',
      compilerOptions: [],
      linkerOptions: [],
      resourceCompilerOptions: [],
      includeDirs: [],
      libDirs: [],
      resourceIncludeDirs: [],
      linkLibs: [],
      buildTargets: [],
      virtualTargets: [],
      virtualFolders: [],
      commandsBeforeBuild: [],
      commandsAfterBuild: [],
      buildScripts: [],
      notes: '',
      showNotesOnLoad: false,
      envVars: [],
      alwaysRunPostBuildSteps: false,
      customVariables: {},
      files: [],
      extensions: root.Extensions ?? null,
      rawProject: root.Project,
    };

    // 项目级选项（<Project><Option .../><Build><Target>...）
    const projNode = root.Project;
    if (projNode) {
      this.parseProjectOptions(projNode.Option, project);
      this.parseCompilerOptions(projNode.Compiler, project);
      this.parseLinkerOptions(projNode.Linker, project);
      this.parseIncludeDirs(projNode.IncludeDirs, project);
      this.parseLibDirs(projNode.LibDirs, project);
      this.parseResourceCompilerOptions(projNode.ResourceCompiler, project);
      // 项目级 pre/post build 命令（<ExtraCommands>）
      this.parseExtraCommands(projNode.ExtraCommands, project);
      this.parseExtraCommands(projNode.MakeCommands, project);
      // 虚拟目标
      this.parseVirtualTargets(projNode.VirtualTargets, project);
      // 构建目标
      this.parseBuildTargets(projNode.Build, project);
      // 文件
      this.parseUnits(root.Project, project);
      // 项目自定义变量（<Extensions><codeblocks_project_custom_variables>）
      this.parseProjectCustomVariables(root, project);
    }

    // 计算公共顶层路径并设置 relativeToCommonTopLevelPath（对应 CalculateCommonTopLevelPath）
    project.commonTopLevelPath = this.calculateCommonTopLevelPath(project);
    for (const f of project.files) {
      f.relativeToCommonTopLevelPath = this.relativeToCommonTopLevel(f.absolutePath, project.commonTopLevelPath);
    }

    return project;
  }

  /** 计算所有文件的公共顶层路径（移植 CalculateCommonTopLevelPath） */
  private calculateCommonTopLevelPath(project: Project): string {
    const sep = path.sep;
    let base = project.basePath + sep;
    // 卷名比较需归一化：basePath 用反斜杠、absolutePath 由 unixJoin 用正斜杠生成，
    // 二者 root 分别为 "E:\" 与 "E:/"，直接比较会误判为跨卷而跳过所有文件，
    // 导致公共顶层目录无法提升（对象文件落位错误）。
    const vol = path.parse(base).root.replace(/[\\/]/g, '').toLowerCase();

    for (const f of project.files) {
      if (!f.absolutePath) continue;
      // 跨卷文件不参与（简化：仅同卷）
      if (path.parse(f.absolutePath).root.replace(/[\\/]/g, '').toLowerCase() !== vol) continue;

      const tmp = f.relativeFilename;
      // 跳过开头的 '.' '/' '\' 字符，得到相对公共前缀（如 "../../"）
      let pos = 0;
      while (pos < tmp.length && (tmp[pos] === '.' || tmp[pos] === '/' || tmp[pos] === '\\')) pos++;
      if (pos > 0 && pos < tmp.length) {
        const tmpbase = project.basePath + sep + tmp.slice(0, pos) + sep;
        const norm = path.normalize(tmpbase);
        // 若规范化的 tmpbase 目录层级少于 base，且 base 以其为前缀，则提升 base
        if (norm.split(/[\\/]/).filter(Boolean).length < base.split(/[\\/]/).filter(Boolean).length
            && this.startsWithPath(base, norm)) {
          base = norm;
        }
      }
    }

    // 确保以分隔符结尾（Code::Blocks 返回带尾分隔符的目录）
    return base.endsWith(sep) ? base : base + sep;
  }

  private startsWithPath(base: string, prefix: string): boolean {
    const b = path.resolve(base);
    const p = path.resolve(prefix);
    return b === p || b.startsWith(p + path.sep);
  }

  /** 计算文件相对公共顶层路径的路径（对应 MakeRelativeTo(m_CommonTopLevelPath)） */
  private relativeToCommonTopLevel(fileAbs: string, commonTopLevelPath: string): string {
    const rel = path.relative(commonTopLevelPath, fileAbs);
    return rel.replace(/\\/g, '/');
  }

  /**
   * 项目自定义变量 —— 对应 cbProject 的 SetVariable（cbp <Extensions><codeblocks_project_custom_variables>）：
   * 每个子节点名 = 变量名，value 属性 = 值；供构建宏展开（ReplaceMacros）使用。
   */
  private parseProjectCustomVariables(root: any, project: Project): void {
    const ext = root.Extensions;
    if (!ext || typeof ext !== 'object') return;
    let node = ext['codeblocks_project_custom_variables'];
    if (node === undefined) {
      for (const key of Object.keys(ext)) {
        if (key.toLowerCase().includes('custom_variables')) {
          node = ext[key];
          break;
        }
      }
    }
    if (!node) return;
    if (Array.isArray(node)) node = node[0];
    for (const key of Object.keys(node)) {
      // 跳过属性前缀与 fast-xml-parser 的空白文本节点（#text）
      if (key.startsWith('@_') || key.startsWith('#')) continue;
      const v = node[key];
      const val = v !== null && typeof v === 'object' ? String(v['@_value'] ?? '') : String(v ?? '');
      project.customVariables[key] = val;
    }
  }

  private parseProjectOptions(optNodes: any, project: Project): void {
    if (!optNodes) return;
    let nodes = Array.isArray(optNodes) ? optNodes : [optNodes];
    for (const node of nodes) {
      if (node['@_title'] !== undefined) project.title = String(node['@_title']);
      if (node['@_compiler'] !== undefined) project.compilerId = String(node['@_compiler']);
      if (node['@_virtualFolders'] !== undefined) {
        project.virtualFolders = String(node['@_virtualFolders']).split(';').filter(Boolean);
      }
      // PCH 模式（projectloader.cpp:400-443：<Option pch_mode="0/1/2">，默认 pchObjectDir=1）
      if (node['@_pch_mode'] !== undefined) {
        const n = Number(node['@_pch_mode']);
        if (!Number.isNaN(n) && n >= 0 && n <= 2) project.pchMode = n;
      }
      // 扩展对象命名（projectloader.cpp:1524：<Option extended_obj_names="1">）
      if (node['@_extended_obj_names'] !== undefined) {
        project.extendedObjNames = node['@_extended_obj_names'] === '1' || node['@_extended_obj_names'] === 'true';
      }
      // 项目级平台过滤（projectloader.cpp:399-463：<Option platforms>，默认 spAll）
      if (node['@_platforms'] !== undefined) {
        project.platforms = parsePlatforms(String(node['@_platforms']));
      }
      // 项目备注：<Option show_notes="1"><notes><![CDATA[...]]></notes></Option>
      if (node['@_show_notes'] !== undefined) {
        project.showNotesOnLoad = String(node['@_show_notes']) !== '0';
      }
      const notesNode = node['notes'];
      if (notesNode !== undefined) {
        if (typeof notesNode === 'string') {
          project.notes = notesNode;
        } else if (notesNode && typeof notesNode === 'object') {
          project.notes = String(notesNode['__cdata'] ?? notesNode['#text'] ?? '');
        }
      }
    }
  }

  private parseCompilerOptions(node: any, sink: { compilerOptions: string[]; includeDirs: string[] }): void {
    sink.compilerOptions.push(...collectAddOptions(node));
    // <Compiler><Add directory=...> 同时归属 includeDirs（DoCompilerOptions）
    sink.includeDirs.push(...collectAddDirectories(node));
  }

  private parseLinkerOptions(node: any, sink: { linkerOptions: string[]; libDirs: string[]; linkLibs: string[] }): void {
    sink.linkerOptions.push(...collectAddOptions(node));
    // <Linker><Add library=...> → linkLibs，<Add directory=...> → libDirs（DoLinkerOptions）
    sink.libDirs.push(...collectAddDirectories(node));
    sink.linkLibs.push(...collectAddLibraries(node));
  }

  private parseResourceCompilerOptions(node: any, sink: Project | BuildTarget): void {
    if (!sink.resourceCompilerOptions) sink.resourceCompilerOptions = [];
    sink.resourceCompilerOptions.push(...collectAddOptions(node));
    // <ResourceCompiler><Add directory=...> → resourceIncludeDirs（DoResourceCompilerOptions）
    sink.resourceIncludeDirs.push(...collectAddDirectories(node));
  }

  private parseIncludeDirs(node: any, sink: { includeDirs: string[] }): void {
    sink.includeDirs.push(...collectAddOptions(node).map(toNativeSeparator));
  }

  private parseLibDirs(node: any, sink: { libDirs: string[] }): void {
    sink.libDirs.push(...collectAddOptions(node).map(toNativeSeparator));
  }

  private parseVirtualTargets(node: any, project: Project): void {
    if (!node) return;
    let adds = node.Add;
    if (adds === undefined) return;
    if (!Array.isArray(adds)) adds = [adds];
    for (const add of adds) {
      const vt: VirtualBuildTarget = {
        title: String(add['@_alias'] ?? ''),
        targets: (String(add['@_targets'] ?? '')).split(';').filter(Boolean),
      };
      project.virtualTargets.push(vt);
    }
  }

  private parseBuildTargets(buildNode: any, project: Project): void {
    if (!buildNode) return;
    let targets = buildNode.Target;
    if (targets === undefined) return;
    if (!Array.isArray(targets)) targets = [targets];

    for (const tnode of targets) {
      const target: BuildTarget = {
        title: String(tnode['@_title'] ?? ''),
        targetType: TargetType.Executable,
        compilerId: project.compilerId,
        outputFilename: '',
        objectOutput: '',
        depsOutput: '',
        executionParameters: '',
        optionRelations: defaultRelations(),
        compilerOptions: [],
        linkerOptions: [],
        resourceCompilerOptions: [],
        includeDirs: [],
        libDirs: [],
        resourceIncludeDirs: [],
        linkLibs: [],
        files: [],
        linkerExecutable: LinkerExecutableOption.AutoDetect,
        createDefFile: false,
        createStaticLib: false,
        impLib: '',
        defFile: '',
        useConsoleRunner: true,
        includeInTargetAll: true,
        platforms: 0xff,
        commandsBeforeBuild: [],
        commandsAfterBuild: [],
        commandsBeforeClean: [],
        commandsAfterClean: [],
        buildScripts: [],
        envVars: [],
        alwaysRunPostBuildSteps: false,
        externalDeps: [],
        additionalOutput: [],
      };

      this.parseTargetOptions(tnode.Option, target);
      this.parseCompilerOptions(tnode.Compiler, target);
      this.parseLinkerOptions(tnode.Linker, target);
      this.parseLinkerExe(tnode.Linker, target);
      this.parseResourceCompilerOptions(tnode.ResourceCompiler, target);
      this.parseIncludeDirs(tnode.IncludeDirs, target);
      this.parseLibDirs(tnode.LibDirs, target);

      // pre/post build steps（.cbp 用 <ExtraCommands>，早期版本可能用 <MakeCommands>）
      this.parseExtraCommands(tnode.ExtraCommands, target);
      this.parseExtraCommands(tnode.MakeCommands, target);

      // 目标级构建脚本 <Script file="..."/>
      this.parseBuildScripts(tnode, target.buildScripts);

      // 目标级环境变量 <Environment><Variable name value>
      this.parseEnvironment(tnode.Environment, target);

      project.buildTargets.push(target);
    }

    // 项目级构建脚本（<Build><Script>，与目标并列于 Build 节点下）
    this.parseBuildScripts(buildNode, project.buildScripts);

    // 项目级环境变量（<Build><Environment>，位于 Target 之后）
    this.parseEnvironment(buildNode.Environment, project);
  }

  /** 解析 <Script file="..."/> 到目标数组（对应 DoBuildTarget / DoBuild 的 Script 循环） */
  private parseBuildScripts(parent: any, sink: string[]): void {
    if (!parent?.Script) return;
    let scripts = parent.Script;
    if (!Array.isArray(scripts)) scripts = [scripts];
    for (const s of scripts) {
      const f = s['@_file'];
      if (f !== undefined) sink.push(toUnix(String(f)));
    }
  }

  /** 解析 <Linker><LinkerExe value="CCompiler|CppCompiler|Linker">（DoLinkerOptions） */
  private parseLinkerExe(node: any, target: BuildTarget): void {
    if (!node?.LinkerExe) return;
    const value = String(node.LinkerExe['@_value'] ?? '');
    switch (value) {
      case 'CCompiler': target.linkerExecutable = LinkerExecutableOption.CCompiler; break;
      case 'CppCompiler': target.linkerExecutable = LinkerExecutableOption.CppCompiler; break;
      case 'Linker': target.linkerExecutable = LinkerExecutableOption.Linker; break;
      default: target.linkerExecutable = LinkerExecutableOption.AutoDetect;
    }
  }

  /** 解析 <Environment><Variable name value>（DoEnvironment） */
  private parseEnvironment(node: any, sink: { envVars: EnvVariable[] }): void {
    if (!node?.Variable) return;
    let vars = node.Variable;
    if (!Array.isArray(vars)) vars = [vars];
    for (const v of vars) {
      const name = String(v['@_name'] ?? '');
      if (!name) continue;
      sink.envVars.push({ name, value: toNativeSeparator(String(v['@_value'] ?? '')) });
    }
  }

  private parseTargetOptions(optNodes: any, target: BuildTarget): void {
    if (!optNodes) return;
    let nodes = Array.isArray(optNodes) ? optNodes : [optNodes];
    for (const node of nodes) {
      if (node['@_title'] !== undefined) target.title = String(node['@_title']);
      if (node['@_type'] !== undefined) target.targetType = parseTargetType(node['@_type']);
      if (node['@_compiler'] !== undefined) target.compilerId = String(node['@_compiler']);
      if (node['@_output'] !== undefined) target.outputFilename = toNativeSeparator(String(node['@_output']));
      if (node['@_object_output'] !== undefined) target.objectOutput = toUnix(String(node['@_object_output']));
      if (node['@_deps_output'] !== undefined) target.depsOutput = toUnix(String(node['@_deps_output']));
      if (node['@_parameters'] !== undefined) target.executionParameters = String(node['@_parameters']);
      // 外部依赖 / 附加输出（projectloader.cpp:594-598：分号分隔列表，Unix 路径）
      if (node['@_external_deps'] !== undefined) target.externalDeps = splitList(String(node['@_external_deps']));
      if (node['@_additional_output'] !== undefined) target.additionalOutput = splitList(String(node['@_additional_output']));
      if (node['@_createDefFile'] !== undefined) target.createDefFile = node['@_createDefFile'] === '1' || node['@_createDefFile'] === 'true';
      if (node['@_createStaticLib'] !== undefined) target.createStaticLib = node['@_createStaticLib'] === '1' || node['@_createStaticLib'] === 'true';
      if (node['@_imp_lib'] !== undefined) target.impLib = toNativeSeparator(String(node['@_imp_lib']));
      if (node['@_def_file'] !== undefined) target.defFile = toNativeSeparator(String(node['@_def_file']));
      if (node['@_use_console_runner'] !== undefined) target.useConsoleRunner = node['@_use_console_runner'] === '1' || node['@_use_console_runner'] === 'true';
      // <Option include_in_target_all="0/1">（DoBuildTargetOptions，默认 true）
      if (node['@_include_in_target_all'] !== undefined) target.includeInTargetAll = node['@_include_in_target_all'] !== '0';
      // 目标级平台过滤（projectloader.cpp:546-663：<Option platforms>，默认 spAll）
      if (node['@_platforms'] !== undefined) target.platforms = parsePlatforms(String(node['@_platforms']));
      // 关系属性（projectCompilerOptionsRelation 等）
      this.parseRelation(node['@_projectCompilerOptionsRelation'], OptionsRelationType.CompilerOptions, target);
      this.parseRelation(node['@_projectLinkerOptionsRelation'], OptionsRelationType.LinkerOptions, target);
      this.parseRelation(node['@_projectIncludeDirsRelation'], OptionsRelationType.IncludeDirs, target);
      this.parseRelation(node['@_projectLibDirsRelation'], OptionsRelationType.LibDirs, target);
      this.parseRelation(node['@_projectResourceIncludeDirsRelation'], OptionsRelationType.ResDirs, target);
    }
  }

  private parseRelation(v: any, type: OptionsRelationType, target: BuildTarget): void {
    if (v === undefined) return;
    const n = Number(v);
    if (!Number.isNaN(n) && n >= 0 && n <= 3) {
      target.optionRelations[type] = n as OptionsRelation;
    }
  }

  /** 解析 pre/post build/clean 命令（DoExtraCommands + DoMakeCommands） */
  private parseExtraCommands(node: any, sink: { commandsBeforeBuild: string[]; commandsAfterBuild: string[]; alwaysRunPostBuildSteps?: boolean }): void {
    if (!node) return;
    // <ExtraCommands><Mode after="always"> → AlwaysRunPostBuildSteps
    let modes = node.Mode;
    if (modes !== undefined) {
      if (!Array.isArray(modes)) modes = [modes];
      for (const m of modes) {
        if (String(m['@_after'] ?? '') === 'always') {
          if (sink.alwaysRunPostBuildSteps !== undefined) sink.alwaysRunPostBuildSteps = true;
        }
      }
    }
    // <ExtraCommands><Add before=".." after=".."/></ExtraCommands>
    let adds = node.Add;
    if (adds === undefined) return;
    if (!Array.isArray(adds)) adds = [adds];
    for (const add of adds) {
      const before = String(add['@_before'] ?? '');
      const after = String(add['@_after'] ?? '');
      if (before) sink.commandsBeforeBuild.push(before);
      if (after) sink.commandsAfterBuild.push(after);
    }
    // 兼容 <MakeCommands><Build><Option before=".."/></Build>...
    for (const phase of ['Build', 'Clean']) {
      const phaseNode = node[phase];
      if (!phaseNode) continue;
      let opts = phaseNode.Option;
      if (opts === undefined) continue;
      if (!Array.isArray(opts)) opts = [opts];
      for (const o of opts) {
        const cmd = String(o['@_command'] ?? '');
        if (!cmd) continue;
        const before = o['@_before'];
        if (phase === 'Build') {
          if (before) sink.commandsBeforeBuild.push(cmd); else sink.commandsAfterBuild.push(cmd);
        } else {
          // clean 命令仅 BuildTarget 支持
          const bt = sink as unknown as BuildTarget;
          if (before) bt.commandsBeforeClean.push(cmd); else bt.commandsAfterClean.push(cmd);
        }
      }
    }
  }

  private parseUnits(projNode: any, project: Project): void {
    if (!projNode) return;
    let units = projNode.Unit;
    if (units === undefined) return;
    if (!Array.isArray(units)) units = [units];

    for (const unit of units) {
      const filename = String(unit['@_filename'] ?? '');
      if (!filename) continue;

      const rel = toUnix(filename);
      // 对齐 cbProject::AddFile：compile/link 默认值按文件类型决定，compilerVar 按扩展名决定；
      // 随后由显式 <Option compile/link/compilerVar> 覆盖（projectloader.cpp DoUnitOptions）。
      const ft = fileTypeOf(rel);
      const file: ProjectFile = {
        relativeFilename: rel,
        relativeToCommonTopLevelPath: rel,
        absolutePath: unixJoin(project.basePath, rel),
        buildTargets: [],
        explicitTargets: false,
        compilerVar: defaultCompilerVar(rel),
        compile: defaultCompile(rel),
        link: defaultLink(rel),
        customBuildCommands: {},
        weight: 50,
        virtualFolder: '',
        generatedFiles: [],
      };

      let foundTarget = false;
      let noTarget = false;

      // 解析该文件归属的构建目标
      let opts = unit.Option;
      if (opts !== undefined) {
        if (!Array.isArray(opts)) opts = [opts];
        for (const o of opts) {
          const targets = o['@_target'];
          if (targets !== undefined) {
            file.explicitTargets = true;
            // Code::Blocks 用特殊值 <{~None~}> 表示「不归属任何目标」
            const list = String(targets).split(';').filter((x) => x && x !== '<{~None~}>');
            if (list.length) {
              file.buildTargets.push(...list);
              foundTarget = true;
            } else {
              noTarget = true;
            }
          }
          if (o['@_compilerVar'] !== undefined) file.compilerVar = String(o['@_compilerVar']);
          if (o['@_compile'] !== undefined) file.compile = String(o['@_compile']) !== '0';
          if (o['@_link'] !== undefined) file.link = String(o['@_link']) !== '0';
          if (o['@_weight'] !== undefined) file.weight = Number(o['@_weight']) || 50;
          if (o['@_virtualFolder'] !== undefined) file.virtualFolder = toUnix(String(o['@_virtualFolder']));
          // custom build command：<Option compiler="id" use="1" buildCommand="..."/>
          // 对齐 DoUnitOptions：compiler 与 buildCommand 均非空（不 trim）才记录；
          // use 属性仅在此时读取（缺省为 0/false，即不启用）。
          if (o['@_buildCommand'] !== undefined && o['@_compiler'] !== undefined) {
            const cmp = String(o['@_compiler']);
            const cmd = String(o['@_buildCommand']).replace(/\\n/g, '\n');
            if (cmp && cmd) {
              const use = o['@_use'] !== undefined ? String(o['@_use']) !== '0' : false;
              file.customBuildCommands[cmp] = { command: cmd, use };
            }
          }
        }
      }

      project.files.push(file);

      // 无 target 属性的文件归属所有目标（Code::Blocks pre-1.6 兼容）
      if (!foundTarget && !noTarget) {
        for (const t of project.buildTargets) {
          file.buildTargets.push(t.title);
        }
      }

      // 归属到对应构建目标的 files 列表
      for (const bt of file.buildTargets) {
        const target = project.buildTargets.find((t) => t.title === bt);
        if (target) target.files.push(file);
      }
    }
  }
}

/** .workspace 解析器 —— 对应 workspaceloader.cpp */
export class WorkspaceParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  }

  parse(filename: string): Workspace {
    const result = parseXmlCached(filename, this.parser, workspaceXmlCache);
    const root = result.CodeBlocks_workspace_file;
    if (!root) throw new Error('不是有效的 .workspace 文件');

    const basePath = path.dirname(filename);
    const ws: Workspace = {
      title: String(root.Workspace?.['@_title'] ?? path.basename(filename, '.workspace')),
      basePath,
      filename,
      projectPaths: [],
      dependencies: {},
    };

    let projects = root.Workspace?.Project;
    if (projects !== undefined) {
      if (!Array.isArray(projects)) projects = [projects];
      for (const p of projects) {
        const f = p['@_filename'];
        if (!f) continue;
        const rel = toUnix(String(f));
        ws.projectPaths.push(rel);
        if (p['@_active'] === '1' || p['@_active'] === 'true') ws.activeProject = rel;

        // 解析 <Depends filename="...">（对齐 workspaceloader.cpp 第二遍循环建立依赖）
        let depends = p.Depends;
        if (depends !== undefined) {
          if (!Array.isArray(depends)) depends = [depends];
          const deps: string[] = [];
          for (const d of depends) {
            const df = d['@_filename'];
            if (df) deps.push(toUnix(String(df)));
          }
          if (deps.length) ws.dependencies[rel] = deps;
        }
      }
    }
    return ws;
  }
}
