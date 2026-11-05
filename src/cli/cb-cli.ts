#!/usr/bin/env node
/**
 * cb-cli —— Code::Blocks 工程命令行工具（无 VS Code 宿主）。
 *
 * 设计约束：
 *  - stdout 只输出结果（`--json` 时是纯 JSON）；构建日志与警告全部走 stderr。
 *  - 退出码：0 成功 / 2 用法 / 3 参数校验 / 4 构建或运行失败 / 5 写盘与外部修改。
 *  - src 内禁止 console.*（仓库约定），统一 process.stdout.write / process.stderr.write。
 */
import { asControlError, ControlError } from '../api/types';

type FlagValue = string | boolean;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, FlagValue>;
  json: boolean;
}

const USAGE = `cb-cli —— Code::Blocks project CLI

Usage:
  cb-cli <command> [options]

Commands:
  show <cbp>                       Read the project model (--section summary|targets|files|options|all)
  schema                           Print the editable field schema
  edit <cbp> --ops <json>          Apply edits (--ops-file <file> to read JSON from a file)
  add-file <cbp> <file>            Add a source file (--targets Debug,Release, --no-compile, --no-link)
  remove-file <cbp> <file>         Remove a file
  rename-file <cbp> <from> <to>    Rename a file reference
  add-target <cbp> <title>         Add a target (--copy-from Debug, --type 0..5)
  remove-target <cbp> <title>      Remove a target
  rename-target <cbp> <from> <to>  Rename a target
  build <cbp>                      Build (--rebuild | --clean, --target, --timeout)
  run <cbp>                        Run the built target (--target, --args, --cwd, --timeout)
  export <cbp> --kind <kind>       makefile | compile_commands | commands (--target, --out)
  compiler <list|info>             Inspect compilers (--compiler-id)
  workspace <info|deps|list>       Inspect a .workspace or edit project dependencies
  debug <action>                   Debug control (start|stop|breakpoints|state|stack|variables|evaluate|continue|step)

Options:
  --json                           Machine-readable output on stdout
  --dry-run                        Validate only (edit/build)
  --format canonical|preserve      Write format (default canonical)
  --allow-scripts                  Allow editing build scripts / pre-post commands
  --force                          Overwrite even if modified externally
  --section <name>                 Project read section
  --target <title>                 Build target
  --timeout <ms>                   Timeout for build/run
  --ops <json> / --ops-file <file> Edit operations
  --help, -h                       Show this help
`;

const BOOLEAN_FLAGS = new Set([
  'json', 'dry-run', 'allow-scripts', 'force', 'no-compile', 'no-link', 'rebuild', 'clean', 'help', 'h', 'stop-on-entry',
]);

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, FlagValue> = {};
  const positional: string[] = [];
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key.includes('=')) {
        const [k, ...rest] = key.split('=');
        flags[k] = rest.join('=');
      } else if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
        else flags[key] = true;
      }
      continue;
    }
    if (a === '-h') { flags.help = true; continue; }
    if (!command) { command = a; continue; }
    positional.push(a);
  }
  return { command, positional, flags, json: flags.json === true };
}

function flagString(parsed: ParsedArgs, key: string): string | undefined {
  const v = parsed.flags[key];
  return typeof v === 'string' ? v : undefined;
}

function flagNumber(parsed: ParsedArgs, key: string): number | undefined {
  const s = flagString(parsed, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function out(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

function print(result: unknown, json: boolean): void {
  if (json) { out(JSON.stringify(result, null, 2)); return; }
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    // 人类可读：优先展示常见摘要字段，其余仍以 JSON 呈现，避免"看不到结果"
    if (obj.summary && typeof obj.summary === 'object') {
      const s = obj.summary as Record<string, unknown>;
      out(`ok=${String(obj.ok)} target=${String(obj.target ?? '')} duration=${String(s.durationMs ?? '?')}ms errors=${String(s.errorCount ?? 0)} warnings=${String(s.warningCount ?? 0)}`);
      const projects = Array.isArray(s.projects) ? s.projects as Array<Record<string, unknown>> : [];
      for (const p of projects) {
        out(`  ${String(p.projectTitle ?? p.projectName)} - ${String(p.targetName)}: compiled=${String(p.compiledCount)} skipped=${String(p.skippedCount)} failed=${String(p.failedCount)} link=${p.linkSuccess ? 'ok' : 'fail'}`);
        const diags = Array.isArray(p.diagnostics) ? p.diagnostics as Array<Record<string, unknown>> : [];
        for (const d of diags.slice(0, 20)) {
          out(`    ${String(d.severity)} ${String(d.file ?? '')}:${String(d.line ?? 0)}:${String(d.column ?? 0)} ${String(d.message)}`);
        }
        if (diags.length > 20) out(`    ... ${diags.length - 20} more diagnostic(s)`);
      }
      return;
    }
  }
  out(JSON.stringify(result, null, 2));
}

function exitCodeFor(err: ControlError): number {
  switch (err.code) {
    case 'usage': return 2;
    case 'invalid-input': return 3;
    case 'build-failed':
    case 'build-busy':
    case 'unsupported':
    case 'compiler-missing':
    case 'timeout':
    case 'not-running': return 4;
    case 'external-modified':
    case 'io-error':
    case 'project-not-found':
    case 'workspace-not-found': return 5;
    default: return 1;
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.help || parsed.flags.h || !parsed.command) {
    out(USAGE);
    process.exit(parsed.command ? 0 : 2);
  }

  // 延迟到 shim 安装后再加载（runtime 内部顺序敏感）
  const { createRuntime } = require('./runtime') as typeof import('./runtime');

  const positional = parsed.positional;
  // debug/workspace 的第一个位置参数是 action，项目路径顺延一位
  const cbpIndex = (parsed.command === 'debug' || parsed.command === 'workspace') ? 1 : 0;
  const cbpArg = flagString(parsed, 'cbp') ?? positional[cbpIndex];
  const runtime = createRuntime({ target: cbpArg });
  const ctx = runtime.context;
  // 必须在上面的 createRuntime（内部安装 vscode 替身）之后加载工具注册表
  const { invokeTool } = require('../api/toolRegistry') as typeof import('../api/toolRegistry');

  const json = parsed.json;
  const cmd = parsed.command;
  let result: unknown;

  switch (cmd) {
    case 'show':
    case 'read':
      result = await invokeTool(ctx, 'codeblocks_project_read', {
        cbp: cbpArg,
        section: flagString(parsed, 'section') ?? 'all',
        target: flagString(parsed, 'target'),
      });
      break;

    case 'schema':
      result = await invokeTool(ctx, 'codeblocks_project_read', { section: 'schema' });
      break;

    case 'edit': {
      let opsRaw = flagString(parsed, 'ops');
      const opsFile = flagString(parsed, 'ops-file');
      if (!opsRaw && opsFile) {
        const fs = require('fs') as typeof import('fs');
        opsRaw = fs.readFileSync(opsFile, 'utf8');
      }
      if (!opsRaw) throw new ControlError('usage', 'edit requires --ops <json> or --ops-file <file>');
      let ops: unknown;
      try { ops = JSON.parse(opsRaw); } catch (err) {
        throw new ControlError('invalid-input', `Invalid --ops JSON: ${(err as Error).message}`);
      }
      result = await invokeTool(ctx, 'codeblocks_project_edit', {
        cbp: cbpArg,
        ops,
        dryRun: parsed.flags['dry-run'] === true,
        format: flagString(parsed, 'format'),
        allowScripts: parsed.flags['allow-scripts'] === true,
        force: parsed.flags.force === true,
      });
      break;
    }

    case 'add-file':
      result = await invokeTool(ctx, 'codeblocks_project_file', {
        cbp: cbpArg,
        action: 'add',
        file: positional[1],
        targets: flagString(parsed, 'targets')?.split(',').map((s) => s.trim()).filter(Boolean),
        compile: parsed.flags['no-compile'] !== true,
        link: parsed.flags['no-link'] !== true,
        force: parsed.flags.force === true,
      });
      break;

    case 'remove-file':
      result = await invokeTool(ctx, 'codeblocks_project_file', { cbp: cbpArg, action: 'remove', file: positional[1], force: parsed.flags.force === true });
      break;

    case 'rename-file':
      result = await invokeTool(ctx, 'codeblocks_project_file', { cbp: cbpArg, action: 'rename', file: positional[1], to: positional[2], force: parsed.flags.force === true });
      break;

    case 'add-target':
      result = await invokeTool(ctx, 'codeblocks_project_target', {
        cbp: cbpArg,
        action: 'add',
        title: positional[1],
        copyFrom: flagString(parsed, 'copy-from'),
        targetType: flagNumber(parsed, 'type'),
        force: parsed.flags.force === true,
      });
      break;

    case 'remove-target':
      result = await invokeTool(ctx, 'codeblocks_project_target', { cbp: cbpArg, action: 'remove', title: positional[1], force: parsed.flags.force === true });
      break;

    case 'rename-target':
      result = await invokeTool(ctx, 'codeblocks_project_target', { cbp: cbpArg, action: 'rename', title: positional[1], to: positional[2], force: parsed.flags.force === true });
      break;

    case 'build':
      result = await invokeTool(ctx, 'codeblocks_build', {
        cbp: cbpArg,
        target: flagString(parsed, 'target'),
        mode: parsed.flags.rebuild === true ? 'rebuild' : parsed.flags.clean === true ? 'clean' : 'build',
        timeoutMs: flagNumber(parsed, 'timeout'),
        dryRun: parsed.flags['dry-run'] === true,
      });
      break;

    case 'run':
      result = await invokeTool(ctx, 'codeblocks_run', {
        cbp: cbpArg,
        target: flagString(parsed, 'target'),
        args: flagString(parsed, 'args'),
        cwd: flagString(parsed, 'cwd'),
        timeoutMs: flagNumber(parsed, 'timeout'),
      });
      break;

    case 'export':
      result = await invokeTool(ctx, 'codeblocks_export', {
        cbp: cbpArg,
        kind: flagString(parsed, 'kind') ?? positional[1],
        target: flagString(parsed, 'target'),
        out: flagString(parsed, 'out'),
      });
      break;

    case 'compiler':
      result = await invokeTool(ctx, 'codeblocks_compiler', {
        action: positional[0] === 'info' ? 'info' : 'list',
        compilerId: flagString(parsed, 'compiler-id'),
      });
      break;

    case 'workspace':
      result = await invokeTool(ctx, 'codeblocks_workspace', {
        action: positional[0] ?? 'info',
        workspace: flagString(parsed, 'workspace') ?? positional[1],
        project: flagString(parsed, 'project') ?? positional[2],
        dependencies: positional.slice(3),
      });
      break;

    case 'debug':
      result = await invokeTool(ctx, 'codeblocks_debug', {
        action: positional[0],
        cbp: cbpArg,
        target: flagString(parsed, 'target'),
        args: flagString(parsed, 'args'),
        file: flagString(parsed, 'file'),
        lines: flagString(parsed, 'lines')?.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n)),
        expression: flagString(parsed, 'expression'),
        frameId: flagNumber(parsed, 'frame'),
        kind: flagString(parsed, 'kind'),
        stopOnEntry: parsed.flags['stop-on-entry'] === true,
      });
      break;

    default:
      throw new ControlError('usage', `Unknown command: ${cmd}`);
  }

  print(result, json);
  const failed = result && typeof result === 'object' && (result as { ok?: unknown }).ok === false;
  process.exit(failed ? 4 : 0);
}

main().catch((err) => {
  const e = asControlError(err);
  process.stderr.write(`${e.code}: ${e.message}\n`);
  if (e.details !== undefined) {
    try { process.stderr.write(JSON.stringify(e.details, null, 2) + '\n'); } catch { /* 忽略序列化失败 */ }
  }
  process.exit(exitCodeFor(e));
});
