/**
 * AutoVersioning 命令与构建钩子 —— 对齐 Code::Blocks AutoVersioning 插件。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Project } from '../model/types';
import { writeFileAtomicSync } from '../model/atomicWrite';
import {
  AutoVersioningConfig,
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
} from '../tools/autoversioning';
import * as i18n from '../i18n';

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

function writeHeader(project: Project, config: AutoVersioningConfig, text: string): string {
  const file = versionHeaderPath(project, config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomicSync(file, text);
  return file;
}

/** 构建前生成 version.h（配置存在时才生效）。 */
export function prepareAutoVersioningBuild(project: Project, output?: (message: string) => void): void {
  const config = readAutoVersioningConfig(project);
  if (!config) return;
  const state = stateFromDisk(project, config);
  const file = writeHeader(project, config, generateVersionHeader(config, state));
  output?.(i18n.t('AutoVersioning: generated {0}', path.basename(file)));
}

function updateManifest(project: Project, config: AutoVersioningConfig, state: ReturnType<typeof defaultAutoVersioningState>): void {
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

/** 构建成功后递增 BUILDS_COUNT 并写回 version.h。 */
export function completeAutoVersioningBuild(project: Project, output?: (message: string) => void): void {
  const config = readAutoVersioningConfig(project);
  if (!config) return;
  const state = bumpBuildCount(stateFromDisk(project, config));
  const file = writeHeader(project, config, generateVersionHeader(config, state));
  updateManifest(project, config, state);
  output?.(i18n.t('AutoVersioning: build count is now {0} ({1})', state.values.buildCount, path.basename(file)));
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
  const file = writeHeader(project, config, generateVersionHeader(config, state));
  const v = state.values;
  deps.output(i18n.t('AutoVersioning: version {0}.{1}.{2}.{3}', v.major, v.minor, v.build, v.revision));
  vscode.window.showInformationMessage(i18n.t('Version bumped to {0}.{1}.{2}.{3} ({4})', v.major, v.minor, v.build, v.revision, path.basename(file)));
  await persistConfig(project, config, deps);
}

async function generateHeader(project: Project, deps: AutoVersioningCommandDeps): Promise<void> {
  const config = readAutoVersioningConfig(project) ?? defaultAutoVersioningConfig();
  const state = stateFromDisk(project, config);
  const file = writeHeader(project, config, generateVersionHeader(config, state));
  const v = state.values;
  vscode.window.showInformationMessage(i18n.t('Generated {0} for version {1}.{2}.{3}.{4}', path.basename(file), v.major, v.minor, v.build, v.revision));
  await persistConfig(project, config, deps);
}

async function configureProject(project: Project, deps: AutoVersioningCommandDeps): Promise<void> {
  const config = defaultAutoVersioningConfig();
  writeAutoVersioningConfig(project, config);
  const state = defaultAutoVersioningState();
  const file = writeHeader(project, config, generateVersionHeader(config, state));
  await persistConfig(project, config, deps);
  deps.output(i18n.t('AutoVersioning: configured {0}', project.title));
  vscode.window.showInformationMessage(i18n.t('AutoVersioning configured; generated {0}', path.basename(file)));
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
  const choice = await vscode.window.showQuickPick([editValues, bump, header, headerPath, toggleAuto], {
    placeHolder: i18n.t('AutoVersioning for {0}', project.title),
  });
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
    const file = writeHeader(project, config, generateVersionHeader(config, state));
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Version updated ({0})', path.basename(file)));
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
    const file = writeHeader(project, config, generateVersionHeader(config, state));
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Version header path set to {0}', file));
    return;
  }
  if (choice === toggleAuto) {
    config.settings.autoincrement = !config.settings.autoincrement;
    await persistConfig(project, config, deps);
    vscode.window.showInformationMessage(i18n.t('Autoincrement is now {0}', config.settings.autoincrement ? i18n.t('on') : i18n.t('off')));
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
