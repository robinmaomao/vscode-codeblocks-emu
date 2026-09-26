/**
 * 从目标导出独立工程 —— 对应 projectloader.cpp:1472-1830 ExportTargetAsProject（onlyTarget 非空）。
 *
 * 对齐 CB 语义：
 * - 工程头（title/compiler/虚拟文件夹/备注/MakeCommands/项目级选项与 pre-post/环境变量/脚本）原样保留；
 * - 仅导出选中的目标（全部目标选项，含输出命名策略、工作目录、宿主程序、环境变量、MakeCommands 等）；
 * - 文件只保留归属该目标的文件（`buildTargets` 含该目标；自动生成文件不导出——序列化器已处理）；
 *   单目标工程的文件不再写 target 归属（explicitTargets=false，与 CB 按数量比较后省略等价）；
 * - 虚拟目标不导出（CB：仅整工程导出时写出）；
 * - Extensions 节点随工程保留（CB cbproject::ExportTargetAsProject 传入 m_pExtensionsElement）。
 *
 * 纯函数（无 vscode 依赖），供命令与回归测试共用。
 */
import { Project, BuildTarget } from '../model/types';

/** 深拷贝目标（数组/映射字段至少浅拷贝；files 由导出流程重建） */
function cloneTarget(t: BuildTarget): BuildTarget {
  return {
    ...t,
    compilerOptions: [...t.compilerOptions],
    linkerOptions: [...t.linkerOptions],
    resourceCompilerOptions: [...t.resourceCompilerOptions],
    includeDirs: [...t.includeDirs],
    libDirs: [...t.libDirs],
    resourceIncludeDirs: [...t.resourceIncludeDirs],
    linkLibs: [...t.linkLibs],
    optionRelations: { ...t.optionRelations },
    commandsBeforeBuild: [...t.commandsBeforeBuild],
    commandsAfterBuild: [...t.commandsAfterBuild],
    commandsBeforeClean: [...t.commandsBeforeClean],
    commandsAfterClean: [...t.commandsAfterClean],
    buildScripts: [...t.buildScripts],
    envVars: t.envVars.map((v) => ({ ...v })),
    externalDeps: [...t.externalDeps],
    additionalOutput: [...t.additionalOutput],
    makeCommands: { ...(t.makeCommands ?? {}) },
    files: [],
  };
}

/** 构造「仅包含指定目标」的新工程对象（不写盘；由调用方 serializeProject 输出） */
export function buildTargetExportProject(project: Project, targetTitle: string): Project {
  const target = project.buildTargets.find((t) => t.title === targetTitle);
  if (!target) throw new Error(`目标不存在：${targetTitle}`);

  const exportedTarget = cloneTarget(target);
  const files = project.files
    .filter((f) => f.buildTargets.includes(targetTitle))
    .map((f) => ({
      ...f,
      buildTargets: [targetTitle],
      explicitTargets: false, // 单目标工程无需 target 归属标注（CB 同：数量相同时省略）
      customBuildCommands: { ...f.customBuildCommands },
    }));
  exportedTarget.files = files;

  return {
    ...project,
    buildTargets: [exportedTarget],
    files,
    virtualTargets: [], // CB：虚拟目标仅整工程导出
    // 项目级数组浅拷贝，避免调用方后续误改原工程
    compilerOptions: [...project.compilerOptions],
    linkerOptions: [...project.linkerOptions],
    resourceCompilerOptions: [...project.resourceCompilerOptions],
    includeDirs: [...project.includeDirs],
    libDirs: [...project.libDirs],
    resourceIncludeDirs: [...project.resourceIncludeDirs],
    linkLibs: [...project.linkLibs],
    commandsBeforeBuild: [...project.commandsBeforeBuild],
    commandsAfterBuild: [...project.commandsAfterBuild],
    buildScripts: [...project.buildScripts],
    envVars: project.envVars.map((v) => ({ ...v })),
    customVariables: { ...project.customVariables },
  };
}
