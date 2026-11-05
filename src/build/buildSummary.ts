/**
 * 构建摘要数据结构（无 vscode 依赖）——供 Build Log 视图、LM Tools、CLI/MCP 共用。
 *
 * 从 `ui/buildLogTreeProvider.ts` 下沉：构建内核（`build/buildProject.ts`）与三种传输
 * （Language Model Tools / MCP / CLI）都需要这份结构，而 UI 层不能反向被内核依赖。
 */

/** 诊断严重程度（仅收集 error/warning，info 噪音大不展示） */
export type BuildLogSeverity = 'error' | 'warning';

/** 单条诊断（对应 OutputParser 解析结果，file 已解析为绝对路径） */
export interface BuildLogDiagnostic {
  severity: BuildLogSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/** 单个项目的构建摘要 */
export interface BuildLogProject {
  projectName: string;      // 显示名（.cbp 所在目录名）
  targetName: string;
  compilerPath: string;
  success: boolean;
  compiledCount: number;    // 本次实际编译的文件数
  skippedCount: number;     // 增量跳过数
  failedCount: number;      // 编译失败数
  linkSuccess: boolean;
  linkSkipped: boolean;     // static lib 无链接步骤
  outputFilename?: string;
  diagnostics: BuildLogDiagnostic[];
  /** 本次实际执行的命令（HTML 构建日志 full_command_line 命令行块用；第六轮 F8） */
  commands?: string[];
  /** 项目源文件绝对路径（供「Build Log 使用 clangd 诊断」模式收集诊断） */
  files?: string[];
  durationMs: number;
  /** 构建开始时间戳（毫秒） */
  startTime?: number;
  /** 是否被取消（输出汇总块用 ⚠️ 构建已取消） */
  cancelled?: boolean;
  /** 项目标题（输出汇总块用；缺省回退 projectName） */
  projectTitle?: string;
  /** 单文件编译耗时（输出汇总块「最慢 Top 3」用） */
  topTimings?: { file: string; ms: number }[];
}

/** 一次构建的整体摘要 */
export interface BuildLogSummary {
  success: boolean;
  durationMs: number;
  /** 构建开始时间戳（毫秒） */
  startTime?: number;
  projects: BuildLogProject[];
  errorCount: number;
  warningCount: number;
  /** 是否因达到 maxReportedErrors 上限而被截断 */
  truncated?: boolean;
}

/** 诊断收集预算（跨项目累计；由调用方持有，保证工作区构建的截断语义不变） */
export interface BuildDiagnosticsBudget {
  errorCount: number;
  truncated: boolean;
}
