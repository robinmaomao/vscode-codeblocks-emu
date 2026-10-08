// M0 构建阶段计时探针回归：BuildProfiler 纯模块行为 + BuildEngine 接线（静态断言）
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const { BuildProfiler } = require('../dist/build/buildProfiler.js');

// ---------- A. enabled() 环境变量开关 ----------
const prev = process.env.CB_BUILD_PROFILE;
process.env.CB_BUILD_PROFILE = '1';
check('A1 CB_BUILD_PROFILE=1 时 enabled()=true', BuildProfiler.enabled() === true);
process.env.CB_BUILD_PROFILE = '0';
check('A2 CB_BUILD_PROFILE=0 时 enabled()=false', BuildProfiler.enabled() === false);
delete process.env.CB_BUILD_PROFILE;
check('A3 未设置时 enabled()=false', BuildProfiler.enabled() === false);
if (prev === undefined) delete process.env.CB_BUILD_PROFILE; else process.env.CB_BUILD_PROFILE = prev;

// ---------- B. add/count/time 基本行为 ----------
{
  const p = new BuildProfiler();
  p.add('总计', 10);
  p.add('总计', 5);
  p.count('spawn 次数');
  p.count('spawn 次数', 2);
  const syncVal = p.time('命令生成', () => 42);
  check('B1 time() 返回块内结果', syncVal === 42);
  const rendered = p.render().join('\n');
  check('B2 同键 add 累计（总计 15.0 ms，两次调用显示 ×2）', /总计\s+15\.0 ms（×2）/.test(rendered), rendered);
  check('B3 计数累计（spawn 次数 = 3）', /spawn 次数\s+3/.test(rendered), rendered);
  check('B4 time() 记录条目（命令生成 出现）', /命令生成\s+\d+\.\d ms/.test(rendered), rendered);
}

// ---------- C. 异步计时与异常路径 ----------
(async () => {
  const p = new BuildProfiler();
  const v = await p.timeAsync('异步', async () => 'ok');
  check('C1 timeAsync() 返回块内结果', v === 'ok');
  let threw = false;
  try {
    await p.timeAsync('异步', async () => { throw new Error('x'); });
  } catch { threw = true; }
  check('C2 timeAsync() 异常仍计入并向外抛出', threw && /异步/.test(p.render().join('\n')));

  // ---------- D. render 分组与格式化 ----------
  const q = new BuildProfiler();
  q.add('环境准备', 1);
  q.add('Debug/增量判定', 2);
  q.add('Debug/增量判定', 3);
  q.add('Debug/命令生成', 4);
  q.count('Debug/输出字节', 2048);
  const lines = q.render();
  const idxGlobal = lines.findIndex((l) => l.includes('环境准备'));
  const idxGroup = lines.findIndex((l) => l.includes('── Debug ──'));
  const idxInner = lines.findIndex((l) => l.includes('增量判定'));
  check('D1 全局组在目标组之前', idxGlobal >= 0 && idxGroup > idxGlobal && idxInner > idxGroup, lines);
  check('D2 同键合并并显示 ×2', /增量判定\s+5\.0 ms（×2）/.test(lines.join('\n')), lines);
  check('D3 字节计数格式化 KB', /输出字节\s+2\.0 KB/.test(lines.join('\n')), lines);
  check('D4 空探针 render 仅标题', new BuildProfiler().render().length === 1);

  // ---------- E. BuildEngine 接线（静态断言，防回归） ----------
  const engineJs = fs.readFileSync(path.join(__dirname, '..', 'dist', 'build', 'buildEngine.js'), 'utf-8');
  check('E1 引擎引用 BuildProfiler', /BuildProfiler/.test(engineJs));
  check('E2 引擎开关：环境变量经 BuildProfiler.enabled() + 设置 build.profile 任一开启', /BuildProfiler\.enabled\(\)/.test(engineJs) && /'build\.profile'/.test(engineJs));
  check('E3 构建收尾输出 [profile] 块', /\[Code::Blocks\]\[profile\]/.test(engineJs));
  check('E4 探针关闭时 add 直通（profAdd 早退写法存在）', /profAdd\(/.test(engineJs) && /this\.prof\?\.add\(key, ms\)/.test(engineJs));
  const profJs = fs.readFileSync(path.join(__dirname, '..', 'dist', 'build', 'buildProfiler.js'), 'utf-8');
  check('E5 探针模块读取 CB_BUILD_PROFILE', /CB_BUILD_PROFILE/.test(profJs));

  console.log(`\nbuild-profiler 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
