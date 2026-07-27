import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { V3_DEMO_RESPONDER_ENV } from "@t3tools/shared/v3Demo";
import {
  createV3ElectronDevLaunch,
  resolveV3WorkspaceRoot,
  withWorkspaceBinOnPath,
} from "./v3-electron-dev.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("resolves the promoted V3 main repository directly", () => {
  const workspaceRoot = resolveV3WorkspaceRoot(repositoryRoot);
  assert.equal(workspaceRoot, resolve(repositoryRoot));
});

test("creates an isolated desktop development launch", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, {
    ELECTRON_RUN_AS_NODE: "1",
    T3CODE_PORT: "9999",
    VITE_DEV_SERVER_URL: "http://localhost:9998",
  });

  assert.equal(launch.environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.environment.T3CODE_PORT, undefined);
  assert.equal(launch.environment.VITE_DEV_SERVER_URL, undefined);
  assert.equal(launch.environment.T3CODE_DISABLE_AUTO_UPDATE, "1");
  assert.equal(launch.environment.T3CODE_DESKTOP_APP_STAGE_LABEL, "Nightly");
  assert.equal(launch.environment.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "1");
  assert.equal(launch.environment[V3_DEMO_RESPONDER_ENV], "1");
  assert.equal(launch.environment.VITE_V3_DEMO_AGENT_SIDEBAR, "1");
  assert.match(launch.environment.APPDATA, /v3-electron-dev-appdata$/);
  assert.match(launch.dataHome, /sidebar-preview$/);
  assert.equal(launch.useRealData, false);
  assert.deepEqual(launch.args.slice(0, 2), ["scripts/dev-runner.ts", "dev:desktop"]);
});

test("keeps CLI credential stores pinned to the real APPDATA", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, {
    APPDATA: join("C:", "Users", "dev", "AppData", "Roaming"),
  });

  // The sandboxed APPDATA is for Electron's userData only. `gh` reading its
  // hosts.yml from there would exit 4 on every backend PR lookup.
  assert.notEqual(launch.environment.APPDATA, join("C:", "Users", "dev", "AppData", "Roaming"));
  assert.equal(
    launch.environment.GH_CONFIG_DIR,
    join("C:", "Users", "dev", "AppData", "Roaming", "GitHub CLI"),
  );
});

test("respects an explicit CLI config dir from the ambient environment", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, {
    APPDATA: join("C:", "Users", "dev", "AppData", "Roaming"),
    GH_CONFIG_DIR: join("C:", "custom", "gh"),
  });

  assert.equal(launch.environment.GH_CONFIG_DIR, join("C:", "custom", "gh"));
});

test("real-data mode targets the snapshot home and drops every demo flag", () => {
  const launch = createV3ElectronDevLaunch(
    repositoryRoot,
    {
      // Demo flags inherited from an ambient environment must not survive.
      [V3_DEMO_RESPONDER_ENV]: "1",
      VITE_V3_DEMO_AGENT_SIDEBAR: "1",
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "1",
    },
    { homeDir: resolve(repositoryRoot, ".t3", "test-real-home") },
  );

  assert.equal(launch.useRealData, true);
  assert.equal(launch.dataHome, resolve(repositoryRoot, ".t3", "test-real-home"));
  assert.equal(launch.args.at(-1), launch.dataHome);
  assert.equal(launch.environment[V3_DEMO_RESPONDER_ENV], undefined);
  assert.equal(launch.environment.VITE_V3_DEMO_AGENT_SIDEBAR, undefined);
  assert.equal(launch.environment.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, undefined);
  // A separate Electron profile keeps demo and real-data windows apart.
  assert.match(launch.environment.APPDATA, /v3-electron-dev-appdata-real$/);
});

test("puts the workspace bin directory on PATH so a bare `vp` spawn resolves", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, { PATH: "/usr/bin" });
  const binDirectory = resolve(repositoryRoot, "node_modules", ".bin");
  const key = Object.keys(launch.environment).find((name) => name.toUpperCase() === "PATH");

  // Prefix rather than a split: the delimiter is platform-dependent, and a
  // naive /[;:]/ split would tear `C:\` in half on Windows.
  assert.ok(launch.environment[key].startsWith(`${binDirectory}`));
  assert.ok(launch.environment[key].includes("/usr/bin"));
});

test("does not duplicate the bin directory when it is already on PATH", () => {
  const binDirectory = "C:\\repo\\node_modules\\.bin";
  const environment = withWorkspaceBinOnPath(
    { PATH: `${binDirectory};C:\\Windows` },
    binDirectory,
    "win32",
  );

  assert.equal(environment.PATH, `${binDirectory};C:\\Windows`);
});

test("finds PATH under Windows casing instead of adding a second variable", () => {
  const environment = withWorkspaceBinOnPath({ Path: "C:\\Windows" }, "C:\\bin", "win32");

  assert.equal(environment.Path, "C:\\bin;C:\\Windows");
  assert.equal(environment.PATH, undefined);
});
