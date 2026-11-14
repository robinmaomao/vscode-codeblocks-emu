// Build options 启用/禁用联动回归：
//  - 以本地 Code::Blocks 源码 compileroptionsdlg.cpp 为事实来源，锁定“哪些页/按钮在什么条件下可用”
//  - 校验本扩展的 Build options 视图与 CB 规则一一对应
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const cb = read('codeblocks-src/src/plugins/compilergcc/compileroptionsdlg.cpp');
const view = read('src/ui/buildOptionsView.ts');
const ext = read('src/extension.ts');
const props = read('src/ui/projectPropertiesPanel.ts');

// ---------- Code::Blocks 侧事实 ----------
check('CB：自定义 Makefile 移除 Compiler / Linker / Search directories 三页',
  /IsMakefileCustom\(\)\)[\s\S]{0,400}?nb->RemovePage\(2\);[\s\S]{0,120}?nb->RemovePage\(1\);[\s\S]{0,120}?nb->RemovePage\(0\);/.test(cb), null);
check('CB：Commands only 目标禁用 Compiler / Linker / Search / Make 四页并切到 Pre/post',
  /ttCommandsOnly\)[\s\S]{0,400}?nb->GetPage\(0\)->Disable\(\);[\s\S]{0,200}?nb->GetPage\(5\)->Disable\(\);[\s\S]{0,120}?nb->SetSelection\(3\);/.test(cb), null);
check('CB：切换作用域时按 Commands only 重新禁用页',
  /const bool cmd = \(m_pTarget && m_pTarget->GetTargetType\(\) == ttCommandsOnly\)/.test(cb)
  && /nb->GetPage\(0\)->Enable\(!cmd\)/.test(cb)
  && /nb->GetPage\(pageOffset \+ 2\)->Enable\(!cmd\)/.test(cb), null);
check('CB：自定义 Makefile 时 Make 页下标前移（pageOffset）',
  /if \(!m_pProject->IsMakefileCustom\(\)\)[\s\S]{0,300}?pageOffset = 3;[\s\S]{0,80}?else\s+pageOffset = 0;/.test(cb), null);
check('CB：Linker executable 仅目标作用域显示',
  /const bool show = \(m_pTarget != nullptr\);[\s\S]{0,260}?cmbLinkerExe->Show\(show\);/.test(cb), null);
check('CB：Policy 下拉仅目标作用域启用',
  /en = \(data && data->GetTarget\(\)\);[\s\S]{0,260}?cmbCompilerPolicy[\s\S]{0,60}?Enable\(en\)/.test(cb), null);
check('CB：Edit 需恰好 1 项、Delete/Copy 需选中、Clear 需非空',
  /edit\.Enable\(num == 1\);/.test(cb) && /del\.Enable\(en\);/.test(cb)
  && /clear\.Enable\(itemCount != 0\);/.test(cb) && /copy\.Enable\(en && hasProject\);/.test(cb), null);
check('CB：上移看最小下标、下移看最大下标',
  /up\.Enable\(minIndex > 0\);/.test(cb) && /down\.Enable\(maxIndex < itemCount - 1\);/.test(cb), null);
check('CB：Copy 只复制选中条目',
  /if \(lstLibs->IsSelected\(i\)\)[\s\S]{0,80}?AddLinkLib/.test(cb), null);
check('CB：Make 命令输入随自定义 Makefile 启用',
  /bool en = project->IsMakefileCustom\(\);[\s\S]{0,500}?txtMakeCmd_SilentBuild[\s\S]{0,60}?Enable\(en\);/.test(cb), null);
check('CB：Dist-clean 可编辑并保存，Silent build 由 Build 派生',
  /SetMakeCommandFor\(mcDistClean,[\s\S]{0,140}?txtMakeCmd_DistClean",\s*wxTextCtrl\)->GetValue\(\)\)/.test(cb)
  && /mcSilentBuild, XRCCTRL\(\*this, "txtMakeCmd_Build",\s*wxTextCtrl\)->GetValue\(\) \+ _T\(" > \$\(CMD_NULL\)"\)/.test(cb), null);
check('CB：编译器未安装时禁用整本 notebook',
  /compilerIdx == -1\)[\s\S]{0,2000}?nb->Disable\(\);/.test(cb), null);

// ---------- 扩展侧实现 ----------
check('扩展：作用域数据带 targetType',
  /targetType\?: number;/.test(view) && /targetType: t\.targetType/.test(props) && /targetType: t\.targetType/.test(ext), null);
check('扩展：自定义 Makefile 过滤 Compiler / Linker / Search 三页',
  /DATA\.makefileIsCustom[\s\S]{0,220}?p\[0\] !== 'compiler' && p\[0\] !== 'linker' && p\[0\] !== 'dirs'/.test(view), null);
check('扩展：Commands only 禁用四页',
  /function isCommandsOnly\(\)[\s\S]{0,200}?Number\(current\(\)\.targetType\) === 4/.test(view)
  && /id === 'compiler' \|\| id === 'linker' \|\| id === 'dirs' \|\| id === 'make'/.test(view), null);
check('扩展：当前页不可用时回落到 Pre/post',
  /function ensurePage\(\)[\s\S]{0,420}?page = ids\.indexOf\('extras'\) >= 0 \? 'extras' : ids\[0\]/.test(view), null);
check('扩展：页签按禁用状态渲染 disabled',
  /\(dis \? ' disabled title="'/.test(view) && /if \(b\.disabled\) return;/.test(view), null);
check('扩展：Edit 需恰好 1 项、Copy 需选中',
  /sels\.length !== 1/.test(view) && /copy\.disabled = !has;/.test(view), null);
check('扩展：上移/下移按选中集合边界启用',
  /var upDis = !has \|\| sels\[0\] <= 0;/.test(view)
  && /var downDis = !has \|\| sels\[sels\.length - 1\] >= items\.length - 1;/.test(view), null);
check('扩展：列表支持 Ctrl/Shift 多选',
  /ev\.ctrlKey \|\| ev\.metaKey/.test(view) && /ev\.shiftKey && anchor\[selKey\] >= 0/.test(view), null);
check('扩展：Copy 只带选中条目到目标',
  /selectedIndexes\('linker'\)\.map\(function \(i\) \{ return sc\.linkLibs\[i\]; \}\)/.test(view)
  && /selectedIndexes\('dir'\)\.map\(function \(i\) \{ return arr\[i\]; \}\)/.test(view), null);
check('扩展：Make 页四行，Dist-clean / Silent 不渲染但数据保留',
  /row\('mk-build', L\.buildTarget, m\.build\)/.test(view)
  && /row\('mk-ask', L\.askRebuild, m\.askRebuildNeeded\)/.test(view)
  && !/mk-dist/.test(view) && !/mk-silent/.test(view)
  && /applyDerivedSilent\(\)/.test(view), null);
check('扩展：编译器未安装时禁用页面控件并提示',
  /function isCompilerMissing\(\)/.test(view) && /applyPageDisabled\(el\)/.test(view)
  && /id="bo-compiler-note"/.test(view), null);
check('扩展：Linker executable 工程作用域保持禁用+提示',
  /var exeDisabled = isProject\(\);/.test(view) && /disabled title="' \+ esc\(L\.linkerExecutableHint\)/.test(view), null);

console.log(`\nbuild-options-enable-rules: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
