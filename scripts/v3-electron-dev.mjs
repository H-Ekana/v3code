#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { V3_DEMO_RESPONDER_ENV } from "@t3tools/shared/v3Demo";
import { prepareV3SidebarDemo } from "./v3-sidebar-demo.mjs";

function isV3Workspace(directory) {
  const desktopPackagePath = NodePath.join(directory, "apps", "desktop", "package.json");
  if (!NodeFS.existsSync(desktopPackagePath)) return false;

  try {
    const desktopPackage = JSON.parse(NodeFS.readFileSync(desktopPackagePath, "utf8"));
    return desktopPackage.productName === "V3 Code";
  } catch {
    return false;
  }
}

export function resolveV3WorkspaceRoot(invocationRoot) {
  const currentRoot = NodePath.resolve(invocationRoot);
  if (isV3Workspace(currentRoot)) return currentRoot;

  throw new Error(
    `This command must be run from the V3 Code repository root. Received ${currentRoot}.`,
  );
}

/**
 * Prepends the workspace's `node_modules/.bin` to PATH.
 *
 * dev-runner spawns `vp` by bare name, so it only resolves when that directory
 * is on PATH. A package manager injects it, which is why `pnpm run electron:dev`
 * works and a direct `node scripts/v3-electron-dev.mjs` fails with
 * `spawn vp ENOENT`. Injecting it here makes both entry points behave the same.
 */
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev launcher has no Effect runtime.
export function withWorkspaceBinOnPath(environment, binDirectory, platform = process.platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  // Windows environments surface PATH under arbitrary casing (Path, PATH).
  const key = Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const entries = (environment[key] ?? "").split(delimiter).filter((entry) => entry.trim() !== "");
  const normalize = (entry) => {
    const stripped = entry.trim().replace(/^"+|"+$/g, "");
    return platform === "win32" ? stripped.toLowerCase() : stripped;
  };

  if (entries.some((entry) => normalize(entry) === normalize(binDirectory))) {
    return environment;
  }
  return { ...environment, [key]: [binDirectory, ...entries].join(delimiter) };
}

export function createV3ElectronDevLaunch(
  invocationRoot,
  baseEnvironment = process.env,
  options = {},
) {
  const workspaceRoot = resolveV3WorkspaceRoot(invocationRoot);
  // Real-data mode reads a snapshot of the installed app's threads; the default
  // demo home is reseeded on every launch and would hide them.
  const useRealData = options.homeDir !== undefined;
  const dataHome = options.homeDir ?? NodePath.join(workspaceRoot, ".t3", "sidebar-preview");
  const appData = NodePath.join(
    workspaceRoot,
    ".t3",
    useRealData ? "v3-electron-dev-appdata-real" : "v3-electron-dev-appdata",
  );
  const binDirectory = NodePath.join(workspaceRoot, "node_modules", ".bin");
  const vpExecutable = NodePath.join(
    binDirectory,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev launcher has no Effect runtime.
    process.platform === "win32" ? "vp.CMD" : "vp",
  );

  if (!NodeFS.existsSync(vpExecutable)) {
    throw new Error(
      `Dependencies are missing in ${workspaceRoot}. Install them in that worktree before launching V3 Code.`,
    );
  }

  NodeFS.mkdirSync(dataHome, { recursive: true });
  NodeFS.mkdirSync(appData, { recursive: true });

  // Redirecting APPDATA sandboxes Electron's userData, but it also moves every
  // Windows CLI that stores credentials under it. `gh` reads its hosts.yml from
  // `%APPDATA%\GitHub CLI`, so the sandbox makes the backend's PR lookups exit
  // 4 ("not logged into any GitHub hosts") on every status poll. Pin the CLIs
  // that support an explicit config dir back to the real one.
  const realAppData = baseEnvironment.APPDATA?.trim();
  const cliConfigDirs =
    realAppData && realAppData.length > 0
      ? {
          ...(baseEnvironment.GH_CONFIG_DIR
            ? {}
            : { GH_CONFIG_DIR: NodePath.join(realAppData, "GitHub CLI") }),
          ...(baseEnvironment.GLAB_CONFIG_DIR
            ? {}
            : { GLAB_CONFIG_DIR: NodePath.join(realAppData, "glab-cli") }),
        }
      : {};

  const environment = withWorkspaceBinOnPath(
    {
      ...baseEnvironment,
      APPDATA: appData,
      ...cliConfigDirs,
      T3CODE_DEV_INSTANCE: useRealData ? "v3-real-data" : "v3-subagent-sidebar",
      T3CODE_DISABLE_AUTO_UPDATE: "1",
      T3CODE_DESKTOP_APP_STAGE_LABEL: "Nightly",
      T3CODE_BUNDLED_DEV: options.bundledDev === true ? "1" : "0",
      T3CODE_DESKTOP_OPEN_DEVTOOLS: options.openDevTools === true ? "1" : "0",
      VITE_T3CODE_SKIP_STARTUP_SPLASH: options.skipSplash === true ? "1" : "0",
      // The demo responder and demo sidebar synthesise fake agents, which would
      // mask the real rosters this mode exists to show.
      ...(useRealData
        ? {}
        : {
            T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "1",
            [V3_DEMO_RESPONDER_ENV]: "1",
            VITE_V3_DEMO_AGENT_SIDEBAR: "1",
          }),
    },
    binDirectory,
  );

  if (useRealData) {
    // Inherited demo flags would otherwise survive into a real-data launch.
    delete environment[V3_DEMO_RESPONDER_ENV];
    delete environment.VITE_V3_DEMO_AGENT_SIDEBAR;
    delete environment.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
  }

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
    useRealData,
    bundledDev: options.bundledDev === true,
    openDevTools: options.openDevTools === true,
    skipSplash: options.skipSplash === true,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev launcher has no Effect runtime.
    command: process.platform === "win32" ? "node.exe" : "node",
    args: ["scripts/dev-runner.ts", "dev:desktop", "--home-dir", dataHome],
    environment,
  };
}

export function resolveV3ElectronDevFlags(argv) {
  return {
    bundledDev: argv.includes("--bundled-vite") && !argv.includes("--classic-vite"),
    openDevTools: argv.includes("--devtools"),
    skipSplash: argv.includes("--skip-splash"),
  };
}

function printLaunchSummary(launch) {
  console.log("[v3-electron-dev] Starting V3 Code desktop development");
  console.log(`[v3-electron-dev] workspace: ${launch.workspaceRoot}`);
  console.log(`[v3-electron-dev] mode:      ${launch.useRealData ? "real data" : "demo"}`);
  console.log(`[v3-electron-dev] data:      ${launch.dataHome}`);
  console.log(`[v3-electron-dev] app data:  ${launch.appData}`);
  console.log(
    "[v3-electron-dev] renderer:  " + (launch.bundledDev ? "bundled dev" : "classic Vite"),
  );
  console.log("[v3-electron-dev] DevTools:  " + (launch.openDevTools ? "open" : "closed"));
  console.log("[v3-electron-dev] splash:    " + (launch.skipSplash ? "skipped" : "enabled"));
  console.log("[v3-electron-dev] Ports are selected automatically to avoid conflicts.");
  console.log("[v3-electron-dev] Press Ctrl+C to stop Electron and all development services.");
}

/**
 * Resolves the data home for this launch, taking a fresh snapshot of the
 * installed app's database when real-data mode is requested and none exists
 * yet (or `--refresh-data` forces one).
 */
async function resolveDataHome(argv) {
  if (!argv.includes("--real-data")) return undefined;

  const { resolveSnapshotPaths, snapshotInstalledDatabase, snapshotIsMissing, snapshotAgeHours } =
    await import("./snapshot-installed-db.mjs");
  const destIndex = argv.indexOf("--data-dir");
  const options = destIndex === -1 ? {} : { dest: argv[destIndex + 1] };

  if (argv.includes("--refresh-data") || snapshotIsMissing(options)) {
    snapshotInstalledDatabase(options);
  } else {
    const hours = snapshotAgeHours(options) ?? 0;
    console.log(
      `[v3-electron-dev] snapshot is ${hours.toFixed(1)}h old — pass --refresh-data to re-copy.`,
    );
  }
  return resolveSnapshotPaths(options).destBase;
}

async function main() {
  const argv = process.argv.slice(2);
  const homeDir = await resolveDataHome(argv);
  const launch = createV3ElectronDevLaunch(process.cwd(), process.env, {
    homeDir,
    ...resolveV3ElectronDevFlags(argv),
  });
  printLaunchSummary(launch);

  if (process.argv.includes("--dry-run")) return;

  if (!launch.useRealData) {
    const demo = await prepareV3SidebarDemo(launch.workspaceRoot, launch.dataHome);
    console.log(
      `[v3-electron-dev] demo:      ${demo.projectId} / ${demo.threadId} (reset for this launch)`,
    );
  }

  const child = NodeChildProcess.spawn(launch.command, launch.args, {
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

if (
  NodePath.basename(process.argv[1] ?? "") === NodePath.basename(new URL(import.meta.url).pathname)
) {
  await main();
}
