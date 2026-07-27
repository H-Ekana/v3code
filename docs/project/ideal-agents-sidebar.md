# The ideal agents sidebar

Goal: the Agents panel should show **sub-agents** as the primary list, each marked with the icon of
the provider **actually doing the work**, with a live status you can trust and a click-through to
that agent's full thought process. Background shells should hang off their parent sub-agent instead
of inflating the top-level list; unparented shells/monitors get their own de-emphasised section.

The problem this solves: today the panel is a sea of green dots. You cannot tell what an agent is
working on, whether it is still working, or which model is doing the work — you have to ask.

---

## Target UI (approved reference)

`scripts/v3-sidebar-demo.mjs` renders the agreed target. Run it and look at the Agents surface —
that layout is the spec. **Caveat: the demo hand-authors its labels, so it shows fields the real
pipeline does not populate yet.** Treat it as the destination, not as evidence.

### Anatomy of a card

```
┌ WORKFLOW · V3 SIDEBAR LAUNCH        ← group header (workflow container)
│  ✓ RESEARCH                          ← phase header, green + ✓ when done
│  ◎ Map provider events  [explorer] [GPT-5.6 Codex]        6m ✓
│    Produced a normalized provider event map…               ← activity line
│    18.4k tok · 14 tools                                  › ← meta row
│  IMPLEMENTATION  1 active            ← phase header, blue while running
│  ◎ Build live agent cards [frontend] [Grok Code Fast]  168m 33s
└ SUB-AGENTS                           ← non-workflow section
   ◎ Document edge cases [researcher] [GPT-5.6 Codex]  ·  run 2
```

| Element                                            | Source field                                                          | Status today                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Provider glyph + overlaid status dot               | `delegateProvider ?? provider`, `status`                              | ✅ built                                                                                                                   |
| Bold title                                         | `name`                                                                | ✅                                                                                                                         |
| Role badge (`explorer`, `frontend`)                | `agentType`                                                           | ⚠️ **absent on Codex sub-agents** (`CodexAdapter.ts:526`)                                                                  |
| Model badge (`GPT-5.6 Codex`)                      | `model`                                                               | ⚠️ **absent on Codex sub-agents AND ordinary Claude sub-agents** — only workflow children set it (`ClaudeAdapter.ts:2824`) |
| Elapsed / `✓`                                      | `lastStartedAt`, `endedAt`                                            | ✅ (ticks live; frozen once ended)                                                                                         |
| Activity line                                      | `currentActivity` → `lastToolName` → `resultSummary` → `errorMessage` | ✅ but describes the wrapper for detached jobs (Step 7)                                                                    |
| `18.4k tok · 14 tools · run N`                     | `usage`, `activationCount`                                            | ⚠️ token count is the wrapper's for detached jobs                                                                          |
| Phase headers (RESEARCH / IMPLEMENTATION / REVIEW) | `phaseIndex`/`phaseTitle` + workflow `phases`                         | ⚠️ **workflow groups only** — plain sub-agents get no phase tag                                                            |
| `SUB-AGENTS` / `BACKGROUND TASKS` sections         | `kind`                                                                | ✅ built                                                                                                                   |
| Amber "waiting" state                              | `status: "waiting"`                                                   | ❌ **unreachable** — no emitter outside tests                                                                              |

### Gap: the demo mixes two different axes

`explorer` / `researcher` / `code-reviewer` / `orchestrator` are **roles**. `frontend` is a **scope**
— which part of the codebase the agent touches. The demo puts both in the `agentType` slot.

In reality `agentType` is the SDK's `subagent_type`, i.e. the agent _definition name_ (`Explore`,
`general-purpose`, `codex:codex-rescue`, `convex:convex-expert`). A scope label like `frontend` has
**no source anywhere in the pipeline**. Delivering it needs a genuinely new signal — plausibly
inferred from the files an agent has touched, or from its task description. Both are heuristics and
neither exists today. Decide whether scope is wanted as a separate badge before building it.

### Step 8 — make the real panel as informative as the demo pretends

Ordered by value per unit of work:

1. **Populate `agentType` + `model` for Codex sub-agents** (`CodexAdapter.ts:526`). Highest value —
   two badges currently blank on every Codex row.
2. **Populate `model` for ordinary Claude sub-agents**, not just workflow children.
3. **Phase tags for non-workflow sub-agents.** `phaseIndex`/`phaseTitle` are already optional on
   _every_ snapshot and `PhaseHeader` (`AgentsPanel.tsx:197`) already renders them — only the label
   source is missing. Cheapest option: an `agentType → phase` lookup mirroring the `delegateProvider`
   resolver. Note it only works where `agentType` exists, so it depends on item 1.
4. **Scope badge** — blocked on inventing the signal (see above).
5. **Emit `waiting`** so the amber state stops being dead code.

Update the demo script alongside these so it keeps exercising real code paths: it currently has no
delegated row, no `shell` kind, and therefore never renders `BACKGROUND TASKS` or the `· N shells`
chip.

---

## Where to find out what agents are actually doing

**Read this first if you are an agent trying to check on other agents.** All of this exists on disk
today. Nothing in v3code reads any of it yet.

### 1. Job registry — status, phase, elapsed (fastest check)

```bash
node "C:/Users/vasus/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" status [job-id] [--all] [--json]
node "C:/Users/vasus/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" result <job-id> [--json]
```

`--json` gives structured output. Lists active + finished jobs with `status`, `phase`
(`starting → running → verifying → done`), elapsed time, the Codex session id, and the log path.
Run it from the repo root — the registry is scoped per workspace.

### 2. Per-job progress log — human-readable feed

```
~/.claude/plugins/data/codex-openai-codex/state/<workspace-hash>/jobs/<job-id>.log
```

Append-only, tailable. Lines like `Running command: …`, `Command completed: … (exit 0)`,
`Assistant message captured: …`. This is the summarised feed — good for a live activity line.
The `<workspace-hash>` is derived per workspace; get the exact path from `status`, don't guess it.

### 3. Codex session JSONL — the full transcript (the good stuff)

```
~/.codex/sessions/YYYY/MM/DD/rollout-<ISO-timestamp>-<session-id>.jsonl
```

The `<session-id>` comes from `status`. `codex resume <session-id>` reopens it. Verified record
types from one real 237-line session:

| Record                                                                  | Count   | Use                                                          |
| ----------------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `response_item/reasoning`                                               | 64      | **the thought process** — this is what the side chat renders |
| `response_item/function_call` + `/function_call_output`                 | 52 + 52 | tool calls and results                                       |
| `event_msg/token_count`                                                 | 52      | **real token usage**, updated per turn                       |
| `event_msg/agent_message`                                               | 3       | assistant messages                                           |
| `session_meta`, `turn_context`, `world_state`, `event_msg/task_started` | 1 each  | session setup                                                |

This is strictly higher fidelity than the `.log` and is the right source for both the live token
count and the transcript drill-in. Prefer it over the log wherever both would work.

Caveat: Codex `response_item/reasoning` carries `summary[]` plus `encrypted_content`. Only the
provider-exposed summaries are renderable — there is no hidden chain-of-thought to decrypt.

### 4. Claude sub-agent transcripts — use the SDK, not the filesystem

```ts
getSubagentMessages(parentSessionId, agentId, { dir, limit, offset });
```

Declared in `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:771`. It parses the
JSONL, follows `parentUuid`, and returns chronological messages. Backing file (`sdk.d.ts:983`):

```
~/.claude/projects/<dir>/<sessionId>/subagents/agent-<agentId>.jsonl
```

`ClaudeAdapter` already holds both inputs: `resumeSessionId` (`ClaudeAdapter.ts:3397`, `:3850`) and
`cwd` (`:3751`).

**Correction — `outputFile` is NOT the transcript.** It _is_ populated
(`ClaudeAdapter.ts:2936` → `ProviderRuntimeIngestion.ts:263`), contrary to the "reserved" comment at
`threadAgents.ts:122`, but it points at a temp task output
(`%TEMP%/claude/<project>/<session>/tasks/<agentId>.output`), not the child conversation. Treat it as
a final-output reference only.

---

## Current behaviour (verified)

- `deriveAgentPanelState` (`packages/client-runtime/src/state/threadAgents.ts:116-187`) groups
  **only** by `kind === "workflow"` and `parentAgentId`. Every other row with no parent falls into
  the single "Direct spawns" bucket (`:126-128`), and orphans fold back in at `:154-157`.
- `kind` is already correct and unused by the panel. `taskKind`
  (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:92-102`) maps
  `local_agent → subagent`, `local_bash|shell → shell`, `monitor → monitor`,
  `local_workflow → workflow`, `workflow_agent → workflow_agent`.
- `parentAgentId` comes from `payload.parentTaskId` (`ProviderRuntimeIngestion.ts:231-233`), which
  **only workflow children set today** (`ClaudeAdapter.ts:2829`). Shells are unparented.
- `provider: ProviderDriverKind` is required on every snapshot
  (`packages/contracts/src/threadAgents.ts:87`) and is already populated — `"claudeAgent"` /
  `"codex"`. No backend work needed for icons.
- Icons already exist: `PROVIDER_ICON_BY_PROVIDER`
  (`apps/web/src/components/chat/providerIconUtils.ts`) and `ProviderInstanceIcon`
  (`apps/web/src/components/chat/ProviderInstanceIcon.tsx`), which supports an overlaid status dot
  and falls back to provider initials. Used already in `settings/ProviderInstanceCard.tsx:504`.
- No `AgentsPanel.test.tsx` exists. Only `packages/client-runtime/src/state/threadAgents.test.ts`
  covers derivation.

Correction to note: the `Explore` row is a **sub-agent** (`kind: "subagent"`), not a background
task. The real background tasks are the `node "…codex-companion.mjs"` rows (`kind: "shell"`).

## Step 0 — spike (blocking, ~30 min)

Confirm whether the `task_started` SDK message for a nested background bash carries
`parent_tool_use_id` pointing at the spawning sub-agent's Task `tool_use_id`.
`ClaudeAdapter.ts:2738-2757` already reads `tool_use_id`; `parent_tool_use_id` is a known SDK
field (`ClaudeAdapter.ts:1302`). Log a raw `task_started` for a shell launched inside a sub-agent.

- **If present** → do Step 1, shells nest under their parent.
- **If absent** → skip Step 1. Shells stay unparented and land in the Background section only.
  Steps 2-4 still deliver most of the value.

## Step 1 — backend: parent shells to their sub-agent

`apps/server/src/provider/Layers/ClaudeAdapter.ts`

- Keep a session-scoped `Map<toolUseId, taskId>`, populated on `task_started` for
  `taskType === "local_agent"`.
- On `task_started` for a shell, resolve `parent_tool_use_id` through that map and emit
  `parentTaskId` in the payload.

No contract change: `parentTaskId` already exists on the wire and `parentAgentId` on the snapshot.
`taskKind`'s `if (parentTaskId) return "workflow_agent"` fallback is safe — the explicit
`local_bash` branch wins first (`ProviderRuntimeIngestion.ts:96-100`).

## Step 2 — client: group by kind, not just parent

`packages/client-runtime/src/state/threadAgents.ts`

Replace the single `direct` bucket with:

```ts
interface AgentPanelRow {
  readonly agent: ThreadAgentSnapshot;
  readonly shells: ReadonlyArray<ThreadAgentSnapshot>; // kind shell/monitor, parented here
}

interface AgentPanelState {
  readonly groups: ReadonlyArray<AgentPanelGroup>; // workflows, unchanged
  readonly subagents: ReadonlyArray<AgentPanelRow>; // kind subagent/workflow_agent/other
  readonly backgroundTasks: ReadonlyArray<ThreadAgentSnapshot>; // unparented shell/monitor
  // counts below
}
```

Rules:

- `kind === "workflow"` → workflow group (unchanged).
- `kind === "shell" | "monitor"` with a `parentAgentId` that resolves to a listed sub-agent →
  attach to that row's `shells`.
- `kind === "shell" | "monitor"` otherwise → `backgroundTasks`.
- everything else unparented → `subagents`.
- Orphan sweep (`:154-157`) must not resurrect shells into the sub-agent list.

**Counts:** `runningCount` currently counts every non-workflow row (`:174-180`). Change it to count
sub-agents only, and add a separate `backgroundRunningCount`. This is what makes the header say
"2 agents" instead of "4". Token totals should still include shells (they're real spend) — keep
`totalTokens` summing everything, no double-count since shells are distinct rows.

## Step 3 — UI: sections + provider icon

`apps/web/src/components/AgentsPanel.tsx`

**Sections** (one scroll, not tabs — tabs hide the count you're scanning for):

1. workflow groups (unchanged)
2. `SUB-AGENTS` — replaces the "Direct spawns" header (`:264`)
3. `BACKGROUND TASKS` — collapsed by default, header shows `▸ Background tasks · N`. Only render
   when non-empty.

**Shell children:** on a sub-agent card with `shells.length > 0`, add a muted
`· N shells` chip in the meta row (`:151-170`) that expands into the existing recent-activity feed
area (`:181`). Do not give shells their own top-level card.

**Provider icon:** in the title row (`:121-134`), replace `AgentStatusDot` with:

```tsx
<ProviderInstanceIcon
  driverKind={agent.provider}
  displayName={String(agent.provider)}
  className="size-5"
  iconClassName="size-5"
  statusDotClassName={STATUS_DOT_CLASS[agent.status]}
  indicatorBackground="var(--card)"
/>
<span className="sr-only">{STATUS_LABEL[agent.status]}</span>
```

- Net width cost ~13px over the current 7px dot; the title row is already tight (up to six children,
  and the `model` badge is `shrink-0` with no max-width), so the title stays the truncation point.
- The `sr-only` span is **required**: `ProviderInstanceIcon` marks its overlaid dot `aria-hidden`,
  whereas today's `AgentStatusDot` (`:43-51`) carries the accessible status label.
- Keep brand colours (Claude orange, OpenAI black/white) — already theme-correct and used in
  provider settings. Do not use `apps/marketing/public/harnesses/openai_dark.svg` (white-only).
- Background-task rows keep the plain `AgentStatusDot` — a shell has no provider identity of its own.

**Do not** add provider icons to `AgentsLiveStrip.tsx`, phase headers (`:197`), group headers
(`:239`), or the footer (`:331`). Those aggregate over possibly-mixed providers; one brand mark
there would be wrong.

## Step 4 — tests

- Extend `packages/client-runtime/src/state/threadAgents.test.ts`: shell parented to a sub-agent
  nests; unparented shell lands in `backgroundTasks`; `runningCount` excludes shells; workflow
  grouping unregressed.
- Add `apps/web/src/components/AgentsPanel.test.tsx` (new file, none exists): renders the Claude
  icon for `provider: "claudeAgent"`, the OpenAI icon for `"codex"`, initials fallback for an
  unknown slug, and keeps an accessible status label.

## Step 5 — delegated providers (the "codex-rescue shows a Claude icon" problem)

`provider` records **which adapter emitted the event**, not which model did the thinking. A
`codex:codex-rescue` sub-agent is a Claude sub-agent that shells out to the Codex CLI, so Steps 1-4
alone would render it with the Claude mark — defeating the point of the feature.

**This cannot be fixed from the skill/agent side.** Agent frontmatter
(`~/.claude/plugins/cache/openai-codex/codex/1.0.6/agents/codex-rescue.md` has `name`,
`description`, `model`, `tools`, `skills`) is never transmitted to v3code. The Claude Code SDK
forwards only `subagent_type` on `task_started` (`ClaudeAdapter.ts:2740`, surfaced as
`payload.agentType`). A skill has no channel to announce "I am Codex". The app must resolve it.

**The usable signal is `agentType`** — already on the snapshot at spawn time, already rendered as
the secondary badge (`AgentsPanel.tsx:129`), and for these rows it is literally
`"codex:codex-rescue"`. The `codex:` prefix is the plugin namespace.

### Contract

Add one optional field to `ThreadAgentSnapshot` (`packages/contracts/src/threadAgents.ts`):

```ts
// The provider actually doing the work, when the emitting adapter is only a
// host. `provider` stays "which adapter emitted this"; renderers prefer
// `delegateProvider ?? provider` for identity.
delegateProvider: Schema.optional(ProviderDriverKind),
```

Optional → backward compatible; the client decoder is strict only about required fields
(`client-runtime/src/state/threadAgents.ts:17`), and the activity payload is `Schema.Unknown` at the
envelope level, so no migration.

**Locked decision:** the icon shows the provider that is _actually doing the work_. Renderers use
`delegateProvider ?? provider` everywhere; `provider` is never overwritten.

`packages/contracts` is schema-only (see AGENTS.md) — the schema field goes there, but the lookup
table and resolver function live in `apps/server`, not contracts.

### Resolution (server, `ProviderRuntimeIngestion.ts` near :198)

Resolve in this order, first hit wins:

1. **Explicit map** — `agentType` exact match against a table in contracts, e.g.
   `"codex:codex-rescue" → "codex"`.
2. **Plugin namespace** — `agentType.split(":")[0]` matched against known provider plugin names
   (`codex → "codex"`). Covers future agents from the same plugin for free.
3. **Child-shell evidence** (only after Step 1 lands) — a parented `kind: "shell"` whose command
   matches a known provider CLI (`codex-companion.mjs`, `codex exec`) upgrades its parent's
   `delegateProvider`. This is evidence rather than a guess, and also catches a bare `Bash` call to
   the Codex CLI with no special sub-agent. Late-binding: the icon flips a second or two in.

Resolve server-side, not in web, so desktop/mobile inherit it. Start with the map hardcoded in
contracts; promote to a user-editable setting only if a second delegating plugin appears.

### Open gap: the delegated work itself is invisible

`codex:codex-rescue` is a _thin forwarder_. It makes one Bash call that launches a **detached
background Codex process**, then completes in ~25-30s. The Codex job then runs for minutes in a
process the Claude adapter never observes — it appears nowhere in the roster.

Consequence: `delegateProvider` correctly marks the card as Codex, but that card's status, elapsed
time and token count all describe the 30-second wrapper, not the 7-minute job. Observed directly —
three rescue agents showed `completed` in the panel while their Codex jobs were still running.

Not solved by Steps 1-5. Options if it matters: poll `codex-companion.mjs status` and synthesise
roster rows for live Codex jobs, or have the wrapper stay in the foreground so its lifetime matches
the work. Decide separately.

### Render (`AgentsPanel.tsx`)

Primary icon = `delegateProvider ?? provider`. When `delegateProvider` is set **and differs**, add a
small host mark in the icon's opposite corner from the status dot — main glyph = who is working
(Codex), corner glyph = who spawned it (Claude). That answers "which provider is this actually
using" without losing the orchestration story. Add the host provider to the `title`/`aria-label`
(`"Codex, run by Claude"`).

Verify against a real Codex-adapter session (`provider: "codex"`, no `delegateProvider`) as well as
a `codex:codex-rescue` row, so both paths are exercised.

---

## Step 6 — sub-agent transcript drill-in (side chat)

Design verified against the repo; not implemented.

**Surface.** The right panel is a thread-scoped persisted _tab workspace_, not a navigation stack —
existing kinds are `plan | diff | files | file | preview | terminal | agents`
(`apps/web/src/rightPanelStore.ts:17`), upserted as independently addressable resource surfaces
(`:28`, `:134`). So add `agent-detail` as a sibling resource surface, NOT nested state inside
`agents`:

```ts
{ id: `agent:${sourceProvider}:${agentId}`, kind: "agent-detail", sourceProvider, agentId }
```

Roster stays open in its own tab, several transcripts can be open at once, and tab close/restore
semantics come free. Route it beside the `agents` branch in `ChatView.tsx:5620`; add title/icon
handling in `RightPanelTabs.tsx:199`. Card body click opens it; keep the activity disclosure as a
separate chevron button (today the whole card is one button — `AgentsPanel.tsx:144`).

Use `agent.provider` for retrieval, **not** `delegateProvider` — the emitting adapter owns the
transcript; `delegateProvider` is display identity only.

**Transport.** New lazy paginated RPC, normalized server-side:

```ts
getAgentTranscript({ threadId, sourceProvider, agentId, cursor?, limit? })
  => { items, nextCursor?, complete, revision? }
```

Do NOT put transcript content in `agent.snapshot`: the roster is a complete latest-wins payload
(`contracts/threadAgents.ts:135`) re-persisted on every material update
(`ProviderRuntimeIngestion.ts:1718`) — transcripts would multiply storage, decode and WS cost.
Follow the existing one-shot-vs-`stream: true` split at `contracts/rpc.ts:640`. Never accept
filesystem paths from the browser.

**Phasing**

| Phase | Scope                                                                                                   | Difficulty  |
| ----- | ------------------------------------------------------------------------------------------------------- | ----------- |
| 1     | Claude direct sub-agents via `getSubagentMessages`; new RPC; `agent-detail` surface; read-only renderer | Medium      |
| 2     | Native Codex: read child thread via app-server `thread/read`, normalize items                           | Medium-High |
| 3     | Live updates (Claude `forwardSubagentText`; Codex child deltas; mounted-tab subscription)               | High        |
| 4     | Workflow children: retain real child agent IDs, not synthetic `<task>:wf:<index>`                       | Medium      |
| 5     | Detached rescue jobs: explicit job registration + synthetic live roster row                             | High        |

Phase 1 should support only `kind === "subagent"`; other kinds keep today's activity disclosure and
show no transcript affordance.

**Blockers to probe before building**

- `task_started.task_id` appearing to equal the SDK `agentId` is observed locally but undocumented —
  needs an integration probe.
- Workflow-agent IDs are synthesized as `<workflowTask>:wf:<index>` (`ClaudeAdapter.ts:2824`) and
  cannot be used with `getSubagentMessages` at all.
- The parent SDK stream is NOT a safe child-transcript source today: child `message_delta` usage is
  deliberately dropped (`ClaudeAdapter.ts:2111`), deltas aren't separated by child identity (`:2128`),
  and complete assistant messages are appended to the parent turn without checking
  `parent_tool_use_id` (`:2517`). `forwardSubagentText` (`sdk.d.ts:1597`) is not enabled.
- Detached rescue jobs share one host Claude session ID across multiple jobs, so wrapper→job
  correlation needs explicit registration, not filename guessing.

---

## Step 7 — live tracking of detached Codex jobs

Design verified against companion 1.0.6; not implemented. Overall difficulty: **large**, driven by
lifecycle authority and restart recovery — not by the panel UI (which is trivial, the fields already
render).

**Owner.** A new server-side `DelegatedJobRuntime` Effect layer that emits ordinary `task.*` events;
ingestion already folds those into snapshots (`ProviderRuntimeIngestion.ts:122-133,159-285`). Do NOT
put the watcher in ClaudeAdapter — use the adapter only for the correlation handshake.

**Correlation handshake** (session-scoped maps in ClaudeAdapter):

```
taskToolUseId  → wrapperTaskId
bashToolUseId  → { wrapperTaskId, command, cwd }
wrapperTaskId  → companionJobId
```

Parse the job id from the Bash tool_result: `started in the background as (task-[a-z0-9]+-[a-z0-9]+)`
(`codex-companion.mjs:556-557`), or `{jobId,...}` in JSON mode (`:700-706`). Validate workspace +
Claude session before accepting. **If correlation is ambiguous, decline to attach rather than update
the wrong row.**

**Polling:** tail the correlated `.log` + poll per-job JSON at 1s while active, back off to 5-10s
when idle. Recommend opt-in until correlation and stale-job handling are proven.

**New field:** `delegateJobId` — the durable authority key telling ingestion "ignore the wrapper's
terminal event, job Y owns this row now."

### Cross-connection worth chasing (may unblock Step 1)

Step 0 found `SDKTaskStartedMessage` has no `parent_tool_use_id`. But the SDK docs state sub-agent
`tool_use`/`tool_result` blocks ARE forwarded with `parent_tool_use_id` set, even with full text
forwarding disabled (`sdk.d.ts:1598-1601`; `SDKUserMessage` carries it at `:4130-4135`). So shell→
sub-agent parentage may be recoverable from the **tool_use stream** rather than from `task_started`.
Unverified — existing adapter tests all use `parent_tool_use_id: null`. Probe before relying on it.

### Hard blockers (cannot be solved inside v3code)

- **Real Codex token usage is not exposed** by companion 1.0.6. Showing the underlying job's true
  token count requires a change to the plugin, not to v3code.
- **No supported way to get the Codex JSONL transcript path from a `threadId`** via the companion.
- **No versioned companion JSON schema** — `status --json` shapes are 1.0.6 object construction, not
  a compatibility promise. Any integration is coupled to plugin internals.
- **`CLAUDE_PLUGIN_DATA` is not inherited** by the v3code server; the `~/.claude/plugins/data/...`
  path is conventional, not guaranteed (`state.mjs:29-43`). Needs discovery or a launch handshake.
- ClaudeAdapter currently drops the data needed for the handshake: forwarded assistant tool-use
  blocks other than `ExitPlanMode` are ignored (`ClaudeAdapter.ts:2567-2593`) and tool results whose
  id is not in `inFlightTools` are skipped (`:2380-2385`).

---

## Caveats & blockers register

Consolidated. Every entry below is verified against the repo or the installed SDK/plugin unless
marked _unverified_. `Gates` = which step it blocks.

### A. Hard blockers — cannot be fixed inside v3code

| #   | Blocker                                                                     | Gates                 | Notes                                                                                                                           |
| --- | --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Companion 1.0.6 does not expose real Codex token usage                      | Step 7 token accuracy | Requires a change to the codex plugin. Status/elapsed/activity are still achievable; the token number is not.                   |
| A2  | No supported way to resolve a Codex JSONL transcript path from a `threadId` | Step 6 phase 5        | Rollout files are findable by hand; there is no API.                                                                            |
| A3  | No versioned companion JSON schema                                          | Step 7                | `status --json` shapes are 1.0.6 object construction, not a compatibility promise. Any integration couples to plugin internals. |
| A4  | `CLAUDE_PLUGIN_DATA` is not inherited by the v3code server                  | Step 7                | `~/.claude/plugins/data/...` is conventional, not guaranteed (`state.mjs:29-43`). Needs discovery or a launch handshake.        |
| A5  | Codex reasoning is `encrypted_content` + `summary[]`                        | Step 6                | Only provider-exposed summaries are renderable. Do not promise raw chain-of-thought.                                            |
| A6  | Bash tool caps at 600s                                                      | —                     | Kills the `--wait` shortcut outright; jobs run to an hour. Approach rejected, do not revisit.                                   |

### B. Upstream / SDK blockers

| #   | Blocker                                                                        | Gates          | Notes                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `SDKTaskStartedMessage` has no `parent_tool_use_id` (SDK 0.3.170)              | Step 1         | **Shell nesting is dead code today** — no shell ever gets a parent, so `· N shells` never renders. See C1 for a possible way around it.                                                                                                                                            |
| B2  | Parent SDK stream is not a safe child-transcript source                        | Step 6 phase 3 | Child `message_delta` usage deliberately dropped (`ClaudeAdapter.ts:2111`); deltas not separated by child identity (`:2128`); assistant messages appended to the parent turn without checking `parent_tool_use_id` (`:2517`); `forwardSubagentText` not enabled (`sdk.d.ts:1597`). |
| B3  | ClaudeAdapter drops the data the Step 7 handshake needs                        | Step 7         | Forwarded tool-use blocks ignored except `ExitPlanMode` (`:2567-2593`); tool results whose id is absent from `inFlightTools` are skipped (`:2380-2385`).                                                                                                                           |
| B4  | Workflow-agent IDs are synthetic `<task>:wf:<index>` (`ClaudeAdapter.ts:2824`) | Step 6 phase 4 | Cannot be used with `getSubagentMessages` at all. Workflow children get no transcript until real child IDs are retained.                                                                                                                                                           |

### C. Leads that could remove a blocker

| #   | Lead                                                                                                                                                                     | Would unblock                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | SDK docs say sub-agent `tool_use`/`tool_result` blocks ARE forwarded with `parent_tool_use_id` set even when text forwarding is off (`sdk.d.ts:1598-1601`, `:4130-4135`) | B1 — shell parentage may be recoverable from the **tool-use stream** instead of `task_started`. _Unverified_: all existing adapter tests use `parent_tool_use_id: null`. Cheap probe, high payoff. |

### D. Data-coverage gaps (the demo shows these; reality does not)

| #   | Gap                                                                            | Fix                                                                   |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| D1  | `agentType` **and** `model` absent on Codex sub-agents (`CodexAdapter.ts:526`) | Step 8.1 — highest value, two blank badges on every Codex row         |
| D2  | `model` absent on ordinary Claude sub-agents (only workflow children set it)   | Step 8.2                                                              |
| D3  | Phase tags exist only inside workflow groups                                   | Step 8.3 — depends on D1 if driven off `agentType`                    |
| D4  | No scope signal (`frontend`) anywhere in the pipeline                          | Step 8.4 — **needs inventing**, not plumbing. Decide before building. |
| D5  | `waiting` status has no emitter outside tests                                  | Step 8.5 — amber state is dead code                                   |

### E. Correctness & semantic risks

| #   | Risk                                                                         | Mitigation                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `delegateProvider` is name-matching (`agentType` exact + `codex:` namespace) | A custom agent shelling to Codex without the namespace goes undetected. Child-shell evidence (Step 5 layer 3) is the only real proof, and it depends on B1/C1.                      |
| E2  | `delegateProvider` decorates the 30s wrapper                                 | Icon is right; status, elapsed and tokens describe the wrapper until Step 7 lands. Do not ship the icon as "which model is working" without saying this.                            |
| E3  | Multiple companion jobs share one host Claude session ID                     | Wrapper→job correlation is ambiguous. **Decline to attach rather than update the wrong row.**                                                                                       |
| E4  | Authoritative handoff race                                                   | Once a job owns a row, the wrapper's `task.completed` must be suppressed, usage reset, true start time set, activation count preserved. Rated **Large** — the main cost of Step 7.  |
| E5  | `outputFile` is populated but is NOT the transcript                          | It points at `%TEMP%/.../tasks/<agentId>.output`. Do not build drill-in on it, despite the "reserved for transcript drill-in" comment at `threadAgents.ts:122`.                     |
| E6  | `task_started.task_id == ` SDK `agentId`                                     | Observed locally, **undocumented**. Probe before Step 6 phase 1 relies on it.                                                                                                       |
| E7  | Restart / process lifetime                                                   | Unclear whether a v3code restart triggers a graceful Claude SessionEnd (which may kill the job) or leaves it orphaned. PID liveness and PID reuse need Windows-specific validation. |

### F. Verification debt

| #   | Item                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Nothing shipped tonight has been verified in the installed app.** 66 focused tests + a clean web typecheck is all the evidence there is.                                                                  |
| F2  | `scripts/v3-sidebar-demo.mjs` exercises no delegated row, no `shell` kind, and therefore never renders `BACKGROUND TASKS` or the `· N shells` chip. It will keep passing while never touching the new code. |
| F3  | No repository test exercises a real nested rescue Bash result — all ClaudeAdapter fixtures use `parent_tool_use_id: null`.                                                                                  |

---

## Verified against real session artifacts (2026-07-27)

Scanned this repo's own Claude Code session transcript. Results:

### E6 RESOLVED — sub-agent transcript correlation is real

`~/.claude/projects/<dir>/<sessionId>/subagents/` contains, per sub-agent:

```
agent-<agentId>.jsonl        ← the transcript
agent-<agentId>.meta.json    ← {"agentType","description","toolUseId","spawnDepth"}
```

`<agentId>` matches the id the Agent tool returns, exactly. `meta.json.toolUseId` is the spawning
Task tool call id. This is the Step 6 phase-1 correlation key, now verified with real files rather
than inferred. `agentType` and `spawnDepth` come free.

### C1 remains UNRESOLVED — and cannot be settled from disk

`parent_tool_use_id` is **absent** from every persisted sub-agent record. This is NOT evidence
against C1: the on-disk format stores each sub-agent in its own file with linkage in `meta.json`, so
the field would be redundant there. v3code consumes the **live SDK stream**, not these files. The
two formats are different and disk absence says nothing about stream presence.

Type-level evidence still favours C1: `SDKAssistantMessage.parent_tool_use_id` is a **required**
field (`sdk.d.ts:2692`) and `forwardSubagentText` docs state sub-agent `tool_use`/`tool_result`
blocks are emitted by default (`sdk.d.ts:1597-1601`). Types prove the field exists; they do not
prove it is populated for a nested Bash call.

**The only way to settle it:** temporary instrumentation in `ClaudeAdapter`'s assistant-message
handler logging `parent_tool_use_id` + `tool_use` block names, then a live session where a sub-agent
launches a background Bash. Requires launching the app — see AGENTS.md; needs explicit user
authorisation.

Also noted: `SDKAssistantMessage` carries `subagent_type` ("Subagent type that produced this
message") — potentially relevant to gap D1.

---

## Step 8.3 REVISED — live derived phase tags (supersedes the `agentType → phase` idea)

The earlier proposal (static `agentType → phase` lookup) is **withdrawn**. It labels what an agent
_is_, permanently. Better: label what it is _doing right now_, updating as it works.

### Prior art: the companion already does this

`scripts/lib/codex.mjs:244-296` derives a phase + human message from Codex app-server item events:

| Phase           | Trigger                                                               | Message shape                                                               |
| --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `investigating` | tool call, web search, MCP call                                       | `Searching: <query>` · `Calling <server>/<tool>.` · `Running tool: <tool>.` |
| `editing`       | file changes applied                                                  | `Applying N file change(s).`                                                |
| `verifying`     | command matching `looksLikeVerificationCommand` (`codex.mjs:248,278`) | command summary                                                             |
| `running`       | any other command                                                     | command summary                                                             |
| `reviewing`     | reviewer started (`:244`)                                             | `Reviewer started: <review>`                                                |
| `finalizing`    | final answer / reviewer finished (`:296,440,455`)                     | —                                                                           |

Plus lifecycle `starting` and terminal `done`. Legacy fallback at `job-control.mjs:179`.

### Why this is cheap for native Codex agents

Those phases derive from `item/started` / `item/completed` — **the same events `CodexAdapter`
already consumes** (`CodexAdapter.ts:510-544,697-703`). It currently flattens them into one-line
summaries and discards the structure. Re-deriving the phase is a pure mapping function over data
already flowing. No companion dependency, no correlation, no Step 7.

### Claude sub-agents

`lastToolName` is already on the snapshot. Map similarly: `Read`/`Grep`/`Glob` → investigating,
`Edit`/`Write` → editing, `Bash` w/ verification-looking command → verifying, `Task` → delegating.

### Rendering

`phaseTitle` is already optional on every snapshot and `PhaseHeader` (`AgentsPanel.tsx:197`) already
renders phase state with colour. For non-workflow agents render the derived phase as a small tag on
the card rather than a section header — the workflow phase headers are structural, this is per-agent
and changes constantly.

### Cost split

| Scope                                   | Difficulty                                        | Blocked by                 |
| --------------------------------------- | ------------------------------------------------- | -------------------------- |
| Native in-session Codex sub-agents      | **Small** — mapping function over existing events | nothing                    |
| Claude sub-agents (from `lastToolName`) | **Small**                                         | nothing                    |
| Detached codex-rescue jobs              | **Large**                                         | Step 7 correlation (E3/E4) |

Do the first two first. They deliver the "what is it doing right now" answer for every in-session
agent without touching the hard detached-job problem at all.

---

## Step 7-LITE — uncorrelated Codex job visibility (DO THIS FIRST)

**Motivation:** the user is blind to detached rescue jobs and must ask the assistant what is
happening. Full Step 7 is Large, but _all_ of that cost is in correlation. Visibility does not
require correlation.

**Verified:** a single `codex-companion.mjs status --json` call returns, per running job:

```json
{
  "id": "task-…",
  "status": "running",
  "phase": "verifying",
  "elapsed": "7m 38s",
  "progressPreview": ["Running command: …", "Command completed: … (exit 0)"]
}
```

That is a complete card's worth of data — status, live phase, elapsed, recent activity — with no
log parsing.

**Design.** A server-side poller emits synthetic roster rows (`provider: "codex"`, `kind: "other"`,
no `parentAgentId`) mapped straight onto existing snapshot fields:

| Job field           | Snapshot field                                               |
| ------------------- | ------------------------------------------------------------ |
| `id`                | `agentId`                                                    |
| `status`            | `status` (`running` → running; terminal → completed/failed)  |
| `phase`             | `phaseTitle` (renders as the live tag from Step 8.3-revised) |
| `elapsed`           | derive `firstStartedAt`                                      |
| `progressPreview[]` | `recentActivity[]` + newest as `currentActivity`             |

They land in their own section because they have no parent. All existing rendering — status dot,
elapsed timer, activity line, expandable feed — works unchanged.

**What this deliberately avoids**

| Avoided                           | Because                                               |
| --------------------------------- | ----------------------------------------------------- |
| E3 correlation ambiguity          | no wrapper↔job mapping is attempted                   |
| E4 authoritative-handoff race     | job rows are separate; the wrapper card is left alone |
| B3 ClaudeAdapter tool-use capture | not needed                                            |
| C1 / B1                           | irrelevant to this path                               |

**Accepted cost:** a rescue produces two rows — the wrapper card (green, 30s) and the job row (live).
Slightly redundant, but honest and vastly better than blindness. Correlating them later (full Step 7)
becomes a pure refinement rather than a prerequisite.

**Remaining risks:** A3 (no versioned companion schema — degrade gracefully, treat every field as
optional) and A4 (locating the companion script / state root — shell out to the CLI rather than
reading state files directly).

**Difficulty: Small–Medium.** Poller + field mapping. No adapter changes, no contract changes.

---

## Step 9 — surface tool & command failures on the card

**Why:** "this agent is still running but three of its commands failed" is the single most useful
signal an engineer can get from a roster. Today a card shows tokens and a tool count; a failing
agent and a healthy one look identical until the whole thing goes red at the end.

**The data already exists on all three paths:**

| Path                    | Source                                                                                                    | Notes                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Detached Codex jobs     | `progressPreview[]` already contains `Command failed: … (exit 124)`                                       | **Free with Step 7-lite** — no extra work, just don't discard the outcome when mapping |
| Claude sub-agents       | `ClaudeAdapter.ts:1172-1217` already extracts every `tool_result`'s tool-use id, text, **and error flag** | Flag is read but not propagated to the roster                                          |
| Native Codex sub-agents | `item/completed` carries status; `CodexAdapter.ts:510-544` already consumes it                            | Currently flattened to a one-line summary, status dropped                              |

**Contract.** `ThreadAgentActivityEntry` is `{ at, summary }`
(`packages/contracts/src/threadAgents.ts:68`). Add one optional field:

```ts
outcome: Schema.optional(Schema.Literals(["ok", "error"])),
```

Optional → backward compatible, same pattern as `delegateProvider`. Optionally also a rolled-up
`errorCount` on the snapshot so the card can show a badge without expanding.

**Render.**

- Failed entries in the expandable activity feed (`AgentsPanel.tsx:181`) in `text-destructive-foreground`.
- A small red `N failed` chip in the meta row when `errorCount > 0` **and the agent is still running**
  — that is the case currently invisible. A finished-and-failed agent already turns the card red.
- Do NOT change the status dot: a running agent with failed commands is still `running`. Failures are
  a health signal, not a status.

**Difficulty: Small.** One optional contract field, three small propagation changes, one render
change. The error data is already being read on every path and thrown away.

---

## ROADMAP — priority order

Reordered after observing that the user was repeatedly blind to what agents were doing. Earlier
ordering led with cosmetics; this leads with visibility.

| #   | Item                                                                              | Size | Status       | Blocked by                 |
| --- | --------------------------------------------------------------------------------- | ---- | ------------ | -------------------------- |
| 1   | **Step 7-lite** — uncorrelated Codex job rows (status/phase/elapsed/activity)     | S–M  | designed     | nothing                    |
| 2   | **Step 9** — surface tool & command failures                                      | S    | designed     | nothing (free-ish with #1) |
| 3   | **Step 8.3-revised** — live derived phase tags for in-session agents              | S    | designed     | nothing                    |
| 4   | **Step 8.1/8.2** — populate `agentType` + `model` for Codex and Claude sub-agents | S    | designed     | nothing                    |
| 5   | **Step 6 phase 1** — transcript side chat, Claude sub-agents                      | M    | designed     | E6 now resolved            |
| 6   | **Step 7 full** — wrapper↔job correlation, authoritative handoff                  | L    | designed     | E3, E4, B3                 |
| 7   | **C1/B1** — revive shell nesting via tool-use stream                              | S–M  | in progress  | needs live probe           |
| 8   | **Step 8.4** — scope badge (`frontend`)                                           | ?    | not designed | no signal exists (D4)      |

**Already shipped** (tests pass; _not_ verified in the installed app — F1):
Steps 2, 3, 4, 5 — `delegateProvider` + resolver, kind-based grouping, provider icons,
`SUB-AGENTS` / `BACKGROUND TASKS` sections.

**Dead code today:** Step 1 shell nesting (B1) — shipped but can never trigger until #7 lands.

---

## KEY REFRAME (2026-07-27) — this is a data-supply problem, not a UI problem

**Observed:** with Codex as the main provider, its sub-agent cards already show live climbing token
counts, per-item activity (`Reasoning`, `File change`, `Assistant message`, full command strings),
`run N` counters, and an expandable timestamped feed. The target UI is not aspirational — **it already
ships and already works.**

**Why Claude sub-agents look poorer — same code, different upstream granularity.**
`ProviderRuntimeIngestion.ts:184-194` appends a timestamped `recentActivity` entry every time
`summary` OR `lastToolName` changes. Identical for both providers. The comment at `:189` explicitly
names Codex as the source of full command/item text.

| Provider | Upstream emission                                                                                          | Result                            |
| -------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Codex    | app-server emits a **separate item event** per reasoning block / command / file change / assistant message | rich timestamped timeline         |
| Claude   | `task_progress` emits a **coarse periodic summary** (one line, replaced)                                   | few distinct entries, sparse feed |

**Implication for the roadmap:** stop building panel UI. The panel is fine. The work is making the
Claude path emit at Codex's granularity.

**Most plausible lever:** `forwardSubagentText` (`sdk.d.ts:1597`) forwards sub-agent text and thinking
blocks as messages with `parent_tool_use_id` set. v3code does not enable it — `ClaudeAdapter.ts:3769`
sets only `includePartialMessages`. Enabling it would plausibly deliver:

- item-level activity for Claude sub-agents (parity with Codex), AND
- the `parent_tool_use_id` stream that lead C1 needs to revive shell nesting (B1), AND
- a live child transcript source for Step 6 phase 3 (currently blocked by B2).

**One option flag, three blockers.** Probe this before spending effort on anything else.
Caveat: enabling it increases stream volume — check the cost of forwarding full sub-agent
conversations before turning it on unconditionally; it may need to be opt-in or filtered.
