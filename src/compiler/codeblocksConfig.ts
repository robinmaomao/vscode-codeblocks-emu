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
}

/** CodeBlocks 用户编译器注册表 */
export class CodeBlocksConfig {
  private parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  private userCompilers = new Map<string, UserCompilerConfig>();
  /** 编译器全局搜索目录（default.conf /compiler_sets/<id>：include_dirs/library_dirs/res_include_dirs/link_libs） */
  private compilerSets = new Map<string, { includeDirs: string[]; libDirs: string[]; resIncludeDirs: string[]; linkLibs: string[] }>();

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

    // 编译器设置集合（/compiler_sets/<id>：全局搜索目录 + 链接库，对齐 Compiler::LoadSettings:645-647）
    const sets = root?.CodeBlocksConfig?.compiler?.compiler_sets;
    if (sets && typeof sets === 'object') {
      for (const key of Object.keys(sets)) {
        if (key.startsWith('@_')) continue;
        const cc = sets[key];
        if (!cc || typeof cc !== 'object') continue;
        const get = (n: string): string => {
          const node = cc[n];
          if (node === undefined || node === null) return '';
          if (typeof node === 'object') return String(node['str'] ?? node['#text'] ?? '');
          return String(node);
        };
        const id = String(key).toLowerCase();
        const entry = {
          includeDirs: splitCfgList(get('include_dirs')),
          libDirs: splitCfgList(get('library_dirs')),
          resIncludeDirs: splitCfgList(get('res_include_dirs')),
          linkLibs: splitCfgList(get('link_libs')),
        };
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
   * 编译器全局搜索目录 + 链接库（对齐 Compiler::LoadSettings 的 include_dirs/library_dirs/res_include_dirs/link_libs）。
   * 优先 compiler_sets（设置集合），缺失时回退 user_sets（用户编译器节点同样可能携带这些字段）。
   */
  searchDirs(compilerId: string): { includeDirs: string[]; libDirs: string[]; resIncludeDirs: string[]; linkLibs: string[] } {
    const lower = compilerId.toLowerCase();
    const sets = this.compilerSets.get(lower);
    if (sets) return sets;
    const uc = this.find(compilerId);
    if (uc) {
      // user_sets 节点里的同名字段（旧版 CB 把搜索目录存在用户编译器定义里）
      const raw = (uc as unknown as Record<string, unknown>);
      const get = (n: string): string => String(raw[n] ?? '');
      return {
        includeDirs: splitCfgList(get('include_dirs')),
        libDirs: splitCfgList(get('library_dirs')),
        resIncludeDirs: splitCfgList(get('res_include_dirs')),
        linkLibs: splitCfgList(get('link_libs')),
      };
    }
    return { includeDirs: [], libDirs: [], resIncludeDirs: [], linkLibs: [] };
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
