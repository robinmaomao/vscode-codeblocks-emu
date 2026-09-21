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
} from './types';

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
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

/** 从 <Compiler>/<Linker> 的 <Add directory="..."/> 提取目录（对应 DoCompilerOptions/DoLinkerOptions） */
function collectAddDirectories(parent: any): string[] {
  const out: string[] = [];
  if (!parent) return out;
  let node = parent.Add;
  if (node === undefined) return out;
  if (!Array.isArray(node)) node = [node];
  for (const n of node) {
    const dir = n['@_directory'];
    if (dir !== undefined && dir !== '') out.push(toUnix(String(dir)));
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
    if (lib !== undefined && lib !== '') out.push(toUnix(String(lib)));
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
    const raw = fs.readFileSync(filename, 'utf-8');
    const result = this.parser.parse(raw);

    const root = result.CodeBlocks_project_file;
    if (!root) throw new Error('不是有效的 .cbp 文件：缺少 <CodeBlocks_project_file> 根节点');

    const basePath = path.dirname(filename);
    const project: Project = {
      title: String(root.Project?.['@_title'] ?? path.basename(filename, '.cbp')),
      basePath,
      commonTopLevelPath: basePath,
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
      files: [],
      extensions: root.Extensions ?? null,
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

  private parseProjectOptions(optNodes: any, project: Project): void {
    if (!optNodes) return;
    let nodes = Array.isArray(optNodes) ? optNodes : [optNodes];
    for (const node of nodes) {
      if (node['@_title'] !== undefined) project.title = String(node['@_title']);
      if (node['@_compiler'] !== undefined) project.compilerId = String(node['@_compiler']);
      if (node['@_virtualFolders'] !== undefined) {
        project.virtualFolders = String(node['@_virtualFolders']).split(';').filter(Boolean);
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
  }

  private parseIncludeDirs(node: any, sink: { includeDirs: string[] }): void {
    sink.includeDirs.push(...collectAddOptions(node).map(toUnix));
  }

  private parseLibDirs(node: any, sink: { libDirs: string[] }): void {
    sink.libDirs.push(...collectAddOptions(node).map(toUnix));
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
        useConsoleRunner: false,
        includeInTargetAll: true,
        commandsBeforeBuild: [],
        commandsAfterBuild: [],
        commandsBeforeClean: [],
        commandsAfterClean: [],
      };

      this.parseTargetOptions(tnode.Option, target);
      this.parseCompilerOptions(tnode.Compiler, target);
      this.parseLinkerOptions(tnode.Linker, target);
      this.parseResourceCompilerOptions(tnode.ResourceCompiler, target);
      this.parseIncludeDirs(tnode.IncludeDirs, target);
      this.parseLibDirs(tnode.LibDirs, target);

      // pre/post build steps（.cbp 用 <ExtraCommands>，早期版本可能用 <MakeCommands>）
      this.parseExtraCommands(tnode.ExtraCommands, target);
      this.parseExtraCommands(tnode.MakeCommands, target);

      project.buildTargets.push(target);
    }
  }

  private parseTargetOptions(optNodes: any, target: BuildTarget): void {
    if (!optNodes) return;
    let nodes = Array.isArray(optNodes) ? optNodes : [optNodes];
    for (const node of nodes) {
      if (node['@_title'] !== undefined) target.title = String(node['@_title']);
      if (node['@_type'] !== undefined) target.targetType = parseTargetType(node['@_type']);
      if (node['@_compiler'] !== undefined) target.compilerId = String(node['@_compiler']);
      if (node['@_output'] !== undefined) target.outputFilename = String(node['@_output']);
      if (node['@_object_output'] !== undefined) target.objectOutput = toUnix(String(node['@_object_output']));
      if (node['@_createDefFile'] !== undefined) target.createDefFile = node['@_createDefFile'] === '1' || node['@_createDefFile'] === 'true';
      if (node['@_createStaticLib'] !== undefined) target.createStaticLib = node['@_createStaticLib'] === '1' || node['@_createStaticLib'] === 'true';
      if (node['@_use_console_runner'] !== undefined) target.useConsoleRunner = node['@_use_console_runner'] === '1' || node['@_use_console_runner'] === 'true';
      // 关系属性（projectCompilerOptionsRelation 等）
      this.parseRelation(node['@_projectCompilerOptionsRelation'], OptionsRelationType.CompilerOptions, target);
      this.parseRelation(node['@_projectLinkerOptionsRelation'], OptionsRelationType.LinkerOptions, target);
      this.parseRelation(node['@_projectIncludeDirsRelation'], OptionsRelationType.IncludeDirs, target);
      this.parseRelation(node['@_projectLibDirsRelation'], OptionsRelationType.LibDirs, target);
      this.parseRelation(node['@_projectResIncludeDirsRelation'], OptionsRelationType.ResDirs, target);
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
  private parseExtraCommands(node: any, sink: { commandsBeforeBuild: string[]; commandsAfterBuild: string[] }): void {
    if (!node) return;
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
      const file: ProjectFile = {
        relativeFilename: rel,
        relativeToCommonTopLevelPath: rel,
        absolutePath: unixJoin(project.basePath, rel),
        buildTargets: [],
        compilerVar: '',
        compile: true,
        link: true,
        customBuildCommands: {},
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
            const list = String(targets).split(';').filter(Boolean);
            if (list.length) {
              file.buildTargets.push(...list);
              foundTarget = true;
            } else {
              noTarget = true; // <{~None~}>
            }
          }
          if (o['@_compilerVar'] !== undefined) file.compilerVar = String(o['@_compilerVar']);
          if (o['@_compile'] !== undefined) file.compile = String(o['@_compile']) !== '0';
          if (o['@_link'] !== undefined) file.link = String(o['@_link']) !== '0';
          // custom build command：<Option compiler="id" use="1" buildCommand="..."/>
          if (o['@_buildCommand'] !== undefined && o['@_compiler'] !== undefined) {
            const cmp = String(o['@_compiler']);
            const cmd = String(o['@_buildCommand']).replace(/\\n/g, '\n');
            if (cmp && cmd) file.customBuildCommands[cmp] = cmd;
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
    const raw = fs.readFileSync(filename, 'utf-8');
    const result = this.parser.parse(raw);
    const root = result.CodeBlocks_workspace_file;
    if (!root) throw new Error('不是有效的 .workspace 文件');

    const basePath = path.dirname(filename);
    const ws: Workspace = {
      title: String(root.Workspace?.['@_title'] ?? path.basename(filename, '.workspace')),
      basePath,
      filename,
      projectPaths: [],
    };

    let projects = root.Project;
    if (projects !== undefined) {
      if (!Array.isArray(projects)) projects = [projects];
      for (const p of projects) {
        const f = p['@_filename'];
        if (f) {
          const rel = toUnix(String(f));
          ws.projectPaths.push(rel);
          if (p['@_active'] === '1' || p['@_active'] === 'true') ws.activeProject = rel;
        }
      }
    }
    return ws;
  }
}
