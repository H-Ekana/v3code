import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";

import { runMigrations } from "../apps/server/src/persistence/Migrations.ts";
import * as NodeSqliteClient from "../apps/server/src/persistence/NodeSqliteClient.ts";

export const V3_DEMO_PROJECT_ID = "v3-agent-playground";
export const V3_DEMO_THREAD_ID = "v3-agent-sidebar-demo";

const PROJECTOR_NAMES = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
];

const RESET_TABLES = [
  "auth_pairing_links",
  "auth_sessions",
  "checkpoint_diff_blobs",
  "orchestration_command_receipts",
  "orchestration_events",
  "projection_pending_approvals",
  "projection_thread_proposed_plans",
  "projection_thread_activities",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_turns",
  "projection_threads",
  "projection_projects",
  "projection_state",
  "provider_session_runtime",
];

function isoMinutesBefore(now, minutes) {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function agent(input) {
  return {
    activationCount: 1,
    recentActivity: [],
    ...input,
  };
}

function createAgentRoster(now) {
  const startedAt = isoMinutesBefore(now, 18);
  const recentAt = isoMinutesBefore(now, 1);

  return [
    agent({
      agentId: "workflow-v3-sidebar",
      provider: "claudeAgent",
      kind: "workflow",
      name: "V3 sidebar launch",
      agentType: "orchestrator",
      model: "Claude Opus",
      status: "running",
      currentActivity: "Coordinating the provider-agnostic implementation",
      firstStartedAt: startedAt,
      lastStartedAt: startedAt,
      lastActivityAt: recentAt,
      phases: [
        { index: 0, title: "Research" },
        { index: 1, title: "Implementation" },
        { index: 2, title: "Review" },
      ],
      recentActivity: [
        { at: isoMinutesBefore(now, 16), summary: "Split the work across three providers" },
        { at: isoMinutesBefore(now, 1), summary: "Collecting implementation results" },
      ],
      updatedAt: recentAt,
    }),
    agent({
      agentId: "codex-architecture",
      provider: "codex",
      kind: "workflow_agent",
      name: "Map provider events",
      agentType: "explorer",
      model: "GPT-5.6 Codex",
      status: "completed",
      parentAgentId: "workflow-v3-sidebar",
      phaseIndex: 0,
      phaseTitle: "Research",
      currentActivity: "Mapped Codex and Claude child-session events",
      resultSummary: "Produced a normalized provider event map and identity model.",
      usage: { totalTokens: 18_420, inputTokens: 12_600, outputTokens: 5_820, toolUses: 14 },
      firstStartedAt: isoMinutesBefore(now, 18),
      lastStartedAt: isoMinutesBefore(now, 18),
      lastActivityAt: isoMinutesBefore(now, 12),
      endedAt: isoMinutesBefore(now, 12),
      recentActivity: [
        { at: isoMinutesBefore(now, 17), summary: "Inspected Codex collaboration events" },
        { at: isoMinutesBefore(now, 12), summary: "Returned the provider normalization map" },
      ],
      updatedAt: isoMinutesBefore(now, 12),
    }),
    agent({
      agentId: "grok-sidebar-ui",
      provider: "grok",
      kind: "workflow_agent",
      name: "Build live agent cards",
      agentType: "frontend",
      model: "Grok Code Fast",
      status: "running",
      parentAgentId: "workflow-v3-sidebar",
      phaseIndex: 1,
      phaseTitle: "Implementation",
      currentActivity: "Polishing expandable chat and activity cards",
      lastToolName: "apply_patch",
      usage: { totalTokens: 11_870, inputTokens: 8_900, outputTokens: 2_970, toolUses: 9 },
      firstStartedAt: isoMinutesBefore(now, 11),
      lastStartedAt: isoMinutesBefore(now, 11),
      lastActivityAt: recentAt,
      recentActivity: [
        { at: isoMinutesBefore(now, 8), summary: "Added live provider and status badges" },
        { at: isoMinutesBefore(now, 1), summary: "Wired expandable activity history" },
      ],
      updatedAt: recentAt,
    }),
    agent({
      agentId: "claude-review",
      provider: "claudeAgent",
      kind: "workflow_agent",
      name: "Review interaction states",
      agentType: "code-reviewer",
      model: "Claude Sonnet",
      status: "waiting",
      parentAgentId: "workflow-v3-sidebar",
      phaseIndex: 2,
      phaseTitle: "Review",
      currentActivity: "Waiting for the implementation pass",
      usage: { totalTokens: 4_240, inputTokens: 3_700, outputTokens: 540, toolUses: 3 },
      firstStartedAt: isoMinutesBefore(now, 6),
      lastStartedAt: isoMinutesBefore(now, 6),
      lastActivityAt: isoMinutesBefore(now, 2),
      recentActivity: [
        { at: isoMinutesBefore(now, 4), summary: "Reviewed empty and loading states" },
        { at: isoMinutesBefore(now, 2), summary: "Paused until the UI patch is ready" },
      ],
      updatedAt: isoMinutesBefore(now, 2),
    }),
    agent({
      agentId: "codex-docs",
      provider: "codex",
      kind: "subagent",
      name: "Document edge cases",
      agentType: "researcher",
      model: "GPT-5.6 Codex",
      status: "idle",
      currentActivity: "Ready for a follow-up",
      resultSummary: "Catalogued disconnect, retry, and cross-provider identity edge cases.",
      usage: { totalTokens: 9_610, inputTokens: 7_300, outputTokens: 2_310, toolUses: 7 },
      firstStartedAt: isoMinutesBefore(now, 15),
      lastStartedAt: isoMinutesBefore(now, 15),
      lastActivityAt: isoMinutesBefore(now, 7),
      endedAt: isoMinutesBefore(now, 7),
      activationCount: 2,
      recentActivity: [
        { at: isoMinutesBefore(now, 13), summary: "Compared reconnect semantics by provider" },
        { at: isoMinutesBefore(now, 7), summary: "Returned the edge-case checklist" },
      ],
      updatedAt: isoMinutesBefore(now, 7),
    }),
  ];
}

function resetDemoDatabase(database) {
  database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    for (const table of RESET_TABLES) {
      database.exec(`DELETE FROM ${table}`);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

function seedDemoDatabase(database, workspaceRoot, now) {
  const projectCreatedAt = isoMinutesBefore(now, 180);
  const threadCreatedAt = isoMinutesBefore(now, 24);
  const userMessageAt = isoMinutesBefore(now, 20);
  const assistantMessageAt = isoMinutesBefore(now, 19);
  const latestActivityAt = isoMinutesBefore(now, 1);
  const modelSelection = JSON.stringify({ instanceId: "codex", model: "gpt-5.6-sol" });
  const turnId = "v3-agent-sidebar-demo-turn";
  const roster = createAgentRoster(now);

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, default_model_selection_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, '[]', ?, ?, ?, NULL)`,
      )
      .run(
        V3_DEMO_PROJECT_ID,
        "V3 Agent Playground",
        workspaceRoot,
        modelSelection,
        projectCreatedAt,
        latestActivityAt,
      );

    database
      .prepare(
        `INSERT INTO projection_threads (
          thread_id, project_id, title, branch, worktree_path, latest_turn_id,
          runtime_mode, interaction_mode, model_selection_json, latest_user_message_at,
          pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
          settled_override, settled_at, snoozed_until, snoozed_at,
          created_at, updated_at, archived_at, deleted_at
        ) VALUES (?, ?, ?, 'main', NULL, ?, 'full-access', 'default', ?, ?, 0, 0, 0,
          NULL, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        V3_DEMO_THREAD_ID,
        V3_DEMO_PROJECT_ID,
        "Coordinate provider-agnostic sub-agents",
        turnId,
        modelSelection,
        userMessageAt,
        threadCreatedAt,
        latestActivityAt,
      );

    database
      .prepare(
        `INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, assistant_message_id, state,
          requested_at, started_at, completed_at, checkpoint_turn_count, checkpoint_ref,
          checkpoint_status, checkpoint_files_json, source_proposed_plan_thread_id,
          source_proposed_plan_id
        ) VALUES (?, ?, NULL, ?, 'completed', ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL)`,
      )
      .run(
        V3_DEMO_THREAD_ID,
        turnId,
        "v3-agent-sidebar-demo-assistant",
        userMessageAt,
        userMessageAt,
        assistantMessageAt,
      );

    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    insertMessage.run(
      "v3-agent-sidebar-demo-user",
      V3_DEMO_THREAD_ID,
      turnId,
      "user",
      "Coordinate a provider-agnostic sub-agent sidebar. Delegate architecture research to Codex, UI implementation to Grok, and interaction review to Claude.",
      userMessageAt,
      userMessageAt,
    );
    insertMessage.run(
      "v3-agent-sidebar-demo-assistant",
      V3_DEMO_THREAD_ID,
      turnId,
      "assistant",
      "The demo team is running in parallel. Open the Agents surface to inspect each provider, expand its activity history, and compare completed, running, waiting, and resumable states.",
      assistantMessageAt,
      assistantMessageAt,
    );

    database
      .prepare(
        `INSERT INTO projection_thread_sessions (
          thread_id, status, provider_name, provider_instance_id, provider_session_id,
          provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
        ) VALUES (?, 'stopped', 'Claude', 'claude', NULL, NULL, 'full-access', NULL, NULL, ?)`,
      )
      .run(V3_DEMO_THREAD_ID, latestActivityAt);

    database
      .prepare(
        `INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES (?, ?, ?, 'info', 'agent.snapshot', ?, ?, 1, ?)`,
      )
      .run(
        "v3-agent-sidebar-roster",
        V3_DEMO_THREAD_ID,
        turnId,
        "Provider-agnostic demo roster",
        JSON.stringify({ agents: roster, revision: 1 }),
        latestActivityAt,
      );

    const insertProjectorState = database.prepare(
      `INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
       VALUES (?, 1, ?)`,
    );
    for (const projector of PROJECTOR_NAMES) {
      insertProjectorState.run(projector, latestActivityAt);
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function prepareV3SidebarDemo(workspaceRoot, dataHome) {
  const userdata = join(dataHome, "userdata");
  const databasePath = join(userdata, "state.sqlite");
  mkdirSync(userdata, { recursive: true });

  await Effect.runPromise(
    runMigrations().pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: databasePath })),
      Effect.scoped,
    ),
  );

  const database = new DatabaseSync(databasePath);
  try {
    resetDemoDatabase(database);
    seedDemoDatabase(database, workspaceRoot, new Date());
  } finally {
    database.close();
  }

  return {
    databasePath,
    projectId: V3_DEMO_PROJECT_ID,
    threadId: V3_DEMO_THREAD_ID,
  };
}
