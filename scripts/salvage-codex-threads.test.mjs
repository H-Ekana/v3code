import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTest from "node:test";

import {
  extractCodexAssistantMessages,
  extractCodexTaskCompletions,
  salvageCodexThreads,
} from "./salvage-codex-threads.mjs";

const temporaryDirectories = [];

NodeTest.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

function makeFixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "v3-salvage-test-"));
  temporaryDirectories.push(root);
  const dbPath = NodePath.join(root, "state.sqlite");
  const sessionsRoot = NodePath.join(root, "sessions");
  const claudeProjectsRoot = NodePath.join(root, "claude-projects");
  const datedSessionDirectory = NodePath.join(sessionsRoot, "2026", "07", "27");
  NodeFS.mkdirSync(datedSessionDirectory, { recursive: true });
  NodeFS.mkdirSync(claudeProjectsRoot, { recursive: true });
  const db = new NodeSqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT
    );
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      deleted_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      turn_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      active_turn_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_turns (
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      state TEXT NOT NULL,
      completed_at TEXT,
      requested_at TEXT,
      started_at TEXT
    );
    CREATE TABLE orchestration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      UNIQUE (aggregate_kind, stream_id, stream_version)
    );
  `);
  db.prepare(
    `INSERT INTO projection_threads (thread_id, title, deleted_at, updated_at)
     VALUES (?, ?, NULL, ?)`,
  ).run("broken-thread", "Broken hover thread", "2026-07-27T08:00:00.000Z");
  db.prepare(
    `INSERT INTO projection_threads (thread_id, title, deleted_at, updated_at)
     VALUES (?, ?, NULL, ?)`,
  ).run("claude-thread", "Hung Claude thread", "2026-07-27T08:00:00.000Z");
  db.prepare(
    `INSERT INTO provider_session_runtime
     (thread_id, provider_name, status, last_seen_at, resume_cursor_json)
     VALUES (?, 'codex', 'running', ?, ?)`,
  ).run("v3-thread", "2026-07-27T08:00:00.000Z", JSON.stringify({ threadId: "codex-thread" }));
  db.prepare(
    `INSERT INTO provider_session_runtime
     (thread_id, provider_name, status, last_seen_at, resume_cursor_json)
     VALUES (?, 'claudeAgent', 'running', ?, ?)`,
  ).run("claude-thread", "2026-07-27T08:00:00.000Z", JSON.stringify({ resume: "claude-session" }));
  db.prepare(
    `INSERT INTO projection_thread_sessions
     (thread_id, status, active_turn_id, updated_at)
     VALUES (?, 'running', ?, ?)`,
  ).run("v3-thread", "turn-old", "2026-07-27T08:00:00.000Z");
  db.prepare(
    `INSERT INTO projection_thread_sessions
     (thread_id, status, active_turn_id, updated_at)
     VALUES (?, 'running', ?, ?)`,
  ).run("claude-thread", "claude-turn", "2026-07-27T08:00:00.000Z");
  db.prepare(
    `INSERT INTO projection_turns (thread_id, turn_id, state, completed_at)
     VALUES (?, ?, 'running', NULL)`,
  ).run("v3-thread", "turn-old");
  db.prepare(
    `INSERT INTO projection_turns
     (thread_id, turn_id, state, completed_at, requested_at, started_at)
     VALUES (?, ?, 'running', NULL, ?, ?)`,
  ).run("claude-thread", "claude-turn", "2026-07-27T08:00:00.000Z", "2026-07-27T08:00:01.000Z");
  const insertMessage = db.prepare(
    `INSERT INTO projection_thread_messages
     (message_id, thread_id, role, text, is_streaming, turn_id, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
  );
  insertMessage.run(
    "assistant:existing",
    "v3-thread",
    "Already projected",
    0,
    "turn-old",
    "2026-07-27T08:00:10.000Z",
  );
  insertMessage.run(
    "assistant:partial",
    "v3-thread",
    "Partial",
    1,
    "turn-old",
    "2026-07-27T08:00:20.000Z",
  );
  insertMessage.run(
    "assistant:claude-partial",
    "claude-thread",
    "Claude partial",
    0,
    "claude-turn",
    "2026-07-27T08:00:10.000Z",
  );
  db.close();

  const rows = [
    {
      timestamp: "2026-07-27T08:00:10.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "existing",
        role: "assistant",
        content: [{ type: "output_text", text: "Already projected" }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-old" },
      },
    },
    {
      timestamp: "2026-07-27T08:00:20.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "missing",
        role: "assistant",
        content: [{ type: "output_text", text: "Recovered reply" }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-new" },
      },
    },
    {
      timestamp: "2026-07-27T08:00:30.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "partial",
        role: "assistant",
        content: [{ type: "output_text", text: "Partial completed reply" }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-new" },
      },
    },
    {
      timestamp: "2026-07-27T08:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "turn-old",
        last_agent_message: "Recovered reply",
      },
    },
  ];
  const jsonlPath = NodePath.join(datedSessionDirectory, "rollout-codex-thread.jsonl");
  NodeFS.writeFileSync(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const claudeRows = [
    {
      type: "assistant",
      uuid: "claude-partial-raw",
      timestamp: "2026-07-27T08:00:10.000Z",
      message: {
        id: "provider-claude-partial",
        content: [{ type: "text", text: "Claude partial completed" }],
      },
    },
    {
      type: "assistant",
      uuid: "claude-missing-raw",
      timestamp: "2026-07-27T08:00:20.000Z",
      message: {
        id: "provider-claude-missing",
        content: [{ type: "text", text: "Hidden Claude update" }],
      },
    },
  ];
  NodeFS.writeFileSync(
    NodePath.join(claudeProjectsRoot, "claude-session.jsonl"),
    `${claudeRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  return { root, dbPath, sessionsRoot, claudeProjectsRoot, jsonlPath };
}

NodeTest.test("extracts completed assistant messages with provider correlation", () => {
  const fixture = makeFixture();
  NodeAssert.deepEqual(extractCodexAssistantMessages(fixture.jsonlPath), [
    {
      messageId: "assistant:existing",
      providerItemId: "existing",
      turnId: "turn-old",
      text: "Already projected",
      timestamp: "2026-07-27T08:00:10.000Z",
    },
    {
      messageId: "assistant:missing",
      providerItemId: "missing",
      turnId: "turn-new",
      text: "Recovered reply",
      timestamp: "2026-07-27T08:00:20.000Z",
    },
    {
      messageId: "assistant:partial",
      providerItemId: "partial",
      turnId: "turn-new",
      text: "Partial completed reply",
      timestamp: "2026-07-27T08:00:30.000Z",
    },
  ]);
});

NodeTest.test("extracts transcript task completion evidence", () => {
  const fixture = makeFixture();
  NodeAssert.deepEqual(
    [...extractCodexTaskCompletions(fixture.jsonlPath)],
    [["turn-old", "2026-07-27T08:01:00.000Z"]],
  );
});

NodeTest.test("recovers missing events, repairs stale state, backs up, and is idempotent", () => {
  const fixture = makeFixture();
  const options = {
    dbPath: fixture.dbPath,
    codexSessionsRoot: fixture.sessionsRoot,
    claudeProjectsRoot: fixture.claudeProjectsRoot,
    threadIds: ["v3-thread"],
    claudeThreadIds: ["claude-thread"],
    interruptThreadIds: ["claude-thread"],
    deleteThreadIds: ["broken-thread"],
    apply: true,
    now: "2026-07-27T09:00:00.000Z",
  };

  const first = salvageCodexThreads(options);
  NodeAssert.equal(first.recoveredCount, 4);
  NodeAssert.equal(first.repairedCount, 1);
  NodeAssert.equal(first.interruptedCount, 1);
  NodeAssert.equal(first.deletedCount, 1);
  NodeAssert.ok(first.backupDirectory);
  NodeAssert.ok(
    NodeFS.readFileSync(NodePath.join(first.backupDirectory, "state.sqlite")).length > 0,
  );

  const db = new NodeSqlite.DatabaseSync(fixture.dbPath, { readOnly: true });
  const events = db
    .prepare(
      `SELECT payload_json, metadata_json
       FROM orchestration_events
       WHERE stream_id = 'v3-thread'
       ORDER BY occurred_at`,
    )
    .all();
  NodeAssert.deepEqual(
    events.map((event) => JSON.parse(event.payload_json)),
    [
      {
        threadId: "v3-thread",
        messageId: "assistant:missing",
        role: "assistant",
        text: "Recovered reply",
        turnId: "turn-new",
        streaming: false,
        createdAt: "2026-07-27T08:00:20.000Z",
        updatedAt: "2026-07-27T08:00:20.000Z",
      },
      {
        threadId: "v3-thread",
        messageId: "assistant:partial",
        role: "assistant",
        text: "Partial completed reply",
        turnId: "turn-new",
        streaming: false,
        createdAt: "2026-07-27T08:00:30.000Z",
        updatedAt: "2026-07-27T08:00:30.000Z",
      },
    ],
  );
  NodeAssert.ok(events.every((event) => JSON.parse(event.metadata_json).adapterKey === "codex"));
  NodeAssert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT status, active_turn_id FROM projection_thread_sessions WHERE thread_id = ?`,
        )
        .get("v3-thread"),
    },
    { status: "stopped", active_turn_id: null },
  );
  NodeAssert.deepEqual(
    {
      ...db
        .prepare(`SELECT state, completed_at FROM projection_turns WHERE thread_id = ?`)
        .get("v3-thread"),
    },
    {
      state: "completed",
      completed_at: "2026-07-27T08:01:00.000Z",
    },
  );
  NodeAssert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT status, active_turn_id FROM projection_thread_sessions WHERE thread_id = ?`,
        )
        .get("claude-thread"),
    },
    { status: "stopped", active_turn_id: null },
  );
  NodeAssert.deepEqual(
    {
      ...db
        .prepare(`SELECT state, completed_at FROM projection_turns WHERE thread_id = ?`)
        .get("claude-thread"),
    },
    {
      state: "interrupted",
      completed_at: "2026-07-27T09:00:00.000Z",
    },
  );
  NodeAssert.deepEqual(
    {
      ...db
        .prepare(`SELECT deleted_at, updated_at FROM projection_threads WHERE thread_id = ?`)
        .get("broken-thread"),
    },
    {
      deleted_at: "2026-07-27T09:00:00.000Z",
      updated_at: "2026-07-27T09:00:00.000Z",
    },
  );
  db.close();

  const second = salvageCodexThreads({
    ...options,
    now: "2026-07-27T09:01:00.000Z",
  });
  NodeAssert.equal(second.recoveredCount, 0);
  NodeAssert.equal(second.repairedCount, 0);
  NodeAssert.equal(second.interruptedCount, 0);
  NodeAssert.equal(second.deletedCount, 0);
});
