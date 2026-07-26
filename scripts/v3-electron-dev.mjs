#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function isV3Workspace(directory) {
  const desktopPackagePath = join(directory, "apps", "desktop", "package.json");
  if (!existsSync(desktopPackagePath)) return false;

  try {
    const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
    return desktopPackage.productName === "V3 Code";
  } catch {
    return false;
  }
}

export function resolveV3WorkspaceRoot(invocationRoot) {
  const currentRoot = resolve(invocationRoot);
  if (isV3Workspace(currentRoot)) return currentRoot;

  throw new Error(
    `This command must be run from the V3 Code repository root. Received ${currentRoot}.`,
  );
}

export function createV3ElectronDevLaunch(invocationRoot, baseEnvironment = process.env) {
  const workspaceRoot = resolveV3WorkspaceRoot(invocationRoot);
  const seededHome = join(workspaceRoot, ".t3", "sidebar-preview");
  const fallbackHome = join(workspaceRoot, ".t3", "v3-electron-dev");
  const dataHome = existsSync(seededHome) ? seededHome : fallbackHome;
  const appData = join(workspaceRoot, ".t3", "v3-electron-dev-appdata");
  const vpExecutable = join(
    workspaceRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vp.CMD" : "vp",
  );

  if (!existsSync(vpExecutable)) {
    throw new Error(
      `Dependencies are missing in ${workspaceRoot}. Install them in that worktree before launching V3 Code.`,
    );
  }

  mkdirSync(dataHome, { recursive: true });
  mkdirSync(appData, { recursive: true });

  const environment = {
    ...baseEnvironment,
    APPDATA: appData,
    T3CODE_DEV_INSTANCE: "v3-subagent-sidebar",
    T3CODE_DISABLE_AUTO_UPDATE: "1",
  };

  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "HOST",
    "PORT",
    "T3CODE_DESKTOP_WS_URL",
    "T3CODE_MODE",
    "T3CODE_PORT",
    "VITE_DEV_SERVER_URL",
  ]) {
    delete environment[name];
  }

  return {
    workspaceRoot,
    dataHome,
    appData,
    command: process.platform === "win32" ? "node.exe" : "node",
    args: ["scripts/dev-runner.ts", "dev:desktop", "--home-dir", dataHome],
    environment,
  };
}

function printLaunchSummary(launch) {
  console.log("[v3-electron-dev] Starting V3 Code desktop development");
  console.log(`[v3-electron-dev] workspace: ${launch.workspaceRoot}`);
  console.log(`[v3-electron-dev] data:      ${launch.dataHome}`);
  console.log(`[v3-electron-dev] app data:  ${launch.appData}`);
  console.log("[v3-electron-dev] Ports are selected automatically to avoid conflicts.");
  console.log("[v3-electron-dev] Press Ctrl+C to stop Electron and all development services.");
}

async function main() {
  const launch = createV3ElectronDevLaunch(process.cwd());
  printLaunchSummary(launch);

  if (process.argv.includes("--dry-run")) return;

  const child = spawn(launch.command, launch.args, {
    cwd: launch.workspaceRoot,
    env: launch.environment,
    stdio: "inherit",
    windowsHide: false,
  });

  child.once("error", (error) => {
    console.error(`[v3-electron-dev] Failed to start: ${error.message}`);
    process.exitCode = 1;
  });

  const exitCode = await new Promise((resolveExitCode) => {
    child.once("exit", (code, signal) => {
      if (signal) {
        console.log(`[v3-electron-dev] Development services stopped (${signal}).`);
      }
      resolveExitCode(code ?? (signal ? 1 : 0));
    });
  });

  process.exitCode = exitCode;
}

if (basename(process.argv[1] ?? "") === basename(new URL(import.meta.url).pathname)) {
  await main();
}
