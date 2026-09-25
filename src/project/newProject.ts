/**
 * 新建工程向导 —— 对标 Code::Blocks 的 New Project 模板
 *
 * 提供 Console App / Static Lib / Shared Lib / Empty Project 四类模板，
 * 生成 .cbp（Debug/Release 双目标）+ 骨架源文件。
 */
import * as path from 'path';
import {
  Project,
  BuildTarget,
  ProjectFile,
  TargetType,
  OptionsRelation,
  OptionsRelationType,
  LinkerExecutableOption,
} from '../model/types';
import { defaultCompilerVar, defaultCompile, defaultLink } from '../model/fileTypes';

/** 工程模板定义 */
export interface ProjectTemplate {
  id: string;
  /** QuickPick 显示名 */
  label: string;
  description: string;
  targetType: TargetType;
  /** 骨架源文件（相对项目目录的文件名 + 内容） */
  skeleton: { name: string; content: string }[];
}

const CONSOLE_MAIN_C = `#include <stdio.h>

int main()
{
    printf("Hello, world!\\n");
    return 0;
}
`;

const CONSOLE_MAIN_CPP = `#include <iostream>

int main()
{
    std::cout << "Hello, world!" << std::endl;
    return 0;
}
`;

/** 工程模板列表（对齐 Code::Blocks 常用 New Project 模板） */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'console-cpp',
    label: 'Console application (C++)',
    description: '控制台程序（C++，main.cpp）',
    targetType: TargetType.ConsoleOnly,
    skeleton: [{ name: 'main.cpp', content: CONSOLE_MAIN_CPP }],
  },
  {
    id: 'console-c',
    label: 'Console application (C)',
    description: '控制台程序（C，main.c）',
    targetType: TargetType.ConsoleOnly,
    skeleton: [{ name: 'main.c', content: CONSOLE_MAIN_C }],
  },
  {
    id: 'static',
    label: 'Static library',
    description: '静态库（.a）',
    targetType: TargetType.StaticLib,
    skeleton: [],
  },
  {
    id: 'shared',
    label: 'Shared library',
    description: '共享库（.so/.dll）',
    targetType: TargetType.DynamicLib,
    skeleton: [],
  },
  {
    id: 'empty',
    label: 'Empty project',
    description: '空工程',
    targetType: TargetType.ConsoleOnly,
    skeleton: [],
  },
];

function defaultRelations(): Record<OptionsRelationType, OptionsRelation> {
  return {
    [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
  };
}

function makeTarget(name: string, title: string, type: TargetType, compilerOptions: string[], compilerId: string): BuildTarget {
  return {
    title,
    targetType: type,
    compilerId,
    outputFilename: type === TargetType.StaticLib ? `bin/${title}/lib${name}.a`
      : type === TargetType.DynamicLib ? (process.platform === 'win32' ? `bin/${title}/lib${name}.dll` : `bin/${title}/lib${name}.so`)
      : `bin/${title}/${name}`,
    objectOutput: `obj/${title}/`,
    depsOutput: '',
    executionParameters: '',
    optionRelations: defaultRelations(),
    compilerOptions,
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
    includeInTargetAll: false,
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
}

function makeFile(projectDir: string, rel: string, targetTitles: string[]): ProjectFile {
  return {
    relativeFilename: rel,
    relativeToCommonTopLevelPath: rel,
    absolutePath: path.join(projectDir, rel),
    buildTargets: [...targetTitles],
    explicitTargets: false,
    // 默认值对齐 cbProject::AddFile（.c→CC，Win .rc→WINDRES，其它→CPP；compile/link 按文件类型）
    compilerVar: defaultCompilerVar(rel),
    compile: defaultCompile(rel),
    link: defaultLink(rel),
    customBuildCommands: {},
    weight: 50,
    virtualFolder: '',
    generatedFiles: [],
  };
}

/** 生成新工程的 Project 模型（不落盘） */
export function createProjectFromTemplate(
  name: string,
  basePath: string,
  tpl: ProjectTemplate,
  compilerId = 'gcc',
): { project: Project; projectDir: string } {
  const projectDir = path.join(basePath, name);
  const targetTitles = ['Debug', 'Release'];
  const project: Project = {
    title: name,
    basePath: projectDir,
    commonTopLevelPath: projectDir,
    pchMode: 1,
    extendedObjNames: false,
    platforms: 0xff,
    filename: path.join(projectDir, `${name}.cbp`),
    compilerId,
    compilerOptions: [],
    linkerOptions: [],
    resourceCompilerOptions: [],
    includeDirs: [],
    libDirs: [],
    resourceIncludeDirs: [],
    linkLibs: [],
    buildTargets: [
      makeTarget(name, 'Debug', tpl.targetType, ['-g', '-Wall'], compilerId),
      makeTarget(name, 'Release', tpl.targetType, ['-O2'], compilerId),
    ],
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
    files: tpl.skeleton.map((f) => makeFile(projectDir, f.name, targetTitles)),
    extensions: null,
  };
  return { project, projectDir };
}
