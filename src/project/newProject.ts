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
import * as i18n from '../i18n';

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

const GLFW_README = i18n.t('GLFW template notes\n================\n1. Add the GLFW installation\'s include directory to Build Options → Search directories\n   (the relative path include is preset; the GLFW header must be at <project>/include/GLFW/glfw3.h).\n2. Add the directory containing the library file (libglfw3.a) to Linker directories (the system library\n   search path is used by default).\n3. Link libraries glfw3 / opengl32 / gdi32 (MinGW static libraries) are preset.\n4. For a different GLFW version, edit those paths directly in the project properties.\n');

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

const SDL2_README = i18n.t('SDL2 template notes\n================\n1. Unpack SDL2-devel (MinGW build) and add its include directory to the search directories\n   (if SDL.h is under include/SDL2, use include/SDL2 as the search directory).\n2. Add x86_64-w64-mingw32/lib (or i686-w64-mingw32/lib) to the library directories.\n3. Link libraries mingw32 / SDL2main / SDL2 are preset; add -mwindows if you want no console window.\n');

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

const WX_README = i18n.t('wxWidgets template notes\n====================\n1. Check the include directory against the output of wx-config --cxxflags; MinGW installations usually use\n   <wx>/include and <wx>/lib/gcc_lib/mswu (version dependent).\n2. Link library names change with the wx version (this template presets the wx 3.2 Unicode static libraries:\n   wxmsw32u_core / wxbase32u); switch to the matching DLL import libraries when using dynamic libraries.\n3. A single main.cpp compiles directly without moc; custom control classes added later (using\n   wxDECLARE_EVENT_TABLE and the like) need preprocessing; consider CMake + the official wxWidgets toolchain.\n');

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

const QT_README = i18n.t('Qt template notes\n=============\n1. Add the subdirectories of the Qt installation\'s include directory (e.g. C:/Qt/6.6.0/mingw_64/include)\n   to the search directories; the common ones: include, include/QtCore, include/QtGui, include/QtWidgets.\n2. Add C:/Qt/6.6.0/mingw_64/lib to the library directories.\n3. Link libraries Qt6Widgets / Qt6Gui / Qt6Core are preset; linking requires C++17 or later.\n4. Custom QObject classes (with Q_OBJECT) need moc preprocessing; this template has only main.cpp, so it\n   does not. As the project grows, consider switching to CMake (Qt\'s official recommendation).\n');

const AVR_MAIN_C = i18n.t('#include <avr/io.h>\n#include <util/delay.h>\n\nint main(void)\n{\n    DDRB |= (1 << PB5);            /* Arduino Uno on-board LED: PB5 */\n\n    while (1)\n    {\n        PORTB ^= (1 << PB5);\n        _delay_ms(500);\n    }\n    return 0;\n}\n');

const AVR_README = i18n.t('AVR template notes (aligned with the Code::Blocks AVR wizard)\n==================\n1. The AVR toolchain (avr-gcc / avr-objcopy / avrdude) must be installed; in "Compiler settings",\n   point the compiler to avr-gcc (e.g. C:/WinAVR/bin/avr-gcc.exe or the avr-gcc bundled with Arduino).\n2. Compiler options -mmcu=atmega328p -DF_CPU=16000000UL -Os are preset (change -mmcu and F_CPU\n   for your target chip).\n3. Link libraries usually also need -lm; for flashing you can add a custom avrdude tool under Tools → Configure Tools…:\n   avrdude -c arduino -p m328p -P COM3 -b 115200 -U flash:w:$(TARGET_OUTPUT_FILE):i\n4. Hexadecimal output (.hex) can be produced by calling avr-objcopy from a custom tool in Tools:\n   avr-objcopy -O ihex -R .eeprom <project output>.elf app.hex\n');

const MSP430_MAIN_C = i18n.t('#include <msp430.h>\n\nint main(void)\n{\n    WDTCTL = WDTPW | WDTHOLD;      /* disable watchdog */\n\n    P1DIR |= BIT0;                 /* P1.0 output (on-board LaunchPad LED) */\n    for (;;)\n    {\n        P1OUT ^= BIT0;\n        __delay_cycles(1000000);\n    }\n    return 0;\n}\n');

const MSP430_README = i18n.t('MSP430 template notes (aligned with the Code::Blocks MSP430 wizard)\n=====================\n1. The MSP430 toolchain (msp430-gcc / msp430-gdb) must be installed; point to it in "Compiler settings"\n   (e.g. C:/ti/msp430-gcc/bin/msp430-gcc.exe).\n2. Compiler options -mmcu=msp430g2553 -Os are preset (the chip that ships with the LaunchPad MSP-EXP430G2;\n   change -mmcu for your actual chip).\n3. Debugging: in "Project properties → Debugger", select msp430-gdb and enable remote/serial debugging\n   (msp430-gdb is usually paired with msp430-gdbproxy, or use the on-board eZ430 debugger).\n4. Flashing can be done separately with TI UniFlash / mspdebug; or add a custom mspdebug tool under\n   Tools → Configure Tools… .\n');

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

const OPENCV_README = i18n.t('OpenCV template notes (aligned with the Code::Blocks OpenCV wizard)\n================\n1. OpenCV must be installed (the official Windows package or an MSYS2/MinGW package); this template presets\n   link libraries with MinGW names:\n   opencv_core / opencv_imgproc / opencv_imgcodecs / opencv_highgui (when an OpenCV 4 distribution merges them\n   into opencv_world, change the link libraries to opencv_world).\n2. Add OpenCV\'s include directory and its subdirectories to the search directories\n   (from OpenCV 4 onward the headers are flat under include/opencv4).\n3. Add OpenCV\'s lib to the library directories (MinGW static libraries are libopencv_*.a, DLL import\n   libraries are libopencv_*.dll.a).\n4. For "Link libraries": when the dynamic library distribution is used, add OpenCV\'s bin directory to PATH\n   before running.\n');

/** 工程模板列表（对齐 Code::Blocks 常用 New Project 模板） */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'console-cpp',
    label: 'Console application (C++)',
    description: i18n.t('Console application (C++, main.cpp)'),
    targetType: TargetType.ConsoleOnly,
    skeleton: [{ name: 'main.cpp', content: CONSOLE_MAIN_CPP }],
  },
  {
    id: 'console-c',
    label: 'Console application (C)',
    description: i18n.t('Console application (C, main.c)'),
    targetType: TargetType.ConsoleOnly,
    skeleton: [{ name: 'main.c', content: CONSOLE_MAIN_C }],
  },
  {
    id: 'static',
    label: 'Static library',
    description: i18n.t('Static library (.a)'),
    targetType: TargetType.StaticLib,
    skeleton: [],
  },
  {
    id: 'shared',
    label: 'Shared library',
    description: i18n.t('Shared library (.so/.dll)'),
    targetType: TargetType.DynamicLib,
    skeleton: [],
  },
  {
    id: 'empty',
    label: 'Empty project',
    description: i18n.t('Empty project'),
    targetType: TargetType.ConsoleOnly,
    skeleton: [],
  },
  {
    id: 'glfw',
    label: 'GLFW application (C)',
    description: i18n.t('Graphics window application (GLFW; adjust include/libs to your install path; see the template notes)'),
    targetType: TargetType.ConsoleOnly,
    includeDirs: ['include'],
    linkLibs: ['glfw3', 'opengl32', 'gdi32'],
    skeleton: [
      { name: 'main.c', content: GLFW_MAIN_C },
      { name: i18n.t('README-template.txt'), content: GLFW_README },
    ],
  },
  {
    id: 'sdl2',
    label: 'SDL2 application (C)',
    description: i18n.t('SDL2 window application (MinGW: -lmingw32 -lSDL2main -lSDL2)'),
    targetType: TargetType.ConsoleOnly,
    includeDirs: ['include'],
    linkLibs: ['mingw32', 'SDL2main', 'SDL2'],
    skeleton: [
      { name: 'main.c', content: SDL2_MAIN_C },
      { name: i18n.t('README-template.txt'), content: SDL2_README },
    ],
  },
  {
    id: 'wxwidgets',
    label: 'wxWidgets application (C++)',
    description: i18n.t('Minimal wxWidgets skeleton (adjust link library names to your wx version; see the template notes)'),
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-std=c++17'],
    linkLibs: ['wxmsw32u_core', 'wxbase32u'],
    skeleton: [
      { name: 'main.cpp', content: WX_MAIN_CPP },
      { name: i18n.t('README-template.txt'), content: WX_README },
    ],
  },
  {
    id: 'qt',
    label: 'Qt Widgets application (C++)',
    description: i18n.t('Minimal Qt6 Widgets application (Qt include/lib directories required; moc notes in the template)'),
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-std=c++17'],
    linkLibs: ['Qt6Widgets', 'Qt6Gui', 'Qt6Core'],
    skeleton: [
      { name: 'main.cpp', content: QT_MAIN_CPP },
      { name: i18n.t('README-template.txt'), content: QT_README },
    ],
  },
  {
    id: 'avr',
    label: 'AVR application (C, avr-gcc)',
    description: i18n.t('AVR bare-metal application (atmega328p; -mmcu/-DF_CPU can be changed for your chip)'),
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-mmcu=atmega328p', '-DF_CPU=16000000UL', '-Os'],
    skeleton: [
      { name: 'main.c', content: AVR_MAIN_C },
      { name: i18n.t('README-template.txt'), content: AVR_README },
    ],
  },
  {
    id: 'msp430',
    label: 'MSP430 application (C, msp430-gcc)',
    description: i18n.t('MSP430 bare-metal application (msp430g2553; debug with msp430-gdb)'),
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-mmcu=msp430g2553', '-Os'],
    skeleton: [
      { name: 'main.c', content: MSP430_MAIN_C },
      { name: i18n.t('README-template.txt'), content: MSP430_README },
    ],
  },
  {
    id: 'opencv',
    label: 'OpenCV application (C++)',
    description: i18n.t('OpenCV image window application (link libraries preset with OpenCV 4 MinGW names)'),
    targetType: TargetType.ConsoleOnly,
    compilerOptions: ['-std=c++17'],
    linkLibs: ['opencv_core', 'opencv_imgproc', 'opencv_imgcodecs', 'opencv_highgui'],
    skeleton: [
      { name: 'main.cpp', content: OPENCV_MAIN_CPP },
      { name: i18n.t('README-template.txt'), content: OPENCV_README },
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
