import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import { V3_DEMO_RESPONDER_ENV } from "@t3tools/shared/v3Demo";
import {
  createV3ElectronDevLaunch,
  resolveV3ElectronDevFlags,
  resolveV3WorkspaceRoot,
  withWorkspaceBinOnPath,
} from "./v3-electron-dev.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

NodeTest.test("resolves the promoted V3 main repository directly", () => {
  const workspaceRoot = resolveV3WorkspaceRoot(repositoryRoot);
  NodeAssert.equal(workspaceRoot, NodePath.resolve(repositoryRoot));
});

NodeTest.test("creates an isolated desktop development launch", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, {
    ELECTRON_RUN_AS_NODE: "1",
    T3CODE_PORT: "9999",
    VITE_DEV_SERVER_URL: "http://localhost:9998",
  });

  NodeAssert.equal(launch.environment.ELECTRON_RUN_AS_NODE, undefined);
  NodeAssert.equal(launch.environment.T3CODE_PORT, undefined);
  NodeAssert.equal(launch.environment.VITE_DEV_SERVER_URL, undefined);
  NodeAssert.equal(launch.environment.T3CODE_DISABLE_AUTO_UPDATE, "1");
  NodeAssert.equal(launch.environment.T3CODE_DESKTOP_APP_STAGE_LABEL, "Nightly");
  NodeAssert.equal(launch.environment.T3CODE_BUNDLED_DEV, "0");
  NodeAssert.equal(launch.environment.T3CODE_DESKTOP_OPEN_DEVTOOLS, "0");
  NodeAssert.equal(launch.environment.VITE_T3CODE_SKIP_STARTUP_SPLASH, "0");
  NodeAssert.equal(launch.environment.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "1");
  NodeAssert.equal(launch.environment[V3_DEMO_RESPONDER_ENV], "1");
  NodeAssert.equal(launch.environment.VITE_V3_DEMO_AGENT_SIDEBAR, "1");
  NodeAssert.match(launch.environment.APPDATA, /v3-electron-dev-appdata$/);
  NodeAssert.match(launch.dataHome, /sidebar-preview$/);
  NodeAssert.equal(launch.useRealData, false);
  NodeAssert.deepEqual(launch.args.slice(0, 2), ["scripts/dev-runner.ts", "dev:desktop"]);
});

NodeTest.test("supports reversible renderer startup flags", () => {
  const flags = resolveV3ElectronDevFlags(["--bundled-vite", "--devtools", "--skip-splash"]);
  const launch = createV3ElectronDevLaunch(repositoryRoot, {}, flags);

  NodeAssert.deepEqual(flags, {
    bundledDev: true,
    openDevTools: true,
    skipSplash: true,
  });
  NodeAssert.equal(launch.environment.T3CODE_BUNDLED_DEV, "1");
  NodeAssert.equal(launch.environment.T3CODE_DESKTOP_OPEN_DEVTOOLS, "1");
  NodeAssert.equal(launch.environment.VITE_T3CODE_SKIP_STARTUP_SPLASH, "1");
});

NodeTest.test("classic Vite overrides the experimental bundled renderer", () => {
  NodeAssert.deepEqual(resolveV3ElectronDevFlags(["--bundled-vite", "--classic-vite"]), {
    bundledDev: false,
    openDevTools: false,
    skipSplash: false,
  });
});

NodeTest.test("keeps CLI credential stores pinned to the real APPDATA", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, {
    APPDATA: NodePath.join("C:", "Users", "dev", "AppData", "Roaming"),
  });

  // The sandboxed APPDATA is for Electron's userData only. `gh` reading its
  // hosts.yml from there would exit 4 on every backend PR lookup.
  NodeAssert.notEqual(
    launch.environment.APPDATA,
    NodePath.join("C:", "Users", "dev", "AppData", "Roaming"),
  );
  NodeAssert.equal(
    launch.environment.GH_CONFIG_DIR,
    NodePath.join("C:", "Users", "dev", "AppData", "Roaming", "GitHub CLI"),
  );
});

NodeTest.test("respects an explicit CLI config dir from the ambient environment", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, {
    APPDATA: NodePath.join("C:", "Users", "dev", "AppData", "Roaming"),
    GH_CONFIG_DIR: NodePath.join("C:", "custom", "gh"),
  });

  NodeAssert.equal(launch.environment.GH_CONFIG_DIR, NodePath.join("C:", "custom", "gh"));
});

NodeTest.test("real-data mode targets the snapshot home and drops every demo flag", () => {
  const launch = createV3ElectronDevLaunch(
    repositoryRoot,
    {
      // Demo flags inherited from an ambient environment must not survive.
      [V3_DEMO_RESPONDER_ENV]: "1",
      VITE_V3_DEMO_AGENT_SIDEBAR: "1",
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "1",
    },
    { homeDir: NodePath.resolve(repositoryRoot, ".t3", "test-real-home") },
  );

  NodeAssert.equal(launch.useRealData, true);
  NodeAssert.equal(launch.dataHome, NodePath.resolve(repositoryRoot, ".t3", "test-real-home"));
  NodeAssert.equal(launch.args.at(-1), launch.dataHome);
  NodeAssert.equal(launch.environment[V3_DEMO_RESPONDER_ENV], undefined);
  NodeAssert.equal(launch.environment.VITE_V3_DEMO_AGENT_SIDEBAR, undefined);
  NodeAssert.equal(launch.environment.T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, undefined);
  // A separate Electron profile keeps demo and real-data windows apart.
  NodeAssert.match(launch.environment.APPDATA, /v3-electron-dev-appdata-real$/);
});

NodeTest.test("puts the workspace bin directory on PATH so a bare `vp` spawn resolves", () => {
  const launch = createV3ElectronDevLaunch(repositoryRoot, { PATH: "/usr/bin" });
  const binDirectory = NodePath.resolve(repositoryRoot, "node_modules", ".bin");
  const key = Object.keys(launch.environment).find((name) => name.toUpperCase() === "PATH");

  // Prefix rather than a split: the delimiter is platform-dependent, and a
  // naive /[;:]/ split would tear `C:\` in half on Windows.
  NodeAssert.ok(launch.environment[key].startsWith(`${binDirectory}`));
  NodeAssert.ok(launch.environment[key].includes("/usr/bin"));
});

NodeTest.test("does not duplicate the bin directory when it is already on PATH", () => {
  const binDirectory = "C:\\repo\\node_modules\\.bin";
  const environment = withWorkspaceBinOnPath(
    { PATH: `${binDirectory};C:\\Windows` },
    binDirectory,
    "win32",
  );

  NodeAssert.equal(environment.PATH, `${binDirectory};C:\\Windows`);
});

NodeTest.test("finds PATH under Windows casing instead of adding a second variable", () => {
  const environment = withWorkspaceBinOnPath({ Path: "C:\\Windows" }, "C:\\bin", "win32");

  NodeAssert.equal(environment.Path, "C:\\bin;C:\\Windows");
  NodeAssert.equal(environment.PATH, undefined);
});
