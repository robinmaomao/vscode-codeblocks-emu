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
