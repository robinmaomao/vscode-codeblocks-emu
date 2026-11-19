/**
 * 工程模型 → JSON 快照（无 vscode 依赖）。
 *
 * 快照只输出「可读 + 可编辑」的字段，避免把 rawProject / extensions 这类内部结构
 * 塞给模型（既浪费上下文，也容易让 agent 误以为可以直接 patch）。
 */
import type { BuildTarget, Project, ProjectFile, VirtualBuildTarget, Workspace } from '../model/types';
import { fieldSpecs } from './types';

export type QuerySection = 'summary' | 'targets' | 'files' | 'options' | 'schema' | 'all';

export interface QueryOptions {
  section?: QuerySection;
  /** 只看某个目标（targets/files/options） */
  target?: string;
}

/** 目标快照（字段与编辑白名单一一对应） */
export function targetSnapshot(t: BuildTarget): Record<string, unknown> {
  return {
    title: t.title,
    targetType: t.targetType,
    compilerId: t.compilerId,
    outputFilename: t.outputFilename,
    objectOutput: t.objectOutput,
    platforms: t.platforms,
    depsOutput: t.depsOutput,
    executionParameters: t.executionParameters,
    workingDir: t.workingDir,
    hostApplication: t.hostApplication,
    runHostApplicationInTerminal: t.runHostApplicationInTerminal,
    useConsoleRunner: t.useConsoleRunner,
    impLib: t.impLib,
    defFile: t.defFile,
    createDefFile: t.createDefFile,
    createStaticLib: t.createStaticLib,
    prefixAuto: t.prefixAuto,
    extensionAuto: t.extensionAuto,
    includeInTargetAll: t.includeInTargetAll,
    linkerExecutable: t.linkerExecutable,
    alwaysRunPostBuildSteps: t.alwaysRunPostBuildSteps,
    externalDeps: t.externalDeps,
    additionalOutput: t.additionalOutput,
    compilerOptions: t.compilerOptions,
    linkerOptions: t.linkerOptions,
    resourceCompilerOptions: t.resourceCompilerOptions,
    includeDirs: t.includeDirs,
    libDirs: t.libDirs,
    resourceIncludeDirs: t.resourceIncludeDirs,
    linkLibs: t.linkLibs,
    optionRelations: t.optionRelations,
    envVars: t.envVars,
    commandsBeforeBuild: t.commandsBeforeBuild,
    commandsAfterBuild: t.commandsAfterBuild,
    commandsBeforeClean: t.commandsBeforeClean,
    commandsAfterClean: t.commandsAfterClean,
    buildScripts: t.buildScripts,
    makeCommands: t.makeCommands,
    fileCount: t.files.length,
  };
}

/** 文件快照 */
export function fileSnapshot(f: ProjectFile): Record<string, unknown> {
  return {
    file: f.relativeFilename,
    compile: f.compile,
    link: f.link,
    compilerVar: f.compilerVar,
    buildTargets: f.buildTargets,
    explicitTargets: f.explicitTargets,
    weight: f.weight,
    virtualFolder: f.virtualFolder,
    customBuildCommands: f.customBuildCommands,
    generatedFiles: f.generatedFiles,
  };
}

/** 工程快照 */
export function projectSnapshot(project: Project, opts: QueryOptions = {}): Record<string, unknown> {
  const section = opts.section ?? 'all';
  const want = (s: QuerySection): boolean => section === 'all' || section === s;
  const target = opts.target ? project.buildTargets.find((t) => t.title === opts.target) : undefined;
  if (opts.target && !target) {
    return { error: `Target not found: ${opts.target}`, targets: project.buildTargets.map((t) => t.title) };
  }

  const out: Record<string, unknown> = {};
  if (want('summary')) {
    out.summary = {
      title: project.title,
      filename: project.filename,
      basePath: project.basePath,
      compilerId: project.compilerId,
      platforms: project.platforms,
      pchMode: project.pchMode,
      extendedObjNames: project.extendedObjNames,
      makefileIsCustom: project.makefileIsCustom,
      makefile: project.makefile,
      executionDir: project.executionDir,
      targetCount: project.buildTargets.length,
      fileCount: project.files.length,
      virtualFolders: project.virtualFolders,
      virtualTargets: project.virtualTargets.map((v) => ({ alias: v.title, targets: v.targets })),
      notes: project.notes,
      showNotesOnLoad: project.showNotesOnLoad,
      envVars: project.envVars,
      customVariables: project.customVariables,
      makeCommands: project.makeCommands,
    };
  }
  if (want('targets')) {
    out.targets = (target ? [target] : project.buildTargets).map(targetSnapshot);
  }
  if (want('files')) {
    const files: ProjectFile[] = target ? target.files : project.files;
    out.files = uniqueFiles(files).map(fileSnapshot);
  }
  if (want('options')) {
    out.options = {
      project: {
        compilerOptions: project.compilerOptions,
        linkerOptions: project.linkerOptions,
        resourceCompilerOptions: project.resourceCompilerOptions,
        includeDirs: project.includeDirs,
        libDirs: project.libDirs,
        resourceIncludeDirs: project.resourceIncludeDirs,
        linkLibs: project.linkLibs,
      },
      target: target
        ? {
            title: target.title,
            compilerOptions: target.compilerOptions,
            linkerOptions: target.linkerOptions,
            resourceCompilerOptions: target.resourceCompilerOptions,
            includeDirs: target.includeDirs,
            libDirs: target.libDirs,
            resourceIncludeDirs: target.resourceIncludeDirs,
            linkLibs: target.linkLibs,
            optionRelations: target.optionRelations,
          }
        : undefined,
    };
  }
  if (want('schema')) {
    out.schema = {
      project: fieldSpecs('project'),
      target: fieldSpecs('target'),
      file: fieldSpecs('file'),
      virtualTarget: fieldSpecs('virtualTarget'),
      ops: [
        { op: 'set|add|remove', scope: 'project|target|file|virtualTarget', field: 'see schema above', value: 'new value' },
        { op: 'addTarget', title: 'Release2', copyFrom: 'Release', targetType: 0 },
        { op: 'removeTarget', title: 'Release2' },
        { op: 'renameTarget', title: 'Debug', to: 'Debug2' },
        { op: 'addFile', file: 'src/a.c', targets: ['Debug'], compile: true, link: true },
        { op: 'removeFile', file: 'src/a.c' },
        { op: 'renameFile', file: 'src/a.c', to: 'src/b.c' },
        { op: 'addVirtualTarget', alias: 'All2', targets: ['Debug'] },
        { op: 'removeVirtualTarget', alias: 'All2' },
      ],
      notes: [
        'Array fields: use op=add / op=remove with a single string value; op=set replaces the whole array.',
        'Script fields (commandsBeforeBuild/buildScripts/makeCommands/customBuildCommands) require allowScripts=true.',
      ],
    };
  }
  return out;
}

/** 工作区快照 */
export function workspaceSnapshot(ws: Workspace): Record<string, unknown> {
  return {
    title: ws.title,
    filename: ws.filename,
    basePath: ws.basePath,
    activeProject: ws.activeProject,
    projects: ws.projectPaths,
    dependencies: ws.dependencies,
  };
}

function uniqueFiles(files: ProjectFile[]): ProjectFile[] {
  const seen = new Set<string>();
  const out: ProjectFile[] = [];
  for (const f of files) {
    const key = f.relativeFilename.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** 列出虚拟目标（供 UI/工具校验） */
export function virtualTargetsOf(project: Project): VirtualBuildTarget[] {
  return project.virtualTargets;
}
