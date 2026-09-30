/**
 * 文件类型判定 —— 对齐 Code::Blocks FileTypeOf (globals.cpp) + FileFilters (filefilters.cpp)。
 *
 * 供 parser（AddFile 默认值）与 writer（SaveUnit 条件写入）复用，
 * 保证 compile / link / compilerVar 的「按文件类型默认值」语义与 Code::Blocks 一致。
 */

/** 源文件扩展名（ftSource，不含点、小写） */
const SOURCE_EXTS = new Set([
  'asm', 'd', 'f', 'f77', 'f90', 'f95', 'for', 'fpp', 'f03', 'f08', 'java',
  'c', 'cc', 'cpp', 'cxx', 'c++', 's', 'ss', 's62',
]);

/** 从文件名提取小写扩展名（不含点；无扩展名或点开头返回空串） */
export function fileExt(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

/** ftSource：源文件（.c/.cpp/.cc/.asm/...） */
export function isSourceFile(filename: string): boolean {
  return SOURCE_EXTS.has(fileExt(filename));
}

/** ftResource：Windows 资源脚本（.rc） */
export function isResourceFile(filename: string): boolean {
  return fileExt(filename) === 'rc';
}

/** ftObject：目标文件（.o） */
export function isObjectFile(filename: string): boolean {
  return fileExt(filename) === 'o';
}

/** ftResourceBin：编译后资源（.res） */
export function isResourceBinFile(filename: string): boolean {
  return fileExt(filename) === 'res';
}

/** ftStaticLib：静态库（.a） */
export function isStaticLibFile(filename: string): boolean {
  return fileExt(filename) === 'a';
}

/** 文件类型 —— globals.h FileType（完整枚举，供 buildEngine 分类） */
export enum FileType {
  Source = 'ftSource',
  TemplateSource = 'ftTemplateSource',
  Header = 'ftHeader',
  Object = 'ftObject',
  XRCResource = 'ftXRCResource',
  Resource = 'ftResource',
  ResourceBin = 'ftResourceBin',
  StaticLib = 'ftStaticLib',
  DynamicLib = 'ftDynamicLib',
  Native = 'ftNative',
  Executable = 'ftExecutable',
  XMLDocument = 'ftXMLDocument',
  Script = 'ftScript',
  Other = 'ftOther',
}

/** FileTypeOf 等价实现（globals.cpp 的扩展名→类型映射） */
export function fileTypeOf(filenameOrPath: string): FileType {
  if (isSourceFile(filenameOrPath)) return FileType.Source;
  const ext = fileExt(filenameOrPath);
  if (ext === 'tpp' || ext === 'tcc') return FileType.TemplateSource;
  if (ext === 'h' || ext === 'hh' || ext === 'hpp' || ext === 'hxx' || ext === 'h++' || ext === 'inl') return FileType.Header;
  if (ext === 'o') return FileType.Object;
  if (ext === 'xrc') return FileType.XRCResource;
  if (ext === 'rc') return FileType.Resource;
  if (ext === 'res') return FileType.ResourceBin;
  if (ext === 'a') return FileType.StaticLib;
  if (ext === 'dll' || ext === 'so' || ext === 'dylib') return FileType.DynamicLib;
  if (ext === 'sys') return FileType.Native;
  if (ext === 'exe') return FileType.Executable;
  if (ext === 'xml') return FileType.XMLDocument;
  if (ext === 'script') return FileType.Script;
  return FileType.Other;
}

/** 是否可编译 —— 对齐 cbProject::AddFile 的 localCompile 默认（源文件/资源文件） */
export function isCompilableFileType(ft: FileType): boolean {
  return ft === FileType.Source || ft === FileType.Resource;
}

/** 是否可链接 —— 对齐 cbProject::AddFile 的 localLink 默认 */
export function isLinkableFileType(ft: FileType): boolean {
  return (
    ft === FileType.Source ||
    ft === FileType.Resource ||
    ft === FileType.Object ||
    ft === FileType.ResourceBin ||
    ft === FileType.StaticLib
  );
}

/** 是否为 C++ 源文件（用于 hasCppFilesToLink / 链接器选择） */
export function isCppSource(filenameOrPath: string): boolean {
  const ext = fileExt(filenameOrPath);
  return ext === 'cc' || ext === 'cpp' || ext === 'cxx' || ext === 'c++';
}

/** 是否为 clangd 可索引的 C/C++ 源文件（汇编/资源/链接脚本不可索引） */
export function isClangdIndexable(filenameOrPath: string): boolean {
  const ext = fileExt(filenameOrPath);
  return ext === 'c' || ext === 'cc' || ext === 'cpp' || ext === 'cxx' || ext === 'c++';
}

/**
 * compile 默认值 —— SaveUnit: f->compile != (ft == ftSource || ft == ftResource)。
 * 源文件 / .rc 默认 true，头文件等默认 false。
 */
export function defaultCompile(filename: string): boolean {
  return isSourceFile(filename) || isResourceFile(filename);
}

/**
 * link 默认值 —— SaveUnit: ftSource || ftResource || ftObject || ftResourceBin || ftStaticLib。
 */
export function defaultLink(filename: string): boolean {
  return isSourceFile(filename)
    || isResourceFile(filename)
    || isObjectFile(filename)
    || isResourceBinFile(filename)
    || isStaticLibFile(filename);
}

/**
 * compilerVar 默认值 —— cbproject.cpp AddFile：
 *   .c → "CC"，Windows .rc → "WINDRES"，其它 → "CPP"。
 */
export function defaultCompilerVar(filename: string): string {
  const ext = fileExt(filename);
  if (ext === 'c') return 'CC';
  if (ext === 'rc' && process.platform === 'win32') return 'WINDRES';
  return 'CPP';
}

/**
 * writer 是否需要写 <Option compilerVar> —— 对齐 SaveUnit 的 if / else if 语义
 * （projectloader.cpp 1816-1826）：
 *   - .c 文件：非 "CC" 才写（但会 fall through 到「非 CPP 也写」，故 .c+CC 实际会写）
 *   - .rc 文件（Windows）：非 "WINDRES" 才写
 *   - 其它：非 "CPP" 才写
 * 精确复刻真值表：只有「非 c/rc 文件 + compilerVar=="CPP"」时不写，其余非空均写。
 */
export function shouldWriteCompilerVar(filename: string, compilerVar: string): boolean {
  if (!compilerVar) return false;
  const ext = fileExt(filename);
  if (compilerVar !== 'CC' && ext === 'c') return true;
  if (compilerVar !== 'WINDRES' && ext === 'rc' && process.platform === 'win32') return true;
  if (compilerVar !== 'CPP') return true;
  return false;
}
