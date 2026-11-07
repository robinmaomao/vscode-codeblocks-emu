/**
 * 内容搜索 worker 入口（由 esbuild 单独打包为 bundle/search-worker.js）。
 *
 * 协议：
 *   宿主 → worker: { type:'search', id, files, query, caseSensitive, regex, limits? }
 *                  { type:'cancel', id }
 *   worker → 宿主: { type:'progress', id, scanned, total, matches }
 *                  { type:'result', id, result }
 *                  { type:'error', id, message }
 */
import { parentPort } from 'node:worker_threads';
import { defaultTextCache, searchFileSet, TextSearchFile } from './textSearchTasks';

export interface WorkerSearchMessage {
  type: 'search';
  id: number;
  files: TextSearchFile[];
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  limits?: {
    maxFileBytes?: number;
    maxFileMatches?: number;
    maxTotalMatches?: number;
    concurrency?: number;
  };
}

export interface WorkerCancelMessage {
  type: 'cancel';
  id?: number;
}

type Incoming = WorkerSearchMessage | WorkerCancelMessage;

if (!parentPort) {
  throw new Error('search worker must run inside worker_threads');
}

const port = parentPort;
const cache = defaultTextCache();
let controller: AbortController | undefined;
let currentId = 0;

function post(message: unknown): void {
  try {
    port.postMessage(message);
  } catch {
    /* 宿主已退出：忽略 */
  }
}

port.on('message', (message: Incoming) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'cancel') {
    if (message.id === undefined || message.id === currentId) controller?.abort();
    return;
  }

  if (message.type !== 'search') return;
  controller?.abort();
  const id = Number(message.id) || 0;
  currentId = id;
  const local = new AbortController();
  controller = local;

  void searchFileSet(Array.isArray(message.files) ? message.files : [], {
    query: String(message.query ?? ''),
    caseSensitive: message.caseSensitive === true,
    regex: message.regex === true,
    maxFileBytes: message.limits?.maxFileBytes,
    maxFileMatches: message.limits?.maxFileMatches,
    maxTotalMatches: message.limits?.maxTotalMatches,
    concurrency: message.limits?.concurrency,
    cache,
    signal: local.signal,
    onProgress: (p) => post({ type: 'progress', id, ...p }),
  })
    .then((result) => post({ type: 'result', id, result }))
    .catch((err) => post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) }));
});
