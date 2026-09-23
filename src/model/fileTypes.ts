/**
 * 文件类型判定 —— 对应 Code::Blocks 的 globals.cpp FileTypeOf() 与 filefilters.cpp FileFilters
 *
 * 移植自 codeblocks-src/src/sdk/globals.cpp（LGPL v3）。
 * 纯函数，无 wxWidgets 依赖；用于对齐「哪些文件可编译/可链接」的判定。
 */

/** 文件类型 —— globals.h FileType */
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

/**
 * 取文件扩展名（不含点、小写）。
 * 对齐 FileTypeOf 的 `filename.AfterLast('.')` + `.Lower()`；基于 basename 取扩展名，
 * 避免目录名含点（如 `a.b/foo`）被误判。
 */
export function extensionOf(filenameOrPath: string): string {
  const base = filenameOrPath.replace(/\\/g, '/').split('/').pop() ?? filenameOrPath;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** FileTypeOf 等价实现（globals.cpp 的扩展名→类型映射） */
export function fileTypeOf(filenameOrPath: string): FileType {
  const ext = extensionOf(filenameOrPath);

  // 源文件（ftSource）—— 含 C/C++/汇编/D/Fortran/Java
  if (
    ext === 'asm' || ext === 'c' || ext === 'cc' || ext === 'cpp' || ext === 'cxx' || ext === 'c++' ||
    ext === 's' || ext === 'ss' || ext === 's62' ||
    ext === 'd' ||
    ext === 'f' || ext === 'f77' || ext === 'f90' || ext === 'f95' || ext === 'for' || ext === 'fpp' ||
    ext === 'f03' || ext === 'f08' ||
    ext === 'java'
  ) {
    return FileType.Source;
  }

  if (ext === 'tpp' || ext === 'tcc') return FileType.TemplateSource;

  if (ext === 'h' || ext === 'hh' || ext === 'hpp' || ext === 'hxx' || ext === 'h++' || ext === 'inl') {
    return FileType.Header;
  }

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
  const ext = extensionOf(filenameOrPath);
  return ext === 'cc' || ext === 'cpp' || ext === 'cxx' || ext === 'c++';
}

/** 是否为 clangd 可索引的 C/C++ 源文件（汇编/资源/链接脚本不可索引） */
export function isClangdIndexable(filenameOrPath: string): boolean {
  const ext = extensionOf(filenameOrPath);
  return ext === 'c' || ext === 'cc' || ext === 'cpp' || ext === 'cxx' || ext === 'c++';
}

/** 默认编译变量 —— 对齐 cbProject::AddFile：.c→CC，Windows .rc→WINDRES，其余→CPP */
export function defaultCompilerVar(filenameOrPath: string): string {
  const ext = extensionOf(filenameOrPath);
  if (ext === 'c') return 'CC';
  if (ext === 'rc' && process.platform === 'win32') return 'WINDRES';
  return 'CPP';
}
