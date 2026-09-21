/**
 * 兜底 IntelliSense —— 轻量项目符号索引 + 补全 / 悬停 / 跳转。
 *
 * 仅当 clangd 不可用时启用（isEnabled 返回 true 时才生效），
 * 符号提取只做词法级扫描（参考 CodeBlocks codecompletion tokenizer 思路，
 * 不移植完整语法树），覆盖项目内函数 / 宏 / 类型 / 变量。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';

export interface SymbolEntry {
  name: string;
  kind: vscode.CompletionItemKind;
  detail?: string;
  insertText?: string;
  file: string;
  line: number; // 1-based
}

/** C/C++ 关键字与内建类型（用于过滤误匹配） */
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return',
  'break', 'continue', 'goto', 'sizeof', 'typedef', 'struct', 'enum', 'union',
  'class', 'namespace', 'using', 'template', 'typename', 'public', 'private',
  'protected', 'const', 'static', 'extern', 'volatile', 'register', 'inline',
  'virtual', 'friend', 'operator', 'new', 'delete', 'this', 'throw', 'try',
  'catch', 'true', 'false', 'nullptr', 'NULL', 'asm', '__asm__', '__attribute__',
  '__declspec', 'alignas', 'alignof', 'static_assert', '_Static_assert',
  'signed', 'unsigned', 'void', 'bool', 'char', 'int', 'long', 'short',
  'float', 'double', 'auto', 'decltype', 'constexpr', 'mutable', 'explicit',
  'size_t', 'ssize_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uintptr_t', 'intptr_t',
]);

/** 是否是可参与索引的源文件 */
function isIndexable(filename: string): boolean {
  return /\.(c|cpp|cc|cxx|C|h|hpp|hh|hxx)$/.test(filename);
}

/** 去除注释与字符串/字符字面量，保留换行（保证行号一致） */
function stripCommentsAndStrings(content: string): string {
  let out = '';
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i];
    const next = content[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && content[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"') {
      out += '""';
      i++;
      while (i < n && content[i] !== '"') {
        if (content[i] === '\\') i++;
        if (content[i] === '\n') out += '\n';
        i++;
      }
      i++;
    } else if (c === "'") {
      out += "''";
      i++;
      while (i < n && content[i] !== "'") {
        if (content[i] === '\\') i++;
        i++;
      }
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export class SymbolIndex {
  private byName = new Map<string, SymbolEntry[]>();
  private all: SymbolEntry[] = [];

  /** 从源文件列表重建索引（增量全量重建均可） */
  rebuild(files: string[]): void {
    this.byName.clear();
    this.all = [];
    for (const file of files) {
      if (!isIndexable(file)) continue;
      this.scanFile(file);
    }
  }

  lookup(name: string): SymbolEntry[] {
    return this.byName.get(name) ?? [];
  }

  allEntries(): SymbolEntry[] {
    return this.all;
  }

  private add(entry: SymbolEntry): void {
    if (!entry.name || KEYWORDS.has(entry.name)) return;
    // 同名合并（同名函数重载 / 声明与定义），保留首个 detail
    const existing = this.byName.get(entry.name);
    if (existing) {
      if (!entry.detail) entry.detail = existing[0].detail;
      existing.push(entry);
    } else {
      this.byName.set(entry.name, [entry]);
    }
    this.all.push(entry);
  }

  private scanFile(file: string): void {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      return; // 二进制 / 无权限，跳过
    }
    const cleaned = stripCommentsAndStrings(content);
    const lines = cleaned.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const line = lines[i];

      // #define NAME / #define NAME(args)
      const def = line.match(/^\s*#\s*define\s+([A-Za-z_]\w*)\b(?:\(([^)]*)\))?/);
      if (def) {
        const name = def[1];
        const isFn = def[2] !== undefined;
        this.add({
          name,
          kind: isFn ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Constant,
          detail: isFn ? `#define ${name}(${def[2]})` : `#define ${name}`,
          insertText: isFn ? `${name}($1)` : name,
          file,
          line: lineNo,
        });
        continue;
      }

      // struct / enum / union / class NAME
      const type = line.match(/^\s*(?:typedef\s+)?(struct|enum|union|class)\s+([A-Za-z_]\w*)/);
      if (type) {
        const kindMap: Record<string, vscode.CompletionItemKind> = {
          struct: vscode.CompletionItemKind.Struct,
          enum: vscode.CompletionItemKind.Enum,
          union: vscode.CompletionItemKind.Struct,
          class: vscode.CompletionItemKind.Class,
        };
        this.add({
          name: type[2],
          kind: kindMap[type[1]],
          detail: `${type[1]} ${type[2]}`,
          file,
          line: lineNo,
        });
        continue;
      }

      // typedef struct {...} Name; / typedef ... Name;
      const typedef = line.match(/\}\s*([A-Za-z_]\w*)\s*;/) || line.match(/^\s*typedef\b[^;]*?\s([A-Za-z_]\w*)\s*;/);
      if (typedef && !KEYWORDS.has(typedef[1])) {
        this.add({
          name: typedef[1],
          kind: vscode.CompletionItemKind.TypeParameter,
          detail: `typedef ${typedef[1]}`,
          file,
          line: lineNo,
        });
        continue;
      }

      // 函数：return_type name(params) { / ; / const
      const fn = line.match(/^\s*(?:[\w:<>~*&\[\]\s]+?\s+)?([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*(?:\{|;|const\b)/);
      if (fn && !KEYWORDS.has(fn[1]) && !/^\s*(?:if|for|while|switch)\s*\(/.test(line)) {
        this.add({
          name: fn[1],
          kind: vscode.CompletionItemKind.Function,
          detail: `${fn[1]}(${fn[2].trim()})`,
          insertText: `${fn[1]}($1)`,
          file,
          line: lineNo,
        });
        continue;
      }

      // 变量：type name = / ; / [（行内有类型关键字）
      const hasType = /\b(int|char|float|double|long|short|unsigned|signed|void|bool|size_t|uint\d+_t|int\d+_t)\b/.test(line);
      if (hasType && !line.includes('(')) {
        const vr = line.match(/^\s*(?:[\w:<>~*&\[\]\s]+?\s+)([A-Za-z_]\w*)\s*(?:=|;|\[)/);
        if (vr && !KEYWORDS.has(vr[1])) {
          this.add({
            name: vr[1],
            kind: vscode.CompletionItemKind.Variable,
            detail: `${vr[1]} (变量)`,
            file,
            line: lineNo,
          });
        }
      }
    }
  }
}

/** 取光标前的标识符前缀（用于补全过滤） */
function getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
  const line = document.lineAt(position).text;
  const before = line.slice(0, position.character);
  const m = before.match(/[A-Za-z_]\w*$/);
  return m ? m[0] : '';
}

/** 取光标处单词（用于悬停 / 跳转） */
function getWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  return wordRange;
}

/** CompletionItemKind → SymbolKind（用于文档符号） */
function toSymbolKind(kind: vscode.CompletionItemKind): vscode.SymbolKind {
  switch (kind) {
    case vscode.CompletionItemKind.Function:
    case vscode.CompletionItemKind.Method:
      return vscode.SymbolKind.Function;
    case vscode.CompletionItemKind.Constant:
      return vscode.SymbolKind.Constant;
    case vscode.CompletionItemKind.Struct:
    case vscode.CompletionItemKind.Class:
      return vscode.SymbolKind.Class;
    case vscode.CompletionItemKind.Enum:
      return vscode.SymbolKind.Enum;
    case vscode.CompletionItemKind.TypeParameter:
      return vscode.SymbolKind.TypeParameter;
    case vscode.CompletionItemKind.Variable:
    case vscode.CompletionItemKind.Field:
      return vscode.SymbolKind.Variable;
    default:
      return vscode.SymbolKind.Object;
  }
}

/**
 * 注册兜底 IntelliSense（补全 / 悬停 / 跳转定义）。
 * @param index 项目符号索引
 * @param isEnabled 返回 true 时兜底生效（clangd 不可用时）
 */
export function registerFallbackIntelliSense(
  index: SymbolIndex,
  isEnabled: () => boolean,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  const langs = ['c', 'cpp'];

  const completion = vscode.languages.registerCompletionItemProvider(langs, {
    provideCompletionItems(document, position) {
      if (!isEnabled()) return undefined;
      const prefix = getPrefix(document, position);
      const items: vscode.CompletionItem[] = [];
      for (const e of index.allEntries()) {
        if (!e.name.startsWith(prefix) || e.name === prefix) continue;
        const item = new vscode.CompletionItem(e.name, e.kind);
        item.detail = e.detail;
        item.documentation = `${e.file}:${e.line}`;
        if (e.insertText) {
          item.insertText = new vscode.SnippetString(e.insertText);
        }
        items.push(item);
      }
      return items;
    },
  }, ...'.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split(''));
  disposables.push(completion);

  const hover = vscode.languages.registerHoverProvider(langs, {
    provideHover(document, position) {
      if (!isEnabled()) return undefined;
      const range = getWordRange(document, position);
      if (!range) return undefined;
      const word = document.getText(range);
      const entries = index.lookup(word);
      if (!entries.length) return undefined;
      const e = entries[0];
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(e.detail ?? e.name, 'cpp');
      markdown.appendText(`\n\n${e.file}:${e.line}`);
      return new vscode.Hover(markdown, range);
    },
  });
  disposables.push(hover);

  const definition = vscode.languages.registerDefinitionProvider(langs, {
    provideDefinition(document, position) {
      if (!isEnabled()) return undefined;
      const range = getWordRange(document, position);
      if (!range) return undefined;
      const word = document.getText(range);
      const entries = index.lookup(word);
      if (!entries.length) return undefined;
      const e = entries[0];
      return new vscode.Location(vscode.Uri.file(e.file), new vscode.Position(e.line - 1, 0));
    },
  });
  disposables.push(definition);

  // 文档符号（大纲视图）：列出当前文件的索引符号
  const documentSymbols = vscode.languages.registerDocumentSymbolProvider(langs, {
    provideDocumentSymbols(document) {
      if (!isEnabled()) return undefined;
      const file = document.uri.fsPath;
      const syms: vscode.SymbolInformation[] = [];
      for (const e of index.allEntries()) {
        if (e.file !== file) continue;
        syms.push(new vscode.SymbolInformation(
          e.name,
          toSymbolKind(e.kind),
          new vscode.Range(e.line - 1, 0, e.line - 1, 0),
          vscode.Uri.file(e.file),
        ));
      }
      return syms.length ? syms : undefined;
    },
  });
  disposables.push(documentSymbols);

  return disposables;
}
