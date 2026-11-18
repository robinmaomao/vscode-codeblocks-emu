// 验证 LruCache 的 LRU 淘汰与命中移动语义
const { LruCache } = require('../dist/tools/lru');

let fail = 0;
function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { console.error('FAIL ' + name); fail++; }
}

const c = new LruCache(3);
c.set('a', 1);
c.set('b', 2);
c.set('c', 3);
check('初始三键都可取', c.get('a') === 1 && c.get('b') === 2 && c.get('c') === 3);
check('size=3', c.size === 3);

// 访问 a（移到最新），再插入 d → 淘汰最旧的 b
c.get('a');
c.set('d', 4);
check('淘汰最久未用的 b', c.get('b') === undefined);
check('a/c/d 保留', c.get('a') === 1 && c.get('c') === 3 && c.get('d') === 4);
check('size 仍为 3', c.size === 3);

// set 已存在 key：更新值且不增长
c.set('a', 10);
check('更新已存在 key 的值', c.get('a') === 10);
check('更新后 size 不变', c.size === 3);

// delete / clear
check('delete 存在 key 返回 true', c.delete('a') === true);
check('delete 不存在 key 返回 false', c.delete('zzz') === false);
c.clear();
check('clear 后 size=0', c.size === 0);

// entries：最旧 → 最新，且不改变 LRU 顺序
const c2 = new LruCache(3);
c2.set('x', 1); c2.set('y', 2); c2.set('z', 3); c2.get('x');
check('entries 返回全部条目（最旧→最新）', JSON.stringify(c2.entries()) === JSON.stringify([['y', 2], ['z', 3], ['x', 1]]), c2.entries(), [['y', 2], ['z', 3], ['x', 1]]);
check('entries 不改变 size', c2.size === 3, c2.size, 3);

// 容量校验
let threw = false;
try { new LruCache(0); } catch { threw = true; }
check('容量 0 抛错', threw);

if (fail === 0) {
  console.log('全部通过');
  process.exit(0);
} else {
  process.exit(1);
}
