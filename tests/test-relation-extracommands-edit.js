// 验证 ExtraCommands（pre/post build 命令）+ OptionsRelation 序列化
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const { OptionsRelationType, OptionsRelation } = require('../dist/model/types');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 项目级 pre/post build 命令
project.commandsBeforeBuild = ['echo pre-build'];
project.commandsAfterBuild = ['echo post-build'];

// Debug 目标：before/after + relations
const dbg = project.buildTargets[0];
dbg.commandsBeforeBuild = ['echo dbg-pre'];
dbg.commandsAfterBuild = ['echo dbg-post'];
dbg.optionRelations[OptionsRelationType.CompilerOptions] = 0; // 仅父级
dbg.optionRelations[OptionsRelationType.LinkerOptions] = 2;   // 前置
dbg.optionRelations[OptionsRelationType.IncludeDirs] = 1;     // 仅目标

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

const tmp = path.join(require('os').tmpdir(), 'cb-rel-extra-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
console.log('项目级:', JSON.stringify({ before: reparse.commandsBeforeBuild, after: reparse.commandsAfterBuild }));
const rdbg = reparse.buildTargets[0];
console.log('Debug before/after:', JSON.stringify({ before: rdbg.commandsBeforeBuild, after: rdbg.commandsAfterBuild }));
console.log('Debug relations:', JSON.stringify(rdbg.optionRelations));
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
check('项目级 pre/post build 命令', JSON.stringify(reparse.commandsBeforeBuild) === JSON.stringify(['echo pre-build']) && JSON.stringify(reparse.commandsAfterBuild) === JSON.stringify(['echo post-build']), { before: reparse.commandsBeforeBuild, after: reparse.commandsAfterBuild });
check('目标级 pre/post build 命令', JSON.stringify(rdbg.commandsBeforeBuild) === JSON.stringify(['echo dbg-pre']) && JSON.stringify(rdbg.commandsAfterBuild) === JSON.stringify(['echo dbg-post']), { before: rdbg.commandsBeforeBuild, after: rdbg.commandsAfterBuild });
check('OptionsRelation 序列化', rdbg.optionRelations[OptionsRelationType.CompilerOptions] === 0 && rdbg.optionRelations[OptionsRelationType.LinkerOptions] === 2 && rdbg.optionRelations[OptionsRelationType.IncludeDirs] === 1, rdbg.optionRelations);
console.log(`OptionsRelation/额外命令: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
