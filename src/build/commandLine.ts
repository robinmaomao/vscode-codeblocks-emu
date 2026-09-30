/**
 * 命令行长度处理 —— 对应 Code::Blocks CheckForToLongCommandLine（directcommands.cpp:200）。
 *
 * Windows 下命令经 cmd.exe 执行时命令行上限 8191 字符；超长时把末尾参数
 * （通常为对象文件列表）写入响应文件（.respFile），命令改为 `... @"<respFile>"`，
 * gcc 从 @file 读取参数。响应文件内 `\` 转义为 `\\`（MinGW/gcc 要求）。
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ProjectFile } from '../model/types';

/** 按 weight + 文件名排序（对齐 directcommands.cpp MySortProjectFilesByWeight） */
export function compareFilesByWeight(a: ProjectFile, b: ProjectFile): number {
  const dw = a.weight - b.weight;
  if (dw !== 0) return dw;
  // 对齐 wxString::CmpNoCase / Cmp 的字节序比较，而非 localeCompare：
  // localeCompare 会忽略 '.' / '_' 等标点，导致 "func.c" 被排到 "func_aux.c" 之后，
  // 进而链接对象顺序与 Code::Blocks 不一致、产物字节不同。
  const al = a.relativeFilename.toLowerCase();
  const bl = b.relativeFilename.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a.relativeFilename < b.relativeFilename) return -1;
  if (a.relativeFilename > b.relativeFilename) return 1;
  return 0;
}

/** Windows cmd.exe 命令行上限 8191 字符，留余量（safe 模式阈值） */
export const MAX_CMD_LENGTH = 8000;
/** CB 阈值（directcommands.cpp:202-211：Windows 32767 / Linux 131072） */
export const CB_MAX_CMD_LENGTH = process.platform === 'win32' ? 32767 : 131072;
let respFileCounter = 0;

/**
 * 链接/打包响应文件基础路径 —— 对齐 CB CheckForToLongCommandLine 的 path 参数（directcommands.cpp:925：
 * target->GetObjectOutput()）：对象输出目录为空时用 `.objs`（对齐 CompileTargetBase::GetObjectOutput
 * 的空值默认，compiletargetbase.cpp:203-216），避免响应文件散落到工程根目录。
 */
export function linkRespBase(basePath: string, objectOutput: string, targetTitle: string): string {
  return path.join(basePath, objectOutput || '.objs', `${targetTitle}_link`);
}

/** 响应文件模式（codeblocks.build.responseFile：safe=保护性默认；cb=对齐 CB 细节） */
export type ResponseFileMode = 'safe' | 'cb';

export function responseFileMode(): ResponseFileMode {
  try {
    // 惰性 require：headless 单测无 vscode 宿主时回退 safe
    const vs: typeof import('vscode') = require('vscode');
    const v = vs.workspace.getConfiguration('codeblocks').get<string>('build.responseFile', 'safe');
    return v === 'cb' ? 'cb' : 'safe';
  } catch {
    return 'safe';
  }
}

/** 响应文件处理结果 */
export interface RespResult {
  command: string;
  respFile?: string;
}

/**
 * 命令过长时改用响应文件；未超长或无法分割时原样返回。
 * @param command 待执行的命令字符串
 * @param respBase 响应文件基础路径（对齐 CB CheckForToLongCommandLine 命名：
 *                 编译 = 对象目录/源文件名，链接 = 对象输出目录/目标名_link）
 * @param cwd 构建工作目录（工程根；cb 模式下相对路径引用的基准）
 */
export function applyResponseFile(command: string, respBase?: string, cwd?: string): RespResult {
  if (process.platform !== 'win32') {
    return { command };
  }
  const mode = responseFileMode();
  const maxLength = mode === 'cb' ? CB_MAX_CMD_LENGTH : MAX_CMD_LENGTH;
  if (command.length <= maxLength) {
    return { command };
  }

  // 命名：safe=基础名追加 .respFile（保护性，保留源扩展名）；
  // cb=SetName(basename).SetExt("respFile") 替换扩展名（对齐 CB directcommands.cpp:222-224 → main.respFile）
  let rel: string;
  if (mode === 'cb' && respBase) {
    const p = path.parse(respBase);
    rel = path.join(p.dir, p.name + '.respFile');
  } else {
    rel = respBase
      ? respBase + '.respFile'
      : path.join(os.tmpdir(), `codeblocks-resp-${process.pid}-${++respFileCounter}.respFile`);
  }
  const respAbs = cwd ? path.resolve(cwd, rel) : path.resolve(rel);
  const responseFileLength = (mode === 'cb' ? rel.length : respAbs.length) + 5;

  // 从末尾向前找空格分割点（对齐 Code::Blocks rfind(' ', maxLength - responseFileLength)）
  let startPos = command.lastIndexOf(' ', maxLength - responseFileLength);
  if (startPos <= 0) startPos = command.indexOf(' ');
  if (startPos <= 0) return { command }; // 无法分割：原样返回（CB 会告警仍继续，保护性返回）

  const rest = command.slice(startPos + 1);
  try {
    // 对齐 CB：响应文件路径的目录结构需存在（CreateDirRecursively）
    const dir = path.dirname(respAbs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 响应文件内 \ 转义为 \\（MinGW/gcc 要求）
    fs.writeFileSync(respAbs, rest.replace(/\\/g, '\\\\'), 'utf-8');
  } catch {
    return { command };
  }

  // safe 引用绝对路径（保护性）；cb 引用相对路径（对齐 CB，构建 CWD=工程根）
  const ref = mode === 'cb' ? rel : respAbs;
  return { command: `${command.slice(0, startPos)} @"${ref}"`, respFile: respAbs };
}
