// 验证 weight 排序（对齐 MySortProjectFilesByWeight）+ 资源对象分离
const { compareFilesByWeight } = require('./dist/build/commandLine');

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

const mk = (name, weight) => ({
  relativeFilename: name, relativeToCommonTopLevelPath: name, absolutePath: name,
  buildTargets: [], compilerVar: 'CPP', compile: true, link: true,
  customBuildCommands: {}, weight,
});

// 1. weight 升序（小者先）
const files = [
  mk('c.c', 90), mk('a.c', 50), mk('b.c', 50), mk('d.c', 10), mk('e.c', 90),
];
const sorted = [...files].sort(compareFilesByWeight).map((f) => f.relativeFilename);
check('weight 升序', JSON.stringify(sorted) === JSON.stringify(['d.c', 'a.c', 'b.c', 'c.c', 'e.c']));

// 2. weight 相同按文件名（不分大小写）
const files2 = [mk('B.c', 50), mk('a.c', 50), mk('C.c', 50)];
const sorted2 = [...files2].sort(compareFilesByWeight).map((f) => f.relativeFilename);
check('同 weight 按文件名（不分大小写）', JSON.stringify(sorted2) === JSON.stringify(['a.c', 'B.c', 'C.c']));

// 3. weight 分组（同 weight 一组）
const groups = [];
let i = 0;
const sortedAll = [...files].sort(compareFilesByWeight);
while (i < sortedAll.length) {
  const w = sortedAll[i].weight;
  const group = [];
  while (i < sortedAll.length && sortedAll[i].weight === w) { group.push(sortedAll[i].relativeFilename); i++; }
  groups.push(group);
}
check('weight 分组数 = 3（10/50/90）', groups.length === 3);
check('weight=10 组', JSON.stringify(groups[0]) === JSON.stringify(['d.c']));
check('weight=50 组', JSON.stringify(groups[1]) === JSON.stringify(['a.c', 'b.c']));
check('weight=90 组', JSON.stringify(groups[2]) === JSON.stringify(['c.c', 'e.c']));

// 4. 默认 weight=50 时，排序稳定按文件名
const files3 = [mk('z.c', 50), mk('m.c', 50), mk('a.c', 50)];
const sorted3 = [...files3].sort(compareFilesByWeight).map((f) => f.relativeFilename);
check('默认 weight 全 50 → 按文件名', JSON.stringify(sorted3) === JSON.stringify(['a.c', 'm.c', 'z.c']));

process.exit(failed ? 1 : 0);
