/**
 * 工程导入（C5）—— Dev-C++（.dev，INI 与 XML 两代格式）/ VC6（.dsp）/ VS2010+（.vcxproj）→ Project 模型。
 *
 * 对齐 Code::Blocks projectsimporter 的对应载入器（devcpploader / msvcloader / msvc10loader）：
 * - .dev INI：/Project 键（Name/Compiler/CppCompiler/Linker/Includes/Libs/Type）+ [Unit<n>] FileName；
 * - .dev XML：<DEVPROJECT>（NAME/TYPE/UNITS/INCLUDEPATHS/LIBPATHS/CFLAGS/CXXFLAGS/LIBS）；
 * - .dsp：# TARGTYPE / SOURCE= / # ADD CPP（/I /D /O2 /Zi）/ # ADD LINK32（*.lib、/subsystem）；
 * - .vcxproj：ProjectName/ConfigurationType/ClCompile/ClInclude/AdditionalIncludeDirectories/
 *   AdditionalDependencies/SubSystem/LanguageStandard/Optimization。
 *
 * MSVC 风格选项做近似 GCC 转换（/O2→-O2、/D→-D、/subsystem:windows→-mwindows 等），导入后可按需微调。
 * 纯逻辑（无 vscode 依赖），供 extension.ts 命令与回归测试共用。
 */
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { Project, ProjectFile, TargetType } from '../model/types';
import { makeFile, makeTarget } from './newProject';

export interface ImportedProject {
  title: string;
  targetType: TargetType;
  /** 源文件（原格式记录形式；反斜杠已归一） */
  files: string[];
  includeDirs: string[];
  libDirs: string[];
  /** 链接库（已去掉 -l / .lib 前缀） */
  linkLibs: string[];
  /** 已近似转换为 GCC 风格 */
  compilerOptions: string[];
  linkerOptions: string[];
  /** 输出文件名（源工程显式指定时；否则缺省 bin/Debug/<title>） */
  outputName?: string;
}

function asArr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Dev-C++ / CB 的目标类型编号（ttExecutable=0 / ttConsoleOnly=1 / ttStaticLib=2 / ttDynamicLib=3） */
function targetTypeFromNumber(v: unknown): TargetType {
  switch (Number(v)) {
    case 1: return TargetType.ConsoleOnly;
    case 2: return TargetType.StaticLib;
    case 3: return TargetType.DynamicLib;
    default: return TargetType.Executable;
  }
}

function dedup(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const s = it.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ---------------- .dev（INI 格式，Dev-C++ 4） ----------------

function parseIni(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      current = sec[1].trim().toLowerCase();
      sections[current] = sections[current] ?? {};
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (!kv || !current) continue;
    sections[current][kv[1].trim().toLowerCase()] = kv[2].trim();
  }
  return sections;
}

function importDevIni(text: string, fallbackTitle: string): ImportedProject {
  const sections = parseIni(text);
  const proj = sections['project'] ?? {};
  const splitA = (v: string | undefined): string[] => (v ? v.split('_@@_').map((s) => s.trim()).filter(Boolean) : []);

  const title = proj['name']?.trim() || fallbackTitle;
  const targetType = targetTypeFromNumber(proj['type'] ?? 0);

  const files: string[] = [];
  const unitCount = Number(proj['unitcount'] ?? 0) || 0;
  for (let i = 1; i <= unitCount; i++) {
    const unit = sections[`unit${i}`];
    const fn = unit?.['filename']?.trim();
    if (fn) files.push(toUnix(fn).replace(/^\.\//, ''));
  }

  const includeDirs = (proj['includes'] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const libDirs = (proj['libs'] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const compilerOptions = [...splitA(proj['compiler']), ...splitA(proj['cppcompiler'])];

  const linkTokens = splitA(proj['linker']).flatMap((t) => t.split(/\s+/));
  const linkLibs: string[] = [];
  const linkerOptions: string[] = [];
  for (const t of linkTokens) {
    if (t.startsWith('-l')) linkLibs.push(t.slice(2));
    else if (t) linkerOptions.push(t);
  }

  let outputName: string | undefined;
  if ((proj['overrideoutput'] ?? '0') === '1' && proj['overrideoutputname']) {
    outputName = toUnix(proj['overrideoutputname']);
  }

  return { title, targetType, files, includeDirs, libDirs, linkLibs, compilerOptions, linkerOptions, outputName };
}

// ---------------- .dev（XML 格式，Dev-C++ 5） ----------------

function importDevXml(text: string, fallbackTitle: string): ImportedProject {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'FILE',
  });
  const doc = parser.parse(text);
  const rootKey = Object.keys(doc).find((k) => k.toLowerCase() === 'devproject');
  const root = rootKey ? doc[rootKey] : {};
  const getNode = (name: string): any => {
    const key = Object.keys(root).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? root[key] : undefined;
  };
  const getValue = (name: string): string => {
    const node = getNode(name);
    if (node === undefined || node === null) return '';
    if (typeof node === 'object') return String(node['@_value'] ?? '');
    return String(node);
  };
  const fileValues = (name: string): string[] =>
    asArr<any>(getNode(name)?.FILE)
      .map((f: any) => String(f?.['@_value'] ?? f ?? '').trim())
      .filter(Boolean);

  const title = getValue('NAME').trim() || fallbackTitle;
  const targetType = targetTypeFromNumber(getValue('TYPE') || 0);

  const files = [...fileValues('UNITS'), ...fileValues('FILES')].map((f) => toUnix(f).replace(/^\.\//, ''));
  const includeDirs = dedup([
    ...fileValues('INCLUDEPATHS'),
    ...fileValues('INCLUDES').filter((v) => !v.startsWith('-')),
  ]);
  const libDirs = fileValues('LIBPATHS');
  const linkLibs = fileValues('LIBS').map((v) => (v.startsWith('-l') ? v.slice(2) : v));
  const cFlags = [...fileValues('CFLAGS'), ...fileValues('CXXFLAGS')];
  const linkerOptions = fileValues('LFLAGS').filter((v) => !v.startsWith('-l'));

  return { title, targetType, files, includeDirs, libDirs, linkLibs, compilerOptions: dedup(cFlags), linkerOptions };
}

/** 按内容自动识别 INI / XML 两代 .dev 格式 */
export function importDevProject(text: string, fallbackTitle: string): ImportedProject {
  return text.trimStart().startsWith('<') ? importDevXml(text, fallbackTitle) : importDevIni(text, fallbackTitle);
}

// ---------------- .dsp（VC6） ----------------

export function importDspProject(text: string, fallbackTitle: string): ImportedProject {
  const title = (text.match(/^# Microsoft Developer Studio Project File - Name="([^"]*)"/m) ?? [])[1]?.trim() || fallbackTitle;
  const targtype = (text.match(/# TARGTYPE\s+"([^"]*)"/) ?? [])[1] ?? '';
  const targetType = targtype.includes('Console')
    ? TargetType.ConsoleOnly
    : targtype.includes('Dynamic-Link')
      ? TargetType.DynamicLib
      : targtype.includes('Static')
        ? TargetType.StaticLib
        : targtype
          ? TargetType.Executable
          : TargetType.ConsoleOnly;

  const files: string[] = [];
  for (const m of text.matchAll(/^SOURCE=(.+)$/gm)) {
    files.push(toUnix(m[1].trim()).replace(/^\.\//, ''));
  }

  const includeDirs: string[] = [];
  const defines: string[] = [];
  let opt: string | undefined;
  let debugInfo = false;
  for (const m of text.matchAll(/^# ADD (?:BASE )?CPP (.+)$/gm)) {
    const line = m[1];
    for (const d of line.matchAll(/\/I\s*"([^"]+)"|\/I\s*(\S+)/g)) {
      const dir = (d[1] ?? d[2] ?? '').trim();
      if (dir) includeDirs.push(toUnix(dir).replace(/^\.\//, ''));
    }
    for (const d of line.matchAll(/\/D\s*"([^"]+)"|\/D\s*(\S+)/g)) {
      const def = (d[1] ?? d[2] ?? '').trim();
      if (def) defines.push('-D' + def.replace(/=.*$/, (eq) => eq));
    }
    if (/\/O2\b|\/O1\b/.test(line)) opt = '-O2';
    if (/\/Zi\b|\/ZI\b/.test(line)) debugInfo = true;
  }
  if (!opt && /\/Od\b/.test(text)) opt = '-O0';

  const linkLibs: string[] = [];
  const linkerOptions: string[] = [];
  let outputName: string | undefined;
  for (const m of text.matchAll(/^# ADD (?:BASE )?LINK32 (.+)$/gm)) {
    for (const tok of m[1].match(/"([^"]*)"|(\S+)/g) ?? []) {
      const t = tok.replace(/^"|"$/g, '');
      if (/\.lib$/i.test(t)) linkLibs.push(t.replace(/\.lib$/i, ''));
      else if (/^\/subsystem:windows/i.test(t)) linkerOptions.push('-mwindows');
      else if (/^\/out:/i.test(t)) outputName = toUnix(t.slice(5).replace(/^"|"$/g, ''));
    }
  }

  const compilerOptions = dedup([...(opt ? [opt] : []), ...(debugInfo ? ['-g'] : []), ...defines]);
  return {
    title, targetType, files, includeDirs: dedup(includeDirs), libDirs: [],
    linkLibs: dedup(linkLibs), compilerOptions, linkerOptions: dedup(linkerOptions), outputName,
  };
}

// ---------------- .vcxproj（VS2010+） ----------------

export function importVcxproj(text: string, fallbackTitle: string): ImportedProject {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => [
      'PropertyGroup', 'ItemGroup', 'ItemDefinitionGroup',
      'ClCompile', 'ClInclude', 'ResourceCompile',
    ].includes(name),
  });
  const doc = parser.parse(text);
  const proj = (Object.keys(doc).find((k) => k.toLowerCase() === 'project') ? doc[Object.keys(doc).find((k) => k.toLowerCase() === 'project') as string] : {}) as any;

  const textOf = (v: any): string => (typeof v === 'string' ? v : String(v?.['#text'] ?? v?.['@_value'] ?? ''));

  let title = '';
  let configType = '';
  for (const pg of asArr<any>(proj.PropertyGroup)) {
    title = title || textOf(pg.ProjectName).trim() || textOf(pg.RootNamespace).trim();
    configType = configType || textOf(pg.ConfigurationType).trim();
  }

  const files: string[] = [];
  for (const ig of asArr<any>(proj.ItemGroup)) {
    for (const key of ['ClCompile', 'ClInclude', 'ResourceCompile']) {
      for (const item of asArr<any>(ig[key])) {
        const inc = String(item?.['@_Include'] ?? '').trim();
        if (inc) files.push(toUnix(inc).replace(/^\.\//, ''));
      }
    }
  }

  const includeDirs: string[] = [];
  const libDirs: string[] = [];
  const linkLibs: string[] = [];
  const defines: string[] = [];
  let std: string | undefined;
  let opt: string | undefined;
  let subsystem = '';
  for (const idef of asArr<any>(proj.ItemDefinitionGroup)) {
    for (const comp of asArr<any>(idef.ClCompile)) {
      for (const v of textOf(comp.AdditionalIncludeDirectories).split(';')) {
        const d = v.replace(/%\([^)]*\)/g, '').replace(/\$\([^)]*\)/g, '').trim();
        if (d) includeDirs.push(toUnix(d));
      }
      for (const v of textOf(comp.PreprocessorDefinitions).split(';')) {
        const d = v.replace(/%\([^)]*\)/g, '').trim();
        if (d) defines.push('-D' + d);
      }
      const ls = textOf(comp.LanguageStandard).trim().toLowerCase();
      if (ls === 'stdcpp14') std = '-std=c++14';
      else if (ls === 'stdcpp17') std = '-std=c++17';
      else if (ls === 'stdcpp20') std = '-std=c++20';
      else if (ls === 'stdcpplatest') std = '-std=c++2b';
      const o = textOf(comp.Optimization).trim();
      if (o === 'MaxSpeed') opt = '-O2';
      else if (o === 'MinSpace') opt = '-Os';
      else if (o === 'Full') opt = '-O3';
      else if (o === 'Disabled') opt = '-O0';
    }
    for (const link of asArr<any>(idef.Link)) {
      for (const v of textOf(link.AdditionalLibraryDirectories).split(';')) {
        const d = v.replace(/%\([^)]*\)/g, '').replace(/\$\([^)]*\)/g, '').trim();
        if (d) libDirs.push(toUnix(d));
      }
      for (const v of textOf(link.AdditionalDependencies).split(';')) {
        const d = v.replace(/%\([^)]*\)/g, '').trim();
        if (d) linkLibs.push(d.replace(/\.lib$/i, ''));
      }
      subsystem = subsystem || textOf(link.SubSystem).trim();
    }
  }

  const targetType =
    configType === 'DynamicLibrary' ? TargetType.DynamicLib
      : configType === 'StaticLibrary' ? TargetType.StaticLib
        : configType === 'Utility' ? TargetType.CommandsOnly
          : subsystem.toLowerCase() === 'console' ? TargetType.ConsoleOnly
            : configType === 'Application' ? TargetType.Executable
              : TargetType.ConsoleOnly;

  const compilerOptions = dedup([...(std ? [std] : []), ...(opt ? [opt] : []), ...defines]);
  return {
    title: title || fallbackTitle, targetType, files, includeDirs: dedup(includeDirs),
    libDirs: dedup(libDirs), linkLibs: dedup(linkLibs), compilerOptions, linkerOptions: [],
  };
}

// ---------------- 构造 Project 模型 ----------------

/**
 * 由解析结果构造 Project 模型（不落盘；.cbp 写到源文件同目录）。
 * 文件路径：绝对路径转为相对源文件目录；位于工程目录外的文件跳过并计入 skipped。
 */
export function buildProjectFromImport(
  srcFile: string,
  imp: ImportedProject,
  compilerId = 'gcc',
): { project: Project; cbpPath: string; skipped: string[] } {
  const basePath = path.dirname(srcFile);
  const title = (imp.title || path.basename(srcFile, path.extname(srcFile))).trim() || 'imported';
  const targetTitles = ['Debug'];
  const target = makeTarget(title, 'Debug', imp.targetType, ['-g', '-Wall', ...dedup(imp.compilerOptions)], compilerId);
  target.includeDirs = dedup(imp.includeDirs);
  target.libDirs = dedup(imp.libDirs);
  target.linkLibs = dedup(imp.linkLibs);
  target.linkerOptions = dedup(imp.linkerOptions);
  target.outputFilename = imp.outputName || `bin/Debug/${title}`;

  const skipped: string[] = [];
  const files: ProjectFile[] = [];
  for (const f of imp.files) {
    let rel = toUnix(f).replace(/^\.\//, '');
    if (path.isAbsolute(f)) {
      const relNative = path.relative(basePath, f);
      if (relNative.startsWith('..')) {
        skipped.push(f);
        continue;
      }
      rel = toUnix(relNative);
    }
    if (!rel || files.some((x) => x.relativeFilename === rel)) continue;
    files.push(makeFile(basePath, rel, targetTitles));
  }

  const cbpPath = path.join(basePath, `${title}.cbp`);
  const project: Project = {
    title,
    basePath,
    commonTopLevelPath: basePath,
    pchMode: 1,
    extendedObjNames: false,
    platforms: 0xff,
    filename: cbpPath,
    compilerId,
    compilerOptions: [],
    linkerOptions: [],
    resourceCompilerOptions: [],
    includeDirs: [],
    libDirs: [],
    resourceIncludeDirs: [],
    linkLibs: [],
    buildTargets: [target],
    virtualTargets: [],
    virtualFolders: [],
    commandsBeforeBuild: [],
    commandsAfterBuild: [],
    buildScripts: [],
    notes: `由 ${path.basename(srcFile)} 导入（Code::Blocks 扩展 C5）`,
    showNotesOnLoad: false,
    envVars: [],
    alwaysRunPostBuildSteps: false,
    makefileIsCustom: false,
    makefile: '',
    executionDir: '',
    makeCommands: {},
    customVariables: {},
    files,
    extensions: null,
  };
  return { project, cbpPath, skipped };
}
