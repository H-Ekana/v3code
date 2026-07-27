// @effect-diagnostics nodeBuiltinImport:off - Builds real temp job stores on disk.
import { assert, describe, it } from "@effect/vitest";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  classifyProgressOutcome,
  isTerminalCompanionStatus,
  parseLaunchedCodexJobId,
  readCompanionJobRecord,
  readCompanionProgressSince,
  resolveCompanionJobsDir,
} from "./codexCompanionJobs.ts";

const makeTempDir = (prefix: string): string =>
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));

const writeLog = (jobsDir: string, jobId: string, contents: string): void => {
  NodeFS.writeFileSync(NodePath.join(jobsDir, `${jobId}.log`), contents, "utf8");
};

describe("parseLaunchedCodexJobId", () => {
  it("extracts the job id from the companion launch confirmation", () => {
    // Verbatim shape of `renderQueuedTaskLaunch` in codex-companion.mjs.
    const stdout =
      "Codex Task started in the background as task-mdk3j2-a8f9x1. Check /codex:status task-mdk3j2-a8f9x1 for progress.\n";
    assert.strictEqual(parseLaunchedCodexJobId(stdout), "task-mdk3j2-a8f9x1");
  });

  it("does not swallow the trailing sentence period", () => {
    const stdout = "Codex Resume started in the background as task-abc-123.";
    assert.strictEqual(parseLaunchedCodexJobId(stdout), "task-abc-123");
  });

  it("returns undefined for unrelated tool output", () => {
    assert.strictEqual(parseLaunchedCodexJobId("npm test passed"), undefined);
    assert.strictEqual(parseLaunchedCodexJobId(""), undefined);
  });
});

describe("classifyProgressOutcome", () => {
  it("treats a nonzero exit as an error and a zero exit as ok", () => {
    assert.strictEqual(classifyProgressOutcome("Command completed: npm test (exit 0)"), "ok");
    assert.strictEqual(classifyProgressOutcome("Command completed: npm test (exit 1)"), "error");
    assert.strictEqual(classifyProgressOutcome("Command failed: pytest (exit 124)"), "error");
  });

  it("flags explicit failure prefixes", () => {
    assert.strictEqual(classifyProgressOutcome("Codex error: model request failed"), "error");
  });

  it("leaves ordinary progress unknown rather than assuming success", () => {
    assert.strictEqual(classifyProgressOutcome("Running command: rg --files"), undefined);
    assert.strictEqual(classifyProgressOutcome("Applying 3 file change(s)."), undefined);
  });
});

describe("readCompanionProgressSince", () => {
  it("reads timestamped lines and advances the offset", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    writeLog(
      jobsDir,
      "task-1",
      "[2026-07-27T12:00:00.000Z] Running command: npm test\n" +
        "[2026-07-27T12:00:05.000Z] Command completed: npm test (exit 1)\n",
    );

    const first = readCompanionProgressSince(jobsDir, "task-1", 0);
    assert.strictEqual(first.lines.length, 2);
    assert.strictEqual(first.lines[0]?.message, "Running command: npm test");
    assert.strictEqual(first.lines[0]?.outcome, undefined);
    assert.strictEqual(first.lines[1]?.outcome, "error");
    assert.strictEqual(first.lines[1]?.at, "2026-07-27T12:00:05.000Z");

    // A second poll with no new content yields nothing.
    const second = readCompanionProgressSince(jobsDir, "task-1", first.nextOffset);
    assert.deepStrictEqual(second.lines, []);
    assert.strictEqual(second.nextOffset, first.nextOffset);
  });

  it("returns only lines appended since the offset", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    const logFile = NodePath.join(jobsDir, "task-2.log");
    NodeFS.writeFileSync(logFile, "[2026-07-27T12:00:00.000Z] Starting.\n", "utf8");

    const first = readCompanionProgressSince(jobsDir, "task-2", 0);
    assert.strictEqual(first.lines.length, 1);

    NodeFS.appendFileSync(
      logFile,
      "[2026-07-27T12:01:00.000Z] Applying 2 file change(s).\n",
      "utf8",
    );

    const second = readCompanionProgressSince(jobsDir, "task-2", first.nextOffset);
    assert.strictEqual(second.lines.length, 1);
    assert.strictEqual(second.lines[0]?.message, "Applying 2 file change(s).");
  });

  it("defers a partially written trailing line to the next read", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    const logFile = NodePath.join(jobsDir, "task-3.log");
    NodeFS.writeFileSync(
      logFile,
      "[2026-07-27T12:00:00.000Z] Starting.\n[2026-07-27T12:00:01.000Z] Running comm",
      "utf8",
    );

    const first = readCompanionProgressSince(jobsDir, "task-3", 0);
    assert.strictEqual(first.lines.length, 1);
    assert.strictEqual(first.lines[0]?.message, "Starting.");

    // The worker finishes writing the line.
    NodeFS.appendFileSync(logFile, "and: npm test\n", "utf8");

    const second = readCompanionProgressSince(jobsDir, "task-3", first.nextOffset);
    assert.strictEqual(second.lines.length, 1);
    assert.strictEqual(second.lines[0]?.message, "Running command: npm test");
  });

  it("skips untimestamped block bodies written by appendLogBlock", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    writeLog(
      jobsDir,
      "task-4",
      "[2026-07-27T12:00:00.000Z] Command completed: rg foo (exit 0)\n" +
        "\n[2026-07-27T12:00:00.000Z] Command output\n" +
        "src/a.ts:12: foo\n" +
        "src/b.ts:44: foo\n",
    );

    const read = readCompanionProgressSince(jobsDir, "task-4", 0);
    assert.deepStrictEqual(
      read.lines.map((line) => line.message),
      ["Command completed: rg foo (exit 0)", "Command output"],
    );
  });

  it("re-reads a replacement log of the same length instead of skipping it", () => {
    // The companion unlinks and recreates logs, so a fresh file can be exactly
    // as long as the old offset. Comparing sizes alone would resume mid-file
    // and silently drop the entire new run.
    const jobsDir = makeTempDir("codex-jobs-");
    const logFile = NodePath.join(jobsDir, "task-8.log");
    NodeFS.writeFileSync(logFile, "[2026-07-27T12:00:00.000Z] Old line AAA.\n", "utf8");
    const first = readCompanionProgressSince(jobsDir, "task-8", 0);
    assert.strictEqual(first.lines.length, 1);

    NodeFS.unlinkSync(logFile);
    const replacement = "[2026-07-27T13:00:00.000Z] New line BBB.\n";
    NodeFS.writeFileSync(logFile, replacement, "utf8");
    assert.strictEqual(
      NodeFS.statSync(logFile).size,
      first.nextOffset,
      "fixture must reproduce the equal-size case",
    );

    const second = readCompanionProgressSince(jobsDir, "task-8", first.nextOffset, first.inode);
    assert.deepStrictEqual(
      second.lines.map((line) => line.message),
      ["New line BBB."],
    );
  });

  it("re-reads from the start when the log is truncated", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    const logFile = NodePath.join(jobsDir, "task-5.log");
    NodeFS.writeFileSync(logFile, "[2026-07-27T12:00:00.000Z] Old run.\n", "utf8");
    const first = readCompanionProgressSince(jobsDir, "task-5", 0);

    NodeFS.writeFileSync(logFile, "[2026-07-27T13:00:00.000Z] New.\n", "utf8");
    const second = readCompanionProgressSince(jobsDir, "task-5", first.nextOffset);
    assert.deepStrictEqual(
      second.lines.map((line) => line.message),
      ["New."],
    );
  });

  it("returns nothing when the log does not exist yet", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    const read = readCompanionProgressSince(jobsDir, "missing", 7);
    assert.deepStrictEqual(read.lines, []);
    assert.strictEqual(read.nextOffset, 7);
  });
});

describe("readCompanionJobRecord", () => {
  it("reads status, phase and title", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    NodeFS.writeFileSync(
      NodePath.join(jobsDir, "task-6.json"),
      JSON.stringify({
        id: "task-6",
        status: "running",
        phase: "verifying",
        title: "Codex Task",
        createdAt: "2026-07-27T12:00:00.000Z",
      }),
      "utf8",
    );

    const record = readCompanionJobRecord(jobsDir, "task-6");
    assert.strictEqual(record?.status, "running");
    assert.strictEqual(record?.phase, "verifying");
    assert.strictEqual(record?.title, "Codex Task");
    assert.strictEqual(record?.startedAt, "2026-07-27T12:00:00.000Z");
  });

  it("returns undefined for a torn write instead of throwing", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    NodeFS.writeFileSync(NodePath.join(jobsDir, "task-7.json"), '{"id":"task-7","stat', "utf8");
    assert.strictEqual(readCompanionJobRecord(jobsDir, "task-7"), undefined);
  });

  it("returns undefined when the record is absent", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    assert.strictEqual(readCompanionJobRecord(jobsDir, "nope"), undefined);
  });
});

describe("resolveCompanionJobsDir", () => {
  it("finds the jobs dir via the workspace hash without the plugin env var", () => {
    const pluginData = makeTempDir("codex-plugin-data-");
    const workspace = makeTempDir("v3code-workspace-");
    NodeFS.mkdirSync(NodePath.join(workspace, ".git"));

    // Reproduce state.mjs's naming: slug from the given path, hash from realpath.
    const canonical = NodeFS.realpathSync.native(workspace);
    const slug = NodePath.basename(workspace).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const hash = NodeCrypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
    const jobsDir = NodePath.join(pluginData, "state", `${slug}-${hash}`, "jobs");
    NodeFS.mkdirSync(jobsDir, { recursive: true });

    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    try {
      assert.strictEqual(resolveCompanionJobsDir(workspace), jobsDir);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  });

  it("resolves from a subdirectory, since the companion keys on the git root", () => {
    const pluginData = makeTempDir("codex-plugin-data-");
    const workspace = makeTempDir("v3code-workspace-");
    NodeFS.mkdirSync(NodePath.join(workspace, ".git"));
    const nested = NodePath.join(workspace, "apps", "server", "src");
    NodeFS.mkdirSync(nested, { recursive: true });

    const canonical = NodeFS.realpathSync.native(workspace);
    const slug = NodePath.basename(workspace).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const hash = NodeCrypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
    const jobsDir = NodePath.join(pluginData, "state", `${slug}-${hash}`, "jobs");
    NodeFS.mkdirSync(jobsDir, { recursive: true });

    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    try {
      // Hashing the cwd instead of the git root would silently find nothing.
      assert.strictEqual(resolveCompanionJobsDir(nested), jobsDir);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  });

  it("returns undefined when the companion has never run for the workspace", () => {
    const pluginData = makeTempDir("codex-plugin-data-");
    const workspace = makeTempDir("v3code-workspace-");
    NodeFS.mkdirSync(NodePath.join(workspace, ".git"));

    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    try {
      assert.strictEqual(resolveCompanionJobsDir(workspace), undefined);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = previous;
      }
    }
  });
});

describe("isTerminalCompanionStatus", () => {
  it("distinguishes settled jobs from in-flight ones", () => {
    assert.strictEqual(isTerminalCompanionStatus("completed"), true);
    assert.strictEqual(isTerminalCompanionStatus("failed"), true);
    assert.strictEqual(isTerminalCompanionStatus("cancelled"), true);
    assert.strictEqual(isTerminalCompanionStatus("running"), false);
    assert.strictEqual(isTerminalCompanionStatus("queued"), false);
  });
});
