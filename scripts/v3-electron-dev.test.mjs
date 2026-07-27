import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { V3_DEMO_RESPONDER_ENV } from "@t3tools/shared/v3Demo";
import { createV3ElectronDevLaunch, resolveV3WorkspaceRoot } from "./v3-electron-dev.mjs";

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
  assert.deepEqual(launch.args.slice(0, 2), ["scripts/dev-runner.ts", "dev:desktop"]);
});
