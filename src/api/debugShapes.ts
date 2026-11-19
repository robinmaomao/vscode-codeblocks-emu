/**
 * 调试工具响应归一化（无 vscode 依赖）。
 *
 * `codeblocks_debug` 是同一份工具契约，但两种传输的底层实现不同：
 *  - 扩展内：`vscode.debug` + DAP（帧 id/名称、scopes 结构）
 *  - CLI / MCP：gdb/MI 无头会话（level/addr/func、扁平 variables）
 *
 * 若不归一化，模型在两种传输间切换会读错字段（`state.stopped`、`frames[].name`、`variables.scopes`…）。
 * 这里把两边都映射到同一份文档化形状，`toolRegistry` 只需调用一次。
 */

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** 统一后的栈帧：id/level/name/file/line/column/address（存在才出现） */
function normalizeFrame(raw: unknown): Json {
  const f = asObject(raw);
  const frame: Json = {};
  const id = num(f.id);
  if (id !== undefined) frame.id = id;
  const level = num(f.level);
  if (level !== undefined) frame.level = level;
  // gdb 只给 level：把 level 同时作为 id 暴露，`frameId`（variables/evaluate）在两端语义一致
  if (id === undefined && level !== undefined) frame.id = level;
  const name = str(f.name) ?? str(f.func);
  if (name) frame.name = name;
  // gdb 的 file 是相对名、fullname 才是绝对路径；DAP 帧没有 fullname
  const file = str(f.fullname) ?? str(f.file);
  if (file) frame.file = file;
  const line = num(f.line);
  if (line !== undefined) frame.line = line;
  const column = num(f.column);
  if (column !== undefined) frame.column = column;
  const address = str(f.address) ?? str(f.addr);
  if (address) frame.address = address;
  return frame;
}

function normalizeVariable(raw: unknown): Json {
  const v = asObject(raw);
  const out: Json = { name: str(v.name) ?? '', value: str(v.value) ?? String(v.value ?? '') };
  const type = str(v.type);
  if (type) out.type = type;
  const children = num(v.children);
  if (children !== undefined) out.children = children;
  return out;
}

function normalizeScope(raw: unknown): Json {
  const s = asObject(raw);
  return {
    name: str(s.name) ?? 'Locals',
    variables: Array.isArray(s.variables) ? s.variables.map(normalizeVariable) : [],
  };
}

/** 把两种传输的结果映射到同一份形状（未知 action 原样返回） */
export function normalizeDebugResult(action: string, raw: unknown): unknown {
  const value = asObject(raw);
  switch (action) {
    case 'state': {
      const out: Json = { active: value.active === true };
      for (const key of ['stopped', 'reason', 'threadId', 'id', 'name', 'type'] as const) {
        if (value[key] !== undefined) out[key] = value[key];
      }
      return out;
    }
    case 'stack': {
      const frames = Array.isArray(value.frames) ? value.frames.map(normalizeFrame) : [];
      const out: Json = { frames };
      const threadId = num(value.threadId);
      if (threadId !== undefined) out.threadId = threadId;
      return out;
    }
    case 'variables': {
      const scopes = Array.isArray(value.scopes)
        ? value.scopes.map(normalizeScope)
        // gdb/MI 只给当前帧的扁平变量表 ⇒ 包成单一作用域
        : Array.isArray(value.variables)
          ? [{ name: 'Locals', variables: value.variables.map(normalizeVariable) }]
          : [];
      const out: Json = { scopes };
      const frameId = num(value.frameId);
      if (frameId !== undefined) out.frameId = frameId;
      return out;
    }
    case 'evaluate': {
      const out: Json = {
        expression: str(value.expression) ?? '',
        result: value.result ?? value.value ?? '',
      };
      const type = str(value.type);
      if (type) out.type = type;
      return out;
    }
    case 'start': {
      const out: Json = { ok: value.ok !== false };
      if (value.session !== undefined) out.session = value.session;
      for (const key of ['program', 'cwd', 'stopped', 'reason', 'threadId'] as const) {
        if (value[key] !== undefined) out[key] = value[key];
      }
      return out;
    }
    case 'breakpoints': {
      const out: Json = {
        ok: value.ok !== false,
        file: str(value.file) ?? '',
        lines: Array.isArray(value.lines) ? value.lines : [],
      };
      if (value.breakpoints !== undefined) out.breakpoints = value.breakpoints;
      return out;
    }
    default:
      return raw;
  }
}
