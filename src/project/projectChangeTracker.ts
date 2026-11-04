/**
 * 已打开工程文件的磁盘签名跟踪 —— 对应 Code::Blocks
 * `ProjectManagerUI::CheckForExternallyModifiedProjects()`（projectmanagerui.cpp）
 * 里 `wxFileName::GetModificationTime()` 与 `cbProject::GetLastModificationTime()` 的比较。
 *
 * 只回答一个问题：某个 `.cbp` 相对上次记录的基准是否被改过。
 * 基准在两种时机更新：
 *   - 扩展解析/打开工程后（磁盘状态＝模型状态）；
 *   - 扩展自己写回 `.cbp` 之后（写盘造成的 change 事件不应弹窗）。
 * 用户选择"忽略"时同样更新基准（等价 Code::Blocks 的 `cbProject::Touch()`）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { upperDrive } from '../tools/pathCase';

/** 文件签名：mtime + size（对齐 parser 的 XML 缓存失效口径；防止只改同长度内容被漏判） */
export interface FileSignature {
  mtimeMs: number;
  size: number;
}

/** 读取文件签名；文件不存在/不可读返回 undefined */
export function readFileSignature(file: string): FileSignature | undefined {
  try {
    const st = fs.statSync(file);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return undefined;
  }
}

export class ProjectChangeTracker {
  private readonly known = new Map<string, FileSignature>();

  /** 路径归一化：绝对路径 + 盘符大写；Windows 上再统一小写（NTFS 大小写不敏感，与 normPath 口径一致） */
  private key(file: string): string {
    const abs = upperDrive(path.resolve(file));
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  }

  /** 以当前磁盘状态为基准（打开/重新解析工程后、扩展自写盘后调用） */
  remember(file: string): void {
    const sig = readFileSignature(file);
    // 读取失败（被独占锁住/临时不可读）时**保留旧基准**：删除条目会让该文件从此不再参与检测，
    // 而保留旧签名最坏只是"看起来没变化"，文件恢复可读后一旦 mtime/size 不同仍会触发检测。
    if (sig) this.known.set(this.key(file), sig);
  }

  /** 停止跟踪（工程从列表移除） */
  forget(file: string): void {
    this.known.delete(this.key(file));
  }

  /** 是否正在跟踪该文件 */
  isTracked(file: string): boolean {
    return this.known.has(this.key(file));
  }

  /** 相对基准是否已变化。未跟踪或文件已消失时返回 false（删除由独立的 delete 事件处理） */
  hasChanged(file: string): boolean {
    const prev = this.known.get(this.key(file));
    if (!prev) return false;
    const now = readFileSignature(file);
    if (!now) return false;
    return now.mtimeMs !== prev.mtimeMs || now.size !== prev.size;
  }

  clear(): void {
    this.known.clear();
  }
}

/** 扩展宿主内所有已打开工程共用的跟踪器 */
export const projectChangeTracker = new ProjectChangeTracker();
