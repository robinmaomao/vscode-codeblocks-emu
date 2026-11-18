// P3-3?.cbp ????/?? Option ????????????????
const fs = require('fs');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
const cbp = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
  '<CodeBlocks_project_file>',
  '  <FileVersion major="1" minor="6" />',
  '  <Project>',
  '    <Option title="Unknown" />',
  '    <Option compiler="gcc" />',
  '    <PluginData foo="1"><Child bar="2" /></PluginData>',
  '    <Build>',
  '      <Target title="Debug">',
  '        <Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />',
  '        <Option type="1" />',
  '        <Option compiler="gcc" />',
  '        <PluginTargetData value="x" />',
  '      </Target>',
  '    </Build>',
  '    <Unit filename="main.c">',
  '      <Option compilerVar="CC" />',
  '      <Option customUnit="yes" />',
  '      <PluginUnitData flag="1" />',
  '    </Unit>',
  '    <Extensions>',
  '      <codeblocks_project_custom_variables>',
  '        <variable name="X" value="1" />',
  '      </codeblocks_project_custom_variables>',
  '    </Extensions>',
  '  </Project>',
  '</CodeBlocks_project_file>',
].join('\n');
const os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-unknown-'));
try {
  const file = path.join(dir, 'unknown.cbp');
  fs.writeFileSync(file, cbp, 'utf8');
  const project = new ProjectParser().parse(file);
  const xml = serializeProject(project);
  check('Project unknown child', xml.includes('<PluginData') && xml.includes('<Child'), xml, 'PluginData');
  check('Target unknown child', xml.includes('<PluginTargetData'), xml, 'PluginTargetData');
  check('Unit unknown child', xml.includes('<PluginUnitData'), xml, 'PluginUnitData');
  check('Unit ?? Option ????', xml.includes('customUnit="yes"'), xml, 'customUnit');
  check('?? compilerVar ???', (xml.match(/compilerVar="CC"/g) || []).length === 1, (xml.match(/compilerVar="CC"/g) || []).length, 1);
  check('Project ????????', (xml.match(/<PluginData/g) || []).length === 1, (xml.match(/<PluginData/g) || []).length, 1);
  const out = path.join(dir, 'out.cbp');
  fs.writeFileSync(out, xml, 'utf8');
  const reparsed = new ProjectParser().parse(out);
  const xml2 = serializeProject(reparsed);
  check('???????????', xml2.includes('PluginData') && xml2.includes('PluginTargetData') && xml2.includes('PluginUnitData'), xml2, 'stable');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('writer-unknown-nodes: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
