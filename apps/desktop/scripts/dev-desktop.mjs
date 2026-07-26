import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const scriptPath = NodeURL.fileURLToPath(import.meta.url);
const scriptsDir = NodePath.dirname(scriptPath);
const defaultDesktopRoot = NodePath.resolve(scriptsDir, "..");
const defaultRepoRoot = NodePath.resolve(defaultDesktopRoot, "..", "..");
const defaultVitePlusCliPath = NodeURL.fileURLToPath(import.meta.resolve("vite-plus/bin"));

export function isOutputOlderThanInputs(
  outputPath,
  inputPaths,
  { existsSync = NodeFS.existsSync, statSync = NodeFS.statSync } = {},
) {
  if (!existsSync(outputPath)) {
    return true;
  }

  const outputMtimeMs = statSync(outputPath).mtimeMs;
  return inputPaths.some(
    (inputPath) => existsSync(inputPath) && statSync(inputPath).mtimeMs > outputMtimeMs,
  );
}

export function createDesktopDevProcessPlan({
  desktopRoot = defaultDesktopRoot,
  repoRoot = defaultRepoRoot,
  nodeExecutable = process.execPath,
  vitePlusCliPath = defaultVitePlusCliPath,
  existsSync = NodeFS.existsSync,
  statSync = NodeFS.statSync,
} = {}) {
  const previewBuildScript = NodePath.join(
    desktopRoot,
    "scripts",
    "build-preview-annotation-css.mjs",
  );
  const previewStyleInputs = [
    NodePath.join(desktopRoot, "src", "preview", "Annotation.css"),
    NodePath.join(desktopRoot, "src", "preview", "PickPreload.ts"),
    NodePath.join(repoRoot, "pnpm-lock.yaml"),
    previewBuildScript,
  ];
  const previewStyleOutput = NodePath.join(
    desktopRoot,
    "src",
    "preview",
    "AnnotationStyles.generated.ts",
  );
  const needsPreviewStyleBuild = isOutputOlderThanInputs(previewStyleOutput, previewStyleInputs, {
    existsSync,
    statSync,
  });

  return {
    prepare: needsPreviewStyleBuild
      ? [
          {
            label: "preview styles",
            command: nodeExecutable,
            args: [previewBuildScript],
            cwd: desktopRoot,
          },
        ]
      : [],
    services: [
      {
        label: "server bundle",
        command: nodeExecutable,
        args: [vitePlusCliPath, "pack", "--watch", "--no-clean"],
        cwd: NodePath.join(repoRoot, "apps", "server"),
      },
      {
        label: "desktop bundle",
        command: nodeExecutable,
        args: [vitePlusCliPath, "pack", "--watch", "--no-clean"],
        cwd: desktopRoot,
      },
      {
        label: "Electron",
        command: nodeExecutable,
        args: [NodePath.join(desktopRoot, "scripts", "dev-electron.mjs")],
        cwd: desktopRoot,
      },
    ],
  };
}

function spawnProcess(processSpec) {
  return NodeChildProcess.spawn(processSpec.command, processSpec.args, {
    cwd: processSpec.cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  });
}

async function runPreparation(processSpec) {
  console.log(`[desktop-dev] Preparing ${processSpec.label}...`);
  const child = spawnProcess(processSpec);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });

  if (exitCode !== 0) {
    throw new Error(`${processSpec.label} preparation exited with code ${exitCode}.`);
  }
}

function printDryRun(plan) {
  for (const processSpec of [...plan.prepare, ...plan.services]) {
    console.log(
      `[desktop-dev] ${processSpec.label}: ${processSpec.command} ${processSpec.args.join(" ")}`,
    );
  }
}

async function main() {
  const plan = createDesktopDevProcessPlan();
  if (process.argv.includes("--dry-run")) {
    printDryRun(plan);
    return;
  }

  for (const processSpec of plan.prepare) {
    await runPreparation(processSpec);
  }

  console.log(
    "[desktop-dev] Starting web-independent server/desktop watchers; cached bundles may open immediately.",
  );

  const children = new Map();
  let shuttingDown = false;
  let exitCode = 0;

  const stopChildren = () => {
    for (const child of children.keys()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
  };

  const finish = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    stopChildren();
  };

  for (const processSpec of plan.services) {
    const child = spawnProcess(processSpec);
    children.set(child, processSpec);
    child.once("error", (error) => {
      console.error(`[desktop-dev] ${processSpec.label} failed to start: ${error.message}`);
      finish(1);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (!shuttingDown) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        console.error(`[desktop-dev] ${processSpec.label} stopped unexpectedly (${detail}).`);
        finish(code && code !== 0 ? code : 1);
      }
    });
  }

  process.once("SIGINT", () => finish(130));
  process.once("SIGTERM", () => finish(143));
  process.once("SIGHUP", () => finish(129));

  await Promise.all(
    [...children.keys()].map(
      (child) =>
        new Promise((resolve) => {
          child.once("exit", resolve);
        }),
    ),
  );
  process.exitCode = exitCode;
}

if (NodePath.resolve(process.argv[1] ?? "") === scriptPath) {
  await main();
}
