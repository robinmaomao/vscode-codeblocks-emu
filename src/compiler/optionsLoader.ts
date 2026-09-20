/**
 * 编译器选项 XML 加载器 —— 对应 compiler.cpp LoadDefaultOptions / EvalXMLCondition
 *
 * 移植自 codeblocks-src/src/sdk/compiler.cpp（LGPL v3）。
 * 支持：extends 继承、<if platform>/<else> 条件、<Common> 引用、<Category>、
 * <Program>/<Switch>/<Option>/<Command>/<Sort>/<RegEx> 节点。
 */
import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import {
  Compiler,
  CompilerOption,
  CompilerTool,
  CommandTypeTemplate,
  RegExStruct,
  CompilerSwitches,
} from './compiler';
import { CommandType } from '../model/types';

/** 带名字的子节点 */
interface NamedNode {
  name: string;
  attrs: Record<string, any>;
  children: NamedNode[];
  text: string;
}

/** 平台标识（对应 EvalXMLCondition 的 platform 分支） */
function currentPlatform(): string {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macosx';
    case 'linux': return 'linux';
    case 'freebsd': return 'freebsd';
    default: return 'linux';
  }
}

export class CompilerOptionsLoader {
  private resourcesDir: string;
  private parser: XMLParser;

  constructor(resourcesDir: string) {
    this.resourcesDir = resourcesDir;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      cdataPropName: '__cdata',
      trimValues: false,
    });
  }

  /** 加载指定编译器（如 "gcc"）的完整选项 */
  load(compilerId: string): Compiler {
    const compiler: Compiler = {
      id: compilerId,
      name: compilerId,
      masterPath: '',
      programs: { C: '', CPP: '', LD: '', LIB: '', WINDRES: '', MAKE: '', DBGconfig: '' },
      switches: this.defaultSwitches(),
      commands: [] as CommandTypeTemplate[],
      options: [],
      regexes: [],
      cOnlyFlags: [],
      cppOnlyFlags: [],
    };

    this.loadFile(`options_${compilerId}`, compiler, new Set());
    // 若 programs 为空（文件不存在），回退内置 GCC
    if (!compiler.programs.C && !compiler.programs.CPP) {
      this.applyBuiltinGcc(compiler);
    }
    return compiler;
  }

  private defaultSwitches(): CompilerSwitches {
    return {
      includeDirs: '-I', libDirs: '-L', linkLibs: '-l', defines: '-D', genericSwitch: '-',
      objectExtension: 'o', forceFwdSlashes: false, forceLinkerUseQuotes: false,
      forceCompilerUseQuotes: false, needDependencies: true, libPrefix: 'lib', libExtension: 'a',
      linkerNeedsLibPrefix: false, linkerNeedsLibExtension: false, linkerNeedsPathResolved: false,
      supportsPCH: false, PCHExtension: '', useFlatObjects: false, useFullSourcePaths: false,
      use83Paths: false, includeDirSeparator: ' ', libDirSeparator: ' ', objectSeparator: ' ',
      statusSuccess: 0,
    };
  }

  private resolveFile(name: string): string | null {
    const p = path.join(this.resourcesDir, name + '.xml');
    return fs.existsSync(p) ? p : null;
  }

  private loadFile(name: string, compiler: Compiler, visited: Set<string>): void {
    if (visited.has(name) || visited.size > 10) return;
    visited.add(name);

    const file = this.resolveFile(name);
    if (!file) return;

    const raw = fs.readFileSync(file, 'utf-8');
    const root = this.parser.parse(raw)?.CodeBlocks_compiler_options;
    if (!root) return;

    // extends 继承（先加载父级）
    const extendsName = root['@_extends'];
    if (extendsName) this.loadFile(extendsName, compiler, visited);

    const nodes = this.toNamedChildren(root);
    this.processNodes(nodes, compiler, '', false);
  }

  private toNamedChildren(obj: any): NamedNode[] {
    if (!obj || typeof obj !== 'object') return [];
    const out: NamedNode[] = [];
    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_') || key === '__cdata' || key === '#text') continue;
      let values = obj[key];
      if (!Array.isArray(values)) values = [values];
      for (const v of values) out.push(this.toNamedNode(key, v));
    }
    return out;
  }

  private toNamedNode(name: string, obj: any): NamedNode {
    if (obj && typeof obj === 'object') {
      return {
        name,
        attrs: this.extractAttrs(obj),
        children: this.toNamedChildren(obj),
        text: obj.__cdata ?? obj['#text'] ?? '',
      };
    }
    return { name, attrs: {}, children: [], text: obj === undefined ? '' : String(obj) };
  }

  private extractAttrs(obj: any): Record<string, any> {
    const attrs: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) attrs[key.slice(2)] = obj[key];
    }
    return attrs;
  }

  private processNodes(nodes: NamedNode[], compiler: Compiler, category: string, exclu: boolean): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node.name === 'if') {
        const next = nodes[i + 1];
        if (this.evalCondition(node)) {
          this.processNodes(node.children, compiler, category, exclu);
        } else if (next && next.name === 'else') {
          this.processNodes(next.children, compiler, category, exclu);
          i++;
        }
        continue;
      }
      if (node.name === 'else') continue;

      switch (node.name) {
        case 'Program': this.applyProgram(node, compiler); break;
        case 'Switch': this.applySwitch(node, compiler); break;
        case 'Category':
          this.processNodes(node.children, compiler, node.attrs.name ?? category, node.attrs.exclusive === 'true');
          break;
        case 'Option': compiler.options.push(this.applyOption(node, category, exclu)); break;
        case 'Command': this.applyCommand(node, compiler); break;
        case 'Sort': this.applySort(node, compiler); break;
        case 'Common':
          this.loadFile(`options_common_${node.attrs.name}`, compiler, new Set());
          break;
        case 'RegEx': compiler.regexes.push(this.applyRegEx(node)); break;
      }
    }
  }

  private applyProgram(node: NamedNode, compiler: Compiler): void {
    const n = node.attrs.name;
    const v = node.attrs.value ?? '';
    const p = compiler.programs as any;
    if (n === 'C') p.C = v;
    else if (n === 'CPP') p.CPP = v;
    else if (n === 'LD') p.LD = v;
    else if (n === 'LIB') p.LIB = v;
    else if (n === 'WINDRES') p.WINDRES = v;
    else if (n === 'MAKE') p.MAKE = v;
    else if (n === 'DBGconfig') p.DBGconfig = v;
  }

  private applySwitch(node: NamedNode, compiler: Compiler): void {
    const n = node.attrs.name;
    const v = node.attrs.value ?? '';
    const s = compiler.switches;
    switch (n) {
      case 'includeDirs': s.includeDirs = v; break;
      case 'libDirs': s.libDirs = v; break;
      case 'linkLibs': s.linkLibs = v; break;
      case 'defines': s.defines = v; break;
      case 'genericSwitch': s.genericSwitch = v; break;
      case 'objectExtension': s.objectExtension = v; break;
      case 'forceFwdSlashes': s.forceFwdSlashes = v === 'true'; break;
      case 'forceLinkerUseQuotes': s.forceLinkerUseQuotes = v === 'true'; break;
      case 'forceCompilerUseQuotes': s.forceCompilerUseQuotes = v === 'true'; break;
      case 'needDependencies': s.needDependencies = v === 'true'; break;
      case 'libPrefix': s.libPrefix = v; break;
      case 'libExtension': s.libExtension = v; break;
      case 'linkerNeedsLibPrefix': s.linkerNeedsLibPrefix = v === 'true'; break;
      case 'linkerNeedsLibExtension': s.linkerNeedsLibExtension = v === 'true'; break;
      case 'linkerNeedsPathResolved': s.linkerNeedsPathResolved = v === 'true'; break;
      case 'supportsPCH': s.supportsPCH = v === 'true'; break;
      case 'PCHExtension': s.PCHExtension = v; break;
      case 'UseFlatObjects': s.useFlatObjects = v === 'true'; break;
      case 'UseFullSourcePaths': s.useFullSourcePaths = v === 'true'; break;
      case 'Use83Paths': s.use83Paths = v === 'true'; break;
      case 'includeDirSeparator': if (v) s.includeDirSeparator = v[0]; break;
      case 'libDirSeparator': if (v) s.libDirSeparator = v[0]; break;
      case 'objectSeparator': if (v) s.objectSeparator = v[0]; break;
      case 'statusSuccess': { const num = Number(v); if (!Number.isNaN(num)) s.statusSuccess = num; break; }
    }
  }

  private applyOption(node: NamedNode, categ: string, exclu: boolean): CompilerOption {
    const cat = node.attrs.category ?? (categ || 'General');
    const exclusive = node.attrs.exclusive !== undefined
      ? node.attrs.exclusive === 'true'
      : exclu;
    return {
      name: node.attrs.name ?? '',
      option: node.attrs.option ?? '',
      additionalLibs: node.attrs.additionalLibs,
      supersedes: node.attrs.supersedes,
      checkAgainst: node.attrs.checkAgainst,
      checkMessage: node.attrs.checkMessage,
      category: cat,
      exclusive,
    };
  }

  private applyCommand(node: NamedNode, compiler: Compiler): void {
    const cmdName = node.attrs.name;
    const value = (node.attrs.value ?? '').replace(/\\n/g, '\n');
    const tool: CompilerTool = {
      command: value,
      extensions: (node.attrs.ext ?? '').split(';').filter(Boolean),
      generatedFiles: (node.attrs.gen ?? '').split(';').filter(Boolean),
    };
    const ct = this.commandType(cmdName);
    if (ct === undefined) return;
    if (!compiler.commands[ct]) compiler.commands[ct] = [];
    const vec = compiler.commands[ct];
    const idx = vec.findIndex((t) => arraysEqual(t.extensions, tool.extensions));
    if (idx >= 0) vec[idx] = tool;
    else vec.push(tool);
  }

  private commandType(name: string): CommandType | undefined {
    switch (name) {
      case 'CompileObject': return CommandType.CompileObjectCmd;
      case 'GenDependencies': return CommandType.GenDependenciesCmd;
      case 'CompileResource': return CommandType.CompileResourceCmd;
      case 'LinkExe': return CommandType.LinkExeCmd;
      case 'LinkConsoleExe': return CommandType.LinkConsoleExeCmd;
      case 'LinkDynamic': return CommandType.LinkDynamicCmd;
      case 'LinkStatic': return CommandType.LinkStaticCmd;
      case 'LinkNative': return CommandType.LinkNativeCmd;
      default: return undefined;
    }
  }

  private applySort(node: NamedNode, compiler: Compiler): void {
    if (node.attrs.CFlags) {
      compiler.cOnlyFlags.push(...String(node.attrs.CFlags).replace(/[\r\n]/g, ' ').split(' ').filter(Boolean));
    }
    if (node.attrs.CPPFlags) {
      compiler.cppOnlyFlags.push(...String(node.attrs.CPPFlags).replace(/[\r\n]/g, ' ').split(' ').filter(Boolean));
    }
  }

  private applyRegEx(node: NamedNode): RegExStruct {
    const type = node.attrs.type ?? 'error';
    const msg = String(node.attrs.msg ?? '')
      .split(';').map((s) => Number(s)).filter((n) => !Number.isNaN(n));
    const filename = Number(node.attrs.file ?? 0) || 0;
    const line = Number(node.attrs.line ?? 0) || 0;
    return {
      desc: node.attrs.name ?? '',
      lt: type as any,
      msg,
      filename,
      line,
      regex: this.convertPosixRegex(node.text),
    };
  }

  /** 将 wxRegEx POSIX 字符类转换为 JS 正则 */
  private convertPosixRegex(regex: string): string {
    let out = regex;
    // 处理复合字符类中嵌套的 POSIX 类（如 [][{}()[:blank:]...]）
    out = out.replace(/\[:blank:\]/g, ' \\t');
    out = out.replace(/\[:alnum:\]/g, 'A-Za-z0-9');
    // wxRegEx 中字符类开头的 ']' 是字面字符，JS 需转义为 '\]'
    // 匹配形如 [][]、[]a、[][ 的「闭合方括号紧跟内容」模式
    out = out.replace(/\[\]/g, '[\\]');
    return out;
  }

  /** 对应 EvalXMLCondition 的 platform 分支（exec 条件简化返回 default） */
  private evalCondition(node: NamedNode): boolean {
    const platform = node.attrs.platform;
    if (platform !== undefined) {
      return platform === currentPlatform();
    }
    return node.attrs.default === 'true';
  }

  /** 内置 GCC 回退（无 XML 文件时） */
  private applyBuiltinGcc(compiler: Compiler): void {
    const win = process.platform === 'win32';
    compiler.programs = {
      C: win ? 'gcc.exe' : 'gcc',
      CPP: win ? 'g++.exe' : 'g++',
      LD: win ? 'g++.exe' : 'g++',
      LIB: win ? 'ar.exe' : 'ar',
      WINDRES: win ? 'windres.exe' : '',
      MAKE: win ? 'mingw32-make.exe' : 'make',
      DBGconfig: 'gdb_debugger:Default',
    };
    compiler.switches.needDependencies = true;
    compiler.switches.supportsPCH = true;
    compiler.switches.PCHExtension = 'gch';
    compiler.switches.useFullSourcePaths = true;
    compiler.commands[CommandType.CompileObjectCmd] = [
      { command: '$compiler $options $includes -c $file -o $object', extensions: [], generatedFiles: [] },
    ];
    compiler.commands[CommandType.GenDependenciesCmd] = [
      { command: '$compiler -MM $options -MF $dep_object -MT $object $includes $file', extensions: [], generatedFiles: [] },
    ];
    compiler.commands[CommandType.LinkConsoleExeCmd] = [
      { command: '$linker $libdirs -o $exe_output $link_objects $link_resobjects $link_options $libs', extensions: [], generatedFiles: [] },
    ];
    compiler.commands[CommandType.LinkExeCmd] = [
      { command: '$linker $libdirs -o $exe_output $link_objects $link_resobjects $link_options $libs -mwindows', extensions: [], generatedFiles: [] },
    ];
    compiler.commands[CommandType.LinkDynamicCmd] = [
      { command: '$linker -shared -Wl,--output-def=$def_output -Wl,--out-implib=$static_output -Wl,--dll $libdirs $link_objects $link_resobjects -o $exe_output $link_options $libs', extensions: [], generatedFiles: [] },
    ];
    compiler.commands[CommandType.LinkStaticCmd] = [
      { command: '$lib_linker -r -s $static_output $link_objects', extensions: [], generatedFiles: [] },
    ];
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
