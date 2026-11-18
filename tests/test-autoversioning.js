// AutoVersioning: .cbp extensions roundtrip, version.h generation and increments.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');
const av = require('../dist/tools/autoversioning.js');

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
  '    <Option title="Versioned" />',
  '    <Option compiler="gcc" />',
  '    <Build>',
  '      <Target title="Debug">',
  '        <Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />',
  '        <Option type="1" />',
  '      </Target>',
  '    </Build>',
  '    <Unit filename="main.c" />',
  '    <Extensions>',
  '      <AutoVersioning>',
  '        <Scheme minor_max="20" build_max="5" rev_max="9" rev_rand_max="3" build_times_to_increment_minor="4" />',
  '        <Settings autoincrement="1" date_declarations="0" use_define="1" update_manifest="0" do_auto_increment="1" ask_to_increment="0" language="C" svn="0" svn_directory="" header_path="include/version.h" />',
  '        <Changes_Log show_changes_editor="0" app_title="v%M.%m" changeslog_path="ChangesLog.txt" />',
  '        <Code header_guard="APP_VERSION_H" namespace="AppVersion" prefix="APP" />',
  '      </AutoVersioning>',
  '    </Extensions>',
  '  </Project>',
  '</CodeBlocks_project_file>',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-autoversion-'));
try {
  const file = path.join(dir, 'versioned.cbp');
  fs.writeFileSync(file, cbp, 'utf8');
  const project = new ProjectParser().parse(file);
  const config = av.readAutoVersioningConfig(project);
  check('config parsed', !!config, config, 'config');
  check('scheme parsed', config.scheme.minorMax === 20 && config.scheme.buildMax === 5 && config.scheme.revisionRandMax === 3, config.scheme, 'scheme');
  check('settings parsed', config.settings.useDefine === true && config.settings.dateDeclarations === false && config.settings.language === 'C', config.settings, 'settings');
  check('header path parsed', config.settings.headerPath === 'include/version.h', config.settings.headerPath, 'include/version.h');

  const xml = serializeProject(project);
  check('extensions serialized', xml.includes('<AutoVersioning>') && xml.includes('minor_max="20"') && xml.includes('header_path="include/version.h"'), xml, 'AutoVersioning');
  const out = path.join(dir, 'roundtrip.cbp');
  fs.writeFileSync(out, xml, 'utf8');
  const reparsed = new ProjectParser().parse(out);
  const config2 = av.readAutoVersioningConfig(reparsed);
  check('config roundtrip', config2 && config2.scheme.minorMax === 20 && config2.code.prefix === 'APP', config2, 'roundtrip');

  const state = av.defaultAutoVersioningState();
  state.values = { major: 2, minor: 3, build: 4, revision: 5, buildCount: 6 };
  state.status = { softwareStatus: 'Beta', abbreviation: 'b' };
  state.buildHistory = 7;
  const header = av.generateVersionHeader(config, state, new Date(2024, 0, 2));
  check('define header major', header.includes('#define APP_MAJOR 2'), header, 'define major');
  check('header guard and prefix', header.includes('#ifndef APP_VERSION_H') && header.includes('#define APP_STATUS "Beta"'), header, 'guard');
  check('header date declarations off', !header.includes('UBUNTU_VERSION_STYLE'), header, 'date off');
  check('header full version', header.includes('#define APP_FULLVERSION_STRING "2.3.4.5"'), header, 'full');
  const parsed = av.parseVersionHeader(header);
  check('header parse roundtrip', parsed.values.major === 2 && parsed.values.minor === 3 && parsed.values.build === 4 && parsed.values.revision === 5 && parsed.values.buildCount === 6, parsed, 'state');
  check('header status parse', parsed.status.softwareStatus === 'Beta' && parsed.status.abbreviation === 'b' && parsed.buildHistory === 7, parsed, 'status');

  const cppConfig = av.defaultAutoVersioningConfig();
  cppConfig.code.prefix = 'DEMO';
  const cppHeader = av.generateVersionHeader(cppConfig, state, new Date(2024, 10, 9));
  check('C++ namespace and declarations', cppHeader.includes('namespace AutoVersion{') && cppHeader.includes('static const long DEMO_MAJOR = 2;'), cppHeader, 'C++');
  check('C++ date declarations', cppHeader.includes('static const char DEMO_DATE[] = "09";') && cppHeader.includes('static const char DEMO_YEAR[] = "2024";'), cppHeader, 'date');
  check('C++ guard default', cppHeader.includes('#ifndef VERSION_H'), cppHeader.split('\n')[0], 'VERSION_H');

  const bumped = av.incrementVersion(state, cppConfig, () => 0);
  check('revision increments by one', bumped.values.revision === 6, bumped.values, 6);
  check('build increments', bumped.values.build === 5, bumped.values, 5);
  check('minor advances at history limit', (() => {
    const s = { ...state, buildHistory: 99, values: { ...state.values, minor: 3 } };
    const c = av.defaultAutoVersioningConfig();
    c.scheme.buildTimesToIncrementMinor = 100;
    return av.incrementVersion(s, c, () => 0).values.minor === 4;
  })(), bumped.values.minor, 4);
  check('major advances after minor max', (() => {
    const s = { ...state, buildHistory: 99, values: { ...state.values, minor: 10 } };
    const c = av.defaultAutoVersioningConfig();
    c.scheme.buildTimesToIncrementMinor = 100;
    return av.incrementVersion(s, c, () => 0).values.major === 3;
  })(), bumped.values.major, 3);

  const counted = av.bumpBuildCount(state);
  check('build count increments', counted.values.buildCount === 7 && state.values.buildCount === 6, counted.values.buildCount, 7);
  const value = av.parseVersionValue('4.5.6.7');
  check('version value parse', value && value.major === 4 && value.revision === 7, value, '4.5.6.7');
  check('invalid version value', av.parseVersionValue('4.5.6') === null, av.parseVersionValue('4.5.6'), null);
  check('header path resolves relative', av.versionHeaderPath(project, config).endsWith(path.join('include', 'version.h')), av.versionHeaderPath(project, config), 'include/version.h');

  const written = { extensions: {} };
  av.writeAutoVersioningConfig(written, av.defaultAutoVersioningConfig());
  const writtenSettings = written.extensions.AutoVersioning.Settings;
  check('writer uses CB integer booleans', writtenSettings['@_autoincrement'] === 1 && writtenSettings['@_use_define'] === 0, writtenSettings, '0/1');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('autoversioning: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
