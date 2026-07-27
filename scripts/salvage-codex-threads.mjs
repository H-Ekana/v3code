#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

const DEFAULT_DB_PATH = NodePath.join(NodeOS.homedir(), ".t3", "userdata", "state.sqlite");
const DEFAULT_CODEX_SESSIONS_ROOT = NodePath.join(NodeOS.homedir(), ".codex", "sessions");
const DEFAULT_CLAUDE_PROJECTS_ROOT = NodePath.join(NodeOS.homedir(), ".claude", "projects");
const DEFAULT_PROCESS_NAME = "V3 Code (V3 Preview)";
const TERMINAL_TURN_STATES = new Set(["completed", "interrupted", "error"]);

function parseArgs(argv) {
  const options = {
    apply: false,
    waitForExit: false,
    dbPath: DEFAULT_DB_PATH,
    codexSessionsRoot: DEFAULT_CODEX_SESSIONS_ROOT,
    claudeProjectsRoot: DEFAULT_CLAUDE_PROJECTS_ROOT,
    processName: DEFAULT_PROCESS_NAME,
    pollMs: 1_000,
    threadIds: [],
    claudeThreadIds: [],
    interruptThreadIds: [],
    deleteThreadIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--wait-for-exit") {
      options.waitForExit = true;
    } else if (argument === "--db") {
      options.dbPath = NodePath.resolve(argv[++index]);
    } else if (argument === "--codex-sessions") {
      options.codexSessionsRoot = NodePath.resolve(argv[++index]);
    } else if (argument === "--claude-projects") {
      options.claudeProjectsRoot = NodePath.resolve(argv[++index]);
    } else if (argument === "--process-name") {
      options.processName = argv[++index];
    } else if (argument === "--poll-ms") {
      options.pollMs = Number(argv[++index]);
    } else if (argument === "--thread") {
      options.threadIds.push(argv[++index]);
    } else if (argument === "--claude-thread") {
      options.claudeThreadIds.push(argv[++index]);
    } else if (argument === "--interrupt-thread") {
      options.interruptThreadIds.push(argv[++index]);
    } else if (argument === "--delete-thread") {
      options.deleteThreadIds.push(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (
    options.threadIds.length === 0 &&
    options.claudeThreadIds.length === 0 &&
    options.interruptThreadIds.length === 0 &&
    options.deleteThreadIds.length === 0
  ) {
    throw new Error(
      "Pass at least one --thread, --claude-thread, --interrupt-thread, or --delete-thread.",
    );
  }
  if (!Number.isFinite(options.pollMs) || options.pollMs < 250) {
    throw new Error("--poll-ms must be at least 250.");
  }
  return options;
}

function powershellExecutable() {
  return NodePath.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

export function isProcessRunning(processName) {
  const escapedName = processName.replaceAll("'", "''");
  const result = NodeChildProcess.spawnSync(
    powershellExecutable(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$processes = @(Get-Process -Name '${escapedName}' -ErrorAction SilentlyContinue); if ($processes.Count -gt 0) { exit 0 } else { exit 1 }`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  return result.status === 0;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function waitForProcessExit(processName, pollMs) {
  process.stdout.write(`Waiting for ${processName} to close`);
  let consecutiveClosedPolls = 0;
  while (consecutiveClosedPolls < 3) {
    if (isProcessRunning(processName)) {
      consecutiveClosedPolls = 0;
      process.stdout.write(".");
    } else {
      consecutiveClosedPolls += 1;
    }
    await sleep(pollMs);
  }
  process.stdout.write("\nV3 Code is closed. Starting offline recovery.\n");
}

function findFilesRecursively(root, expectedSuffix, matches = []) {
  if (!NodeFS.existsSync(root)) {
    return matches;
  }
  for (const entry of NodeFS.readdirSync(root, { withFileTypes: true })) {
    const path = NodePath.join(root, entry.name);
    if (entry.isDirectory()) {
      findFilesRecursively(path, expectedSuffix, matches);
    } else if (entry.isFile() && entry.name.endsWith(expectedSuffix)) {
      matches.push(path);
    }
  }
  return matches;
}

export function findCodexSessionFile(codexSessionsRoot, providerThreadId) {
  const matches = findFilesRecursively(codexSessionsRoot, `${providerThreadId}.jsonl`);
  return matches.sort(
    (left, right) => NodeFS.statSync(right).mtimeMs - NodeFS.statSync(left).mtimeMs,
  )[0];
}

export function extractCodexAssistantMessages(jsonlPath) {
  const messages = [];
  for (const line of NodeFS.readFileSync(jsonlPath, "utf8").split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row.payload;
    if (
      row.type !== "response_item" ||
      payload?.type !== "message" ||
      payload.role !== "assistant" ||
      typeof payload.id !== "string"
    ) {
      continue;
    }
    const text = Array.isArray(payload.content)
      ? payload.content
          .filter((part) => part?.type === "output_text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("")
      : "";
    if (!text) {
      continue;
    }
    messages.push({
      messageId: `assistant:${payload.id}`,
      providerItemId: payload.id,
      turnId: payload.internal_chat_message_metadata_passthrough?.turn_id ?? null,
      text,
      timestamp: row.timestamp,
    });
  }
  return messages;
}

export function extractCodexTaskCompletions(jsonlPath) {
  const completions = new Map();
  for (const line of NodeFS.readFileSync(jsonlPath, "utf8").split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row.payload;
    if (
      row.type === "event_msg" &&
      payload?.type === "task_complete" &&
      typeof payload.turn_id === "string"
    ) {
      completions.set(payload.turn_id, row.timestamp);
    }
  }
  return completions;
}

export function extractClaudeAssistantMessages(jsonlPath) {
  const messages = [];
  for (const line of NodeFS.readFileSync(jsonlPath, "utf8").split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      row.type !== "assistant" ||
      row.isSidechain === true ||
      !Array.isArray(row.message?.content)
    ) {
      continue;
    }
    const text = row.message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    if (!text || typeof row.uuid !== "string" || typeof row.timestamp !== "string") {
      continue;
    }
    messages.push({
      rawMessageId: row.uuid,
      providerItemId:
        typeof row.message.id === "string" && row.message.id ? row.message.id : row.uuid,
      text,
      timestamp: row.timestamp,
    });
  }
  return messages;
}

function backupDatabase(dbPath, now) {
  const suffix = now.replaceAll(":", "-").replaceAll(".", "-");
  const backupDirectory = `${dbPath}.salvage-backup-${suffix}`;
  NodeFS.mkdirSync(backupDirectory, { recursive: false });
  for (const source of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (NodeFS.existsSync(source)) {
      NodeFS.copyFileSync(source, NodePath.join(backupDirectory, NodePath.basename(source)));
    }
  }
  return backupDirectory;
}

function readProviderThreadId(runtimeRow) {
  try {
    const cursor = JSON.parse(runtimeRow?.resume_cursor_json ?? "null");
    return typeof cursor?.threadId === "string" ? cursor.threadId : undefined;
  } catch {
    return undefined;
  }
}

function deterministicId(kind, threadId, messageId) {
  const digest = NodeCrypto.createHash("sha256").update(`${threadId}\0${messageId}`).digest("hex");
  return `salvage:${kind}:${digest}`;
}

function planThread(db, codexSessionsRoot, threadId) {
  const runtimeRow = db
    .prepare(
      `SELECT thread_id, provider_name, resume_cursor_json
       FROM provider_session_runtime
       WHERE thread_id = ?`,
    )
    .get(threadId);
  if (!runtimeRow) {
    return { threadId, error: "No provider_session_runtime row.", missingMessages: [] };
  }
  if (runtimeRow.provider_name !== "codex") {
    return {
      threadId,
      error: `Provider is ${runtimeRow.provider_name}, not codex.`,
      missingMessages: [],
    };
  }
  const providerThreadId = readProviderThreadId(runtimeRow);
  if (!providerThreadId) {
    return { threadId, error: "No Codex resume cursor.", missingMessages: [] };
  }
  const jsonlPath = findCodexSessionFile(codexSessionsRoot, providerThreadId);
  if (!jsonlPath) {
    return {
      threadId,
      providerThreadId,
      error: "Codex JSONL transcript not found.",
      missingMessages: [],
    };
  }

  const projectedMessages = new Map(
    db
      .prepare(
        `SELECT message_id, text, is_streaming
         FROM projection_thread_messages
         WHERE thread_id = ?`,
      )
      .all(threadId)
      .map((row) => [row.message_id, row]),
  );
  const eventMessageIds = new Set(
    db
      .prepare(
        `SELECT json_extract(payload_json, '$.messageId') AS message_id
         FROM orchestration_events
         WHERE stream_id = ? AND event_type = 'thread.message-sent'`,
      )
      .all(threadId)
      .map((row) => row.message_id)
      .filter(Boolean),
  );
  const recoveryEventIds = new Set(
    db
      .prepare(
        `SELECT event_id
         FROM orchestration_events
         WHERE stream_id = ? AND event_id LIKE 'salvage:event:%'`,
      )
      .all(threadId)
      .map((row) => row.event_id),
  );
  const missingMessages = extractCodexAssistantMessages(jsonlPath).filter((message) => {
    if (recoveryEventIds.has(deterministicId("event", threadId, message.messageId))) {
      return false;
    }
    const projected = projectedMessages.get(message.messageId);
    if (projected) {
      return projected.text !== message.text || projected.is_streaming === 1;
    }
    return !eventMessageIds.has(message.messageId);
  });
  const taskCompletions = extractCodexTaskCompletions(jsonlPath);

  const session = db
    .prepare(
      `SELECT s.active_turn_id, s.status, tu.state AS turn_state, tu.completed_at
       FROM projection_thread_sessions s
       LEFT JOIN projection_turns tu
         ON tu.thread_id = s.thread_id AND tu.turn_id = s.active_turn_id
       WHERE s.thread_id = ?`,
    )
    .get(threadId);
  const staleSession =
    session?.active_turn_id != null &&
    (session.turn_state == null ||
      TERMINAL_TURN_STATES.has(session.turn_state) ||
      session.completed_at != null ||
      taskCompletions.has(session.active_turn_id));

  return {
    threadId,
    adapterKey: "codex",
    providerThreadId,
    jsonlPath,
    missingMessages,
    staleSession,
    session,
    activeTurnCompletedAt:
      session?.active_turn_id != null ? taskCompletions.get(session.active_turn_id) : undefined,
  };
}

function planClaudeThread(db, claudeProjectsRoot, threadId) {
  const runtimeRow = db
    .prepare(
      `SELECT thread_id, provider_name, resume_cursor_json
       FROM provider_session_runtime
       WHERE thread_id = ?`,
    )
    .get(threadId);
  if (!runtimeRow) {
    return { threadId, error: "No provider_session_runtime row.", missingMessages: [] };
  }
  if (runtimeRow.provider_name !== "claudeAgent") {
    return {
      threadId,
      error: `Provider is ${runtimeRow.provider_name}, not claudeAgent.`,
      missingMessages: [],
    };
  }

  let providerThreadId;
  try {
    const cursor = JSON.parse(runtimeRow.resume_cursor_json ?? "null");
    providerThreadId = typeof cursor?.resume === "string" ? cursor.resume : undefined;
  } catch {
    providerThreadId = undefined;
  }
  if (!providerThreadId) {
    return { threadId, error: "No Claude resume cursor.", missingMessages: [] };
  }
  const jsonlPath = findFilesRecursively(claudeProjectsRoot, `${providerThreadId}.jsonl`).sort(
    (left, right) => NodeFS.statSync(right).mtimeMs - NodeFS.statSync(left).mtimeMs,
  )[0];
  if (!jsonlPath) {
    return {
      threadId,
      providerThreadId,
      error: "Claude JSONL transcript not found.",
      missingMessages: [],
    };
  }

  const projectedMessages = db
    .prepare(
      `SELECT message_id, text, is_streaming, turn_id, created_at
       FROM projection_thread_messages
       WHERE thread_id = ? AND role = 'assistant'`,
    )
    .all(threadId);
  const recoveryEventIds = new Set(
    db
      .prepare(
        `SELECT event_id
         FROM orchestration_events
         WHERE stream_id = ? AND event_id LIKE 'salvage:event:%'`,
      )
      .all(threadId)
      .map((row) => row.event_id),
  );
  const turns = db
    .prepare(
      `SELECT turn_id, requested_at, started_at
       FROM projection_turns
       WHERE thread_id = ? AND turn_id IS NOT NULL
       ORDER BY COALESCE(started_at, requested_at)`,
    )
    .all(threadId);
  const turnForTimestamp = (timestamp) => {
    let selected = null;
    for (const turn of turns) {
      const start = turn.started_at ?? turn.requested_at;
      if (start && start <= timestamp) {
        selected = turn.turn_id;
      }
    }
    return selected;
  };

  const missingMessages = [];
  for (const raw of extractClaudeAssistantMessages(jsonlPath)) {
    const exact = projectedMessages.find((message) => message.text === raw.text);
    if (exact && exact.is_streaming !== 1) {
      continue;
    }
    const projected =
      exact ??
      projectedMessages
        .filter((message) => message.text.length >= 20 && raw.text.startsWith(message.text))
        .sort((left, right) => right.text.length - left.text.length)[0];
    const messageId =
      projected?.message_id ??
      `assistant:${deterministicId("claude-message", threadId, raw.rawMessageId)}`;
    if (recoveryEventIds.has(deterministicId("event", threadId, messageId))) {
      continue;
    }
    missingMessages.push({
      messageId,
      providerItemId: raw.providerItemId,
      turnId: projected?.turn_id ?? turnForTimestamp(raw.timestamp),
      text: raw.text,
      timestamp: raw.timestamp,
    });
  }

  return {
    threadId,
    adapterKey: "claudeAgent",
    providerThreadId,
    jsonlPath,
    missingMessages,
    staleSession: false,
  };
}

function insertRecoveredMessage(db, threadId, message, ingestedAt, adapterKey) {
  const eventId = deterministicId("event", threadId, message.messageId);
  const commandId = deterministicId("command", threadId, message.messageId);
  const payload = {
    threadId,
    messageId: message.messageId,
    role: "assistant",
    text: message.text,
    turnId: message.turnId,
    streaming: false,
    createdAt: message.timestamp,
    updatedAt: message.timestamp,
  };
  const metadata = {
    ...(message.turnId ? { providerTurnId: message.turnId } : {}),
    providerItemId: message.providerItemId,
    adapterKey,
    ingestedAt,
  };
  db.prepare(
    `INSERT INTO orchestration_events (
       event_id, aggregate_kind, stream_id, stream_version, event_type,
       occurred_at, command_id, causation_event_id, correlation_id,
       actor_kind, payload_json, metadata_json
     )
     VALUES (
       ?, 'thread', ?,
       COALESCE((
         SELECT MAX(stream_version) + 1
         FROM orchestration_events
         WHERE aggregate_kind = 'thread' AND stream_id = ?
       ), 0),
       'thread.message-sent', ?, ?, NULL, ?, 'provider', ?, ?
     )`,
  ).run(
    eventId,
    threadId,
    threadId,
    message.timestamp,
    commandId,
    commandId,
    JSON.stringify(payload),
    JSON.stringify(metadata),
  );
}

function repairStaleSession(db, threadId, now, activeTurnCompletedAt) {
  if (activeTurnCompletedAt) {
    db.prepare(
      `UPDATE projection_turns
       SET state = 'completed',
           completed_at = COALESCE(completed_at, ?)
       WHERE thread_id = ?
         AND turn_id = (
           SELECT active_turn_id FROM projection_thread_sessions WHERE thread_id = ?
         )
         AND state NOT IN ('completed', 'interrupted', 'error')`,
    ).run(activeTurnCompletedAt, threadId, threadId);
  }
  db.prepare(
    `UPDATE projection_thread_sessions
     SET active_turn_id = NULL, status = 'stopped', updated_at = ?
     WHERE thread_id = ?`,
  ).run(now, threadId);
  db.prepare(
    `UPDATE provider_session_runtime
     SET status = 'stopped', last_seen_at = ?
     WHERE thread_id = ?`,
  ).run(now, threadId);
}

function interruptThread(db, threadId, now) {
  const session = db
    .prepare(
      `SELECT active_turn_id, status
       FROM projection_thread_sessions
       WHERE thread_id = ?`,
    )
    .get(threadId);
  if (!session || (session.active_turn_id == null && session.status === "stopped")) {
    return false;
  }
  if (session.active_turn_id != null) {
    db.prepare(
      `UPDATE projection_turns
       SET state = 'interrupted', completed_at = COALESCE(completed_at, ?)
       WHERE thread_id = ? AND turn_id = ?
         AND state NOT IN ('completed', 'interrupted', 'error')`,
    ).run(now, threadId, session.active_turn_id);
  }
  repairStaleSession(db, threadId, now, undefined);
  return true;
}

export function salvageCodexThreads(options) {
  const db = new NodeSqlite.DatabaseSync(options.dbPath);
  try {
    const plans = options.threadIds.map((threadId) =>
      planThread(db, options.codexSessionsRoot, threadId),
    );
    plans.push(
      ...(options.claudeThreadIds ?? []).map((threadId) =>
        planClaudeThread(db, options.claudeProjectsRoot, threadId),
      ),
    );
    const interruptionPlans = (options.interruptThreadIds ?? []).map((threadId) => {
      const row = db
        .prepare(
          `SELECT t.title, s.status, s.active_turn_id
           FROM projection_thread_sessions s
           LEFT JOIN projection_threads t ON t.thread_id = s.thread_id
           WHERE s.thread_id = ?`,
        )
        .get(threadId);
      return {
        threadId,
        title: row?.title,
        exists: row != null,
        alreadyStopped: row?.active_turn_id == null && row?.status === "stopped",
      };
    });
    const deletionPlans = (options.deleteThreadIds ?? []).map((threadId) => {
      const row = db
        .prepare("SELECT thread_id, title, deleted_at FROM projection_threads WHERE thread_id = ?")
        .get(threadId);
      return {
        threadId,
        title: row?.title,
        exists: row != null,
        alreadyDeleted: row?.deleted_at != null,
      };
    });
    if (!options.apply) {
      return {
        plans,
        interruptionPlans,
        deletionPlans,
        backupDirectory: undefined,
        recoveredCount: 0,
        repairedCount: 0,
        interruptedCount: 0,
        deletedCount: 0,
      };
    }

    const now = options.now ?? new Date().toISOString();
    const backupDirectory = backupDatabase(options.dbPath, now);
    let recoveredCount = 0;
    let repairedCount = 0;
    let interruptedCount = 0;
    let deletedCount = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const plan of plans) {
        if (plan.error) {
          continue;
        }
        for (const message of plan.missingMessages) {
          insertRecoveredMessage(db, plan.threadId, message, now, plan.adapterKey);
          recoveredCount += 1;
        }
        if (plan.staleSession) {
          repairStaleSession(db, plan.threadId, now, plan.activeTurnCompletedAt);
          repairedCount += 1;
        }
      }
      for (const threadId of options.interruptThreadIds ?? []) {
        if (interruptThread(db, threadId, now)) {
          interruptedCount += 1;
        }
      }
      for (const plan of deletionPlans) {
        if (!plan.exists || plan.alreadyDeleted) {
          continue;
        }
        db.prepare(
          `UPDATE projection_threads
           SET deleted_at = ?, updated_at = ?
           WHERE thread_id = ? AND deleted_at IS NULL`,
        ).run(now, now, plan.threadId);
        deletedCount += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      plans,
      interruptionPlans,
      deletionPlans,
      backupDirectory,
      recoveredCount,
      repairedCount,
      interruptedCount,
      deletedCount,
    };
  } finally {
    db.close();
  }
}

function printResult(result, apply) {
  for (const plan of result.plans) {
    if (plan.error) {
      console.log(`SKIP ${plan.threadId}: ${plan.error}`);
      continue;
    }
    console.log(
      `${apply ? "RECOVER" : "WOULD RECOVER"} ${plan.threadId}: ` +
        `${plan.missingMessages.length} message(s), ` +
        `${plan.staleSession ? "stale spinner" : "session not provably stale"}`,
    );
    console.log(`  ${plan.jsonlPath}`);
  }
  for (const plan of result.deletionPlans) {
    if (!plan.exists) {
      console.log(`SKIP DELETE ${plan.threadId}: thread not found.`);
    } else if (plan.alreadyDeleted) {
      console.log(`SKIP DELETE ${plan.threadId}: already deleted.`);
    } else {
      console.log(
        `${apply ? "DELETE" : "WOULD DELETE"} ${plan.threadId}: ${plan.title ?? "untitled thread"}`,
      );
    }
  }
  for (const plan of result.interruptionPlans) {
    if (!plan.exists) {
      console.log(`SKIP INTERRUPT ${plan.threadId}: session not found.`);
    } else if (plan.alreadyStopped) {
      console.log(`SKIP INTERRUPT ${plan.threadId}: already stopped.`);
    } else {
      console.log(
        `${apply ? "INTERRUPT" : "WOULD INTERRUPT"} ${plan.threadId}: ${plan.title ?? "untitled thread"}`,
      );
    }
  }
  if (apply) {
    console.log(`Recovered ${result.recoveredCount} message(s).`);
    console.log(`Repaired ${result.repairedCount} stale session(s).`);
    console.log(`Interrupted ${result.interruptedCount} abandoned session(s).`);
    console.log(`Deleted ${result.deletedCount} thread(s).`);
    console.log(`Backup: ${result.backupDirectory}`);
    console.log("Reopen V3 Code. New recovery events will populate the messages projection.");
  } else {
    console.log("Dry run only. Add --apply after closing V3 Code.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.waitForExit) {
    await waitForProcessExit(options.processName, options.pollMs);
  } else if (options.apply && isProcessRunning(options.processName)) {
    throw new Error("V3 Code is still running. Close it or pass --wait-for-exit.");
  }
  const result = salvageCodexThreads(options);
  printResult(result, options.apply);
}

const isMain =
  process.argv[1] && NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
