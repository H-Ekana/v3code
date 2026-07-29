// @effect-diagnostics nodeBuiltinImport:off - Builds real temp job stores on disk.
import { assert, describe, it } from "@effect/vitest";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  BUNDLED_CODEX_PLUGIN_DIR_ENV,
  classifyProgressOutcome,
  companionJobsDirHasJob,
  isCompanionProcessRunning,
  isTerminalCompanionStatus,
  lookupCompanionJob,
  parseLaunchedCodexJobId,
  readCompanionAbortSince,
  readCompanionJobRecord,
  readCompanionProgressSince,
  readCompanionWatcherRegistrations,
  resolveBundledCodexPluginDir,
  resolveCompanionJobsDir,
  resolveCompanionJobsDirForJob,
  resolveCompanionJobsDirs,
  writeCompanionWatcherRegistration,
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

describe("isCompanionProcessRunning", () => {
  it("uses a PID only as a read-only liveness signal", () => {
    assert.equal(isCompanionProcessRunning(process.pid), true);
    assert.equal(isCompanionProcessRunning(2_000_000_000), false);
    assert.equal(isCompanionProcessRunning(undefined), undefined);
  });
});

describe("lookupCompanionJob", () => {
  it("uses the capped state list as authority without trusting pid", () => {
    const stateDir = makeTempDir("codex-state-");
    const jobsDir = NodePath.join(stateDir, "jobs");
    NodeFS.mkdirSync(jobsDir);
    const record = {
      id: "task-live",
      status: "running",
      phase: "verifying",
      pid: 999_999,
      updatedAt: "2026-07-29T06:00:00.000Z",
    };
    NodeFS.writeFileSync(
      NodePath.join(stateDir, "state.json"),
      JSON.stringify({ version: 1, jobs: [record] }),
      "utf8",
    );
    NodeFS.writeFileSync(NodePath.join(jobsDir, "task-live.json"), JSON.stringify(record), "utf8");
    writeLog(jobsDir, "task-live", "[2026-07-29T06:00:01.000Z] Verifying.\n");

    const lookup = lookupCompanionJob(jobsDir, "task-live");
    assert.strictEqual(lookup.storeStatus, "present");
    assert.strictEqual(lookup.record?.status, "running");
    assert.ok(lookup.latestArtifactMtimeMs !== undefined);
    assert.ok(lookup.latestJobActivityMtimeMs !== undefined);
  });

  it("reports a job omitted from a valid state list as vanished", () => {
    const stateDir = makeTempDir("codex-state-");
    const jobsDir = NodePath.join(stateDir, "jobs");
    NodeFS.mkdirSync(jobsDir);
    NodeFS.writeFileSync(
      NodePath.join(stateDir, "state.json"),
      JSON.stringify({ version: 1, jobs: [] }),
      "utf8",
    );

    const lookup = lookupCompanionJob(jobsDir, "task-pruned");
    assert.strictEqual(lookup.storeStatus, "vanished");
    assert.strictEqual(lookup.record, undefined);
  });

  it("preserves terminal state when the detailed record is stale", () => {
    const stateDir = makeTempDir("codex-state-");
    const jobsDir = NodePath.join(stateDir, "jobs");
    NodeFS.mkdirSync(jobsDir);
    NodeFS.writeFileSync(
      NodePath.join(stateDir, "state.json"),
      JSON.stringify({ jobs: [{ id: "task-race", status: "completed", phase: "done" }] }),
      "utf8",
    );
    NodeFS.writeFileSync(
      NodePath.join(jobsDir, "task-race.json"),
      JSON.stringify({ id: "task-race", status: "running", phase: "verifying" }),
      "utf8",
    );

    assert.strictEqual(lookupCompanionJob(jobsDir, "task-race").record?.status, "completed");
  });
});

describe("readCompanionAbortSince", () => {
  it("correlates turn_aborted evidence from the job's rollout", () => {
    const sessionsRoot = makeTempDir("codex-sessions-");
    const dayDir = NodePath.join(sessionsRoot, "2026", "07", "27");
    NodeFS.mkdirSync(dayDir, { recursive: true });
    const threadId = "019fa49c-33ea-71b1-bf30-3f68f5d21b3a";
    const turnId = "019fa49c-646d-7cd3-b42a-5b4f616f71c4";
    const rolloutPath = NodePath.join(dayDir, "rollout-2026-07-27T22-55-33-" + threadId + ".jsonl");
    NodeFS.writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-07-27T17:25:33.000Z",
          type: "event_msg",
          payload: {
            type: "turn_aborted",
            reason: "interrupted",
            turn_id: "different-turn",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-27T17:31:08.600Z",
          type: "event_msg",
          payload: {
            type: "turn_aborted",
            reason: "interrupted",
            turn_id: turnId,
            completed_at: "2026-07-27T17:31:08.600Z",
            duration_ms: 335_600,
          },
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const record = {
      id: "task-aborted",
      status: "running" as const,
      phase: "verifying",
      title: "Codex Task",
      startedAt: "2026-07-27T17:25:33.000Z",
      updatedAt: "2026-07-27T17:31:00.000Z",
      threadId,
      turnId,
      pid: undefined,
      errorMessage: undefined,
      result: undefined,
    };
    const first = readCompanionAbortSince(record, 0, undefined, undefined, sessionsRoot);
    assert.equal(first.abort?.reason, "interrupted");
    assert.equal(first.abort?.turnId, turnId);
    assert.equal(first.abort?.durationMs, 335_600);
    assert.equal(first.abort?.rolloutPath, rolloutPath);

    const second = readCompanionAbortSince(
      record,
      first.nextOffset,
      first.rolloutPath,
      first.inode,
      sessionsRoot,
    );
    assert.equal(second.abort, undefined, "already-consumed abort must not replay");
  });
});

describe("companion watcher registrations", () => {
  it("persists and filters the restart correlation by thread", () => {
    const jobsDir = makeTempDir("codex-jobs-");
    writeCompanionWatcherRegistration(jobsDir, {
      threadId: "thread-a",
      agentId: "agent-a",
      jobId: "task-a",
      createdAt: "2026-07-29T06:00:00.000Z",
      codexThreadId: "codex-thread-a",
      codexTurnId: "codex-turn-a",
    });
    writeCompanionWatcherRegistration(jobsDir, {
      threadId: "thread-b",
      agentId: "agent-b",
      jobId: "task-b",
      createdAt: "2026-07-29T06:00:01.000Z",
    });

    assert.deepStrictEqual(readCompanionWatcherRegistrations(jobsDir, "thread-a"), [
      {
        threadId: "thread-a",
        agentId: "agent-a",
        jobId: "task-a",
        createdAt: "2026-07-29T06:00:00.000Z",
        codexThreadId: "codex-thread-a",
        codexTurnId: "codex-turn-a",
      },
    ]);
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

describe("multi-store companion job resolution", () => {
  /**
   * Regression for the bundled-plugin cutover: the store path embeds the
   * plugin's install directory, so the vendored copy writes to `codex-inline/`
   * while a previous marketplace install wrote to `codex-openai-codex/`. Both
   * can hold jobs for the same workspace, and first-match resolution let
   * enumeration order decide which store a watcher read — reporting a live job
   * in the other store as vanished.
   */
  const withTwoStores = <A>(
    run: (context: {
      readonly workspace: string;
      readonly legacyJobsDir: string;
      readonly inlineJobsDir: string;
    }) => A,
  ): A => {
    const configDir = makeTempDir("codex-config-");
    const workspace = makeTempDir("v3code-workspace-");
    NodeFS.mkdirSync(NodePath.join(workspace, ".git"));

    const canonical = NodeFS.realpathSync.native(workspace);
    const slug = NodePath.basename(workspace).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const hash = NodeCrypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
    const stateDirName = `${slug}-${hash}`;

    const makeStore = (pluginDirName: string): string => {
      const stateDir = NodePath.join(
        configDir,
        "plugins",
        "data",
        pluginDirName,
        "state",
        stateDirName,
      );
      const jobsDir = NodePath.join(stateDir, "jobs");
      NodeFS.mkdirSync(jobsDir, { recursive: true });
      return jobsDir;
    };

    const legacyJobsDir = makeStore("codex-openai-codex");
    const inlineJobsDir = makeStore("codex-inline");

    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    delete process.env.CLAUDE_PLUGIN_DATA;
    try {
      return run({ workspace, legacyJobsDir, inlineJobsDir });
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      if (previousPluginData !== undefined) {
        process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
      }
    }
  };

  const writeJob = (jobsDir: string, jobId: string, status: string): void => {
    const record = { id: jobId, status, title: "Codex Task" };
    NodeFS.writeFileSync(
      NodePath.join(NodePath.dirname(jobsDir), "state.json"),
      JSON.stringify({ version: 1, jobs: [record] }),
      "utf8",
    );
    NodeFS.writeFileSync(NodePath.join(jobsDir, `${jobId}.json`), JSON.stringify(record), "utf8");
  };

  it("finds a job record in whichever store holds it", () => {
    withTwoStores(({ workspace, legacyJobsDir, inlineJobsDir }) => {
      writeJob(legacyJobsDir, "task-legacy-1", "running");
      writeJob(inlineJobsDir, "task-inline-1", "running");

      const legacyDir = resolveCompanionJobsDirForJob(workspace, "task-legacy-1") ?? "";
      const inlineDir = resolveCompanionJobsDirForJob(workspace, "task-inline-1") ?? "";
      assert.strictEqual(legacyDir, legacyJobsDir);
      assert.strictEqual(inlineDir, inlineJobsDir);

      // The lookup itself must report the job as present, not vanished — that
      // misreport is exactly what settled live cards as failed.
      const legacyLookup = lookupCompanionJob(legacyDir, "task-legacy-1");
      assert.strictEqual(legacyLookup.storeStatus, "present");
      assert.strictEqual(legacyLookup.record?.status, "running");
      assert.strictEqual(lookupCompanionJob(inlineDir, "task-inline-1").storeStatus, "present");
    });
  });

  it("enumerates every populated store so reconciliation sees both", () => {
    withTwoStores(({ workspace, legacyJobsDir, inlineJobsDir }) => {
      writeJob(legacyJobsDir, "task-legacy-1", "running");
      writeJob(inlineJobsDir, "task-inline-1", "running");
      writeCompanionWatcherRegistration(legacyJobsDir, {
        threadId: "thread-a",
        agentId: "agent-legacy",
        jobId: "task-legacy-1",
        createdAt: "2026-07-29T06:00:00.000Z",
      });
      writeCompanionWatcherRegistration(inlineJobsDir, {
        threadId: "thread-a",
        agentId: "agent-inline",
        jobId: "task-inline-1",
        createdAt: "2026-07-29T06:00:00.000Z",
      });

      const dirs = resolveCompanionJobsDirs(workspace);
      assert.deepStrictEqual([...dirs].sort(), [inlineJobsDir, legacyJobsDir].sort());

      const jobIds = dirs
        .flatMap((dir) => readCompanionWatcherRegistrations(dir, "thread-a"))
        .map((registration) => registration.jobId)
        .sort();
      assert.deepStrictEqual(jobIds, ["task-inline-1", "task-legacy-1"]);

      // First-match resolution can only ever see one of them.
      const firstOnly = resolveCompanionJobsDir(workspace) ?? "";
      assert.strictEqual(readCompanionWatcherRegistrations(firstOnly, "thread-a").length, 1);
    });
  });

  it("falls back to the first store when no store claims the job", () => {
    withTwoStores(({ workspace }) => {
      const dirs = resolveCompanionJobsDirs(workspace);
      assert.strictEqual(resolveCompanionJobsDirForJob(workspace, "task-unknown"), dirs[0]);
    });
  });

  it("recognises a job listed only in state.json after its per-job file is gone", () => {
    withTwoStores(({ workspace, legacyJobsDir }) => {
      writeJob(legacyJobsDir, "task-legacy-2", "completed");
      NodeFS.unlinkSync(NodePath.join(legacyJobsDir, "task-legacy-2.json"));
      assert.strictEqual(companionJobsDirHasJob(legacyJobsDir, "task-legacy-2"), true);
      assert.strictEqual(resolveCompanionJobsDirForJob(workspace, "task-legacy-2"), legacyJobsDir);
    });
  });
});

describe("resolveBundledCodexPluginDir", () => {
  it("uses the packaging env var when it points at a plugin directory", () => {
    const pluginDir = makeTempDir("t3code-bundled-codex-");
    NodeFS.mkdirSync(NodePath.join(pluginDir, ".claude-plugin"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "codex", version: "1.0.6-v3code.1" }),
      "utf8",
    );

    assert.deepStrictEqual(
      resolveBundledCodexPluginDir({ [BUNDLED_CODEX_PLUGIN_DIR_ENV]: pluginDir }),
      { dir: NodePath.resolve(pluginDir), source: "env" },
    );
  });

  it("does not silently fall back when the configured directory is missing", () => {
    // A packaged build has no repo checkout to fall back to, so a bad env value
    // must surface as "nothing loaded" rather than as a dev-machine-only pass.
    assert.strictEqual(
      resolveBundledCodexPluginDir({
        [BUNDLED_CODEX_PLUGIN_DIR_ENV]: NodePath.join(NodeOS.tmpdir(), "t3code-no-such-plugin"),
      }),
      undefined,
    );
  });

  it("falls back to the vendored plugin in a source checkout", () => {
    const resolved = resolveBundledCodexPluginDir({});
    assert.ok(resolved, "expected vendor/claude-plugins/codex to resolve from the checkout");
    assert.strictEqual(resolved?.source, "repo");
    assert.strictEqual(
      NodePath.basename(NodePath.dirname(resolved.dir)),
      "claude-plugins",
      resolved.dir,
    );
  });

  it("returns undefined when neither the env var nor a checkout provides one", () => {
    assert.strictEqual(resolveBundledCodexPluginDir({}, makeTempDir("t3code-empty-")), undefined);
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
