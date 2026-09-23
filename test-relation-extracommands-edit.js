// 验证 ExtraCommands（pre/post build 命令）+ OptionsRelation 序列化
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
const { OptionsRelationType, OptionsRelation } = require('./dist/model/types');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve('test-project/hello-cb.cbp');
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
