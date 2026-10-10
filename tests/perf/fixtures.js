// 大工程探针生成器：造出「规模真实」的 .cbp（1200 文件 / 6 目标 / 40 目录 / 虚拟文件夹），
// 供解析、命令行生成、树模型等性能基准与 E2E 复用。生成物只落临时目录，不污染仓库。
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_OPTS = {
  files: 1200,
  targets: ['Debug', 'Release', 'Profile', 'libstatic', 'libshared', 'vendor'],
  dirs: 40,           // src 下的子目录数量
  includePerDir: 6,   // 每个目录声明的 include 目录数
  withSources: true,  // 是否同时写出真实源文件（E2E 需要；纯解析基准可关）
  longNames: false,   // 子目录使用长名（用于触发响应文件/长命令行场景）
};

const LONG_SEGMENT = 'component_module_directory_segment';

/**
 * 生成探针工程。
 * @param {string} [baseDir] 目标目录（默认 os.tmpdir/cb-perf-<rand>）
 * @returns {{ dir: string, cbp: string, sources: number, targets: string[], files: number }}
 */
function generateBigProject(baseDir, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const dir = baseDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cb-perf-'));
  fs.mkdirSync(dir, { recursive: true });

  const exts = ['.c', '.cpp', '.h', '.S'];
  const units = [];
  let sources = 0;
  for (let i = 0; i < o.files; i++) {
    const bucket = i % o.dirs;
    const segment = `d${String(bucket).padStart(2, '0')}${o.longNames ? '/' + LONG_SEGMENT : ''}`;
    const sub = `src/${segment}`;
    const ext = exts[i % exts.length];
    const rel = `${sub}/file_${String(i).padStart(4, '0')}${ext}`;
    const vf = ext === '.h' ? `include/d${String(bucket).padStart(2, '0')}` : `src/${segment}`;
    const targetAttr = i % 7 === 0 ? ` target="Debug;Release"` : '';
    const weight = i % 11 === 0 ? ` weight="${i % 100}"` : '';
    units.push(`\t\t<Unit filename="${rel}">\n\t\t\t<Option virtualFolder="${vf}"${targetAttr}${weight} />\n\t\t</Unit>`);
    if (o.withSources && ext !== '.h') {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (ext === '.c') fs.writeFileSync(abs, `int f_${i}(void) { return ${i}; }\n`, 'utf-8');
      else if (ext === '.cpp') fs.writeFileSync(abs, `// cpp probe ${i}\nint g_${i}() { return ${i}; }\n`, 'utf-8');
      else fs.writeFileSync(abs, `\t.text\nglobl_${i}:\n\tret\n`, 'utf-8');
      sources++;
    }
    if (o.withSources && ext === '.h') {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `#pragma once\nint probe_${i}(void);\n`, 'utf-8');
    }
  }

  const targetXml = o.targets.map((title, idx) => {
    const kind = idx === 3 ? 2 : idx === 4 ? 3 : idx === 5 ? 4 : 1;
    const out = idx === 3 ? 'lib/perfstatic' : idx === 4 ? 'bin/shared/perfcore' : idx === 5 ? '' : `bin/${title}/perf-app`;
    const objDir = `obj/${title}/`;
    const comp = idx % 2 === 0 ? ['-g', '-Wall', '-Wextra'] : ['-O2', '-Wall'];
    return [
      `\t\t<Target title="${title}">`,
      `\t\t\t<Option type="${kind}" />`,
      `\t\t\t<Option compiler="gcc" />`,
      out ? `\t\t\t<Option output="${out}" />` : '',
      `\t\t\t<Option object_output="${objDir}" />`,
      `\t\t\t<Option parameters="--run-in ${title}" />`,
      `\t\t\t<Compiler>`,
      ...comp.map((c) => `\t\t\t\t<Add option="${c}" />`),
      `\t\t\t</Compiler>`,
      `\t\t\t<Linker>`,
      `\t\t\t\t<Add option="-Wl,--gc-sections" />`,
      idx % 3 === 0 ? `\t\t\t\t<Add library="m" />` : '',
      `\t\t\t</Linker>`,
      `\t\t\t<IncludeDirs>`,
      ...Array.from({ length: o.includePerDir }, (_, k) => `\t\t\t\t<Add directory="vendor/d${k}/include" />`),
      `\t\t\t</IncludeDirs>`,
      `\t\t</Target>`,
    ].filter(Boolean).join('\n');
  }).join('\n');

  const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="perf-big" />
\t\t<Option compiler="gcc" />
\t\t<Option virtualFolders="${Array.from({ length: o.dirs }, (_, i) => `src/d${String(i).padStart(2, '0')}`).join(';')}" />
\t\t<Build>
${targetXml}
\t\t</Build>
\t\t<VirtualTargets>
\t\t\t<Add alias="All" targets="Debug;Release;Profile;libstatic;libshared" />
\t\t</VirtualTargets>
\t\t<Compiler>
\t\t\t<Add option="-pipe" />
\t\t\t<Add directory="include" />
\t\t</Compiler>
\t\t<Linker>
\t\t\t<Add option="-static-libgcc" />
\t\t</Linker>
\t\t<ExtraCommands>
\t\t\t<Add before="echo perf pre-build" />
\t\t\t<Add after="echo perf post-build" />
\t\t</ExtraCommands>
${units.join('\n')}
\t\t<Extensions>
\t\t\t<codeblocks_project_custom_variables>
\t\t\t\t<BUILD_ROOT value="build/perf" />
\t\t\t</codeblocks_project_custom_variables>
\t\t</Extensions>
\t</Project>
</CodeBlocks_project_file>
`;
  const cbpPath = path.join(dir, 'perf-big.cbp');
  fs.writeFileSync(cbpPath, cbp, 'utf-8');
  const sourceFiles = units.length ? collectSources(dir) : [];
  return { dir, cbp: cbpPath, sources, targets: o.targets, files: o.files, sourceFiles };
}

/** 收集生成物中的真实源文件（供 E2E 覆写 main 等用途） */
function collectSources(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(c|cpp|S)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** 生成 N 份 .cbp 副本（解析缓存以文件名为键，冷解析基准需要不同文件名） */
function copyVariants(src, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = src.replace(/\.cbp$/, `.v${i}.cbp`);
    fs.copyFileSync(src, p);
    out.push(p);
  }
  return out;
}

module.exports = { generateBigProject, copyVariants, DEFAULT_OPTS };
