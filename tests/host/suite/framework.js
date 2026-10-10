// 极简宿主测试框架（零外部依赖：宿主内只保证 node 内建 + vscode 可用，
// 且 suite 会被复制到无空格路径运行，无法解析仓库 node_modules）。
const entries = [];

// 单用例超时：宿主内 UI/调试交互可能永久挂起（例如等待用户点击），必须让失败而不是让整轮卡死
const TEST_TIMEOUT = Number(process.env.CB_HOST_TEST_TIMEOUT || 180000);

function suite(name, fn) {
  const group = { name, tests: [] };
  entries.push(group);
  const api = {
    test: (testName, testFn) => group.tests.push({ name: testName, fn: testFn }),
  };
  fn(api);
}

async function runWithTimeout(fn, ms) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`测试超时（${ms} ms）`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runAll() {
  let pass = 0, fail = 0, skip = 0;
  const failures = [];
  for (const group of entries) {
    console.log(`\n[${group.name}]`);
    for (const t of group.tests) {
      const label = `${group.name} › ${t.name}`;
      const ctx = { skip: () => { throw Object.assign(new Error('SKIP'), { __skip: true }); } };
      const t0 = Date.now();
      try {
        await runWithTimeout(t.fn.bind(null, ctx), TEST_TIMEOUT);
        pass++;
        console.log(`OK   ${label}（${Date.now() - t0} ms）`);
      } catch (err) {
        if (err && err.__skip) {
          skip++;
          console.log(`SKIP ${label}`);
          continue;
        }
        fail++;
        failures.push(label);
        console.log(`FAIL ${label}（${Date.now() - t0} ms）\n     ${err && err.stack ? String(err.stack).split('\n').slice(0, 3).join('\n     ') : err}`);
      }
    }
  }
  console.log(`\nhost 宿主集成: ${pass} pass, ${fail} fail, ${skip} skip${failures.length ? '  [' + failures.join(' | ') + ']' : ''}`);
  return fail;
}

module.exports = { suite, runAll };
