/**
 * Agent 控制层的公共类型与字段白名单（无 vscode 依赖）。
 *
 * 只允许修改白名单字段：拼错字段名 / 越权字段会明确报错，而不是静默忽略——
 * agent 最危险的失败模式是「以为改了，其实没改」。
 */

/** 错误码（三端一致：LM Tool / MCP / CLI 退出码映射见 cli） */
export type ControlErrorCode =
  | 'invalid-input'
  | 'usage'
  | 'project-not-found'
  | 'workspace-not-found'
  | 'not-open'
  | 'external-modified'
  | 'build-busy'
  | 'build-failed'
  | 'compiler-missing'
  | 'unsupported'
  | 'timeout'
  | 'not-running'
  | 'disabled'
  | 'read-only'
  | 'io-error';

export interface ControlErrorShape {
  code: ControlErrorCode;
  message: string;
  details?: unknown;
}

/** 控制层异常（携带稳定错误码，便于三端映射） */
export class ControlError extends Error {
  readonly code: ControlErrorCode;
  readonly details: unknown;

  constructor(code: ControlErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ControlError';
    this.code = code;
    this.details = details;
  }
}

/** 抛出控制层错误（never 返回，便于在表达式中使用） */
export function fail(code: ControlErrorCode, message: string, details?: unknown): never {
  throw new ControlError(code, message, details);
}

/** 把任意异常归一化为控制层错误 */
export function asControlError(err: unknown): ControlError {
  if (err instanceof ControlError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ControlError('io-error', message);
}

// ———— 编辑操作 ————

/** 字段类型（用于校验与 schema 输出） */
export type FieldKind = 'string' | 'number' | 'boolean' | 'string[]' | 'json';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** 数值枚举（如 targetType / pchMode） */
  values?: number[];
  min?: number;
  max?: number;
  /** 需要 allowScripts 才能修改（构建脚本 / pre-post 命令 / 自定义构建命令） */
  requiresScripts?: boolean;
  description: string;
}

export type EditScope = 'project' | 'target' | 'file' | 'virtualTarget';

export interface FieldEdit {
  op: 'set' | 'add' | 'remove';
  scope: EditScope;
  /** target 作用域：目标标题；virtualTarget 作用域：别名 */
  target?: string;
  /** file 作用域：相对项目根的路径（`/` 分隔） */
  file?: string;
  field: string;
  value?: unknown;
}

export interface AddTargetEdit {
  op: 'addTarget';
  title: string;
  /** 从已有目标复制全部设置（标题除外） */
  copyFrom?: string;
  targetType?: number;
}

export interface RemoveTargetEdit {
  op: 'removeTarget';
  title: string;
}

export interface RenameTargetEdit {
  op: 'renameTarget';
  title: string;
  to: string;
}

export interface AddFileEdit {
  op: 'addFile';
  file: string;
  targets?: string[];
  compile?: boolean;
  link?: boolean;
  virtualFolder?: string;
  weight?: number;
}

export interface RemoveFileEdit {
  op: 'removeFile';
  file: string;
}

export interface RenameFileEdit {
  op: 'renameFile';
  file: string;
  to: string;
}

export interface AddVirtualTargetEdit {
  op: 'addVirtualTarget';
  alias: string;
  targets: string[];
}

export interface RemoveVirtualTargetEdit {
  op: 'removeVirtualTarget';
  alias: string;
}

export type EditOp =
  | FieldEdit
  | AddTargetEdit
  | RemoveTargetEdit
  | RenameTargetEdit
  | AddFileEdit
  | RemoveFileEdit
  | RenameFileEdit
  | AddVirtualTargetEdit
  | RemoveVirtualTargetEdit;

export interface EditChange {
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface EditOutcome {
  changed: EditChange[];
  warnings: string[];
}

/** 写盘格式：canonical = 规范化整体重写；preserve = 仅定点改写（不支持时自动降级） */
export type WriteFormat = 'canonical' | 'preserve';

// ———— 字段白名单 ————

const PROJECT_FIELDS: FieldSpec[] = [
  { name: 'title', kind: 'string', description: 'Project title' },
  { name: 'compilerId', kind: 'string', description: 'Default compiler id (e.g. gcc)' },
  { name: 'platforms', kind: 'number', min: 0, max: 255, description: 'Platform bitmask (0xff = all)' },
  { name: 'pchMode', kind: 'number', values: [0, 1, 2], description: 'PCH mode: 0 source dir, 1 object dir, 2 source file' },
  { name: 'extendedObjNames', kind: 'boolean', description: 'foo.c -> foo.c.o object naming' },
  { name: 'makefileIsCustom', kind: 'boolean', description: 'Build through a custom makefile' },
  { name: 'makefile', kind: 'string', description: 'Makefile name (default Makefile)' },
  { name: 'executionDir', kind: 'string', description: 'Makefile execution directory (empty = project root)' },
  { name: 'notes', kind: 'string', description: 'Project notes' },
  { name: 'showNotesOnLoad', kind: 'boolean', description: 'Show notes when the project loads' },
  { name: 'alwaysRunPostBuildSteps', kind: 'boolean', description: 'Run post-build steps even without build commands' },
  { name: 'virtualFolders', kind: 'string[]', description: 'Virtual folder list' },
  { name: 'compilerOptions', kind: 'string[]', description: 'Project-level compiler options' },
  { name: 'linkerOptions', kind: 'string[]', description: 'Project-level linker options' },
  { name: 'resourceCompilerOptions', kind: 'string[]', description: 'Project-level resource compiler options' },
  { name: 'includeDirs', kind: 'string[]', description: 'Project-level include directories' },
  { name: 'libDirs', kind: 'string[]', description: 'Project-level library directories' },
  { name: 'resourceIncludeDirs', kind: 'string[]', description: 'Project-level resource include directories' },
  { name: 'linkLibs', kind: 'string[]', description: 'Project-level linked libraries' },
  { name: 'customVariables', kind: 'json', description: 'Custom build variables {name: value}' },
  { name: 'envVars', kind: 'json', description: 'Environment variables [{name, value}]' },
  { name: 'makeCommands', kind: 'json', requiresScripts: true, description: 'Make command templates {build, clean, distClean, askRebuildNeeded, silentBuild, compileFile}' },
  { name: 'commandsBeforeBuild', kind: 'string[]', requiresScripts: true, description: 'Pre-build commands' },
  { name: 'commandsAfterBuild', kind: 'string[]', requiresScripts: true, description: 'Post-build commands' },
  { name: 'buildScripts', kind: 'string[]', requiresScripts: true, description: 'Build script files' },
];

const TARGET_FIELDS: FieldSpec[] = [
  { name: 'targetType', kind: 'number', values: [0, 1, 2, 3, 4, 5], description: '0 exe, 1 console, 2 static lib, 3 dynamic lib, 4 commands only, 5 native' },
  { name: 'outputFilename', kind: 'string', description: 'Output file name' },
  { name: 'objectOutput', kind: 'string', description: 'Object file directory' },
  { name: 'compilerId', kind: 'string', description: 'Target compiler id' },
  { name: 'executionParameters', kind: 'string', description: 'Run/Debug arguments' },
  { name: 'workingDir', kind: 'string', description: 'Run working directory (empty = output directory)' },
  { name: 'depsOutput', kind: 'string', description: 'Dependency output directory' },
  { name: 'platforms', kind: 'number', min: 0, max: 255, description: 'Target platform bitmask' },
  { name: 'hostApplication', kind: 'string', description: 'Host application for library targets' },
  { name: 'runHostApplicationInTerminal', kind: 'boolean', description: 'Run host application in a terminal' },
  { name: 'useConsoleRunner', kind: 'boolean', description: 'Use the console runner' },
  { name: 'impLib', kind: 'string', description: 'Import library name (dynamic lib)' },
  { name: 'defFile', kind: 'string', description: 'DEF file name' },
  { name: 'createDefFile', kind: 'boolean', description: 'Generate a DEF file' },
  { name: 'createStaticLib', kind: 'boolean', description: 'Generate an import static library' },
  { name: 'prefixAuto', kind: 'boolean', description: 'Automatic library prefix' },
  { name: 'extensionAuto', kind: 'boolean', description: 'Automatic library extension' },
  { name: 'externalDeps', kind: 'string[]', description: 'External dependencies (force relink)' },
  { name: 'additionalOutput', kind: 'string[]', description: 'Additional output files' },
  { name: 'compilerOptions', kind: 'string[]', description: 'Target compiler options' },
  { name: 'linkerOptions', kind: 'string[]', description: 'Target linker options' },
  { name: 'includeDirs', kind: 'string[]', description: 'Target include directories' },
  { name: 'libDirs', kind: 'string[]', description: 'Target library directories' },
  { name: 'resourceIncludeDirs', kind: 'string[]', description: 'Target resource include directories' },
  { name: 'linkLibs', kind: 'string[]', description: 'Target linked libraries' },
  { name: 'envVars', kind: 'json', description: 'Target environment variables [{name, value}]' },
  { name: 'optionRelations', kind: 'json', description: 'Option relation map {0..4: 0..3}' },
  { name: 'linkerExecutable', kind: 'number', values: [0, 1, 2, 3], description: 'Linker executable: 0 auto, 1 CC, 2 CPP, 3 LD' },
  { name: 'includeInTargetAll', kind: 'boolean', description: 'Include this target in the virtual All target' },
  { name: 'alwaysRunPostBuildSteps', kind: 'boolean', description: 'Run post-build steps even without build commands' },
  { name: 'makeCommands', kind: 'json', requiresScripts: true, description: 'Target make command templates' },
  { name: 'commandsBeforeBuild', kind: 'string[]', requiresScripts: true, description: 'Target pre-build commands' },
  { name: 'commandsAfterBuild', kind: 'string[]', requiresScripts: true, description: 'Target post-build commands' },
  { name: 'commandsBeforeClean', kind: 'string[]', requiresScripts: true, description: 'Target pre-clean commands' },
  { name: 'commandsAfterClean', kind: 'string[]', requiresScripts: true, description: 'Target post-clean commands' },
  { name: 'buildScripts', kind: 'string[]', requiresScripts: true, description: 'Target build scripts' },
];

const FILE_FIELDS: FieldSpec[] = [
  { name: 'compilerVar', kind: 'string', description: 'Compiler variable: CPP / CC / WINDRES (empty = auto)' },
  { name: 'compile', kind: 'boolean', description: 'Compile this file' },
  { name: 'link', kind: 'boolean', description: 'Link this file' },
  { name: 'buildTargets', kind: 'string[]', description: 'Targets this file belongs to' },
  { name: 'weight', kind: 'number', min: 0, max: 100, description: 'Compile weight (0-100, lower first)' },
  { name: 'virtualFolder', kind: 'string', description: 'Virtual folder (empty = root)' },
  { name: 'customBuildCommands', kind: 'json', requiresScripts: true, description: 'Per-compiler custom build commands {compilerId: {command, use}}' },
];

/** 按 scope 取字段白名单 */
export function fieldSpecs(scope: EditScope): FieldSpec[] {
  switch (scope) {
    case 'project': return PROJECT_FIELDS;
    case 'target': return TARGET_FIELDS;
    case 'file': return FILE_FIELDS;
    case 'virtualTarget': return [{ name: 'targets', kind: 'string[]', description: 'Physical targets included in this virtual target' }];
  }
}
