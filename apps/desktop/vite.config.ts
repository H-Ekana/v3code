// @effect-diagnostics nodeBuiltinImport:off - Reads Playwright's installed bundle while packaging the desktop app.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import { defineConfig } from "vite-plus";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";
import { extractPlaywrightInjectedRuntimeSource } from "./src/preview/PlaywrightInjectedRuntime.ts";

const repoEnv = loadRepoEnv();
const require = NodeModule.createRequire(import.meta.url);
const shouldLaunchElectronAfterPack = process.env.T3CODE_DESKTOP_DEV === "1";
const publicConfigDefine = {
  __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
    repoEnv.T3CODE_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
  ),
};
const playwrightPackageJsonPath = require.resolve("playwright-core/package.json");
const playwrightCoreBundlePath = NodePath.join(
  NodePath.dirname(playwrightPackageJsonPath),
  "lib/coreBundle.js",
);
const playwrightInjectedSource = Effect.runSync(
  extractPlaywrightInjectedRuntimeSource(
    NodeFS.readFileSync(playwrightCoreBundlePath, "utf8"),
    playwrightCoreBundlePath,
  ),
);
const mainProcessDefine = {
  ...publicConfigDefine,
  __T3CODE_PLAYWRIGHT_INJECTED_SOURCE__: JSON.stringify(playwrightInjectedSource),
};

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack",
        dependsOn: ["t3#build"],
        cache: false,
      },
      dev: {
        command: "node scripts/dev-desktop.mjs",
        cache: false,
      },
      "dev:bundle": {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        dependsOn: ["t3#build"],
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      define: mainProcessDefine,
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => id.startsWith("@t3tools/"),
      },
      ...(shouldLaunchElectronAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      define: publicConfigDefine,
      entry: ["src/preload.ts"],
      deps: {
        // Sandboxed Electron preloads cannot reliably resolve package imports
        // from inside the packaged ASAR. Bundle Clerk's preload bridge into the
        // preload artifact instead of leaving a runtime require() behind.
        alwaysBundle: (id) => id === "@clerk/electron" || id.startsWith("@clerk/electron/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pick-preload.ts"],
      deps: {
        alwaysBundle: (id) => id === "react-grab" || id.startsWith("react-grab/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pip-preload.ts"],
    },
  ],
});
