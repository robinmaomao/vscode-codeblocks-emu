// 兼容入口：共享的工程夹具生成器已下沉到 tests/_harness/projectFixtures.js。
// 原因：E2E 层原先直接 require('../perf/fixtures') 形成跨层依赖 —— PR #2 单独合并进 main 时该文件尚不存在，
// 导致 main CI 的 L3（真实工程 E2E）失败（Error: Cannot find module '../perf/fixtures'）。
// 现由 _harness 提供实现，perf 与 e2e 各自引用，层间互不依赖。
module.exports = require('../_harness/projectFixtures');