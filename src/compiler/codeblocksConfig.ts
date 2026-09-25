/**
 * CodeBlocks 配置读取 —— 对应 compilerfactory.cpp RegisterUserCompilers
 *
 * 从 CodeBlocks 的 default.conf 读取「用户自定义编译器」配置（如 riscv32-v2），
 * 将其映射到实际的交叉编译器程序路径。这解决了 .cbp 里 compiler="riscv32-v2"
 * 这类用户编译器 ID 无法被扩展识别的问题。
 */
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { RegExStruct } from './compiler';
import { convertPosixRegex } from './posixRegex';

/** 用户编译器配置（default.conf 里 /compiler/user_sets/<id>） */
export interface UserCompilerConfig {
  id: string;          // 存储 ID（default.conf 元素名）
  name: string;
  parent: string;      // 父编译器 ID（如 gcc）
  masterPath: string;
  C: string;           // C 编译器可执行名
  CPP: string;
  LD: string;          // 链接器可执行名
  LIB: string;
  /** 原始 XML 节点（供 searchDirs 读取 INCLUDE_DIRS/LIBRARIES 等大写键） */
  raw: Record<string, unknown>;
}

/** 用户自定义错误正则（default.conf /compiler_sets/<id>/regex/reNNN，对齐 Compiler::LoadSettings:699） */
interface UserRegexConfig {
  index: number;
  description: string;
  type: number;      // cltNormal=0/cltWarning=1/cltError=2/cltInfo=3
  regex: string;
  msg1: number;
  msg2: number;
  msg3: number;
  filename: number;
  line: number;
}

/** CodeBlocks 用户编译器注册表 */
export class CodeBlocksConfig {
  private parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  private userCompilers = new Map<string, UserCompilerConfig>();
  /** 编译器全局搜索目录（default.conf /compiler_sets/<id>：include_dirs/library_dirs/res_include_dirs/libraries + 选项 + 用户正则） */
  private compilerSets = new Map<string, {
    includeDirs: string[];
    libDirs: string[];
    resIncludeDirs: string[];
    linkLibs: string[];
    compilerOptions: string[];
    linkerOptions: string[];
    resourceCompilerOptions: string[];
    regexes: UserRegexConfig[];
  }>();
  /** 全局编译器变量（default.conf /gcv/sets/<set>/<var>/<member>，对齐 uservarmanager） */
  private globalVars = new Map<string, Record<string, string>>();

  /** 加载 default.conf（若存在） */
  load(defaultConfPath?: string): void {
    const confPath = defaultConfPath ?? this.defaultConfLocation();
    if (!confPath || !fs.existsSync(confPath)) return;

    let raw: string;
    try {
      raw = fs.readFileSync(confPath, 'utf-8');
    } catch {
      return;
    }

    let root: any;
    try {
      root = this.parser.parse(raw);
    } catch {
      return;
    }

    const userSets = root?.CodeBlocksConfig?.compiler?.user_sets;

    // 全局编译器变量（/gcv/sets/<set>/<var>/<member>，默认集优先；旧版 /global_uservars）
    this.parseGlobalVariables(root);

    // 编译器设置集合（/compiler_sets/<id>：全局搜索目录 + 链接库，对齐 Compiler::LoadSettings:645-647）
    const sets = root?.CodeBlocksConfig?.compiler?.compiler_sets;
    if (sets && typeof sets === 'object') {
      for (const key of Object.keys(sets)) {
        if (key.startsWith('@_')) continue;
        const cc = sets[key];
        if (!cc || typeof cc !== 'object') continue;
        const get = (n: string): string => {
          const node = cc[n] ?? cc[n.toUpperCase()];
          if (node === undefined || node === null) return '';
          if (typeof node === 'object') return String(node['str'] ?? node['#text'] ?? '');
          return String(node);
        };
        const id = String(key).toLowerCase();
        const entry = {
          includeDirs: splitCfgList(get('include_dirs')),
          libDirs: splitCfgList(get('library_dirs')),
          resIncludeDirs: splitCfgList(get('res_include_dirs')),
          linkLibs: splitCfgList(get('libraries') || get('link_libs')),
          compilerOptions: splitCfgList(get('compiler_options')),
          linkerOptions: splitCfgList(get('linker_options')),
          resourceCompilerOptions: splitCfgList(get('resource_compiler_options')),
          regexes: [] as UserRegexConfig[],
        };
        // 用户自定义错误正则（/compiler_sets/<id>/regex/reNNN，对齐 Compiler::LoadSettings:699-737）
        const reNode = cc['regex'];
        if (reNode && typeof reNode === 'object') {
          for (const rkey of Object.keys(reNode)) {
            if (!/^re\d+$/.test(rkey)) continue;
            const index = parseInt(rkey.slice(2), 10);
            if (!Number.isFinite(index)) continue;
            const r = reNode[rkey];
            if (!r || typeof r !== 'object') continue;
            const rget = (n: string): string => {
              const nd = r[n];
              if (nd === undefined || nd === null) return '';
              if (typeof nd === 'object') return String(nd['str'] ?? nd['#text'] ?? '');
              return String(nd);
            };
            // cbKeyBinder 的整数存为 <key int="2"/>，字符串存为 <key><str><![CDATA[...]]></str></key>（解析后 str 扁平为字符串）
            const rint = (n: string): number => {
              const nd = r[n];
              if (nd === undefined || nd === null) return 0;
              if (typeof nd === 'object') {
                const raw = String(nd['@_int'] ?? nd['str'] ?? nd['#text'] ?? '0');
                return parseInt(raw, 10) || 0;
              }
              return parseInt(String(nd), 10) || 0;
            };
            // 对齐 CB：无 description 节点跳过
            if (!rget('description')) continue;
            entry.regexes.push({
              index,
              description: rget('description'),
              type: rint('type'),
              regex: rget('regex'),
              msg1: rint('msg1'),
              msg2: rint('msg2'),
              msg3: rint('msg3'),
              filename: rint('filename'),
              line: rint('line'),
            });
          }
        }
        this.compilerSets.set(id, entry);
        this.compilerSets.set(id.replace(/_/g, '-'), entry);
        this.compilerSets.set(id.replace(/-/g, '_'), entry);
      }
    }

    if (!userSets) return;

    for (const key of Object.keys(userSets)) {
      if (key.startsWith('@_')) continue;
      const cc = userSets[key];
      if (!cc || typeof cc !== 'object') continue;

      const get = (n: string): string => {
        const node = cc[n];
        if (node === undefined || node === null) return '';
        if (typeof node === 'object') return String(node['str'] ?? node['#text'] ?? '');
        return String(node);
      };

      const id = String(key).toLowerCase();
      const config: UserCompilerConfig = {
        id,
        name: get('NAME'),
        parent: get('PARENT').toLowerCase(),
        masterPath: get('MASTER_PATH'),
        C: get('C_COMPILER'),
        CPP: get('CPP_COMPILER'),
        LD: get('LINKER'),
        LIB: get('LIB_LINKER'),
        raw: cc as Record<string, unknown>,
      };
      this.userCompilers.set(id, config);
      // 同时注册连字符变体（riscv32-v2 与 riscv32_v2 互相映射）
      this.userCompilers.set(id.replace(/_/g, '-'), config);
      this.userCompilers.set(id.replace(/-/g, '_'), config);
    }
  }

  /** 查找用户编译器（支持连字符/下划线变体匹配） */
  find(compilerId: string): UserCompilerConfig | undefined {
    const lower = compilerId.toLowerCase();
    return this.userCompilers.get(lower);
  }

  /** 全局编译器变量：变量名 → { base/include/lib/obj/bin/cflags/lflags... }（默认集优先合并） */
  globalVariables(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    // 默认集最后合并（覆盖其它集，对齐 GetMemberValue：活动集优先）
    const names = [...this.globalVars.keys()];
    for (const name of names) out[name] = { ...this.globalVars.get(name) };
    return out;
  }

  /** 解析 /gcv/sets/<set>/<var>/<member> 与旧版 /global_uservars（uservarmanager.cpp:459-490） */
  private parseGlobalVariables(root: any): void {
    this.globalVars.clear();
    const readMembers = (v: any): Record<string, string> | undefined => {
      if (!v || typeof v !== 'object') return undefined;
      const members: Record<string, string> = {};
      for (const key of Object.keys(v)) {
        if (key.startsWith('@_')) continue;
        const node = v[key];
        if (node === undefined || node === null) continue;
        members[key] = typeof node === 'object' ? String(node['str'] ?? node['#text'] ?? '') : String(node);
      }
      return Object.keys(members).length ? members : undefined;
    };
    const mergeSet = (sets: any): void => {
      if (!sets || typeof sets !== 'object') return;
      // 默认集最后合并（活动集优先，对齐 GetMemberValue）
      const keys = Object.keys(sets).filter((k) => !k.startsWith('@_'));
      const ordered = [...keys.filter((k) => k !== 'default'), ...keys.filter((k) => k === 'default')];
      for (const setName of ordered) {
        const set = sets[setName];
        if (!set || typeof set !== 'object') continue;
        for (const varName of Object.keys(set)) {
          if (varName.startsWith('@_')) continue;
          const members = readMembers(set[varName]);
          if (!members) continue;
          const existing = this.globalVars.get(varName) ?? {};
          this.globalVars.set(varName, { ...existing, ...members });
        }
      }
    };
    const top = root?.CodeBlocksConfig;
    mergeSet(top?.gcv?.sets);
    mergeSet(root?.gcv?.sets);
    // 旧版 /global_uservars：<var>/<member> 直接挂在根下
    mergeSet(top?.global_uservars);
    mergeSet(root?.global_uservars);
  }

  /** 按 masterPath（安装目录）查找用户编译器，用于区分同名工具链的不同版本（如 RV32-V1 / RV32-V2） */
  findByMasterPath(masterPath: string): UserCompilerConfig | undefined {
    if (!masterPath) return undefined;
    const normalized = path.normalize(masterPath).toLowerCase();
    for (const cfg of this.userCompilers.values()) {
      if (cfg.masterPath && path.normalize(cfg.masterPath).toLowerCase() === normalized) {
        return cfg;
      }
    }
    return undefined;
  }

  /** 若 compilerId 是用户自定义编译器，返回其完整程序路径映射 */
  resolvePrograms(compilerId: string): { C: string; CPP: string; LD: string; LIB: string; masterPath: string } | undefined {
    const cfg = this.find(compilerId);
    if (!cfg || !cfg.masterPath) return undefined;

    const bin = path.join(cfg.masterPath, 'bin');
    const resolve = (exe: string): string => {
      if (!exe) return '';
      const p = path.join(bin, exe);
      return fs.existsSync(p) ? p : exe;
    };

    return {
      C: resolve(cfg.C),
      CPP: resolve(cfg.CPP),
      LD: resolve(cfg.LD),
      LIB: resolve(cfg.LIB),
      masterPath: cfg.masterPath,
    };
  }

  /**
   * 编译器全局搜索目录 + 链接库 + 全局选项（对齐 Compiler::LoadSettings 的 include_dirs/library_dirs/res_include_dirs/libraries/compiler_options/linker_options/resource_compiler_options）。
   * 优先 compiler_sets（设置集合，CB 25.x 小写键），缺失时回退 user_sets（用户编译器节点，旧版 CB 大写键）。
   */
  searchDirs(compilerId: string): {
    includeDirs: string[];
    libDirs: string[];
    resIncludeDirs: string[];
    linkLibs: string[];
    compilerOptions: string[];
    linkerOptions: string[];
    resourceCompilerOptions: string[];
  } {
    const lower = compilerId.toLowerCase();
    const sets = this.compilerSets.get(lower);
    if (sets) return sets;
    const uc = this.find(compilerId);
    if (uc) {
      // user_sets 节点里的同名字段（旧版 CB 把搜索目录存在用户编译器定义里，且键名大写：
      // INCLUDE_DIRS/LIBRARY_DIRS/RES_INCLUDE_DIRS/LIBRARIES/COMPILER_OPTIONS/LINKER_OPTIONS）
      const raw = uc.raw;
      const get = (n: string): string => {
        const node = raw[n] ?? raw[n.toUpperCase()];
        if (node === undefined || node === null) return '';
        if (typeof node === 'object') return String((node as any)['str'] ?? (node as any)['#text'] ?? '');
        return String(node);
      };
      return {
        includeDirs: splitCfgList(get('include_dirs')),
        libDirs: splitCfgList(get('library_dirs')),
        resIncludeDirs: splitCfgList(get('res_include_dirs')),
        // CB 键名是 /libraries（compiler.cpp:466/648），非 link_libs；双键兼容
        linkLibs: splitCfgList(get('libraries') || get('link_libs')),
        compilerOptions: splitCfgList(get('compiler_options')),
        linkerOptions: splitCfgList(get('linker_options')),
        resourceCompilerOptions: splitCfgList(get('resource_compiler_options')),
      };
    }
    return {
      includeDirs: [], libDirs: [], resIncludeDirs: [], linkLibs: [],
      compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    };
  }

  /**
   * 应用用户自定义错误正则 —— 对齐 Compiler::LoadSettings:699-737：
   * index ≤ 现有正则数 → 按索引覆盖 XML 默认正则；否则追加。
   */
  applyUserRegexes(compilerId: string, regexes: RegExStruct[]): void {
    const lower = compilerId.toLowerCase();
    const entry = this.compilerSets.get(lower);
    if (!entry || entry.regexes.length === 0) return;
    for (const r of entry.regexes) {
      const lt = r.type === 1 ? 'warning' : r.type === 3 ? 'info' : r.type === 0 ? 'normal' : 'error';
      const rs: RegExStruct = {
        desc: r.description,
        lt,
        msg: [r.msg1, r.msg2, r.msg3],
        filename: r.filename,
        line: r.line,
        regex: convertPosixRegex(r.regex),
      };
      if (r.index <= regexes.length) regexes[r.index - 1] = rs;
      else regexes.push(rs);
    }
  }

  /** default.conf 常见位置 */
  private defaultConfLocation(): string | undefined {
    const win = process.platform === 'win32';
    if (win) {
      const appData = process.env.APPDATA;
      if (appData) return path.join(appData, 'CodeBlocks', 'default.conf');
      return undefined;
    }
    const home = process.env.HOME;
    if (home) return path.join(home, '.codeblocks', 'default.conf');
    return undefined;
  }
}

/** 分号分隔列表（对齐 wx GetArrayFromString：去引号、忽略空项） */
function splitCfgList(v: string): string[] {
  return v.split(';').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}
