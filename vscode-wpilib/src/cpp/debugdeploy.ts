'use strict';

import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as vscode from 'vscode';
import { ICodeDeployer, IDeployDebugAPI, IPreferencesAPI } from '../shared/externalapi';
import { gradleRun } from '../shared/gradle';
import { getIsWindows, readFileAsync } from '../utilities';
import { IDebugCommands, startDebugging } from './debug';
import { IUnixSimulateCommands, startUnixSimulation } from './simulateunix';
import { IWindowsSimulateCommands, startWindowsSimulation } from './simulatewindows';

interface ICppDebugInfo {
  debugfile: string;
  artifact: string;
}

interface ICppDebugCommand {
  name?: string;
  extensions?: string;
  clang?: boolean;
  launchfile: string;
  target: string;
  gdb: string;
  sysroot: string | null;
  srcpaths: string[];
  headerpaths: string[];
  sofiles: string[];
  libsrcpaths: string[];
}

class CppQuickPick<T> implements vscode.QuickPickItem {
  public label: string;
  public description?: string | undefined;
  public detail?: string | undefined;
  public picked?: boolean | undefined;

  public debugInfo: T;

  public constructor(debugInfo: T, label: string) {
    this.debugInfo = debugInfo;
    this.label = label;
  }
}

class DebugCodeDeployer implements ICodeDeployer {
  private preferences: IPreferencesAPI;

  constructor(preferences: IPreferencesAPI) {
    this.preferences = preferences;
  }

  public async getIsCurrentlyValid(workspace: vscode.WorkspaceFolder): Promise<boolean> {
    const prefs = this.preferences.getPreferences(workspace);
    const currentLanguage = prefs.getCurrentLanguage();
    return currentLanguage === 'none' || currentLanguage === 'cpp';
  }
  public async runDeployer(teamNumber: number, workspace: vscode.WorkspaceFolder): Promise<boolean> {
    const command = 'deploy -PdebugMode -PteamNumber=' + teamNumber;
    const online = this.preferences.getPreferences(workspace).getOnline();
    const result = await gradleRun(command, workspace.uri.fsPath, workspace, online);
    if (result !== 0) {
      return false;
    }

    const debugInfo = await readFileAsync(path.join(workspace.uri.fsPath, 'build', 'debug', 'debuginfo.json'));
    const parsedDebugInfo: ICppDebugInfo[] = jsonc.parse(debugInfo) as ICppDebugInfo[];
    let targetDebugInfo = parsedDebugInfo[0];
    if (parsedDebugInfo.length > 1) {
      const arr: Array<CppQuickPick<ICppDebugInfo>> = [];
      for (const i of parsedDebugInfo) {
        arr.push(new CppQuickPick<ICppDebugInfo>(i, i.artifact));
      }
      const picked = await vscode.window.showQuickPick(arr, {
        placeHolder: 'Select an artifact',
      });
      if (picked === undefined) {
        vscode.window.showInformationMessage('Artifact cancelled');
        return false;
      }
      targetDebugInfo = picked.debugInfo;
    }

    const debugPath = path.join(workspace.uri.fsPath, 'build', 'debug', targetDebugInfo.debugfile);

    const targetReadInfo = await readFileAsync(debugPath);
    const targetInfoParsed: ICppDebugCommand = jsonc.parse(targetReadInfo) as ICppDebugCommand;

    const set = new Set<string>(targetInfoParsed.sofiles);

    let soPath = '';

    for (const p of set) {
      soPath += path.dirname(p) + ';';
    }

    soPath = soPath.substring(0, soPath.length - 1);

    let sysroot = '';

    if (targetInfoParsed.sysroot !== null) {
      sysroot = targetInfoParsed.sysroot;
    }

    const config: IDebugCommands = {
      executablePath: targetInfoParsed.launchfile,
      gdbPath: targetInfoParsed.gdb,
      soLibPath: soPath,
      srcPaths: new Set<string>(targetInfoParsed.srcpaths),
      sysroot,
      target: targetInfoParsed.target,
      workspace,
    };

    await startDebugging(config);
    console.log(result);
    return true;
  }
  public getDisplayName(): string {
    return 'cpp';
  }
  public getDescription(): string {
    return 'C++ Debugging';
  }
}

class DeployCodeDeployer implements ICodeDeployer {
  private preferences: IPreferencesAPI;

  constructor(preferences: IPreferencesAPI) {
    this.preferences = preferences;
  }

  public async getIsCurrentlyValid(workspace: vscode.WorkspaceFolder): Promise<boolean> {
    const prefs = this.preferences.getPreferences(workspace);
    const currentLanguage = prefs.getCurrentLanguage();
    return currentLanguage === 'none' || currentLanguage === 'cpp';
  }
  public async runDeployer(teamNumber: number, workspace: vscode.WorkspaceFolder): Promise<boolean> {
    const command = 'deploy -PteamNumber=' + teamNumber;
    const online = this.preferences.getPreferences(workspace).getOnline();
    const result = await gradleRun(command, workspace.uri.fsPath, workspace, online);
    if (result !== 0) {
      return false;
    }
    console.log(result);
    return true;
  }
  public getDisplayName(): string {
    return 'cpp';
  }
  public getDescription(): string {
    return 'C++ Deployment';
  }
}

class SimulateCodeDeployer implements ICodeDeployer {
  private preferences: IPreferencesAPI;

  constructor(preferences: IPreferencesAPI) {
    this.preferences = preferences;
  }

  public async getIsCurrentlyValid(workspace: vscode.WorkspaceFolder): Promise<boolean> {
    const prefs = this.preferences.getPreferences(workspace);
    const currentLanguage = prefs.getCurrentLanguage();
    return currentLanguage === 'none' || currentLanguage === 'cpp';
  }
  public async runDeployer(_: number, workspace: vscode.WorkspaceFolder): Promise<boolean> {
    const command = 'simulateExternalCpp';
    const online = this.preferences.getPreferences(workspace).getOnline();
    const result = await gradleRun(command, workspace.uri.fsPath, workspace, online);
    if (result !== 0) {
      return false;
    }

    const simulateInfo = await readFileAsync(path.join(workspace.uri.fsPath, 'build', 'debug', 'desktopinfo.json'));
    const parsedSimulateInfo: ICppDebugCommand[] = jsonc.parse(simulateInfo) as ICppDebugCommand[];
    let targetSimulateInfo = parsedSimulateInfo[0];
    if (parsedSimulateInfo.length > 1) {
      const arr: Array<CppQuickPick<ICppDebugCommand>> = [];
      for (const i of parsedSimulateInfo) {
        // tslint:disable-next-line:no-non-null-assertion
        arr.push(new CppQuickPick<ICppDebugCommand>(i, i.name!));
      }
      const picked = await vscode.window.showQuickPick(arr, {
        placeHolder: 'Select an artifact',
      });
      if (picked === undefined) {
        vscode.window.showInformationMessage('Artifact cancelled');
        return false;
      }
      targetSimulateInfo = picked.debugInfo;
    }

    let extensions = '';
    // tslint:disable-next-line:no-non-null-assertion
    const targetExtensions = targetSimulateInfo.extensions!;
    if (targetExtensions.length > 0) {
      const extList = [];
      for (const e of targetExtensions) {
        extList.push({
          label: path.basename(e),
          path: e,
        });
      }
      const quickPick = await vscode.window.showQuickPick(extList, {
        canPickMany: true,
        placeHolder: 'Pick extensions to run',
      });
      if (quickPick !== undefined) {
        for (const qp of quickPick) {
          extensions += qp.path;
          extensions += path.delimiter;
        }
      }
    }

    if (!getIsWindows()) {
      const set = new Set<string>(targetSimulateInfo.sofiles);

      let soPath = '';

      for (const p of set) {
        soPath += path.dirname(p) + ';';
      }

      soPath = soPath.substring(0, soPath.length - 1);

      const config: IUnixSimulateCommands = {
        // tslint:disable-next-line:no-non-null-assertion
        clang: targetSimulateInfo.clang!,
        executablePath: targetSimulateInfo.launchfile,
        extensions,
        soLibPath: soPath,
        srcPaths: new Set<string>(targetSimulateInfo.srcpaths),
        stopAtEntry: this.preferences.getPreferences(workspace).getStopSimulationOnEntry(),
        workspace,
      };

      await startUnixSimulation(config);
    } else {
      const config: IWindowsSimulateCommands = {
        extensions,
        launchfile: targetSimulateInfo.launchfile,
        stopAtEntry: this.preferences.getPreferences(workspace).getStopSimulationOnEntry(),
        workspace,
      };

      await startWindowsSimulation(config);
    }
    return true;
  }
  public getDisplayName(): string {
    return 'cpp';
  }
  public getDescription(): string {
    return 'C++ Simulation';
  }
}

export class DebugDeploy {
  private debugDeployer: DebugCodeDeployer;
  private deployDeployer: DeployCodeDeployer;
  private simulator: SimulateCodeDeployer;

  constructor(debugDeployApi: IDeployDebugAPI, preferences: IPreferencesAPI, allowDebug: boolean) {
    debugDeployApi = debugDeployApi;
    debugDeployApi.addLanguageChoice('cpp');

    this.debugDeployer = new DebugCodeDeployer(preferences);
    this.deployDeployer = new DeployCodeDeployer(preferences);
    this.simulator = new SimulateCodeDeployer(preferences);

    debugDeployApi.registerCodeDeploy(this.deployDeployer);

    if (allowDebug) {
      debugDeployApi.registerCodeDebug(this.debugDeployer);
      debugDeployApi.registerCodeSimulate(this.simulator);
    }
  }

  // tslint:disable-next-line:no-empty
  public dispose() {

  }
}