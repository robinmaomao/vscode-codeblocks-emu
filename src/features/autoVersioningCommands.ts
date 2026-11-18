/**
 * AutoVersioning 命令与构建钩子 —— 对齐 Code::Blocks AutoVersioning 插件。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type { Project, ProjectFile } from '../model/types';
import { writeFileAtomicSync } from '../model/atomicWrite';
import {
  AutoVersioningConfig,
  AutoVersioningSvnInfo,
  AutoVersioningState,
  bumpBuildCount,
  defaultAutoVersioningConfig,
  defaultAutoVersioningState,
  generateVersionHeader,
  incrementVersion,
  parseVersionHeader,
  parseVersionValue,
  readAutoVersioningConfig,
  versionHeaderPath,
  writeAutoVersioningConfig,
  writeVersionHeaderIfChanged,
} from '../tools/autoversioning';
import * as i18n from '../i18n';

const execFileAsync = promisify(execFile);

export interface AutoVersioningCommandDeps {
  getProject(): Project | undefined;
  saveProject(project: Project): void | Promise<void>;
  output(message: string): void;
}

function stateFromDisk(project: Project, config: AutoVersioningConfig) {
  const file = versionHeaderPath(project, config);
  if (!fs.existsSync(file)) return defaultAutoVersioningState();
  try {
    return parseVersionHeader(fs.readFileSync(file, 'utf-8'));
  } catch {
    return defaultAutoVersioningState();
  }
}

function sessionKey(project: Project): string {
  return path.resolve(project.filename || project.basePath).toLowerCase();
}

const buildSessions = new Map<string, string>();
let sessionSeq = 0;

function newSessionToken(): string {
  sessionSeq++;
  return `${process.pid}-${Date.now()}-${sessionSeq}`;
}

function hasDirtyProjectDocuments(project: Project): boolean {
  const docs = vscode.workspace.textDocuments as readonly vscode.TextDocument[] | undefined;
  if (!docs?.length) return false;
  const root = path.resolve(project.basePath).toLowerCase();
  return docs.some((doc) => {
    if (!doc.isDirty) return false;
    const file = (doc.uri?.fsPath ?? '').toLowerCase();
    return file === root || file.startsWith(root + path.sep);
  });
}

async function querySvnInfo(
  project: Project,
  config: AutoVersioningConfig,
  output?: (message: string) => void,
): Promise<AutoVersioningSvnInfo | undefined> {
  if (!config.settings.svn) return undefined;
  const dir = config.settings.svnDirectory
    ? path.resolve(project.basePath, config.settings.svnDirectory)
    : project.basePath;
  try {
    const result = await execFileAsync('svn', ['info', dir], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const text = String(result.stdout ?? '');
    const revision = /^Revision:\s*(.+)$/m.exec(text)?.[1]?.trim()
      ?? /^Last Changed Rev:\s*(.+)$/m.exec(text)?.[1]?.trim()
      ?? '';
    const date = /^Last Changed Date:\s*(.+?)(?:\s+\(|$)/m.exec(text)?.[1]?.trim() ?? '';
    return { revision, date };
  } catch (err) {
    output?.(i18n.t('AutoVersioning: SVN query failed ({0}); generating empty SVN fields', (err as Error).message));
    return { revision: '', date: '' };
  }
}

async function renderHeader(
  project: Project,
  config: AutoVersioningConfig,
  state: AutoVersioningState,
  output?: (message: string) => void,
): Promise<string> {
  const svn = await querySvnInfo(project, config, output);
  return generateVersionHeader(config, state, new Date(), svn);
}

function writeHeader(project: Project, config: AutoVersioningConfig, text: string) {
  return writeVersionHeaderIfChanged(versionHeaderPath(project, config), text);
}

/** 构建前生成 version.h（配置存在时才生效）。返回本次构建会话 token。 */
export async function prepareAutoVersioningBuild(
  project: Project,
  output?: (message: string) => void,
): Promise<string | undefined> {
  const config = readAutoVersioningConfig(project);
  if (!config) return undefined;
  let state = stateFromDisk(project, config);
  if (await shouldAutoIncrement(project, config)) {
    state = incrementVersion(state, config);
    output?.(i18n.t('AutoVersioning: auto-incremented before build'));
  }
  const file = writeHeader(project, config, await renderHeader(project, config, state, output));
  if (file.written) output?.(i18n.t('AutoVersioning: generated {0}', path.basename(file.file)));
  updateManifest(project, config, state);
  const token = newSessionToken();
  buildSessions.set(sessionKey(project), token);
  return token;
}

async function shouldAutoIncrement(project: Project, config: AutoVersioningConfig): Promise<boolean> {
  if (!config.settings.doAutoIncrement || !hasDirtyProjectDocuments(project)) return false;
  if (!config.settings.askToIncrement) return true;
  const yes = i18n.t('Yes');
  const no = i18n.t('No');
  const answer = await vscode.window.showWarningMessage(
    i18n.t('Increment the version before building "{0}"?', project.title),
    { modal: true },
    yes,
    no,
  );
  return answer === yes;
}

/** 更新 manifest.xml 的 `<Value version="...">`（仅修改实际变化）。 */
export function updateManifest(project: Project, config: AutoVersioningConfig, state: AutoVersioningState): void {
  if (!config.settings.updateManifest) return;
  const manifest = path.join(project.commonTopLevelPath || project.basePath, 'manifest.xml');
  if (!fs.existsSync(manifest)) return;
  try {
    const text = fs.readFileSync(manifest, 'utf-8');
    const version = `${state.values.major}.${state.values.minor}.${state.values.build}`;
    const next = text.replace(/(<Value\s+version=")[^"]*(")/, `$1${version}$2`);
    if (next !== text) writeFileAtomicSync(manifest, next);
  } catch {
    // manifest.xml 非严格 XML 或不可写时不影响构建
  }
}

/** 构建成功后递增 BUILDS_COUNT 并写回 version.h；同一会话只生效一次。 */
export async function completeAutoVersioningBuild(
  project: Project,
  token?: string,
  output?: (message: string) => void,
): Promise<boolean> {
  const key = sessionKey(project);
  if (token && buildSessions.get(key) !== token) return false;
  buildSessions.delete(key);
  const config = readAutoVersioningConfig(project);
  if (!config) return false;
  const state = bumpBuildCount(stateFromDisk(project, config));
  const file = writeHeader(project, config, await renderHeader(project, config, state, output));
  updateManifest(project, config, state);
  output?.(i18n.t('AutoVersioning: build count is now {0} ({1})', state.values.buildCount, path.basename(file.file)));
  return true;
}

/** 将 version.h 作为非编译 Unit 加入工程及所有目标。 */
export function addVersionHeaderToProject(project: Project, config: AutoVersioningConfig): boolean {
  const absolutePath = versionHeaderPath(project, config);
  const relative = path.relative(project.basePath, absolutePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../')) return false;
  const commonRelative = path.relative(project.commonTopLevelPath || project.basePath, absolutePath).replace(/\\/g, '/');
  const targets = (project.buildTargets ?? []).map((t) => t.title);
  let added = false;
  if (!project.files) project.files = [];
  if (!project.files.some((f) => path.resolve(f.absolutePath).toLowerCase() === path.resolve(absolutePath).toLowerCase())) {
    const unit: ProjectFile = {
      relativeFilename: relative,
      relativeToCommonTopLevelPath: commonRelative && !commonRelative.startsWith('..') ? commonRelative : relative,
      absolutePath,
      buildTargets: [...targets],
      explicitTargets: true,
      compilerVar: '',
      compile: false,
      link: false,
      customBuildCommands: {},
      weight: 50,
      virtualFolder: '',
      generatedFiles: [],
    };
    project.files.push(unit);
    for (const target of project.buildTargets ?? []) {
      if (!target.files.some((f) => path.resolve(f.absolutePath).toLowerCase() === path.resolve(absolutePath).toLowerCase())) {
        target.files.push(unit);
      }
    }
    added = true;
  }
  for (const target of project.buildTargets ?? []) {
    const has = target.files.some((f) => path.resolve(f.absolutePath).toLowerCase() === path.resolve(absolutePath).toLowerCase());
    if (!has) {
      const unit = project.files.find((f) => path.resolve(f.absolutePath).toLowerCase() === path.resolve(absolutePath).toLowerCase());
      if (unit) target.files.push(unit);
    }
  }
  return added;
}

function persistConfig(project: Project, config: AutoVersioningConfig, deps: AutoVersioningCommandDeps): Promise<void> | void {
  writeAutoVersioningConfig(project, config);
  return deps.saveProject(project);
}

async function bumpVersion(project: Project, deps: AutoVersioningCommandDeps): Promise<void> {
  const config = readAutoVersioningConfig(project);
  if (!config) {
    vscode.window.showWarningMessage(i18n.t('AutoVersioning is not configured for this project'));
    return;
  }
  const state = incrementVersion(stateFromDisk(project, config), config);
  const file = writeHeader(project, config, await renderHeader(project, config, state, deps.output));
  updateManifest(project, config, state);
  const v = state.values;
  deps.output(i18n.t('AutoVersioning: version {0}.{1}.{2}.{3}', v.major, v.minor, v.build, v.revision));
  vscode.window.showInformationMessage(i18n.t('Version bumped to {0}.{1}.{2}.{3} ({4})', v.major, v.minor, v.build, v.revision, path.basename(file.file)));
  await persistConfig(project, config, deps);
}

async function generateHeader(project: Project, deps: AutoVersioningCommandDeps): Promise<void> {
  const config = readAutoVersioningConfig(project) ?? defaultAutoVersioningConfig();
  const state = stateFromDisk(project, config);
  const file = writeHeader(project, config, await renderHeader(project, config, state, deps.output));
  updateManifest(project, config, state);
  const v = state.values;
  vscode.window.showInformationMessage(i18n.t('Generated {0} for version {1}.{2}.{3}.{4}', path.basename(file.file), v.major, v.minor, v.build, v.revision));
  await persistConfig(project, config, deps);
}

async function configureProject(project: Project, deps: AutoVersioningCommandDeps): Promise<void> {
  const config = defaultAutoVersioningConfig();
  writeAutoVersioningConfig(project, config);
  const state = defaultAutoVersioningState();
  const file = writeHeader(project, config, await renderHeader(project, config, state, deps.output));
  addVersionHeaderToProject(project, config);
  await persistConfig(project, config, deps);
  deps.output(i18n.t('AutoVersioning: configured {0}', project.title));
  vscode.window.showInformationMessage(i18n.t('AutoVersioning configured; generated {0}', path.basename(file.file)));
}

async function openChangesLog(project: Project, config: AutoVersioningConfig): Promise<void> {
  const file = path.resolve(project.basePath, config.changesLog.changesLogPath || 'ChangesLog.txt');
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomicSync(file, i18n.t('Changes Log for {0}', project.title) + '\n');
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to open Changes Log: {0}', (err as Error).message));
  }
}

async function showDialog(project: Project, deps: AutoVersioningCommandDeps): Promise<void> {
  if (!readAutoVersioningConfig(project)) {
    const configure = i18n.t('Configure');
    const answer = await vscode.window.showInformationMessage(
      i18n.t('Configure project "{0}" for AutoVersioning?', project.title),
      { modal: true },
      configure,
    );
    if (answer === configure) await configureProject(project, deps);
    return;
  }

  const editValues = i18n.t('Edit Version Values…');
  const bump = i18n.t('Bump Version');
  const header = i18n.t('Generate Version Header');
  const headerPath = i18n.t('Set Header Path…');
  const toggleAuto = i18n.t('Toggle Autoincrement');
  const toggleCommit = i18n.t('Toggle Auto Increment on Build');
  const toggleAsk = i18n.t('Toggle Ask Before Increment');
  const toggleSvn = i18n.t('Toggle SVN Fields');
  const addFile = i18n.t('Add version.h to Project');
  const changesLog = i18n.t('Open Changes Log');
  const choice = await vscode.window.showQuickPick(
    [editValues, bump, header, headerPath, toggleAuto, toggleCommit, toggleAsk, toggleSvn, addFile, changesLog],
    { placeHolder: i18n.t('AutoVersioning for {0}', project.title) },
  );
  if (!choice) return;

  const config = readAutoVersioningConfig(project);
  if (!config) return;
  if (choice === bump) {
    await bumpVersion(project, deps);
    return;
  }
  if (choice === header) {
    await generateHeader(project, deps);
    return;
  }
  if (choice === changesLog) {
    await openChangesLog(project, config);
    return;
  }
  if (choice === addFile) {
    const added = addVersionHeaderToProject(project, config);
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(added
      ? i18n.t('Added {0} to the project', config.settings.headerPath)
      : i18n.t('{0} is already part of the project', config.settings.headerPath));
    return;
  }
  if (choice === editValues) {
    const state = stateFromDisk(project, config);
    const v = state.values;
    const text = await vscode.window.showInputBox({
      prompt: i18n.t('Version as major.minor.build.revision'),
      value: `${v.major}.${v.minor}.${v.build}.${v.revision}`,
      validateInput: (value) => parseVersionValue(value) ? undefined : i18n.t('Enter four numbers separated by dots'),
    });
    if (!text) return;
    const parsed = parseVersionValue(text);
    if (!parsed) return;
    state.values = { ...parsed, buildCount: v.buildCount };
    const file = writeHeader(project, config, await renderHeader(project, config, state, deps.output));
    updateManifest(project, config, state);
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Version updated ({0})', path.basename(file.file)));
    return;
  }
  if (choice === headerPath) {
    const value = await vscode.window.showInputBox({
      prompt: i18n.t('Header path relative to the project root'),
      value: config.settings.headerPath,
      validateInput: (v) => v.trim() ? undefined : i18n.t('The header path must not be empty'),
    });
    if (!value) return;
    const state = stateFromDisk(project, config);
    config.settings.headerPath = value.trim();
    const file = writeHeader(project, config, await renderHeader(project, config, state, deps.output));
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Version header path set to {0}', file.file));
    return;
  }
  if (choice === toggleAuto) {
    config.settings.autoincrement = !config.settings.autoincrement;
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Autoincrement is now {0}', config.settings.autoincrement ? i18n.t('on') : i18n.t('off')));
    return;
  }
  if (choice === toggleCommit) {
    config.settings.doAutoIncrement = !config.settings.doAutoIncrement;
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Auto increment on build is now {0}', config.settings.doAutoIncrement ? i18n.t('on') : i18n.t('off')));
    return;
  }
  if (choice === toggleAsk) {
    config.settings.askToIncrement = !config.settings.askToIncrement;
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Ask before increment is now {0}', config.settings.askToIncrement ? i18n.t('on') : i18n.t('off')));
    return;
  }
  if (choice === toggleSvn) {
    config.settings.svn = !config.settings.svn;
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('SVN fields are now {0}', config.settings.svn ? i18n.t('on') : i18n.t('off')));
  }
}

export function registerAutoVersioningCommands(context: vscode.ExtensionContext, deps: AutoVersioningCommandDeps): void {
  const project = (): Project | undefined => deps.getProject();
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.autoVersioning', async () => {
      const p = project();
      if (p) await showDialog(p, deps);
    }),
    vscode.commands.registerCommand('codeblocks.bumpVersion', async () => {
      const p = project();
      if (p) await bumpVersion(p, deps);
    }),
    vscode.commands.registerCommand('codeblocks.generateVersionHeader', async () => {
      const p = project();
      if (p) await generateHeader(p, deps);
    }),
  );
}
