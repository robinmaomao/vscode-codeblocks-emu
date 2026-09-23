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
  const ci = a.relativeFilename.toLowerCase().localeCompare(b.relativeFilename.toLowerCase());
  if (ci !== 0) return ci;
  return a.relativeFilename.localeCompare(b.relativeFilename);
}

/** Windows cmd.exe 命令行上限 8191 字符，留余量 */
export const MAX_CMD_LENGTH = 8000;
let respFileCounter = 0;

/** 响应文件处理结果 */
export interface RespResult {
  command: string;
  respFile?: string;
}

/**
 * 命令过长时改用响应文件；未超长或无法分割时原样返回。
 * @param command 待执行的命令字符串
 */
export function applyResponseFile(command: string): RespResult {
  if (process.platform !== 'win32' || command.length <= MAX_CMD_LENGTH) {
    return { command };
  }

  const respFile = path.join(os.tmpdir(), `codeblocks-resp-${process.pid}-${++respFileCounter}.respFile`);
  const respAbs = path.resolve(respFile);
  const responseFileLength = respAbs.length + 5;

  // 从末尾向前找空格分割点（对齐 Code::Blocks rfind(' ', maxLength - responseFileLength)）
  let startPos = command.lastIndexOf(' ', MAX_CMD_LENGTH - responseFileLength);
  if (startPos <= 0) startPos = command.indexOf(' ');
  if (startPos <= 0) return { command }; // 无法分割，原样返回

  const rest = command.slice(startPos + 1);
  try {
    // 响应文件内 \ 转义为 \\（MinGW/gcc 要求）
    fs.writeFileSync(respAbs, rest.replace(/\\/g, '\\\\'), 'utf-8');
  } catch {
    return { command };
  }

  return { command: `${command.slice(0, startPos)} @"${respAbs}"`, respFile: respAbs };
}
