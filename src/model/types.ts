/**
 * 数据模型 —— 对应 Code::Blocks 的 compiletargetbase.h / projectbuildtarget.h / projectfile.h
 *
 * 移植自 codeblocks-src/src/include/compiletargetbase.h 等（LGPL v3）。
 * 此处为 TypeScript 等价重写，仅保留纯数据/枚举语义，不含 wxWidgets 依赖。
 */

/** 目标产出类型 —— compiletargetbase.h TargetType */
export enum TargetType {
  Executable = 0,    // ttExecutable
  ConsoleOnly = 1,   // ttConsoleOnly
  StaticLib = 2,     // ttStaticLib
  DynamicLib = 3,    // ttDynamicLib
  CommandsOnly = 4,  // ttCommandsOnly
  Native = 5,        // ttNative
}

/** 选项关系 —— compiletargetbase.h OptionsRelation */
export enum OptionsRelation {
  UseParentOptionsOnly = 0,   // orUseParentOptionsOnly
  UseTargetOptionsOnly = 1,   // orUseTargetOptionsOnly
  PrependToParentOptions = 2, // orPrependToParentOptions
  AppendToParentOptions = 3,  // orAppendToParentOptions
}

/** 选项关系类型 —— compiletargetbase.h OptionsRelationType */
export enum OptionsRelationType {
  CompilerOptions = 0, // ortCompilerOptions
  LinkerOptions = 1,   // ortLinkerOptions
  IncludeDirs = 2,     // ortIncludeDirs
  LibDirs = 3,         // ortLibDirs
  ResDirs = 4,         // ortResDirs
}

/** 链接器可执行选择 —— 对应 LinkerExecutableOption */
export enum LinkerExecutableOption {
  AutoDetect = 0,
  CCompiler = 1,
  CppCompiler = 2,
  Linker = 3,
}

/** 命令类型 —— compiler.h CommandType */
export enum CommandType {
  CompileObjectCmd = 0,  // ctCompileObjectCmd
  GenDependenciesCmd = 1, // ctGenDependenciesCmd
  CompileResourceCmd = 2, // ctCompileResourceCmd
  LinkExeCmd = 3,        // ctLinkExeCmd
  LinkConsoleExeCmd = 4, // ctLinkConsoleExeCmd
  LinkDynamicCmd = 5,    // ctLinkDynamicCmd
  LinkStaticCmd = 6,     // ctLinkStaticCmd
  LinkNativeCmd = 7,     // ctLinkNativeCmd
}

/** 编译输出行类型 —— compiler.h CompilerLineType */
export enum CompilerLineType {
  Normal = 0, // cltNormal
  Warning = 1, // cltWarning
  Error = 2,   // cltError
  Info = 3,    // cltInfo
}

/** 环境变量项（<Environment><Variable name value>） */
export interface EnvVariable {
  name: string;
  value: string;
}

/** 自定义编译命令 —— projectfile.h pfCustomBuild */
export interface CustomBuildCommand {
  /** 构建命令模板（含 $compiler/$file 等宏） */
  command: string;
  /** 是否启用该自定义命令（<Option use="1"/>） */
  use: boolean;
}

/** 单个文件在项目中的定义 —— projectfile.h ProjectFile */
export interface ProjectFile {
  /** 相对项目根目录的路径（Unix 分隔符） */
  relativeFilename: string;
  /** 相对公共顶层路径（无 ..，用于生成对象文件名，对应 projectfile.h relativeToCommonTopLevelPath） */
  relativeToCommonTopLevelPath: string;
  /** 绝对路径（加载后计算） */
  absolutePath: string;
  /** 该文件所属的构建目标标题列表 */
  buildTargets: string[];
  /** 是否在 .cbp 中显式写了 <Option target=...>（false = 未写，隐式归属所有目标） */
  explicitTargets: boolean;
  /** 编译变量：CPP / CC / WINDRES */
  compilerVar: string;
  /** 是否参与编译（<Option compile="1"/>） */
  compile: boolean;
  /** 是否参与链接（<Option link="1"/>） */
  link: boolean;
  /** 自定义编译命令（按编译器 ID 映射：compilerId → pfCustomBuild） */
  customBuildCommands: Record<string, CustomBuildCommand>;
  /** 编译权重（0-100，默认 50，小者先编译，对应 projectfile.h weight） */
  weight: number;
  /** 虚拟文件夹归属（空 = 根，对应 <Option virtualFolder>） */
  virtualFolder: string;
}

/** 构建目标 —— projectbuildtarget.h ProjectBuildTarget（继承 CompileTargetBase） */
export interface BuildTarget {
  /** 目标标题，如 "Debug" / "Release" */
  title: string;
  /** 产出类型 */
  targetType: TargetType;
  /** 编译器 ID（对应 options_<id>.xml） */
  compilerId: string;
  /** 输出文件名（相对项目根） */
  outputFilename: string;
  /** 对象文件输出目录 */
  objectOutput: string;

  /** 各关系类型的选项关系映射 */
  optionRelations: Record<OptionsRelationType, OptionsRelation>;

  // 编译选项（三级：项目 → 目标 → 文件）
  compilerOptions: string[];
  linkerOptions: string[];
  resourceCompilerOptions: string[];
  includeDirs: string[];
  libDirs: string[];
  resourceIncludeDirs: string[];
  linkLibs: string[];

  /** 该目标包含的文件 */
  files: ProjectFile[];

  /** 链接器可执行选择 */
  linkerExecutable: LinkerExecutableOption;
  /** 静态库是否生成 DEF 文件 */
  createDefFile: boolean;
  /** 动态库是否生成 import 库 */
  createStaticLib: boolean;
  /** 动态库 import 库文件名（<Option output imp_lib="...">，空 = 由 output 推导） */
  impLib: string;
  /** 动态库 def 文件名（<Option output def_file="...">，空 = 由 output 推导） */
  defFile: string;
  /** 是否使用 console runner */
  useConsoleRunner: boolean;
  /** 是否纳入 "All" 虚拟目标 */
  includeInTargetAll: boolean;

  /** deps 输出目录（<Option deps_output>，默认 .deps，对齐 GetDepsOutput） */
  depsOutput: string;
  /** 执行参数（<Option parameters>，Run/Debug 用，对齐 GetExecutionParameters） */
  executionParameters: string;

  /** pre/post build 命令 */
  commandsBeforeBuild: string[];
  commandsAfterBuild: string[];
  /** clean 命令（pre/post） */
  commandsBeforeClean: string[];
  commandsAfterClean: string[];

  /** 构建脚本列表（<Script file="..."/>） */
  buildScripts: string[];

  /** 目标级环境变量（<Environment><Variable name value>） */
  envVars: EnvVariable[];
  /** 是否始终运行 post build 步骤（<ExtraCommands><Mode after="always">） */
  alwaysRunPostBuildSteps: boolean;
}

/** 虚拟目标（如 "All"） */
export interface VirtualBuildTarget {
  title: string;
  /** 关联的物理目标标题 */
  targets: string[];
}

/** 项目 —— cbproject.h cbProject */
export interface Project {
  /** 项目标题 */
  title: string;
  /** 项目根目录（绝对路径） */
  basePath: string;
  /** 所有文件的公共顶层路径（绝对路径，用于生成对象文件，对应 cbproject.cpp CalculateCommonTopLevelPath） */
  commonTopLevelPath: string;
  /** PCH 模式（cbp <Option pch_mode>，PCHMode：0=pchSourceDir 1=pchObjectDir 2=pchSourceFile，默认 1） */
  pchMode: number;
  /** 扩展对象命名（<Option extended_obj_names="1">：foo.c → foo.c.o，默认 false） */
  extendedObjNames: boolean;
  /** .cbp 文件绝对路径 */
  filename: string;
  /** 默认编译器 ID */
  compilerId: string;

  /** 项目级编译选项（作为所有目标的基础） */
  compilerOptions: string[];
  linkerOptions: string[];
  resourceCompilerOptions: string[];
  includeDirs: string[];
  libDirs: string[];
  resourceIncludeDirs: string[];
  linkLibs: string[];

  /** 构建目标 */
  buildTargets: BuildTarget[];
  /** 虚拟目标 */
  virtualTargets: VirtualBuildTarget[];
  /** 虚拟文件夹 */
  virtualFolders: string[];

  /** 项目级 pre/post build 命令（<ExtraCommands>，对所有目标生效） */
  commandsBeforeBuild: string[];
  commandsAfterBuild: string[];

  /** 项目级构建脚本列表（<Build><Script file="..."/>） */
  buildScripts: string[];
  /** 项目备注（<Option show_notes><notes>） */
  notes: string;
  /** 加载项目时是否显示备注 */
  showNotesOnLoad: boolean;

  /** 项目级环境变量（<Build><Environment>） */
  envVars: EnvVariable[];
  /** 项目级是否始终运行 post build 步骤（<ExtraCommands><Mode after="always">） */
  alwaysRunPostBuildSteps: boolean;

  /** 所有文件（含未归属具体目标的） */
  files: ProjectFile[];

  /** 扩展数据（含扩展节点） */
  extensions: unknown;
  /** 原始 XML 项目节点（fast-xml-parser 结果，供序列化透传未映射元素） */
  rawProject?: unknown;
}

/** 工作区 —— cbworkspace.h cbWorkspace */
export interface Workspace {
  title: string;
  basePath: string;
  filename: string;
  /** 项目相对路径列表 */
  projectPaths: string[];
  /** 激活项目（相对路径） */
  activeProject?: string;
  /** 项目依赖（工程相对路径 → 依赖的相对路径列表，来自 <Depends filename>） */
  dependencies: Record<string, string[]>;
}
