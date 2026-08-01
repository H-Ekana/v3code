import * as NodePath from "node:path";

import { assert, describe, it } from "vite-plus/test";

import { createDesktopDevProcessPlan, isOutputOlderThanInputs } from "./dev-desktop.mjs";

describe("desktop development process", () => {
  it("skips generated preview styles when the output is current", () => {
    const mtimes = new Map([
      ["/output", 20],
      ["/input-a", 10],
      ["/input-b", 20],
    ]);

    assert.isFalse(
      isOutputOlderThanInputs("/output", ["/input-a", "/input-b"], {
        existsSync: (path) => mtimes.has(path),
        statSync: (path) => ({ mtimeMs: mtimes.get(path) }),
      }),
    );
  });

  it("refreshes generated preview styles when an input is newer or output is missing", () => {
    const mtimes = new Map([
      ["/output", 20],
      ["/input", 21],
    ]);
    const fileSystem = {
      existsSync: (path) => mtimes.has(path),
      statSync: (path) => ({ mtimeMs: mtimes.get(path) }),
    };

    assert.isTrue(isOutputOlderThanInputs("/output", ["/input"], fileSystem));
    assert.isTrue(isOutputOlderThanInputs("/missing", ["/input"], fileSystem));
  });

  it("starts independent non-clean watchers before the Electron supervisor", () => {
    const plan = createDesktopDevProcessPlan({
      desktopRoot: "/repo/apps/desktop",
      repoRoot: "/repo",
      nodeExecutable: "/node",
      vitePlusCliPath: "/repo/node_modules/vite-plus/dist/bin.js",
      existsSync: () => true,
      statSync: () => ({ mtimeMs: 1 }),
      startedAtMs: 123_456,
    });

    assert.lengthOf(plan.prepare, 0);
    assert.deepEqual(
      plan.services.map(({ label, cwd, args, env }) => ({ label, cwd, args, env })),
      [
        {
          label: "server bundle",
          cwd: NodePath.join("/repo", "apps", "server"),
          args: ["/repo/node_modules/vite-plus/dist/bin.js", "pack", "--watch", "--no-clean"],
          env: undefined,
        },
        {
          label: "desktop bundle",
          cwd: "/repo/apps/desktop",
          args: ["/repo/node_modules/vite-plus/dist/bin.js", "pack", "--watch", "--no-clean"],
          env: undefined,
        },
        {
          label: "Electron",
          cwd: "/repo/apps/desktop",
          args: [NodePath.join("/repo/apps/desktop", "scripts", "dev-electron.mjs")],
          env: { T3CODE_DESKTOP_DEV_STARTED_AT_MS: "123456" },
        },
      ],
    );
  });

  it("prepares stale generated styles before starting services", () => {
    const plan = createDesktopDevProcessPlan({
      desktopRoot: "/repo/apps/desktop",
      repoRoot: "/repo",
      nodeExecutable: "/node",
      vitePlusCliPath: "/vp",
      existsSync: () => true,
      statSync: (path) => ({
        mtimeMs: path.endsWith("AnnotationStyles.generated.ts") ? 1 : 2,
      }),
    });

    assert.deepEqual(plan.prepare, [
      {
        label: "preview styles",
        command: "/node",
        args: [NodePath.join("/repo/apps/desktop", "scripts", "build-preview-annotation-css.mjs")],
        cwd: "/repo/apps/desktop",
      },
    ]);
  });
});
