// 工程导入（Wave 4 C5）：.dev（INI/XML）/ .dsp / .vcxproj 解析 + .cbp 模型生成与回读
const { importDevProject, importDspProject, importVcxproj, buildProjectFromImport } = require('../dist/project/projectImporter');
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const { TargetType } = require('../dist/model/types');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

// ---- .dev XML（Dev-C++ 5） ----
const devXml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<DEVPROJECT>
    <NAME value="gltest" />
    <TYPE value="1" />
    <COMPILER value="gcc.exe" />
    <UNITS>
        <FILE value="main.c" />
        <FILE value="gl.c" />
    </UNITS>
    <INCLUDEPATHS>
        <FILE value="include" />
        <FILE value="C:\\sdk\\inc" />
    </INCLUDEPATHS>
    <CFLAGS>
        <FILE value="-O2" />
    </CFLAGS>
    <LIBPATHS>
        <FILE value="lib" />
    </LIBPATHS>
    <LIBS>
        <FILE value="-lglfw3" />
        <FILE value="-lopengl32" />
    </LIBS>
</DEVPROJECT>`;
const devX = importDevProject(devXml, 'fb');
check('dev XML 标题', devX.title === 'gltest', devX.title);
check('dev XML 类型（1=控制台）', devX.targetType === TargetType.ConsoleOnly, devX.targetType);
check('dev XML 文件列表', JSON.stringify(devX.files) === JSON.stringify(['main.c', 'gl.c']), devX.files);
check('dev XML include 目录', devX.includeDirs.length === 2 && devX.includeDirs[0] === 'include', devX.includeDirs);
check('dev XML 库目录', JSON.stringify(devX.libDirs) === JSON.stringify(['lib']), devX.libDirs);
check('dev XML 链接库（去 -l）', JSON.stringify(devX.linkLibs) === JSON.stringify(['glfw3', 'opengl32']), devX.linkLibs);
check('dev XML 编译选项', JSON.stringify(devX.compilerOptions) === JSON.stringify(['-O2']), devX.compilerOptions);

// ---- .dev INI（Dev-C++ 4） ----
const devIni = `[Project]
FileName=hello.dev
Name=hello
Compiler=-O2_@@_-Wall
CppCompiler=-std=c++14_@@_
Linker=-lmingw32_@@_-lSDL2main_@@_-lSDL2
Includes=C:\\inc;inc2
Libs=C:\\lib
Type=1
UnitCount=2
Unit1=main.c
Unit2=util.cpp

[Unit1]
FileName=main.c
Compile=1
CompileCpp=0
Link=1

[Unit2]
FileName=util.cpp
Compile=1
CompileCpp=1
Link=1
`;
const devI = importDevProject(devIni, 'fb');
check('dev INI 标题', devI.title === 'hello', devI.title);
check('dev INI 文件列表', JSON.stringify(devI.files) === JSON.stringify(['main.c', 'util.cpp']), devI.files);
check('dev INI include 目录', devI.includeDirs.length === 2 && devI.includeDirs[1] === 'inc2', devI.includeDirs);
check('dev INI 链接库', JSON.stringify(devI.linkLibs) === JSON.stringify(['mingw32', 'SDL2main', 'SDL2']), devI.linkLibs);
check('dev INI 编译选项合并', devI.compilerOptions.includes('-O2') && devI.compilerOptions.includes('-Wall') && devI.compilerOptions.includes('-std=c++14'), devI.compilerOptions);

// ---- .dsp（VC6） ----
const dsp = `# Microsoft Developer Studio Project File - Name="winapp" - Package Owner=<4>
# Microsoft Developer Studio Generated Build File, Format Version 6.00
# TARGTYPE "Win32 (x86) Console Application" 0x0103

CFG=winapp - Win32 Debug
# ADD BASE CPP /nologo /W3 /Gm /GX /ZI /Od /I "src\\include" /D "WIN32" /D "_DEBUG" /D "_CONSOLE"
# ADD CPP /nologo /W3 /Gm /GX /ZI /Od /I "src\\include" /D "WIN32"
# ADD BASE LINK32 kernel32.lib user32.lib gdi32.lib /nologo /subsystem:console /machine:I386
# ADD LINK32 kernel32.lib user32.lib /nologo /subsystem:console

# Begin Source File

SOURCE=.\\src\\main.c
# End Source File

# Begin Source File

SOURCE=.\\src\\util.c
# End Source File
`;
const dspR = importDspProject(dsp, 'fb');
check('dsp 标题', dspR.title === 'winapp', dspR.title);
check('dsp 类型', dspR.targetType === TargetType.ConsoleOnly, dspR.targetType);
check('dsp 文件（去 .\\ 反斜杠归一）', JSON.stringify(dspR.files) === JSON.stringify(['src/main.c', 'src/util.c']), dspR.files);
check('dsp include（/I 去重）', JSON.stringify(dspR.includeDirs) === JSON.stringify(['src/include']), dspR.includeDirs);
check('dsp 库（.lib 去后缀去重）', JSON.stringify(dspR.linkLibs) === JSON.stringify(['kernel32', 'user32', 'gdi32']), dspR.linkLibs);
check('dsp 选项（-O0/-g/定义）', dspR.compilerOptions.includes('-O0') && dspR.compilerOptions.includes('-g') && dspR.compilerOptions.includes('-DWIN32'), dspR.compilerOptions);

// ---- .vcxproj（VS2010+） ----
const vcx = `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup Label="Globals">
    <ProjectName>vstest</ProjectName>
    <RootNamespace>vstest</RootNamespace>
  </PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)'=='Debug'" Label="Configuration">
    <ConfigurationType>Application</ConfigurationType>
  </PropertyGroup>
  <ItemGroup>
    <ClCompile Include="src\\main.cpp" />
    <ClCompile Include="src\\util.cpp" />
    <ClInclude Include="src\\util.h" />
  </ItemGroup>
  <ItemDefinitionGroup Condition="'$(Configuration)'=='Debug'">
    <ClCompile>
      <AdditionalIncludeDirectories>include;%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories>
      <PreprocessorDefinitions>WIN32;_DEBUG;%(PreprocessorDefinitions)</PreprocessorDefinitions>
      <LanguageStandard>stdcpp17</LanguageStandard>
      <Optimization>Disabled</Optimization>
    </ClCompile>
    <Link>
      <SubSystem>Console</SubSystem>
      <AdditionalDependencies>winmm.lib;%(AdditionalDependencies)</AdditionalDependencies>
      <AdditionalLibraryDirectories>lib;$(SolutionDir)ext\\lib</AdditionalLibraryDirectories>
    </Link>
  </ItemDefinitionGroup>
</Project>`;
const vcxR = importVcxproj(vcx, 'fb');
check('vcxproj 标题（ProjectName）', vcxR.title === 'vstest', vcxR.title);
check('vcxproj 类型（Console 子系统）', vcxR.targetType === TargetType.ConsoleOnly, vcxR.targetType);
check('vcxproj 文件列表', JSON.stringify(vcxR.files) === JSON.stringify(['src/main.cpp', 'src/util.cpp', 'src/util.h']), vcxR.files);
check('vcxproj include（剥离 %(...)）', JSON.stringify(vcxR.includeDirs) === JSON.stringify(['include']), vcxR.includeDirs);
check('vcxproj 库（.lib 去后缀）', JSON.stringify(vcxR.linkLibs) === JSON.stringify(['winmm']), vcxR.linkLibs);
check('vcxproj 库目录（剥离 $(...) 宏、保留相对残余）', JSON.stringify(vcxR.libDirs) === JSON.stringify(['lib', 'ext/lib']), vcxR.libDirs);
check('vcxproj 选项（std/优化/定义）', vcxR.compilerOptions.includes('-std=c++17') && vcxR.compilerOptions.includes('-O0') && vcxR.compilerOptions.includes('-DWIN32'), vcxR.compilerOptions);

// ---- buildProjectFromImport + .cbp 回读 ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-imp-'));
fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void){return 0;}\n');
fs.writeFileSync(path.join(dir, 'gl.c'), 'int g(void){return 1;}\n');
const devFile = path.join(dir, 'game.dev');
fs.writeFileSync(devFile, devXml, 'utf-8');
const imp = importDevProject(fs.readFileSync(devFile, 'utf-8'), 'game');
imp.files.push('C:\\outside\\ext.c'); // 工程目录外 → 跳过
const built = buildProjectFromImport(devFile, imp, 'gcc');
check('工程目录外文件跳过', built.skipped.length === 1 && built.skipped[0] === 'C:\\outside\\ext.c', built.skipped);
check('目标数量 = 1（Debug）', built.project.buildTargets.length === 1 && built.project.buildTargets[0].title === 'Debug', built.project.buildTargets.map((t) => t.title));
check('文件数量 = 2', built.project.files.length === 2, built.project.files.map((f) => f.relativeFilename));
check('目标 include/库传递', built.project.buildTargets[0].includeDirs.length === 2 && built.project.buildTargets[0].linkLibs.includes('glfw3'), built.project.buildTargets[0]);

fs.writeFileSync(built.cbpPath, serializeProject(built.project), 'utf-8');
const reparsed = new ProjectParser().parse(built.cbpPath);
check('回读：标题', reparsed.title === 'gltest', reparsed.title);
check('回读：文件数', reparsed.files.length === 2, reparsed.files.length);
check('回读：链接库', JSON.stringify(reparsed.buildTargets[0].linkLibs) === JSON.stringify(['glfw3', 'opengl32']), reparsed.buildTargets[0].linkLibs);
check('回读：include 目录', JSON.stringify(reparsed.buildTargets[0].includeDirs.map((d) => d.replace(/\\/g, '/').toLowerCase())) === JSON.stringify(['include', 'c:/sdk/inc']), reparsed.buildTargets[0].includeDirs);

// outputName 覆盖
const imp2 = { ...imp, outputName: 'bin/custom/app' };
const built2 = buildProjectFromImport(devFile, imp2, 'gcc');
check('输出名覆盖', built2.project.buildTargets[0].outputFilename === 'bin/custom/app', built2.project.buildTargets[0].outputFilename);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`工程导入: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
