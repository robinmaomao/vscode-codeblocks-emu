// 验证第三轮 R14（更多工程模板）：模板总数/唯一性/新模板（AVR / MSP430 / OpenCV）参数与骨架，
// 以及 createProjectFromTemplate 对新模板的选项落位（-mmcu 等进入 Debug/Release 双目标）。
const { PROJECT_TEMPLATES, createProjectFromTemplate } = require('../dist/project/newProject.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

check('模板总数 12', PROJECT_TEMPLATES.length === 12, PROJECT_TEMPLATES.length);
const ids = PROJECT_TEMPLATES.map((t) => t.id);
check('模板 id 唯一', new Set(ids).size === ids.length, ids);
for (const id of ['avr', 'msp430', 'opencv']) {
  check(`新模板存在：${id}`, ids.includes(id), ids);
}
for (const t of PROJECT_TEMPLATES) {
  const names = t.skeleton.map((f) => f.name);
  check(`模板 ${t.id}：标签/描述/骨架合法`, !!t.label && !!t.description && new Set(names).size === names.length,
    [t.label, names]);
}

const avr = PROJECT_TEMPLATES.find((t) => t.id === 'avr');
check('AVR：-mmcu=atmega328p', avr.compilerOptions.includes('-mmcu=atmega328p'), avr.compilerOptions);
check('AVR：-DF_CPU', avr.compilerOptions.includes('-DF_CPU=16000000UL'), avr.compilerOptions);
check('AVR：骨架含 avr/io.h', avr.skeleton.some((f) => f.content.includes('#include <avr/io.h>')));

const msp = PROJECT_TEMPLATES.find((t) => t.id === 'msp430');
check('MSP430：-mmcu=msp430g2553', msp.compilerOptions.includes('-mmcu=msp430g2553'), msp.compilerOptions);
check('MSP430：骨架含 msp430.h', msp.skeleton.some((f) => f.content.includes('#include <msp430.h>')));

const cv = PROJECT_TEMPLATES.find((t) => t.id === 'opencv');
check('OpenCV：链接库预置 4 个', JSON.stringify(cv.linkLibs) === JSON.stringify(['opencv_core', 'opencv_imgproc', 'opencv_imgcodecs', 'opencv_highgui']), cv.linkLibs);
check('OpenCV：骨架含 opencv2/opencv.hpp', cv.skeleton.some((f) => f.content.includes('opencv2/opencv.hpp')));

// 新模板 → 工程模型：选项进入 Debug/Release，两类目标共享
const { project } = createProjectFromTemplate('avr-demo', process.cwd(), avr, 'gcc');
check('AVR 工程：双目标', project.buildTargets.length === 2, project.buildTargets.map((t) => t.title));
const dbg = project.buildTargets.find((t) => t.title === 'Debug');
const rel = project.buildTargets.find((t) => t.title === 'Release');
check('AVR 工程：Debug 含 -g 与 -mmcu', dbg.compilerOptions.includes('-g') && dbg.compilerOptions.includes('-mmcu=atmega328p'), dbg.compilerOptions);
check('AVR 工程：Release 含 -O2 与 -mmcu', rel.compilerOptions.includes('-O2') && rel.compilerOptions.includes('-mmcu=atmega328p'), rel.compilerOptions);
check('AVR 工程：骨架文件进入文件列表', project.files.some((f) => f.relativeFilename === 'main.c'));

const { project: cvProj } = createProjectFromTemplate('cv-demo', process.cwd(), cv, 'gcc');
check('OpenCV 工程：链接库进入目标', cvProj.buildTargets.every((t) => t.linkLibs.includes('opencv_core')), cvProj.buildTargets[0].linkLibs);

console.log(`工程模板测试: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
