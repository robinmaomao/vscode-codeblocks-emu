// P2 回归：兜底符号索引懒构建（SymbolIndex.rebuildAsync 分片 + 让出事件循环）+ extension 接线静态断言
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    const K = { Function: 2, Constant: 21, Struct: 22, Enum: 13, Class: 5, TypeParameter: 25, Variable: 6, Method: 1, Field: 8 };
    return {
      CompletionItemKind: K,
      SymbolKind: { Function: 2, Constant: 21, Class: 5, Enum: 13, TypeParameter: 25, Variable: 6, Object: 19 },
      SnippetString: class { constructor(v) { this.value = v; } },
      CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind; } },
      SymbolInformation: class { constructor(name, kind, range, uri) { this.name = name; } },
      Range: class { constructor(a, b, c, d) { this.a = a; } },
      Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }) },
      MarkdownString: class {}, Hover: class {}, Location: class { constructor(u, p) {} },
      Position: class {},
      languages: {
        registerCompletionItemProvider: () => ({ dispose() {} }),
        registerHoverProvider: () => ({ dispose() {} }),
        registerDefinitionProvider: () => ({ dispose() {} }),
        registerDocumentSymbolProvider: () => ({ dispose() {} }),
      },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SymbolIndex } = require(path.resolve(__dirname, '../dist/tools/codeCompletion.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-index-'));
const w = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text, 'utf-8'); return p; };
const files = [
  w('a.c', '#define FOO 1\nint add(int a, int b) {\n  return a + b;\n}\n'),
  w('b.c', 'struct Point {\n  int x;\n};\n'),
  w('c.h', 'typedef struct { int v; } MyType;\n'),
  w('d.c', 'unsigned long counter = 0;\n'),
  w('e.c', 'void helper(void);\n'),
];
const nonIndexable = w('readme.txt', '#define TXT 1\n');
const missing = path.join(dir, 'gone.c'); // 不存在 → scanFile 静默跳过

// ---- 1. rebuildAsync 基本正确性（与 rebuild 同结果） ----
(async () => {
  const idx = new SymbolIndex();
  await idx.rebuildAsync([...files, nonIndexable, missing]);
  check('A1 索引收录宏', idx.lookup('FOO').length === 1, idx.lookup('FOO').length, 1);
  check('A2 索引收录函数', idx.lookup('add').length >= 1, idx.lookup('add').length, '>=1');
  check('A3 索引收录结构体', idx.lookup('Point').length === 1, idx.lookup('Point').length, 1);
  check('A4 索引收录 typedef 名', idx.lookup('MyType').length === 1, idx.lookup('MyType').length, 1);
  check('A5 非索引扩展名跳过（.txt 中的宏不收录）', idx.lookup('TXT').length === 0, idx.lookup('TXT').length, 0);
  check('A6 缺失文件静默跳过（不抛异常）', idx.allEntries().length > 0, idx.allEntries().length, '>0');

  // ---- 2. 分片让出：chunkSize=2，10 个可索引文件 → 5 次让出 ----
  {
    const many = [];
    for (let i = 0; i < 10; i++) many.push(w(`m${i}.c`, `int fn${i}(void) {\n  return ${i};\n}\n`));
    let yields = 0;
    const idx2 = new SymbolIndex();
    await idx2.rebuildAsync(many, { chunkSize: 2, yieldControl: async () => { yields++; } });
    check('B1 让出次数 = floor(可索引数/chunkSize)', yields === 5, yields, 5);
    check('B2 分片构建结果完整', idx2.lookup('fn9').length === 1, idx2.lookup('fn9').length, 1);
  }

  // ---- 3. 不可索引文件不参与让出计数 ----
  {
    let yields = 0;
    const idx3 = new SymbolIndex();
    await idx3.rebuildAsync([nonIndexable, nonIndexable, ...files.slice(0, 3)], { chunkSize: 4, yieldControl: async () => { yields++; } });
    check('B3 跳过项不计入分片（3 个可索引 < 4 → 0 次让出）', yields === 0, yields, 0);
  }

  // ---- 4. 重建清空旧条目 ----
  {
    const idx4 = new SymbolIndex();
    await idx4.rebuildAsync([files[0]]);
    await idx4.rebuildAsync([files[2]]);
    check('B4 二次重建先清空旧条目', idx4.lookup('add').length === 0 && idx4.lookup('MyType').length === 1, { add: idx4.lookup('add').length }, 'cleared');
  }

  // ---- 5. 同步 rebuild 兼容保留 ----
  {
    const idx5 = new SymbolIndex();
    idx5.rebuild([files[0]]);
    check('B5 同步 rebuild 仍可用（兼容）', idx5.lookup('add').length >= 1, idx5.lookup('add').length, '>=1');
  }

  // ---- 6. extension 接线静态断言 ----
  const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
  check('C1 dist 含懒构建入口 markFallbackIndexDirty', ext.includes('markFallbackIndexDirty'), null);
  check('C2 dist 含按需构建 requestFallbackIndexBuild（单飞）', ext.includes('requestFallbackIndexBuild'), null);
  check('C3 dist 用 rebuildAsync（不再同步全量重建）', ext.includes('rebuildAsync'), null);
  check('C4 dist 无旧函数 rebuildFallbackIndex 定义', !ext.includes('function rebuildFallbackIndex'), null);
  check('C5 dist 兜底 provider 传入 onDemand 回调',
    /registerFallbackIntelliSense\)\(fallbackIndex, \(\) => fallbackEnabled, requestFallbackIndexBuild\)/.test(ext), null);
  check('C6 dist 符号视图可见性触发构建（精确形态，非宽泛断言）',
    ext.includes('symbolsTreeView.onDidChangeVisibility') && ext.includes('symbolsViewVisible'), null);
  // P2 复核修复：单飞期间再次置脏 → 收尾追加重建（dirty 未消化且视图可见、失败除外）；构建异常保留脏标记
  check('C7 dist 单飞收尾追加重建（fallbackIndexDirty && symbolsViewVisible）',
    /fallbackIndexDirty\s*&&\s*symbolsViewVisible/.test(ext), null);
  check('C8 dist 构建异常保留脏标记（catch 上下文，非恒真断言）',
    /catch\s*\{\s*failed = true;\s*fallbackIndexDirty = true/.test(ext), null);
  check('C9 dist 失败时不立即重试（!failed 守卫）',
    /!failed\s*&&\s*fallbackIndexDirty\s*&&\s*symbolsViewVisible/.test(ext), null);

  console.log(`\nfallback-index-lazy: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL 运行异常: ' + (e && e.stack || e));
  process.exit(1);
});
