// Properties 启用/禁用联动回归：
//  - 以本地 Code::Blocks 源码 projectoptionsdlg.cpp 为事实来源，锁定“哪些控件在什么条件下可用”
//  - 校验本扩展的 syncEnabledStates / applyTargetTypeRules 与 CB 规则一一对应
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const cb = read('codeblocks-src/src/src/projectoptionsdlg.cpp');
const panel = read('src/ui/projectPropertiesPanel.ts');
const ext = read('src/extension.ts');

// ---------- Code::Blocks 侧事实 ----------
check('CB：Execution directory 仅自定义 Makefile 时启用',
  /txtExecutionDir"[\s\S]{0,80}?Enable\(customMake\)/.test(cb), null);
check('CB：Makefile 文本框不随自定义 Makefile 禁用',
  !/txtProjectMakefile"[\s\S]{0,100}?Enable\(/.test(cb), null);
check('CB：Import library 需勾选 Create import library 且为 Dynamic library',
  /txtI->Enable\(chkSL->IsChecked\(\) && targetType == ttDynamicLib\)/.test(cb)
  && /browseI->Enable\(chkSL->IsChecked\(\) && targetType == ttDynamicLib\)/.test(cb), null);
check('CB：Definition file 需勾选 Create .DEF 且为 Dynamic library',
  /txtD->Enable\(chkCD->IsChecked\(\) && targetType == ttDynamicLib\)/.test(cb)
  && /browseD->Enable\(chkCD->IsChecked\(\) && targetType == ttDynamicLib\)/.test(cb), null);
check('CB：Create import library / .DEF 复选框仅 Dynamic library 可用',
  /chkSL->Enable\(target->GetTargetType\(\) == ttDynamicLib\)/.test(cb)
  && /chkCD->Enable\(target->GetTargetType\(\) == ttDynamicLib\)/.test(cb), null);
check('CB：Pause when execution ends 仅 Console only 可用',
  /chkUseConsoleRunner[\s\S]{0,80}?Enable\(targetType == ttConsoleOnly\)/.test(cb), null);
check('CB：Working dir 对 Static library / Commands only 禁用',
  /txtW->Enable\(targetType == ttExecutable \|\|[\s\S]{0,80}?targetType == ttDynamicLib\)/.test(cb), null);
check('CB：Commands only 清空并禁用 Output/Import/Def/Working/Objects',
  /case ttCommandsOnly:[\s\S]{0,600}?txt->SetValue\(""\)[\s\S]{0,400}?txtO->SetValue\(""\)/.test(cb)
  && /txtO->Enable\(false\)/.test(cb), null);
check('CB：Static library 切换时清空 Import library / Definition file',
  /txtI->SetValue\(""\);[\s\S]{0,80}?txtD->SetValue\(""\);/.test(cb), null);
check('CB：自定义 Makefile 禁用 PCH / 对象目录 / 文件列表 / 脚本页',
  /rbPCHStrategy",\s*wxRadioBox\)->Enable\(!customMake\)/.test(cb)
  && /txtObjectDir",\s*wxTextCtrl\)->Enable\(!customMake && en\)/.test(cb)
  && /list->Enable\(!customMake\)/.test(cb)
  && /btnCheckScripts",\s*wxButton\)->Enable\(!customMake\)/.test(cb), null);
check('CB：目标数 ≤ 1 时 Delete / Re-order 禁用',
  /btnBuildOrder",[\s\S]{0,60}?Enable\(lstTargets->GetCount\(\) > 1\)/.test(cb)
  && /btnDelBuildTarget",[\s\S]{0,80}?Enable\(en && lstTargets->GetCount\(\) > 1\)/.test(cb), null);
check('CB：无选中文件时 Selected file properties 禁用',
  /btnFileOptions",[\s\S]{0,60}?Enable\(filesEn\)/.test(cb), null);
check('CB：PCH 策略受编译器 supportsPCH 控制',
  /hasPCH = compiler && compiler->GetSwitches\(\).supportsPCH/.test(cb)
  && /rbPCHStrategy",[\s\S]{0,60}?Enable\(hasPCH\)/.test(cb), null);

// ---------- 扩展侧实现 ----------
check('扩展：存在 syncEnabledStates 统一同步函数',
  /function syncEnabledStates\(\)/.test(panel), null);
check('扩展：Execution directory 随自定义 Makefile 启用',
  /setDisabled\('set-mkdir', !customMake\)/.test(panel) && /setBrowseDisabled\('set-mkdir', !customMake\)/.test(panel), null);
check('扩展：PCH 随自定义 Makefile / 编译器支持禁用',
  /r\.disabled = customMake \|\| !supportsPch/.test(panel), null);
check('扩展：Console runner 仅 Console only 可用',
  /setDisabled\('f-console', type !== 1\)/.test(panel), null);
check('扩展：Create import library / .DEF 仅 Dynamic library 可用',
  /setDisabled\('f-staticchk', !dynamic\)/.test(panel) && /setDisabled\('f-defchk', !dynamic\)/.test(panel), null);
check('扩展：Import / Definition 需复选框 + Dynamic library',
  /const impOn = dynamic && !!staticChk && staticChk\.checked/.test(panel)
  && /const defOn = dynamic && !!defChk && defChk\.checked/.test(panel)
  && /setDisabled\('f-implib', !impOn \|\| commandsOnly\)/.test(panel)
  && /setDisabled\('f-deffile', !defOn \|\| commandsOnly\)/.test(panel), null);
check('扩展：Working dir 对 Static library / Commands only 禁用',
  /const workdirOn = type === 0 \|\| type === 1 \|\| type === 3 \|\| type === 5/.test(panel)
  && /setDisabled\('f-workdir', !workdirOn \|\| commandsOnly\)/.test(panel), null);
check('扩展：自定义 Makefile 禁用对象目录 / 文件列表 / 工具栏 / 脚本页',
  /setDisabled\('f-object', customMake \|\| commandsOnly\)/.test(panel)
  && /querySelectorAll\('#tflist input\[type="checkbox"\]'\)[\s\S]{0,80}?cb\.disabled = customMake/.test(panel)
  && /\['toggleChecks', 'allOn', 'allOff'\]\.forEach\(id => setDisabled\(id, customMake\)\)/.test(panel)
  && /\['scr-tree', 'scr-list-box', 'scr-add', 'scr-validate'\]\.forEach\(id => setDisabled\(id, customMake\)\)/.test(panel), null);
check('扩展：目标数 ≤ 1 时 Delete / Re-order 禁用',
  /setDisabled\('remove', targets\.length <= 1\)/.test(panel)
  && /setDisabled\('reorderTargets', targets\.length <= 1\)/.test(panel), null);
check('扩展：无目标时 Rename / Duplicate / Export 禁用',
  /setDisabled\('renameTarget', !targets\.length\)/.test(panel)
  && /setDisabled\('copy', !targets\.length\)/.test(panel)
  && /setDisabled\('exportTarget', !targets\.length\)/.test(panel), null);
check('扩展：Commands only 清空 Output/Import/Def/Working/Objects',
  /function applyTargetTypeRules\(\)/.test(panel)
  && /\['f-output', 'f-implib', 'f-deffile', 'f-workdir', 'f-object'\]\.forEach\(clear\)/.test(panel), null);
check('扩展：Static library 切换清空 Import / Definition',
  /const type = Number\(el\.value\);[\s\S]{0,400}?clear\('f-implib'\);[\s\S]{0,120}?clear\('f-deffile'\);/.test(panel), null);
check('扩展：类型/复选框/自定义 Makefile 变更后重新同步',
  /getElementById\('f-type'\)\.addEventListener\('change', applyTargetTypeRules\)/.test(panel)
  && /getElementById\('f-staticchk'\)\.addEventListener\('change', syncEnabledStates\)/.test(panel)
  && /getElementById\('f-defchk'\)\.addEventListener\('change', syncEnabledStates\)/.test(panel)
  && /getElementById\('set-mkcustom'\)\.addEventListener\('change', \(\) => \{ collectSettingsForm\(\); syncEnabledStates\(\); \}\)/.test(panel), null);
check('扩展：Parser / Debugger 无选中项时禁用编辑删除',
  /setDisabled\('parser-edit', selectedParser < 0\)/.test(panel)
  && /setDisabled\('dbg-path-edit', selectedDbgPath < 0\)/.test(panel), null);
check('扩展：禁用态样式（input/button opacity）',
  /\.cb-props input:disabled, \.cb-props select:disabled, \.cb-props textarea:disabled \{ opacity: \.65; \}/.test(panel)
  && /\.cb-props button:disabled \{ opacity: \.5;/.test(panel), null);
check('扩展：payload 传入 supportsPch（编译器 switches）',
  /supportsPch\?: boolean/.test(panel) && /supportsPch: projectCompiler\.switches\.supportsPCH !== false/.test(ext), null);

console.log(`Properties 启用规则回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
