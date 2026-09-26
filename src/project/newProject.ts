/**
 * 新建工程向导 —— 对标 Code::Blocks 的 New Project 模板
 *
 * 提供 12 类内置模板（Console C/C++ / Static / Shared / Empty / GLFW / SDL2 /
 * wxWidgets / Qt / AVR / MSP430 / OpenCV），生成 .cbp（Debug/Release 双目标）+ 骨架源文件。
 * 用户自定义模板见 `userTemplates.ts`（R13）。
 */
import * as path from 'path';
import {
  Project,
  BuildTarget,
  ProjectFile,
  TargetType,
  OptionsRelation,
  OptionsRelationType,
  LinkerExecutableOption,
} from '../model/types';
import { defaultCompilerVar, defaultCompile, defaultLink } from '../model/fileTypes';

/** 工程模板定义 */
export interface ProjectTemplate {
  id: string;
  /** QuickPick 显示名 */
  label: string;
  description: string;
  targetType: TargetType;
  /** 骨架源文件（相对项目目录的文件名 + 内容） */
  skeleton: { name: string; content: string }[];
  /** 模板附加编译选项（Debug/Release 共用，追加在内置选项之后） */
  compilerOptions?: string[];
  /** 模板 include 目录（相对项目根，按安装路径调整） */
  includeDirs?: string[];
  /** 模板库目录 */
  libDirs?: string[];
  /** 模板链接库（不带 -l / .lib 前缀） */
  linkLibs?: string[];
}

const CONSOLE_MAIN_C = `#include <stdio.h>

int main()
{
    printf("Hello, world!\\n");
    return 0;
}
`;

const CONSOLE_MAIN_CPP = `#include <iostream>

int main()
{
    std::cout << "Hello, world!" << std::endl;
    return 0;
}
`;

const GLFW_MAIN_C = `#include <GLFW/glfw3.h>

int main(void)
{
    if (!glfwInit())
        return 1;

    GLFWwindow* window = glfwCreateWindow(800, 600, "GLFW window", NULL, NULL);
    if (!window)
    {
        glfwTerminate();
        return 1;
    }

    while (!glfwWindowShouldClose(window))
    {
        glfwSwapBuffers(window);
        glfwPollEvents();
    }

    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
`;

const GLFW_README = `GLFW 模板说明
================
1. 把 GLFW 安装目录的 include 目录加入 Build Options → Search directories
   （默认已填相对路径 include；GLFW 头文件需位于 <项目>/include/GLFW/glfw3.h）。
2. 库文件（libglfw3.a）所在目录加入 Linker directories（默认用系统库搜索路径）。
3. 链接库已预置：glfw3 / opengl32 / gdi32（MinGW 静态库）。
4. 若使用其它版本 GLFW，可直接在工程属性中修改上述路径。
`;

const SDL2_MAIN_C = `#include <SDL.h>

int main(int argc, char* argv[])
{
    (void)argc;
    (void)argv;

    if (SDL_Init(SDL_INIT_VIDEO) != 0)
        return 1;

    SDL_Window* window = SDL_CreateWindow("SDL2 window",
        SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, 800, 600, 0);
    if (!window)
    {
        SDL_Quit();
        return 1;
    }

    SDL_Event event;
    int running = 1;
    while (running)
    {
        while (SDL_PollEvent(&event))
        {
            if (event.type == SDL_QUIT)
                running = 0;
        }
        SDL_Delay(16);
    }

    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
`;

const SDL2_README = `SDL2 模板说明
================
1. 解压 SDL2-devel（MinGW 版），将其 include 目录加入搜索目录
   （SDL.h 位于 include/SDL2 时：搜索目录填 include/SDL2）。
2. 将 x86_64-w64-mingw32/lib（或 i686-w64-mingw32/lib）加入库目录。
3. 链接库已预置 mingw32 / SDL2main / SDL2；如需无控制台窗口再加 -mwindows。
`;

const WX_MAIN_CPP = `#include <wx/wx.h>

class CbApp : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame(nullptr, wxID_ANY, "wxWidgets");
        frame->Show();
        return true;
    }
};

wxIMPLEMENT_APP(CbApp);
`;

const WX_README = `wxWidgets 模板说明
====================
1. 用 wx-config --cxxflags 的输出核对 include 目录；MinGW 安装通常在
   <wx>/include 与 <wx>/lib/gcc_lib/mswu（版本相关）。
2. 链接库名随 wx 版本变化（本模板预置 wx 3.2 Unicode 静态库：
   wxmsw32u_core / wxbase32u）；使用动态库时改为对应 dll 导入库。
3. 单个 main.cpp 直接编译不需要 moc；后续添加自定义控件类（使用
   wxDECLARE_EVENT_TABLE 等）时需要预处理，建议改用 CMake + wxWidgets 官方工具链。
`;

const QT_MAIN_CPP = `#include <QApplication>
#include <QLabel>

int main(int argc, char* argv[])
{
    QApplication app(argc, argv);
    QLabel label("Qt Widgets");
    label.show();
    return app.exec();
}
`;

const QT_README = `Qt 模板说明
=============
1. 把 Qt 安装目录的 include（如 C:/Qt/6.6.0/mingw_64/include）各子目录加入搜索目录；
   常用：include、include/QtCore、include/QtGui、include/QtWidgets。
2. 库目录加入 C:/Qt/6.6.0/mingw_64/lib。
3. 链接库已预置 Qt6Widgets / Qt6Gui / Qt6Core；链接需要 C++17 及以上。
4. 自定义 QObject 类（含 Q_OBJECT）需要 moc 预处理；本模板仅 main.cpp 不需要。
   工程变大后建议改用 CMake（Qt 官方推荐）。
`;

const AVR_MAIN_C = `#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRB |= (1 << PB5);            /* Arduino Uno 板载 LED：PB5 */

    while (1)
    {
        PORTB ^= (1 << PB5);
        _delay_ms(500);
    }
    return 0;
}
`;

const AVR_README = `AVR 模板说明（对齐 Code::Blocks AVR 向导）
==================
1. 需安装 AVR 工具链（avr-gcc / avr-objcopy / avrdude），并在「编译器设置」中
   把编译器指向 avr-gcc（如 C:/WinAVR/bin/avr-gcc.exe 或 Arduino 自带的 avr-gcc）。
2. 已预置编译选项 -mmcu=atmega328p -DF_CPU=16000000UL -Os（按目标芯片修改
   -mmcu 与 F_CPU）。
3. 链接库通常还需 -lm；烧录可用 Tools → Configure Tools… 添加 avrdude 自定义工具：
   avrdude -c arduino -p m328p -P COM3 -b 115200 -U flash:w:$(TARGET_OUTPUT_FILE):i
4. 十六进制输出（.hex）可通过 Tools 自定义工具调用 avr-objcopy：
   avr-objcopy -O ihex -R .eeprom <工程输出>.elf app.hex
`;

const MSP430_MAIN_C = `#include <msp430.h>

int main(void)
{
    WDTCTL = WDTPW | WDTHOLD;      /* 关闭看门狗 */

    P1DIR |= BIT0;                 /* P1.0 输出（LaunchPad 板载 LED） */
    for (;;)
    {
        P1OUT ^= BIT0;
        __delay_cycles(1000000);
    }
    return 0;
}
`;

const MSP430_README = `MSP430 模板说明（对齐 Code::Blocks MSP430 向导）
=====================
1. 需安装 MSP430 工具链（msp430-gcc / msp430-gdb），并在「编译器设置」中指向
   msp430-gcc（如 C:/ti/msp430-gcc/bin/msp430-gcc.exe）。
2. 已预置编译选项 -mmcu=msp430g2553 -Os（LaunchPad MSP-EXP430G2 标配芯片；
   按实际芯片修改 -mmcu）。
3. 调试：在「项目属性 → 调试器」中选择 msp430-gdb 并启用远程/串口调试
   （msp430-gdb 常配 msp430-gdbproxy，或使用板载 eZ430 调试器）。
4. 烧录可使用 TI UniFlash / mspdebug 单独完成；或在 Tools → Configure Tools… 
   添加 mspdebug 自定义工具。
`;

const OPENCV_MAIN_CPP = `#include <opencv2/opencv.hpp>

int main()
{
    cv::Mat image = cv::Mat::zeros(480, 640, CV_8UC3);
    cv::circle(image, cv::Point(320, 240), 100, cv::Scalar(0, 200, 255), 2);
    cv::putText(image, "OpenCV + Code::Blocks", cv::Point(150, 60),
                cv::FONT_HERSHEY_SIMPLEX, 0.8, cv::Scalar(255, 255, 255), 2);
    cv::imshow("OpenCV window", image);
    cv::waitKey(0);
    return 0;
}
`;

const OPENCV_README = `OpenCV 模板说明（对齐 Code::Blocks OpenCV 向导）
================
1. 需安装 OpenCV（Windows 官方包或 MSYS2/MinGW 包）；本模板按 MinGW 命名预置链接库：
   opencv_core / opencv_imgproc / opencv_imgcodecs / opencv_highgui（OpenCV 4 已合并为
   opencv_world 发行时，可把链接库改为 opencv_world）。
2. include 目录加入 OpenCV 的 include 与其子目录（OpenCV 4 起头文件平铺在 include/opencv4）。
3. 库目录加入 OpenCV 的 lib（MinGW 静态库为 libopencv_*.a，动态库为 libopencv_*.dll.a）。
4. 「链接库」如使用动态库发行包，运行前需把 OpenCV bin 目录加入 PATH。
`;

/** 工程模板列表（对齐 Code::Blocks 常用 New Project 模板） */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'console-cpp',
    label: 'Console application (C++)',
    description: '控制台程序（C++，main.cpp）',
    targetType: TargetType.ConsoleOnly,
    skeleton: [{ name: 'main.cpp', content: CONSOLE_MAIN_CPP }],
  },
  {
    id: 'console-c',
    label: 'Console application (C)',
    description: '控制台程序（C，main.c）',
    targetType: TargetType.ConsoleOnly,
    skeleton: [{ name: 'main.c', content: CONSOLE_MAIN_C }],
  },
  {
    id: 'static',
    label: 'Static library',
    description: '静态库（.a）',
    targetType: TargetType.StaticLib,
    skeleton: [],
  },
  {
    id: 'shared',
    label: 'Shared library',
    description: '共享库（.so/.dll）',
    targetType: TargetType.DynamicLib,
    skeleton: [],
  },
  {
    id: 'empty',
    label: 'Empty project',
    description: '空工程',
    targetType: TargetType.ConsoleOnly,
    skeleton: [],
  },
  {
    id: 'glfw',
    label: 'GLFW application (C)',
    description: '图形窗口程序（GLFW；include/libs 按安装路径调整，见模板说明）',
    targetType: TargetType.ConsoleOnly,
    includeDirs: ['include'],
    linkLibs: ['glfw3', 'opengl32', 'gdi32'],
    skeleton: [
      { name: 'main.c', content: GLFW_MAIN_C },
      { name: 'README-模板说明.txt', content: GLFW_README },
    ],
  },
  {
    id: 'sdl2',
    label: 'SDL2 application (C)',
    description: 'SDL2 窗口程序（MinGW：-lmingw32 -lSDL2main -lSDL2）',
    targetType: TargetType.ConsoleOnly,
    includeDirs: ['include'],
    linkLibs: ['mingw32', 'SDL2main', 'SDL2'],
    skeleton: [
      { name: 'main.c', content: SDL2_MAIN_C },
      { name: 'README-模板说明.txt', content: SDL2_README },
    ],
  },
  {
    id: 'wxwidgets',
    label: 'wxWidgets application (C++)',
    description: 'wxWidgets 最小框架（链接库名按 wx 版本调整，见模板说明）',
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-std=c++17'],
    linkLibs: ['wxmsw32u_core', 'wxbase32u'],
    skeleton: [
      { name: 'main.cpp', content: WX_MAIN_CPP },
      { name: 'README-模板说明.txt', content: WX_README },
    ],
  },
  {
    id: 'qt',
    label: 'Qt Widgets application (C++)',
    description: 'Qt6 Widgets 最小程序（需 Qt 头文件/库目录；moc 说明见模板）',
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-std=c++17'],
    linkLibs: ['Qt6Widgets', 'Qt6Gui', 'Qt6Core'],
    skeleton: [
      { name: 'main.cpp', content: QT_MAIN_CPP },
      { name: 'README-模板说明.txt', content: QT_README },
    ],
  },
  {
    id: 'avr',
    label: 'AVR application (C, avr-gcc)',
    description: 'AVR 裸机程序（atmega328p；-mmcu/-DF_CPU 可按芯片修改）',
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-mmcu=atmega328p', '-DF_CPU=16000000UL', '-Os'],
    skeleton: [
      { name: 'main.c', content: AVR_MAIN_C },
      { name: 'README-模板说明.txt', content: AVR_README },
    ],
  },
  {
    id: 'msp430',
    label: 'MSP430 application (C, msp430-gcc)',
    description: 'MSP430 裸机程序（msp430g2553；配合 msp430-gdb 调试）',
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-mmcu=msp430g2553', '-Os'],
    skeleton: [
      { name: 'main.c', content: MSP430_MAIN_C },
      { name: 'README-模板说明.txt', content: MSP430_README },
    ],
  },
  {
    id: 'opencv',
    label: 'OpenCV application (C++)',
    description: 'OpenCV 图像窗口程序（链接库按 OpenCV 4 MinGW 命名预置）',
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-std=c++17'],
    linkLibs: ['opencv_core', 'opencv_imgproc', 'opencv_imgcodecs', 'opencv_highgui'],
    skeleton: [
      { name: 'main.cpp', content: OPENCV_MAIN_CPP },
      { name: 'README-模板说明.txt', content: OPENCV_README },
    ],
  },
];

function defaultRelations(): Record<OptionsRelationType, OptionsRelation> {
  return {
    [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
    [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
  };
}

export function makeTarget(name: string, title: string, type: TargetType, compilerOptions: string[], compilerId: string): BuildTarget {
  return {
    title,
    targetType: type,
    compilerId,
    outputFilename: type === TargetType.StaticLib ? `bin/${title}/lib${name}.a`
      : type === TargetType.DynamicLib ? (process.platform === 'win32' ? `bin/${title}/lib${name}.dll` : `bin/${title}/lib${name}.so`)
      : `bin/${title}/${name}`,
    objectOutput: `obj/${title}/`,
    depsOutput: '',
    executionParameters: '',
    workingDir: '',
    hostApplication: '',
    runHostApplicationInTerminal: true,
    makeCommands: {},
    optionRelations: defaultRelations(),
    compilerOptions,
    linkerOptions: [],
    resourceCompilerOptions: [],
    includeDirs: [],
    libDirs: [],
    resourceIncludeDirs: [],
    linkLibs: [],
    files: [],
    linkerExecutable: LinkerExecutableOption.AutoDetect,
    createDefFile: false,
    createStaticLib: false,
    impLib: '',
    defFile: '',
    prefixAuto: true,
    extensionAuto: true,
    useConsoleRunner: true,
    includeInTargetAll: false,
    platforms: 0xff,
    commandsBeforeBuild: [],
    commandsAfterBuild: [],
    commandsBeforeClean: [],
    commandsAfterClean: [],
    buildScripts: [],
    envVars: [],
    alwaysRunPostBuildSteps: false,
    externalDeps: [],
    additionalOutput: [],
  };
}

export function makeFile(projectDir: string, rel: string, targetTitles: string[]): ProjectFile {
  return {
    relativeFilename: rel,
    relativeToCommonTopLevelPath: rel,
    absolutePath: path.join(projectDir, rel),
    buildTargets: [...targetTitles],
    explicitTargets: false,
    // 默认值对齐 cbProject::AddFile（.c→CC，Win .rc→WINDRES，其它→CPP；compile/link 按文件类型）
    compilerVar: defaultCompilerVar(rel),
    compile: defaultCompile(rel),
    link: defaultLink(rel),
    customBuildCommands: {},
    weight: 50,
    virtualFolder: '',
    generatedFiles: [],
  };
}

/** 生成新工程的 Project 模型（不落盘） */
export function createProjectFromTemplate(
  name: string,
  basePath: string,
  tpl: ProjectTemplate,
  compilerId = 'gcc',
): { project: Project; projectDir: string } {
  const projectDir = path.join(basePath, name);
  const targetTitles = ['Debug', 'Release'];
  // 模板附加选项（编译选项追加在内置之后；目录/库原样进入两个目标，可按需在工程属性中调整）
  const tplOpts = tpl.compilerOptions ?? [];
  const debugTarget = makeTarget(name, 'Debug', tpl.targetType, ['-g', '-Wall', ...tplOpts], compilerId);
  const releaseTarget = makeTarget(name, 'Release', tpl.targetType, ['-O2', ...tplOpts], compilerId);
  for (const t of [debugTarget, releaseTarget]) {
    t.includeDirs = [...(tpl.includeDirs ?? [])];
    t.libDirs = [...(tpl.libDirs ?? [])];
    t.linkLibs = [...(tpl.linkLibs ?? [])];
  }
  const project: Project = {
    title: name,
    basePath: projectDir,
    commonTopLevelPath: projectDir,
    pchMode: 1,
    extendedObjNames: false,
    platforms: 0xff,
    filename: path.join(projectDir, `${name}.cbp`),
    compilerId,
    compilerOptions: [],
    linkerOptions: [],
    resourceCompilerOptions: [],
    includeDirs: [],
    libDirs: [],
    resourceIncludeDirs: [],
    linkLibs: [],
    buildTargets: [debugTarget, releaseTarget],
    virtualTargets: [],
    virtualFolders: [],
    commandsBeforeBuild: [],
    commandsAfterBuild: [],
    buildScripts: [],
    notes: '',
    showNotesOnLoad: false,
    envVars: [],
    alwaysRunPostBuildSteps: false,
    makefileIsCustom: false,
    makefile: '',
    executionDir: '',
    makeCommands: {},
    customVariables: {},
    files: tpl.skeleton.map((f) => makeFile(projectDir, f.name, targetTitles)),
    extensions: null,
  };
  return { project, projectDir };
}
