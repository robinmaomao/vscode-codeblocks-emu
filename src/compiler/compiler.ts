/**
 * 编译器模型与命令模板 —— 对应 compiler.h / compiler.cpp / options_<id>.xml
 *
 * 移植自 codeblocks-src/src/include/compiler.h（CompilerSwitches/CompilerPrograms/CommandType）
 * 及 options_gcc.xml 的 <Program>/<Switch>/<Command> 结构（LGPL v3）。
 */
import { CommandType } from '../model/types';

/** 编译器程序集合 —— compiler.h CompilerPrograms */
export interface CompilerPrograms {
  C: string;       // C 编译器
  CPP: string;     // C++ 编译器
  LD: string;      // 动态库链接器
  LIB: string;     // 静态库链接器（ar）
  WINDRES: string; // 资源编译器
  MAKE: string;    // make
  DBGconfig: string; // 调试器配置名
}

/** 编译器开关 —— compiler.h CompilerSwitches */
export interface CompilerSwitches {
  includeDirs: string;        // -I
  libDirs: string;            // -L
  linkLibs: string;           // -l
  defines: string;            // -D
  genericSwitch: string;      // -
  objectExtension: string;    // o
  forceFwdSlashes: boolean;
  forceLinkerUseQuotes: boolean;
  forceCompilerUseQuotes: boolean;
  needDependencies: boolean;
  libPrefix: string;          // lib
  libExtension: string;       // a
  linkerNeedsLibPrefix: boolean;
  linkerNeedsLibExtension: boolean;
  linkerNeedsPathResolved: boolean;
  supportsPCH: boolean;
  PCHExtension: string;       // gch
  useFlatObjects: boolean;
  useFullSourcePaths: boolean;
  use83Paths: boolean;
  includeDirSeparator: string;
  libDirSeparator: string;
  objectSeparator: string;
  statusSuccess: number;      // 0
}

/** 编译选项定义 —— options XML 的 <Option> */
export interface CompilerOption {
  name: string;
  option: string;           // 编译器 flag，如 "-g"
  additionalLibs?: string;  // 链接库 flag
  supersedes?: string;      // 互斥选项
  checkAgainst?: string;
  checkMessage?: string;
  category: string;
  exclusive: boolean;
}

/** 编译器命令模板（按扩展名分组的命令） */
export interface CompilerTool {
  command: string;
  extensions: string[];      // 空数组 = 通配
  generatedFiles: string[];
}

/** 编译输出正则 —— compiler.h RegExStruct */
export interface RegExStruct {
  desc: string;
  lt: 'error' | 'warning' | 'info' | 'normal';
  msg: number[];      // msg 子表达式序号（最多 3）
  filename: number;   // 0 = 无
  line: number;       // 0 = 无
  regex: string;
}

/** 编译器定义 */
export interface Compiler {
  id: string;
  name: string;
  masterPath: string;
  programs: CompilerPrograms;
  switches: CompilerSwitches;
  /** 按 CommandType 索引的命令模板列表 */
  commands: CommandTypeTemplate[];
  /** 编译选项 */
  options: CompilerOption[];
  /** 错误/警告正则 */
  regexes: RegExStruct[];
  /** 仅 C 编译器的 flag（编译 C++ 时移除） */
  cOnlyFlags: string[];
  /** 仅 C++ 编译器的 flag（编译 C 时移除） */
  cppOnlyFlags: string[];
  /** 编译器全局 include 目录（default.conf /compiler_sets/<id>/include_dirs，追加在项目/目标目录之后） */
  includeDirs: string[];
  /** 编译器全局库目录（/library_dirs） */
  libDirs: string[];
  /** 编译器全局资源 include 目录（/res_include_dirs） */
  resIncludeDirs: string[];
  /** 编译器全局链接库（/libraries，供外部依赖检查与 $libs 追加） */
  linkLibs: string[];
  /** 编译器附加搜索路径（default.conf /compiler_sets/<id>/extra_paths，SetupEnvironment PATH 注入 + IsValid 程序搜索） */
  extraPaths: string[];
  /** 编译器全局编译选项（/compiler_options，SetupCompilerOptions:1017 追加在项目/目标之后） */
  compilerOptions: string[];
  /** 编译器全局链接选项（/linker_options，SetupLinkerOptions:1046） */
  linkerOptions: string[];
  /** 编译器全局资源编译选项（/resource_compiler_options，SetupResourceCompilerOptions:1161） */
  resourceCompilerOptions: string[];
}

/** 每个 CommandType 下的命令模板数组（按扩展名匹配） */
export type CommandTypeTemplate = CompilerTool[];

/** GCC 默认命令模板 —— options_gcc.xml <Command>（已按平台拆分，此处取 Linux/通用，Windows 分支见下方） */
export function getDefaultCommands(): CommandTypeTemplate[] {
  const t: CommandTypeTemplate[] = [];
  t[CommandType.CompileObjectCmd] = [
    { command: '$compiler $options $includes -c $file -o $object', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.GenDependenciesCmd] = [
    { command: '$compiler -MM $options -MF $dep_object -MT $object $includes $file', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.CompileResourceCmd] = [
    { command: '$rescomp $res_includes $res_options -J rc -O coff -i $file -o $resource_output', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.LinkConsoleExeCmd] = [
    { command: '$linker $libdirs -o $exe_output $link_objects $link_resobjects $link_options $libs', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.LinkExeCmd] = [
    { command: '$linker $libdirs -o $exe_output $link_objects $link_resobjects $link_options $libs -mwindows', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.LinkDynamicCmd] = [
    { command: '$linker -shared -Wl,--output-def=$def_output -Wl,--out-implib=$static_output -Wl,--dll $libdirs $link_objects $link_resobjects -o $exe_output $link_options $libs', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.LinkStaticCmd] = [
    { command: '$lib_linker -r -s $static_output $link_objects', extensions: [], generatedFiles: [] },
  ];
  t[CommandType.LinkNativeCmd] = [
    { command: '$linker $libdirs -o $exe_output $link_objects $link_resobjects $link_options $libs', extensions: [], generatedFiles: [] },
  ];
  return t;
}

/** GCC 默认开关 —— options_gcc.xml <Switch> */
export function getDefaultSwitches(): CompilerSwitches {
  return {
    includeDirs: '-I',
    libDirs: '-L',
    linkLibs: '-l',
    defines: '-D',
    genericSwitch: '-',
    objectExtension: 'o',
    forceFwdSlashes: false,
    forceLinkerUseQuotes: false,
    forceCompilerUseQuotes: false,
    needDependencies: true,
    libPrefix: 'lib',
    libExtension: 'a',
    linkerNeedsLibPrefix: false,
    linkerNeedsLibExtension: false,
    linkerNeedsPathResolved: false,
    supportsPCH: true,
    PCHExtension: 'gch',
    useFlatObjects: false,
    useFullSourcePaths: true,
    use83Paths: false,
    includeDirSeparator: ' ',
    libDirSeparator: ' ',
    objectSeparator: ' ',
    statusSuccess: 0,
  };
}

/** GCC 默认程序 —— options_gcc.xml <Program>（linux 分支；windows 分支加 .exe） */
export function getDefaultPrograms(platform: NodeJS.Platform): CompilerPrograms {
  const win = platform === 'win32';
  return {
    C: win ? 'gcc.exe' : 'gcc',
    CPP: win ? 'g++.exe' : 'g++',
    LD: win ? 'g++.exe' : 'g++',
    LIB: win ? 'ar.exe' : 'ar',
    WINDRES: win ? 'windres.exe' : '',
    MAKE: win ? 'mingw32-make.exe' : 'make',
    DBGconfig: 'gdb_debugger:Default',
  };
}

/** 创建一个 GCC 编译器实例 */
export function createGccCompiler(platform: NodeJS.Platform, masterPath = ''): Compiler {
  return {
    id: 'gcc',
    name: 'GNU GCC Compiler',
    masterPath,
    programs: getDefaultPrograms(platform),
    switches: getDefaultSwitches(),
    commands: getDefaultCommands(),
    options: [],
    regexes: [],
    cOnlyFlags: [],
    cppOnlyFlags: [],
    includeDirs: [],
    libDirs: [],
    resIncludeDirs: [],
    linkLibs: [],
    extraPaths: [],
    compilerOptions: [],
    linkerOptions: [],
    resourceCompilerOptions: [],
  };
}
