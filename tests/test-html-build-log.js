// HTML 构建日志回归（对齐 CB SaveBuildLog/InitBuildLog）：
//  - 文件名基名 hello-cb.cbp → hello-cb（InitBuildLog:3888-3893）
//  - CB 时间戳格式 %d-%m-%Y at %H:%M.%S（SaveBuildLog:3926/3929）
//  - 渲染：<title> 转义 / 起止时间行 / 诊断表（severity/file/line/message）
const path = require('path');
const { buildLogBaseName, cbTimeStamp, escapeHtml, renderHtmlBuildLog } = require(path.resolve(__dirname, '../dist/build/htmlBuildLog.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

// ---- 文件名基名（CB：basepath + basename + "_build_log.html"）----
check('hello-cb.cbp → hello-cb', buildLogBaseName('E:/ws/test-project/hello-cb.cbp') === 'hello-cb', buildLogBaseName('E:/ws/test-project/hello-cb.cbp'));
check('反斜杠路径同样剥离扩展名', buildLogBaseName('C:\\ws\\demo.workspace') === 'demo', buildLogBaseName('C:\\ws\\demo.workspace'));
check('多点文件名只剥最后扩展名', buildLogBaseName('E:/ws/my.project.cbp') === 'my.project', buildLogBaseName('E:/ws/my.project.cbp'));

// ---- CB 时间戳（本地时间构造避免时区依赖）----
const t1 = new Date(2026, 8, 28, 10, 23, 45).getTime();
check('时间戳 = 28-09-2026 at 10:23.45', cbTimeStamp(t1) === '28-09-2026 at 10:23.45', cbTimeStamp(t1));
const t2 = new Date(2026, 0, 5, 3, 7, 9).getTime();
check('单位数补零 = 05-01-2026 at 03:07.09', cbTimeStamp(t2) === '05-01-2026 at 03:07.09', cbTimeStamp(t2));

// ---- HTML 转义（保护性差异：CB 直写）----
check('转义 < > &', escapeHtml('<a href="x">&"y"</a>') === '&lt;a href="x"&gt;&amp;"y"&lt;/a&gt;', escapeHtml('<a href="x">&"y"</a>'));
check('undefined → 空串', escapeHtml(undefined) === '', escapeHtml(undefined));

// ---- 渲染 ----
const end = new Date(2026, 8, 28, 10, 24, 2).getTime();
const html = renderHtmlBuildLog({
  title: 'Hello <b>World</b> build log',
  startMs: t1,
  endMs: end,
  projects: [
    {
      projectName: 'hello-cb',
      targetName: 'Debug',
      diagnostics: [
        { severity: 'error', message: "expected ';' before '}'", file: 'E:/ws/main.c', line: 12 },
        { severity: 'warning', message: 'unused variable <x>', file: 'E:/ws/util.c', line: 3 },
      ],
    },
    { projectName: 'lib', targetName: 'Release', diagnostics: [] },
  ],
});

check('结构：DOCTYPE / <tt> / </html>', html.startsWith('<!DOCTYPE html>') && html.includes('<tt>') && html.trimEnd().endsWith('</html>'), null);
check('标题被转义写入 <title>', html.includes('<title>Hello &lt;b&gt;World&lt;/b&gt; build log</title>'), null);
check('起止时间行（CB 格式）', html.includes('Build started on: <u>28-09-2026 at 10:23.45</u><br />') && html.includes('Build ended on: <u>28-09-2026 at 10:24.02</u>'), null);
check('工程/目标表头行', html.includes('<th colspan="4" style="text-align:left">hello-cb — Debug</th>') && html.includes('<th colspan="4" style="text-align:left">lib — Release</th>'), null);
check('error 行（class/严重度/文件/行号/消息）', html.includes('<tr class="error"><td>error</td><td>E:/ws/main.c</td><td>12</td><td>expected \';\' before \'}\'</td></tr>'), null);
check('warning 行消息转义', html.includes('<tr class="warning"><td>warning</td><td>E:/ws/util.c</td><td>3</td><td>unused variable &lt;x&gt;</td></tr>'), null);
check('无诊断工程仅有表头行', html.includes('<tr><th colspan="4" style="text-align:left">lib — Release</th></tr></table>'), null);

// ---- 无诊断（成功构建）也可渲染 ----
const htmlOk = renderHtmlBuildLog({ title: 'hello-cb build log', startMs: t1, endMs: end, projects: [{ projectName: 'hello-cb', targetName: 'Debug', diagnostics: [] }] });
check('成功构建：无诊断行但保留表头', htmlOk.includes('<th colspan="4" style="text-align:left">hello-cb — Debug</th>') && !htmlOk.includes('class="error"'), null);

console.log(`HTML 构建日志回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
