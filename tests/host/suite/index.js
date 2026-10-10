// 宿主内测试入口（自包含：不依赖 mocha；suite 会被复制到无空格路径下运行）
//
// 契约：VS Code 以 __$__nodeRequire 加载本模块，并要求导出 run(testsRoot, callback)。
// callback(err?, failures?)：failures 为数字且 > 0 时 VS Code 以退出码 1 结束（视为失败）。
// 因此这里**不能**在模块加载阶段执行测试，也不能自行 process.exit。
const { runAll } = require('./framework');
require('./extension.tests');
require('./debug.tests');

exports.run = async (testsRoot, callback) => {
  try {
    console.log(`host testsRoot：${testsRoot}`);
    const failures = await runAll();
    callback(null, failures);
  } catch (err) {
    callback(err);
  }
};
