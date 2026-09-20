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

/** 解析 TargetType 字符串 */
function parseTargetType(s: string | undefined): TargetType {
  switch ((s ?? '').toLowerCase()) {
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
      // 虚拟目标
      this.parseVirtualTargets(projNode.VirtualTargets, project);
      // 构建目标
      this.parseBuildTargets(projNode.Build, project);
      // 文件
      this.parseUnits(root.Project, project);
    }

    return project;
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

  private parseCompilerOptions(node: any, sink: { compilerOptions: string[] }): void {
    sink.compilerOptions.push(...collectAddOptions(node));
  }

  private parseLinkerOptions(node: any, sink: { linkerOptions: string[] }): void {
    sink.linkerOptions.push(...collectAddOptions(node));
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

      // pre/post build steps
      this.parseMakeCommands(tnode.MakeCommands, target);

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

  private parseMakeCommands(node: any, target: BuildTarget): void {
    if (!node) return;
    let items = node.Build ?? node.Clean;
    // .cbp 里 MakeCommands 结构：<MakeCommands><Build><Option before=".."/></Build>...
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
          if (before) target.commandsBeforeBuild.push(cmd); else target.commandsAfterBuild.push(cmd);
        } else {
          if (before) target.commandsBeforeClean.push(cmd); else target.commandsAfterClean.push(cmd);
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
        absolutePath: unixJoin(project.basePath, rel),
        buildTargets: [],
        compilerVar: '',
      };

      // 解析该文件归属的构建目标
      let opts = unit.Option;
      if (opts !== undefined) {
        if (!Array.isArray(opts)) opts = [opts];
        for (const o of opts) {
          const targets = o['@_target'];
          if (targets !== undefined) {
            file.buildTargets.push(...String(targets).split(';').filter(Boolean));
          }
          if (o['@_compilerVar'] !== undefined) file.compilerVar = String(o['@_compilerVar']);
          if (o['@_build'] !== undefined) {
            file.useCustomBuildCommand = true;
            file.customBuildCommand = String(o['@_build']);
          }
        }
      }

      project.files.push(file);

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
