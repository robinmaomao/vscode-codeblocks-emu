/**
 * .cbp 序列化器 —— 对应 projectloader.cpp 的 ExportTargetAsProject（写入 .cbp）。
 *
 * 将 Project 模型写回 .cbp XML，严格对齐 Code::Blocks 的元素顺序、属性、缩进与
 * 空节点省略规则。未映射到模型的原生元素（如 <Option check_files> 等）从
 * 原始 XML 节点（rawProject）透传，保证「往返」不丢失。
 */
import { Project, BuildTarget, TargetType, ProjectFile, OptionsRelationType, LinkerExecutableOption, EnvVariable, PLATFORM_ALL } from './types';
import { XMLBuilder } from 'fast-xml-parser';
import { defaultCompile, defaultLink, shouldWriteCompilerVar } from './fileTypes';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 平台位掩码 → CB 字符串（globals.cpp GetStringFromPlatforms）：
 * 低三位全置 → "All"；否则按 Windows;Unix;Mac; 顺序拼接（带尾分号，CB 同）。
 */
export function formatPlatforms(platforms: number): string {
  const all = 0x04 | 0x02 | 0x01;
  if ((platforms & all) === all) return 'All';
  let s = '';
  if (platforms & 0x04) s += 'Windows;';
  if (platforms & 0x02) s += 'Unix;';
  if (platforms & 0x01) s += 'Mac;';
  return s;
}

/** 从 fast-xml-parser 节点提取属性列表（去掉 @_ 前缀） */
function attrs(node: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!node) return out;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@_')) out[k.slice(2)] = String(v);
  }
  return out;
}

/** 把节点列表归一化为数组 */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** 透传项目级 <Option> 中模型未映射的属性（check_files 等；platforms/makefile/pch_mode/execution_dir/extended_obj_names 已显式写出） */
function passthroughProjectOptions(rawProject: unknown): { key: string; value: string }[] {
  const raw = rawProject as any;
  const handled = new Set([
    'title', 'compiler', 'virtualFolders', 'notes', 'show_notes',
    'platforms', 'pch_mode', 'makefile', 'makefile_is_custom', 'execution_dir', 'extended_obj_names',
  ]);
  const out: { key: string; value: string }[] = [];
  for (const o of asArray<any>(raw?.Option)) {
    for (const [key, value] of Object.entries(attrs(o))) {
      if (!handled.has(key)) out.push({ key, value });
    }
  }
  return out;
}

/** 透传目标级 <Option> 中模型未映射的属性（includeInTargetAll 等遗留属性；高字段已显式写出） */
function passthroughTargetOptions(rawProject: unknown, title: string): { key: string; value: string }[] {
  const raw = rawProject as any;
  const handled = new Set([
    'title', 'type', 'compiler', 'parameters', 'output', 'object_output', 'use_console_runner',
    'createDefFile', 'createStaticLib', 'prefix_auto', 'extension_auto', 'imp_lib', 'def_file',
    'external_deps', 'additional_output',
    'platforms', 'working_dir', 'deps_output', 'host_application', 'run_host_application_in_terminal',
    'projectCompilerOptionsRelation', 'projectLinkerOptionsRelation',
    'projectIncludeDirsRelation', 'projectResourceIncludeDirsRelation', 'projectLibDirsRelation',
  ]);
  const targets = asArray<any>(raw?.Build?.Target);
  const orig = targets.find((t) => t?.['@_title'] === title);
  if (!orig) return [];
  const out: { key: string; value: string }[] = [];
  for (const o of asArray<any>(orig.Option)) {
    for (const [key, value] of Object.entries(attrs(o))) {
      if (!handled.has(key)) out.push({ key, value });
    }
  }
  return out;
}

/** 写 <Compiler> 块（空则省略，对齐 CodeBlocks 的 NoChildren → RemoveChild） */
function writeCompiler(L: string[], indent: string, options: string[], dirs: string[]): void {
  if (!options.length && !dirs.length) return;
  L.push(`${indent}<Compiler>`);
  for (const o of options) L.push(`${indent}\t<Add option="${esc(o)}" />`);
  for (const d of dirs) L.push(`${indent}\t<Add directory="${esc(unix(d))}" />`);
  L.push(`${indent}</Compiler>`);
}

function writeResourceCompiler(L: string[], indent: string, options: string[], dirs: string[]): void {
  if (!options.length && !dirs.length) return;
  L.push(`${indent}<ResourceCompiler>`);
  for (const o of options) L.push(`${indent}\t<Add option="${esc(o)}" />`);
  for (const d of dirs) L.push(`${indent}\t<Add directory="${esc(unix(d))}" />`);
  L.push(`${indent}</ResourceCompiler>`);
}

function writeLinker(L: string[], indent: string, options: string[], libs: string[], dirs: string[], linkerExe?: LinkerExecutableOption): void {
  const hasLinkerExe = linkerExe !== undefined && linkerExe !== LinkerExecutableOption.AutoDetect;
  if (!options.length && !libs.length && !dirs.length && !hasLinkerExe) return;
  L.push(`${indent}<Linker>`);
  for (const o of options) L.push(`${indent}\t<Add option="${esc(o)}" />`);
  for (const lib of libs) L.push(`${indent}\t<Add library="${esc(unix(lib))}" />`);
  for (const d of dirs) L.push(`${indent}\t<Add directory="${esc(unix(d))}" />`);
  // <LinkerExe value="CCompiler|CppCompiler|Linker">（SaveLinkerExecutable，非 AutoDetect 才写）
  if (hasLinkerExe) {
    const v = linkerExe === LinkerExecutableOption.CCompiler ? 'CCompiler'
      : linkerExe === LinkerExecutableOption.CppCompiler ? 'CppCompiler' : 'Linker';
    L.push(`${indent}\t<LinkerExe value="${v}" />`);
  }
  L.push(`${indent}</Linker>`);
}

function writeExtraCommands(L: string[], indent: string, before: string[], after: string[], alwaysRun?: boolean): void {
  if (!before.length && !after.length) return;
  L.push(`${indent}<ExtraCommands>`);
  for (const b of before) L.push(`${indent}\t<Add before="${esc(b)}" />`);
  for (const a of after) L.push(`${indent}\t<Add after="${esc(a)}" />`);
  // <Mode after="always">（AlwaysRunPostBuildSteps）
  if (alwaysRun) L.push(`${indent}\t<Mode after="always" />`);
  L.push(`${indent}</ExtraCommands>`);
}

/** 写 <Environment><Variable name value>（SaveEnvironment，按 name 排序） */
function writeEnvironment(L: string[], indent: string, vars: EnvVariable[]): void {
  if (!vars?.length) return;
  const sorted = [...vars].sort((a, b) => a.name.localeCompare(b.name));
  L.push(`${indent}<Environment>`);
  for (const v of sorted) {
    L.push(`${indent}\t<Variable name="${esc(v.name)}" value="${esc(v.value)}" />`);
  }
  L.push(`${indent}</Environment>`);
}

/** 透传 <MakeCommands> 元素（makefile 项目的 make 命令，保留原始 XML） */
function writeMakeCommands(L: string[], node: unknown, indent: string): void {
  if (node === undefined || node === null) return;
  try {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '\t',
      suppressEmptyNode: true,
    });
    const xml = builder.build({ MakeCommands: node });
    for (const line of xml.split('\n')) {
      if (line.trim()) L.push(indent + line);
    }
  } catch {
    // 忽略透传失败
  }
}

/** 从原始项目节点提取目标级 <MakeCommands>（按目标标题匹配） */
function targetMakeCommands(rawProject: unknown, title: string): unknown {
  const raw = rawProject as any;
  const targets = asArray<any>(raw?.Build?.Target);
  const orig = targets.find((t) => t?.['@_title'] === title);
  return orig?.MakeCommands;
}

/** 写目标的关系属性（默认 3 省略） */
function writeRelations(L: string[], indent: string, t: BuildTarget): void {
  const rels: [OptionsRelationType, string][] = [
    [OptionsRelationType.CompilerOptions, 'projectCompilerOptionsRelation'],
    [OptionsRelationType.LinkerOptions, 'projectLinkerOptionsRelation'],
    [OptionsRelationType.IncludeDirs, 'projectIncludeDirsRelation'],
    [OptionsRelationType.ResDirs, 'projectResourceIncludeDirsRelation'],
    [OptionsRelationType.LibDirs, 'projectLibDirsRelation'],
  ];
  for (const [type, key] of rels) {
    const v = t.optionRelations[type];
    if (v !== 3) L.push(`${indent}<Option ${key}="${v}" />`);
  }
}

function writeTarget(L: string[], t: BuildTarget, rawProject: unknown): void {
  L.push(`\t\t\t<Target title="${esc(t.title)}">`);
  // 透传目标级未映射 Option
  for (const { key, value } of passthroughTargetOptions(rawProject, t.title)) {
    L.push(`\t\t\t\t<Option ${key}="${esc(value)}" />`);
  }
  const impLibAttr = t.impLib ? ` imp_lib="${esc(unix(t.impLib))}"` : '';
  const defFileAttr = t.defFile ? ` def_file="${esc(unix(t.defFile))}"` : '';
  L.push(`\t\t\t\t<Option output="${esc(unix(t.outputFilename))}" prefix_auto="${t.prefixAuto ? 1 : 0}" extension_auto="${t.extensionAuto ? 1 : 0}"${impLibAttr}${defFileAttr} />`);
  // R6：工作目录 / deps 目录（对齐 CB ExportTargetAsProject：working_dir != '.'、deps_output != '.deps' 才写）
  if (t.workingDir && t.workingDir !== '.') {
    L.push(`\t\t\t\t<Option working_dir="${esc(unix(t.workingDir))}" />`);
  }
  if (t.depsOutput && t.depsOutput !== '.deps') {
    L.push(`\t\t\t\t<Option deps_output="${esc(unix(t.depsOutput))}" />`);
  }
  // R6：目标平台过滤（!= spAll 才写，对齐 CB）
  if (t.platforms !== PLATFORM_ALL) {
    L.push(`\t\t\t\t<Option platforms="${esc(formatPlatforms(t.platforms))}" />`);
  }
  if (t.objectOutput && t.objectOutput !== '.objs') {
    L.push(`\t\t\t\t<Option object_output="${esc(unix(t.objectOutput))}" />`);
  }
  L.push(`\t\t\t\t<Option type="${t.targetType}" />`);
  L.push(`\t\t\t\t<Option compiler="${esc(t.compilerId)}" />`);
  // 执行参数（<Option parameters>，对齐 SaveTargetOptions；非空才写）
  if (t.executionParameters) {
    L.push(`\t\t\t\t<Option parameters="${esc(t.executionParameters)}" />`);
  }
  // R6：宿主程序（库/CommandsOnly 目标 Run 用；对齐 CB：host_application 非空才写，且随写终端开关）
  if (t.hostApplication) {
    L.push(`\t\t\t\t<Option host_application="${esc(unix(t.hostApplication))}" />`);
    L.push(`\t\t\t\t<Option run_host_application_in_terminal="${t.runHostApplicationInTerminal ? 1 : 0}" />`);
  }
  if (t.targetType === TargetType.ConsoleOnly && !t.useConsoleRunner) {
    L.push('\t\t\t\t<Option use_console_runner="0" />');
  }
  if ((t.targetType === TargetType.StaticLib || t.targetType === TargetType.DynamicLib) && t.createDefFile) {
    L.push('\t\t\t\t<Option createDefFile="1" />');
  }
  if (t.targetType === TargetType.DynamicLib && t.createStaticLib) {
    L.push('\t\t\t\t<Option createStaticLib="1" />');
  }
  // 外部依赖 / 附加输出（C2：分号列表、Unix 路径；非空才写；未编辑时模型值来自解析，与原始一致）
  if (t.externalDeps?.length) {
    L.push(`\t\t\t\t<Option external_deps="${esc(t.externalDeps.map((d) => unix(d)).join(';'))}" />`);
  }
  if (t.additionalOutput?.length) {
    L.push(`\t\t\t\t<Option additional_output="${esc(t.additionalOutput.map((d) => unix(d)).join(';'))}" />`);
  }
  writeRelations(L, '\t\t\t\t', t);
  // 目标级构建脚本（对齐 SaveUnit：Script 在 Compiler 之前）
  for (const s of t.buildScripts ?? []) {
    L.push(`\t\t\t\t<Script file="${esc(unix(s))}" />`);
  }
  writeCompiler(L, '\t\t\t\t', t.compilerOptions, t.includeDirs);
  writeResourceCompiler(L, '\t\t\t\t', t.resourceCompilerOptions, t.resourceIncludeDirs);
  writeLinker(L, '\t\t\t\t', t.linkerOptions, t.linkLibs, t.libDirs, t.linkerExecutable);
  writeExtraCommands(L, '\t\t\t\t', t.commandsBeforeBuild, t.commandsAfterBuild, t.alwaysRunPostBuildSteps);
  writeEnvironment(L, '\t\t\t\t', t.envVars);
  writeMakeCommands(L, targetMakeCommands(rawProject, t.title), '\t\t\t\t');
  L.push('\t\t\t</Target>');
}

function writeUnit(L: string[], f: ProjectFile, totalTargets: number): void {
  const opts: string[] = [];
  // compilerVar：对齐 SaveUnit 的按扩展名默认值条件（.c→CC、Win .rc→WINDRES、其它→CPP）
  if (shouldWriteCompilerVar(f.relativeFilename, f.compilerVar)) {
    opts.push(`compilerVar="${esc(f.compilerVar)}"`);
  }
  // compile/link：对齐 SaveUnit 的「不等于该文件类型默认值才写」
  if (f.compile !== defaultCompile(f.relativeFilename)) {
    opts.push(`compile="${f.compile ? '1' : '0'}"`);
  }
  if (f.link !== defaultLink(f.relativeFilename)) {
    opts.push(`link="${f.link ? '1' : '0'}"`);
  }
  if (f.weight !== 50) opts.push(`weight="${f.weight}"`);
  if (f.virtualFolder) opts.push(`virtualFolder="${esc(unix(f.virtualFolder))}"`);
  for (const [compiler, c] of Object.entries(f.customBuildCommands)) {
    if (!c || !c.command) continue;
    opts.push(`compiler="${esc(compiler)}" use="${c.use ? '1' : '0'}" buildCommand="${esc(c.command.replace(/\n/g, '\\n'))}"`);
  }
  // 文件目标数 != 项目目标数 时才写 target（数量相等 = 默认属于所有目标）
  if (f.buildTargets.length !== totalTargets) {
    if (f.buildTargets.length === 0) {
      opts.push('target="<{~None~}>"');
    } else {
      for (const bt of f.buildTargets) opts.push(`target="${esc(bt)}"`);
    }
  }
  if (opts.length === 0) {
    L.push(`\t\t<Unit filename="${esc(f.relativeFilename)}" />`);
  } else {
    L.push(`\t\t<Unit filename="${esc(f.relativeFilename)}">`);
    for (const o of opts) L.push(`\t\t\t<Option ${o} />`);
    L.push('\t\t</Unit>');
  }
}

function writeExtensions(L: string[], extensions: unknown): void {
  if (extensions === undefined || extensions === null || extensions === '') {
    L.push('\t\t<Extensions />');
    return;
  }
  try {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '\t',
      suppressEmptyNode: true,
    });
    const xml = builder.build({ Extensions: extensions });
    for (const line of xml.split('\n')) {
      if (line.trim()) L.push('\t\t' + line);
    }
  } catch {
    L.push('\t\t<Extensions />');
  }
}

/** 将 Project 模型序列化为 .cbp XML 文本 */
export function serializeProject(project: Project): string {
  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');
  L.push('<CodeBlocks_project_file>');
  L.push('\t<FileVersion major="1" minor="6" />');
  L.push('\t<Project>');
  L.push(`\t\t<Option title="${esc(project.title)}" />`);
  // R7：工程级高级选项（对齐 CB ExportTargetAsProject 的写出条件）
  if (project.platforms !== PLATFORM_ALL) {
    L.push(`\t\t<Option platforms="${esc(formatPlatforms(project.platforms))}" />`);
  }
  if (project.makefile && project.makefile !== 'Makefile') {
    L.push(`\t\t<Option makefile="${esc(unix(project.makefile))}" />`);
  }
  if (project.makefileIsCustom) {
    L.push('\t\t<Option makefile_is_custom="1" />');
  }
  if (project.executionDir) {
    L.push(`\t\t<Option execution_dir="${esc(unix(project.executionDir))}" />`);
  }
  if (project.pchMode !== 1) {
    L.push(`\t\t<Option pch_mode="${project.pchMode}" />`);
  }
  for (const { key, value } of passthroughProjectOptions(project.rawProject)) {
    L.push(`\t\t<Option ${key}="${esc(value)}" />`);
  }
  L.push(`\t\t<Option compiler="${esc(project.compilerId)}" />`);
  if (project.virtualFolders.length) {
    L.push(`\t\t<Option virtualFolders="${esc(project.virtualFolders.join(';'))}" />`);
  }
  if (project.extendedObjNames) {
    L.push('\t\t<Option extended_obj_names="1" />');
  }
  if (project.showNotesOnLoad || project.notes) {
    const show = project.showNotesOnLoad ? 1 : 0;
    if (project.notes) {
      L.push(`\t\t<Option show_notes="${show}">`);
      L.push(`\t\t\t<notes><![CDATA[${project.notes}]]></notes>`);
      L.push('\t\t</Option>');
    } else {
      L.push(`\t\t<Option show_notes="${show}" />`);
    }
  }

  // 项目级 MakeCommands（对齐 ExportTargetAsProject：位于 <Build> 之前）
  writeMakeCommands(L, (project.rawProject as any)?.MakeCommands, '\t\t');

  L.push('\t\t<Build>');
  for (const t of project.buildTargets) {
    writeTarget(L, t, project.rawProject);
  }
  for (const s of project.buildScripts ?? []) {
    L.push(`\t\t\t<Script file="${esc(unix(s))}" />`);
  }
  // 项目级环境变量（<Build><Environment>，位于 Target 之后）
  writeEnvironment(L, '\t\t', project.envVars);
  L.push('\t\t</Build>');

  if (project.virtualTargets.length) {
    L.push('\t\t<VirtualTargets>');
    for (const vt of project.virtualTargets) {
      L.push(`\t\t\t<Add alias="${esc(vt.title)}" targets="${esc(vt.targets.join(';'))}" />`);
    }
    L.push('\t\t</VirtualTargets>');
  }

  writeCompiler(L, '\t\t', project.compilerOptions, project.includeDirs);
  writeResourceCompiler(L, '\t\t', project.resourceCompilerOptions, project.resourceIncludeDirs);
  writeLinker(L, '\t\t', project.linkerOptions, project.linkLibs, project.libDirs);
  writeExtraCommands(L, '\t\t', project.commandsBeforeBuild, project.commandsAfterBuild, project.alwaysRunPostBuildSteps);

  for (const f of project.files) {
    // 不保存自动生成文件（对齐 projectloader.cpp:1794-1795：do not save auto-generated files）
    if (f.autoGeneratedBy) continue;
    writeUnit(L, f, project.buildTargets.length);
  }

  writeExtensions(L, project.extensions);

  L.push('\t</Project>');
  L.push('</CodeBlocks_project_file>');
  return L.join('\n');
}
