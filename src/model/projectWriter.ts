/**
 * .cbp 序列化器 —— 对应 projectloader.cpp 的 ExportTargetAsProject（写入 .cbp）。
 *
 * 将 Project 模型写回 .cbp XML，严格对齐 Code::Blocks 的元素顺序、属性、缩进与
 * 空节点省略规则。未映射到模型的原生元素（如 <Option platforms/makefile> 等）从
 * 原始 XML 节点（rawProject）透传，保证「往返」不丢失。
 */
import { Project, BuildTarget, TargetType, ProjectFile, OptionsRelationType, LinkerExecutableOption, EnvVariable } from './types';
import { XMLBuilder } from 'fast-xml-parser';
import { defaultCompile, defaultLink, shouldWriteCompilerVar } from './fileTypes';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unix(p: string): string {
  return p.replace(/\\/g, '/');
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

/** 透传项目级 <Option> 中模型未映射的属性（platforms/makefile/pch_mode/...） */
function passthroughProjectOptions(rawProject: unknown): { key: string; value: string }[] {
  const raw = rawProject as any;
  const handled = new Set(['title', 'compiler', 'virtualFolders', 'notes', 'show_notes']);
  const out: { key: string; value: string }[] = [];
  for (const o of asArray<any>(raw?.Option)) {
    for (const [key, value] of Object.entries(attrs(o))) {
      if (!handled.has(key)) out.push({ key, value });
    }
  }
  return out;
}

/** 透传目标级 <Option> 中模型未映射的属性（platforms/working_dir/deps_output/...） */
function passthroughTargetOptions(rawProject: unknown, title: string): { key: string; value: string }[] {
  const raw = rawProject as any;
  const handled = new Set([
    'title', 'type', 'compiler', 'output', 'object_output', 'use_console_runner',
    'createDefFile', 'createStaticLib', 'prefix_auto', 'extension_auto', 'imp_lib', 'def_file',
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
  L.push(`\t\t\t\t<Option output="${esc(unix(t.outputFilename))}" prefix_auto="1" extension_auto="1"${impLibAttr}${defFileAttr} />`);
  if (t.objectOutput && t.objectOutput !== '.objs') {
    L.push(`\t\t\t\t<Option object_output="${esc(unix(t.objectOutput))}" />`);
  }
  L.push(`\t\t\t\t<Option type="${t.targetType}" />`);
  L.push(`\t\t\t\t<Option compiler="${esc(t.compilerId)}" />`);
  if (t.targetType === TargetType.ConsoleOnly && !t.useConsoleRunner) {
    L.push('\t\t\t\t<Option use_console_runner="0" />');
  }
  if ((t.targetType === TargetType.StaticLib || t.targetType === TargetType.DynamicLib) && t.createDefFile) {
    L.push('\t\t\t\t<Option createDefFile="1" />');
  }
  if (t.targetType === TargetType.DynamicLib && t.createStaticLib) {
    L.push('\t\t\t\t<Option createStaticLib="1" />');
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
  if (extensions === undefined || extensions === null) {
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
  for (const { key, value } of passthroughProjectOptions(project.rawProject)) {
    L.push(`\t\t<Option ${key}="${esc(value)}" />`);
  }
  L.push(`\t\t<Option compiler="${esc(project.compilerId)}" />`);
  if (project.virtualFolders.length) {
    L.push(`\t\t<Option virtualFolders="${esc(project.virtualFolders.join(';'))}" />`);
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
