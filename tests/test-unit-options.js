// 验证文件级 compile/link/compilerVar 默认值与显式值 + LinkerExe + Environment + Mode 的往返保真
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const { LinkerExecutableOption } = require('../dist/model/types');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
  <FileVersion major="1" minor="6" />
  <Project>
    <Option title="unit-test" />
    <Option compiler="gcc" />
    <Build>
      <Target title="Debug">
        <Option type="1" />
        <Option compiler="gcc" />
        <Option output="bin/Debug/app" />
        <Linker>
          <LinkerExe value="Linker" />
        </Linker>
        <ExtraCommands>
          <Mode after="always" />
          <Add after="echo done" />
        </ExtraCommands>
        <Environment>
          <Variable name="TARGET_VAR" value="v1" />
        </Environment>
      </Target>
      <Environment>
        <Variable name="PROJ_VAR" value="v2" />
      </Environment>
    </Build>
    <Unit filename="main.c" />
    <Unit filename="force_cpp.c">
      <Option compilerVar="CPP" />
    </Unit>
    <Unit filename="header.h">
      <Option compile="1" />
      <Option link="1" />
    </Unit>
    <Unit filename="plain.h" />
    <Extensions />
  </Project>
</CodeBlocks_project_file>`;

const tmp = path.join(os.tmpdir(), 'cb-unit-options.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const project = new ProjectParser().parse(tmp);

let failed = false;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failed = true; console.log(`FAIL ${name}: 期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`); }
  else console.log(`PASS ${name}`);
};

const byRel = Object.fromEntries(project.files.map((f) => [f.relativeFilename, f]));
// 1) 默认值：.c → CC / compile=true / link=true；.h → CPP / compile=false / link=false
check('main.c compilerVar', byRel['main.c'].compilerVar, 'CC');
check('main.c compile', byRel['main.c'].compile, true);
check('main.c link', byRel['main.c'].link, true);
check('plain.h compilerVar', byRel['plain.h'].compilerVar, 'CPP');
check('plain.h compile(默认 false)', byRel['plain.h'].compile, false);
check('plain.h link(默认 false)', byRel['plain.h'].link, false);
// 2) 显式值：.c+CPP、.h+compile/link=1
check('force_cpp.c compilerVar', byRel['force_cpp.c'].compilerVar, 'CPP');
check('header.h compile(显式1)', byRel['header.h'].compile, true);
check('header.h link(显式1)', byRel['header.h'].link, true);
// 3) 目标级 LinkerExe / Mode / Environment
const t = project.buildTargets[0];
check('LinkerExe', t.linkerExecutable, LinkerExecutableOption.Linker);
check('alwaysRunPostBuildSteps', t.alwaysRunPostBuildSteps, true);
check('target envVars', t.envVars, [{ name: 'TARGET_VAR', value: 'v1' }]);
check('project envVars', project.envVars, [{ name: 'PROJ_VAR', value: 'v2' }]);

// 序列化再解析（往返）
const xml = serializeProject(project);
fs.writeFileSync(tmp, xml, 'utf-8');
const re = new ProjectParser().parse(tmp);
const reByRel = Object.fromEntries(re.files.map((f) => [f.relativeFilename, f]));
const rt = re.buildTargets[0];

check('往返 main.c compilerVar', reByRel['main.c'].compilerVar, 'CC');
check('往返 force_cpp.c compilerVar', reByRel['force_cpp.c'].compilerVar, 'CPP');
check('往返 header.h compile', reByRel['header.h'].compile, true);
check('往返 header.h link', reByRel['header.h'].link, true);
check('往返 plain.h compile', reByRel['plain.h'].compile, false);
check('往返 plain.h link', reByRel['plain.h'].link, false);
check('往返 LinkerExe', rt.linkerExecutable, LinkerExecutableOption.Linker);
check('往返 alwaysRun', rt.alwaysRunPostBuildSteps, true);
check('往返 target envVars', rt.envVars, [{ name: 'TARGET_VAR', value: 'v1' }]);
check('往返 project envVars', re.envVars, [{ name: 'PROJ_VAR', value: 'v2' }]);

// 关键 XML 片段检查
const has = (s) => xml.includes(s);
check('xml 含 compilerVar="CC"', has('<Option compilerVar="CC" />'), true);
check('xml 含 compilerVar="CPP"', has('<Option compilerVar="CPP" />'), true);
check('xml 含 compile="1"', has('<Option compile="1" />'), true);
check('xml 含 link="1"', has('<Option link="1" />'), true);
check('xml 含 LinkerExe', has('<LinkerExe value="Linker" />'), true);
check('xml 含 Mode always', has('<Mode after="always" />'), true);
check('xml 含 TARGET_VAR', has('name="TARGET_VAR" value="v1"'), true);
check('xml 含 PROJ_VAR', has('name="PROJ_VAR" value="v2"'), true);
// plain.h 不应有 compile/link 属性（默认不写）
check('xml 不写 plain.h compile', /<Unit filename="plain\.h" \/>/.test(xml), true);

fs.unlinkSync(tmp);
if (failed) {
  console.log('\n======== 序列化结果 ========');
  console.log(xml);
}
process.exit(failed ? 1 : 0);
