/**
 * 构建取消源 —— 编译随时停止的核心机制
 *
 * 持有取消标志与活动子进程注册表：
 *  - isCancelled() 供构建各检查点查询（目标间/单元间/脚本命令间/链接前）；
 *  - register/unregister 追踪 spawn 出的子进程；
 *  - cancel() 置位标志并强杀所有活动子进程（Windows 用 taskkill /T /F 杀整棵进程树，
 *    cmd.exe → gcc → cc1/as/ld 的孙子进程一并终止）。
 */
import { ChildProcess, spawn } from 'child_process';

export interface BuildCancelHandle {
  /** 是否已请求取消 */
  isCancelled(): boolean;
  /** 注册活动子进程（spawn 后立即注册，close/error 后注销） */
  register(proc: ChildProcess): void;
  /** 注销子进程 */
  unregister(proc: ChildProcess): void;
}

export class BuildCancelSource implements BuildCancelHandle {
  private cancelled = false;
  private active = new Set<ChildProcess>();

  isCancelled(): boolean {
    return this.cancelled;
  }

  register(proc: ChildProcess): void {
    if (this.cancelled) {
      // 竞态防御：取消已发生而进程刚 spawn 出来，立即强杀，不让新进程继续运行
      killProcessTree(proc);
      return;
    }
    this.active.add(proc);
  }

  unregister(proc: ChildProcess): void {
    this.active.delete(proc);
  }

  /** 请求取消：置位标志 + 强杀所有活动子进程（整棵进程树） */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const proc of [...this.active]) {
      killProcessTree(proc);
    }
  }
}

/** 强杀进程树：Windows 用 taskkill /T /F（覆盖 shell:true 的 cmd.exe 孙进程），其它平台 SIGKILL */
function killProcessTree(proc: ChildProcess): void {
  try {
    if (proc.pid === undefined) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        // taskkill 不可用等：回退直接 kill
        try { proc.kill(); } catch { /* ignore */ }
      });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    try { proc.kill(); } catch { /* ignore */ }
  }
}
