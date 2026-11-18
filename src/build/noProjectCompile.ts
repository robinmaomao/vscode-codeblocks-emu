/**
 * 无工程单文件编译 —— 对齐 Code::Blocks `CompileFileWithoutProject`
 * （compilergcc.cpp:3174-3191：默认编译器 + 控制台模板 + 编译后询问运行）。
 *
 * 与主构建共用 GBK/UTF-8 逐行解码（`OutputLineDecoder`），避免中文 Windows 下
 * GCC 的 GBK 路径/诊断在 VS Code 任务终端里显示为乱码。
 */
import { spawn } from 'child_process';
import * as path from 'path';
import { OutputLineDecoder } from '../tools/encoding';

export interface NoProjectCompilePlan {
  /** 编译器可执行文件（已含 masterPath/bin 时可直接执行） */
  program: string;
  args: string[];
  cwd: string;
  /** 产物绝对路径 */
  output: string;
}

/** 构造无工程编译命令（纯函数，便于单测） */
export function buildNoProjectCompilePlan(filePath: string, compilerProgram: string): NoProjectCompilePlan {
  const ext = path.extname(filePath).toLowerCase();
  const fileDir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const outName = process.platform === 'win32' ? `${base}.exe` : base;
  return {
    program: compilerProgram,
    args: ['-g', '-Wall', filePath, '-o', path.join(fileDir, outName)],
    cwd: fileDir,
    output: path.join(fileDir, outName),
  };
}

export interface NoProjectCompileResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
}

/**
 * 执行编译并逐行回调解码后的输出。
 * @param plan buildNoProjectCompilePlan 的结果
 * @param onLine 每行输出（stream 用于着色）
 * @param signal 可选取消信号（取消时强杀进程树）
 */
export function runNoProjectCompile(
  plan: NoProjectCompilePlan,
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
  signal?: AbortSignal,
): Promise<NoProjectCompileResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: null, signal: null, cancelled: true });
      return;
    }
    const child = spawn(plan.program, plan.args, {
      cwd: plan.cwd,
      windowsHide: true,
      shell: false,
      env: process.env,
    });
    const outDecoder = new OutputLineDecoder();
    const errDecoder = new OutputLineDecoder();
    let cancelled = false;

    const onAbort = (): void => {
      cancelled = true;
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* 进程已退出 */
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of outDecoder.push(chunk).lines) onLine(line, 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of errDecoder.push(chunk).lines) onLine(line, 'stderr');
    });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort);
      for (const line of outDecoder.flush().lines) onLine(line, 'stdout');
      for (const line of errDecoder.flush().lines) onLine(line, 'stderr');
      resolve({ code, signal: sig, cancelled });
    });
  });
}
