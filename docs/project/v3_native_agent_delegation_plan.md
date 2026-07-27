# V3 native agent delegation plan

Status: research and implementation plan  
Last updated: 2026-07-27  
Scope: read-only investigation of V3, Codex, ChatGPT plugin/MCP, Claude Agent SDK, Claude CLI, and
the installed OpenAI Codex plugin for Claude Code

## Executive summary

V3 can support provider-neutral native agent delegation. A Codex, Claude, or supported ChatGPT
host should be able to ask V3 to start a Codex or Claude worker, see that worker in the Agents
panel, follow its progress, steer it, stop it, and receive its result.

The important architectural boundary is:

- A **plugin or skill** gives the host model the delegation workflow and tools.
- The **V3 server** owns delegated-job identity, lifecycle, supervision, permissions, persistence,
  and provider sessions.
- The existing **provider-runtime task events and `agent.snapshot` roster** drive the Agents panel.

A plugin alone cannot make an arbitrary `claude -p` or `codex exec` subprocess appear as a real
V3 sub-agent. V3 must either own that process or adopt it through a structured bridge, then emit
the lifecycle events the sidebar already understands.

The recommended shape is:

```text
Codex / Claude / supported ChatGPT surface
                    |
           V3 delegation MCP tools
       delegate / status / send / stop / result
                    |
       NativeAgentDelegationService (server)
          /                          \
 Codex delegated runner       Claude delegated runner
          \                          /
       provider-runtime task.* lifecycle
                    |
        ThreadAgentSnapshot / agent.snapshot
                    |
               Agents panel
```

This should be implemented as a V3 server capability first and packaged as a Codex/ChatGPT plugin
second. `/codex:rescue` can remain as a compatibility command while being changed to call the
native service.

## Questions answered

### Can Codex spawn agents that V3 displays?

Yes. Native Codex collaboration events are already translated by V3 into provider-runtime task
events and then into the thread-agent roster. These are genuine child agents with stable
identities, follow-up activations, and sidebar cards.

### Can Claude spawn agents that V3 displays?

Yes. V3's Claude adapter already consumes Claude Agent SDK `task_started` and `task_progress`
messages. It also enables forwarded sub-agent text, allowing child activity to be represented in
the parent session and Agents panel.

### Can a raw `claude -p` command become a sidebar sub-agent?

Not automatically. To V3, an unwrapped command is a shell or command item, not a provider child
agent. V3 can make it a first-class delegated agent only by supervising the process, parsing
structured stream events, assigning a stable delegation identity, and publishing normalized task
events.

When the CLI must be used, the relevant Claude flags are:

```powershell
claude -p "<prompt>" --output-format stream-json --verbose --forward-subagent-text
```

That is a viable fallback bridge, but the Claude Agent SDK is a better native backend because it
provides structured sub-agent lifecycle data directly.

### Can a V3 plugin allow ChatGPT to delegate agents?

Yes, on ChatGPT/Codex surfaces that can install the plugin and reach its MCP tools. OpenAI plugins
can package skills and MCP-backed tools, so a V3 plugin can teach the host when to delegate and
expose the delegation API.

The ChatGPT web product cannot directly run a user's local `claude.exe`. Web use requires a
reachable, authenticated remote MCP endpoint or a secure V3 gateway. Local Codex/desktop-style
surfaces can connect to V3 locally.

### Can V3 incorporate the OpenAI Codex plugin for Claude Code?

Yes, but V3 should port its useful behaviors instead of embedding the Claude-specific plugin
unchanged. The inspected plugin is Apache-2.0 licensed; an adaptation should retain the applicable
license and NOTICE material and identify modifications.

The useful pieces are:

- detached job supervision;
- stable job IDs and a workspace-scoped registry;
- progress and result retrieval;
- Codex session correlation;
- final-result delivery to the parent;
- compatibility with the `/codex:rescue` workflow.

The Claude plugin's command frontmatter, agent definitions, installation layout, and launch-text
correlation are host-specific and should not become V3's core API.

## Current V3 architecture

### Canonical lifecycle

Provider adapters emit these normalized provider-runtime event types:

- `task.started`
- `task.progress`
- `task.updated`
- `task.completed`

`ProviderRuntimeIngestion` reduces those events into `ThreadAgentSnapshot` entries. It appends the
complete latest-wins roster as an `agent.snapshot` thread activity. The client runtime derives the
Agents panel state from the latest valid snapshot.

Relevant code:

- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/threadAgents.ts`
- `packages/client-runtime/src/state/threadAgents.ts`
- `apps/web/src/components/AgentsPanel.tsx`

`ThreadAgentSnapshot` already includes most fields native delegation needs:

- stable `agentId`;
- emitting `provider` and actual `delegateProvider`;
- `parentAgentId`;
- agent kind, type, model, and name;
- pending, running, waiting, idle, completed, failed, and stopped states;
- activation count for resumable workers;
- current activity and recent activity history;
- token/tool usage;
- start, activity, and end timestamps;
- result and error summaries;
- reserved approval and transcript/output fields.

This means the first implementation should reuse the existing lifecycle and roster rather than
inventing a second sidebar protocol.

### Native Codex sub-agents

Codex app-server child-thread notifications are converted to synthetic collaboration activity and
then normalized into `task.*` events. A Codex child thread can be reactivated with a follow-up,
which is why the roster distinguishes a durable idle agent from a terminal completed process.

This is the highest-fidelity path for Codex work because V3 receives structured identity and
lifecycle information instead of inferring it from console text.

### Native Claude sub-agents

`ClaudeAdapter` maps Claude Agent SDK task lifecycle messages into V3 task events. Forwarded
sub-agent text is enabled so nested work can be surfaced. Claude task identities are normally
one-shot, unlike resumable Codex child threads.

The SDK also exposes a structured `getSubagentMessages(parentSessionId, agentId, options)` path for
retrieving a child transcript. That is preferable to scraping Claude's local JSONL files.

### `/codex:rescue`

The current rescue integration crosses three layers:

1. A Claude command invokes the `codex:codex-rescue` agent.
2. The rescue agent is a thin forwarder that starts a detached
   `codex-companion.mjs` job and then settles.
3. V3 detects the companion launch, correlates it through `parent_tool_use_id`, tails the detached
   job, re-pins the forwarder's card as running, replays progress onto that card, and injects the
   final output back into the parent thread with an `[automated]` prefix.

Relevant V3 files:

- `apps/server/src/provider/codexCompanionJobs.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/ClaudeDeveloperInstructions.ts`

This proves the desired cross-provider UX is possible, but it is a specialized bridge. It depends
on recognizing a companion launch and adapting a detached job back onto the Claude task card.
Native delegation should replace this with an explicit server API and structured job registration.

Operational details for the current companion registry, progress log, Codex JSONL transcript, and
Claude sub-agent transcript are documented in
`docs/project/ideal-agents-sidebar.md`.

### Existing MCP seam

V3 already provides an authenticated, thread-aware `t3-code` MCP server:

- `apps/server/src/mcp/McpHttpServer.ts`
- `apps/server/src/mcp/McpProviderSession.ts`
- `apps/server/src/mcp/toolkits/`

Both Codex and Claude sessions can be connected to this MCP server. The current preview toolkit
demonstrates the intended pattern: contracts define tool inputs, handlers use invocation context
to resolve the authenticated thread/session, and an MCP registration layer exposes the tools.

Native delegation should be added as another toolkit on this server. This avoids teaching each
provider a private V3 RPC protocol and gives Codex, Claude, and plugin-enabled ChatGPT surfaces the
same API.

## Proposed architecture

### 1. `NativeAgentDelegationService`

Add a server-owned service responsible for:

- validating the authenticated parent thread and environment;
- resolving the requested provider instance;
- starting the delegated provider runner;
- assigning a stable delegation ID;
- correlating provider-native child/session/job IDs;
- emitting normalized task lifecycle events;
- accepting follow-ups and stop requests;
- handling approvals and user-input waits;
- persisting recoverable state;
- retrieving progress, transcript, usage, and final result;
- delivering the terminal result to the parent thread exactly once.

The service should not contain Codex- or Claude-specific parsing. It should depend on delegated
runner implementations behind a small provider-neutral interface.

Illustrative interface:

```ts
interface NativeAgentRunner {
  launch(request: RunnerLaunchRequest): Effect<RunnerHandle, RunnerLaunchError>;
  send(handle: RunnerHandle, message: string): Effect<void, RunnerSendError>;
  stop(handle: RunnerHandle): Effect<void, RunnerStopError>;
  inspect(handle: RunnerHandle): Effect<RunnerSnapshot, RunnerInspectError>;
  transcript(handle: RunnerHandle, cursor?: string): Stream<RunnerTranscriptItem>;
  events(handle: RunnerHandle): Stream<RunnerEvent>;
}
```

The actual implementation should follow existing Effect service/layer conventions.

### 2. Delegation contract

The initial request should include:

```ts
interface DelegateAgentRequest {
  providerInstanceId: ProviderInstanceId;
  prompt: string;
  name?: string;
  agentType?: string;
  model?: string;
  reasoningEffort?: string;
  workingDirectory?: string;
  mode?: "oneShot" | "resumable";
  resultDelivery?: "return" | "inject";
}
```

The parent thread, environment, caller provider, and authorization scope must come from the MCP
invocation context. The model should not be allowed to provide arbitrary thread or environment IDs
in the tool request.

The response should be compact and stable:

```ts
interface DelegateAgentResponse {
  delegationId: string;
  agentId: string;
  status: "pending" | "running";
  delegateProvider: ProviderDriverKind;
}
```

Use `delegationId` as V3's durable control-plane identity. Preserve provider-native identifiers
separately:

```text
delegationId
  -> parent thread ID
  -> emitting provider/provider instance
  -> delegated provider/provider instance
  -> provider-native session, child thread, task, or process ID
  -> current activation/run ID
```

Do not derive one namespace from another or assume provider IDs cannot collide.

### 3. MCP toolkit

Recommended first tool set:

| Tool               | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `delegate_agent`   | Start a worker in the caller's authenticated thread and environment      |
| `agent_status`     | Return normalized state, latest activity, usage, and result availability |
| `agent_send`       | Send a follow-up to a resumable or waiting worker                        |
| `agent_stop`       | Request cancellation and settle the worker as stopped                    |
| `agent_result`     | Retrieve a completed result without duplicating parent-thread delivery   |
| `agent_transcript` | Page through provider-exposed transcript items                           |

`agent_status`, `agent_send`, `agent_stop`, `agent_result`, and `agent_transcript` must verify that
the requested delegation belongs to the authenticated thread or another explicitly authorized
scope.

The tools should return structured MCP content plus a short text summary. Results should never
include hidden chain-of-thought. Only provider-exposed reasoning summaries, messages, tool
activity, and outputs may be returned.

### 4. Lifecycle normalization

Every runner event should map into the existing task lifecycle:

| Runner event                          | Provider-runtime event                    | Roster effect                                         |
| ------------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| launch accepted                       | `task.started`                            | pending or running card appears                       |
| provider session ready                | `task.updated`                            | provider/model/native IDs available                   |
| message or tool activity              | `task.progress`                           | activity, tool count, usage, timestamp update         |
| approval/input required               | `task.updated`                            | status becomes waiting and approval link is populated |
| follow-up begins                      | `task.started` or reactivation update     | activation count increments; status running           |
| follow-up ends but agent is resumable | `task.completed` with resumable semantics | status idle                                           |
| final success                         | `task.completed`                          | completed, result summary, end timestamp              |
| provider failure                      | `task.completed`                          | failed with sanitized error                           |
| stop acknowledged                     | `task.completed`                          | stopped                                               |

The exact event payload convention for resumable completion should follow existing Codex child
thread behavior instead of adding a parallel convention.

For a cross-provider delegation:

- `provider` identifies the host adapter or V3 delegation emitter;
- `delegateProvider` identifies the provider actually doing the work;
- `parentAgentId` links nested delegation where a parent agent is known;
- `agentType` describes the provider definition/role, not an inferred codebase scope.

### 5. Parent result delivery

Support two explicit modes:

- `return`: the calling agent waits for the tool result. Suitable only for short work.
- `inject`: the launch returns immediately and V3 inserts a terminal result into the parent thread
  when the delegated job finishes.

Background delegation should default to `inject`. Delivery must be idempotent:

```text
job terminal
  -> persist terminal state and result
  -> atomically claim delivery
  -> append one structured parent-thread input
  -> mark delivered
```

The current `[automated]` result prefix can remain during migration, but a typed internal turn-input
source is preferable so the UI and providers do not depend on parsing a textual marker.

### 6. Provider runners

#### Codex runner

Prefer the existing Codex app-server and V3 provider/session infrastructure over starting a second
independent Codex CLI broker.

The runner should:

- create or attach a linked delegated Codex session;
- retain the Codex child/session ID;
- consume structured app-server notifications;
- support follow-up turns for resumable workers;
- forward approvals through V3;
- expose provider-visible summaries, messages, tools, usage, and results;
- stop through the provider protocol before falling back to process termination.

There is an implementation choice to validate during the spike:

1. create a V3-managed linked child provider session; or
2. ask an existing Codex parent session to spawn a native collaboration child and adopt it.

The first gives V3 a uniform cross-provider control plane. The second preserves the fullest native
Codex collaboration semantics. Both should normalize to the same delegation record and task
lifecycle.

#### Claude runner

Prefer the Claude Agent SDK through V3's existing adapter infrastructure.

The runner should:

- start a linked Claude task/session;
- consume SDK task lifecycle and streamed messages;
- enable forwarded sub-agent text where needed;
- retrieve child transcripts through the SDK;
- normalize Claude approval and user-input waits;
- distinguish one-shot tasks from sessions that can accept a follow-up.

#### Claude CLI fallback

Use `claude -p` only where the SDK cannot support the required mode or as a compatibility bridge.
The fallback must:

- request streaming JSON and verbose output;
- enable forwarded sub-agent text;
- parse complete JSON records, never terminal formatting;
- retain `parent_tool_use_id` and native task/session IDs;
- drain stdout and stderr without deadlocking;
- support graceful stop before forceful process termination;
- treat malformed or truncated output as a runner failure, not valid completion.

Claude's `--bg` managed background sessions are a different mode and are incompatible with `-p`.
Do not combine them.

### 7. Plugin and skill packaging

Build a V3 plugin with:

```text
v3-native-delegation/
  .codex-plugin/
    plugin.json
  skills/
    delegate-agent/
      SKILL.md
    rescue/
      SKILL.md
  README.md
```

The plugin should contain workflow guidance, not the job supervisor itself. Its skills should teach
the host to:

- delegate only bounded, independently useful work;
- select a provider intentionally;
- pass working-directory and model constraints;
- check status without polling excessively;
- steer an existing resumable worker instead of spawning duplicates;
- stop a worker when its result is no longer needed;
- distinguish the forwarder's completion from the delegated job's completion;
- report only after the real delegated job settles.

The MCP implementation should remain in V3 so all host plugins share one source of truth.

For ChatGPT web support, provide a separately designed remote deployment path with strong
authentication and an explicit connection to a user's V3 environment. Do not expose an
unauthenticated local delegation endpoint through a generic tunnel.

## Incorporating the Codex plugin for Claude Code

### What to reuse

- job state model and terminal-state handling;
- workspace-scoped job registry concepts;
- Codex session capture;
- progress-log and structured-result concepts;
- detached execution lessons;
- parent-result delivery behavior;
- rescue prompt/agent workflow where it remains useful.

### What to replace

- `.claude-plugin` packaging as the canonical distribution format;
- Claude command and Agent frontmatter as the service boundary;
- inference from shell command strings or launch messages;
- plugin-cache/data directories as V3's authoritative database;
- a second Codex app-server/session manager when V3 already owns one;
- textual `[automated]` parsing as the long-term result-delivery protocol;
- a forwarder card whose lifecycle has to be artificially re-pinned.

### Compatibility path

Keep `/codex:rescue` available for Claude Code users:

1. The command calls V3's `delegate_agent` tool with `delegateProvider: codex`.
2. V3 immediately creates the real delegated Codex card.
3. The command returns the delegation ID and explains that completion will arrive asynchronously.
4. V3 streams progress to the card and delivers the final result.
5. The old companion bridge remains available behind a feature flag until the native path is
   proven.

Repository convention requires rescue invocations to explicitly use:

```text
--model gpt-5.6-sol --effort high
```

The native request should preserve those explicit values for the compatibility skill.

## Sidebar behavior

No new top-level sidebar state model should be required for the MVP.

A delegated card should show:

- the actual delegated provider icon via `delegateProvider`;
- stable name and role;
- model when known;
- running, waiting, idle, completed, failed, or stopped status;
- current activity and recent activity;
- elapsed time for the current activation;
- cumulative token/tool usage;
- activation count for resumable workers;
- result or error summary;
- transcript/detail affordance when available.

The provider host and delegated provider are separate dimensions. A Claude-hosted Codex worker
should have `provider: "claudeAgent"` only if the Claude adapter emitted the event and
`delegateProvider: "codex"` for the actual worker. A V3-owned provider-neutral emitter may instead
use a dedicated internal source while still setting the delegated provider. Decide this before
persisting records because it affects identity and filtering.

Do not infer that a process is an agent merely because its command contains `claude`, `codex`, or a
known script name. Agent identity must come from explicit delegation registration or a
provider-native child event.

## Persistence and recovery

The delegation registry should survive server restarts. Persist at least:

- delegation ID;
- parent thread and environment IDs;
- host and delegated provider instance IDs;
- provider-native IDs;
- working directory;
- requested model/effort/mode;
- lifecycle status and timestamps;
- current activation;
- result location or compact result;
- result-delivery state;
- transcript cursor/location where appropriate;
- stop request state;
- sanitized terminal error.

On startup:

1. Load nonterminal delegations.
2. Ask the provider runner whether each native session/job still exists.
3. Reattach to live jobs where supported.
4. Mark irrecoverable jobs failed with a clear restart/recovery reason.
5. Rebuild or republish the thread-agent snapshot.
6. Deliver any terminal result that was persisted but not yet delivered.

Never mark a detached job completed merely because its launch wrapper exited.

## Permissions and security

Native delegation expands the ability of one model session to consume compute and operate in a
workspace. The service must preserve V3's existing approval and sandbox boundaries.

Required safeguards:

- derive thread/environment identity from authenticated invocation context;
- authorize every control operation against the delegation's owner;
- constrain working directories to the current environment/workspace unless the user approves an
  expansion;
- validate provider/model/effort against configured provider instances;
- cap concurrent workers per thread and environment;
- prevent recursive delegation storms with depth and fan-out limits;
- propagate approval requests to the user instead of silently broadening permissions;
- redact secrets from summaries, logs, and errors;
- never expose hidden chain-of-thought;
- retain auditable launch, steer, stop, and result-delivery records;
- make stop idempotent;
- ensure a delegated agent cannot steer or stop an unrelated thread's workers;
- require authenticated remote MCP transport for ChatGPT web access.

Suggested initial limits:

- maximum delegation depth: 2;
- maximum active delegated workers per parent: 4;
- maximum active delegated workers per environment: configurable;
- explicit user confirmation for provider changes that create materially different cost or data
  boundaries.

These numbers are starting points and should be validated against existing Codex collaboration
limits and product UX.

## Implementation phases

### Phase 0: architecture spike

Goal: prove both provider backends can be controlled through one server-owned identity.

Tasks:

- trace the exact ProviderService/session APIs needed to create linked delegated sessions;
- prove a Codex delegated session can launch, stream, stop, and accept a follow-up;
- prove a Claude delegated session can launch, stream, stop, and expose its transcript;
- decide linked V3 child session versus adopted native Codex collaboration child;
- define the minimum runner event union;
- confirm how approvals can be correlated with a delegated card;
- confirm restart/reconnect capabilities for each provider.

Exit criteria:

- one Codex and one Claude proof-of-concept runner produce the same in-memory event sequence;
- no CLI output heuristics are required on the preferred paths;
- provider limitations are documented before contracts are frozen.

### Phase 1: local native delegation MVP

Goal: start, display, inspect, stop, and receive the result of a delegated Codex or Claude worker.

Tasks:

- add contracts for delegation requests, responses, state, errors, and runner events;
- implement `NativeAgentDelegationService`;
- implement Codex and Claude runners;
- register `delegate_agent`, `agent_status`, `agent_stop`, and `agent_result` on the V3 MCP server;
- map runner events to the existing `task.*` lifecycle;
- populate `delegateProvider`, model, role, activity, usage, and terminal summaries;
- deliver terminal results to the parent exactly once;
- add focused server, contract, client-state, and sidebar tests.

Exit criteria:

- a Codex parent can launch Codex and Claude workers;
- a Claude parent can launch Codex and Claude workers;
- all four combinations create truthful sidebar cards;
- stop produces a terminal stopped state;
- wrapper exit cannot falsely complete a running job;
- final result delivery occurs once.

### Phase 2: steering, waiting, transcripts, and recovery

Goal: make delegated agents operationally complete rather than fire-and-forget jobs.

Tasks:

- add `agent_send` and `agent_transcript`;
- support Codex reactivation/follow-up;
- surface approval and user-input waits;
- wire approval deep links;
- add persistent registry and startup recovery;
- page provider-exposed transcripts;
- report accurate cumulative usage across activations;
- add cancellation escalation and orphan cleanup.

Exit criteria:

- resumable agents can be steered without creating duplicate cards;
- waiting state is reachable and actionable;
- server restart either reattaches or fails a job explicitly;
- transcript view contains provider-exposed child messages and tool activity;
- no reasoning content beyond provider-exposed summaries is rendered.

### Phase 3: plugin and rescue migration

Goal: offer the workflow naturally from Codex, Claude Code, and supported ChatGPT surfaces.

Tasks:

- create the V3 Codex/ChatGPT plugin;
- create delegation and rescue skills;
- adapt the Claude `/codex:rescue` command to call native tools;
- retain the old companion path behind a temporary compatibility flag;
- add capability detection and a useful fallback message;
- carry forward Apache-2.0 attribution required by reused plugin material;
- document install, connection, and troubleshooting flows.

Exit criteria:

- the same V3 delegation is available from Codex and Claude without host-specific server logic;
- rescue launches a real delegated Codex card directly;
- plugin/skill completion is never reported as delegated-job completion;
- legacy companion mode can be disabled without losing native functionality.

### Phase 4: remote ChatGPT access

Goal: permit an authenticated ChatGPT surface to delegate into a user's V3 environment.

Tasks:

- choose the remote MCP/gateway topology;
- implement user/environment authentication and revocation;
- bind each remote request to an explicit V3 environment;
- design offline behavior and job notifications;
- add rate, cost, and concurrency controls;
- threat-model local workspace exposure and remote command execution;
- run a security review before enabling the feature by default.

Exit criteria:

- ChatGPT cannot access arbitrary local executables or workspaces;
- every delegation is attributable to a user, thread, and environment;
- connections can be revoked;
- remote loss does not orphan jobs silently;
- security review findings are resolved.

## Focused verification plan

Follow repository guidance: use focused tests for changed files/packages and leave the full suite to
CI.

### Contract tests

- valid and invalid delegation requests;
- open provider-driver kinds and provider-instance IDs round-trip;
- status and terminal error unions;
- tolerant decoding of newer optional fields.

### Service tests

- authorization is inferred from invocation context;
- launch creates one delegation and one `task.started`;
- progress is ordered and stale updates cannot overwrite newer state;
- launch failure settles as failed;
- stop is idempotent;
- completion and result delivery are exactly once;
- wrapper completion does not settle a detached job;
- reactivation increments activation count without changing agent identity;
- recursive depth and fan-out limits are enforced;
- restart recovery reattaches or fails explicitly.

### Provider runner tests

- Codex event normalization;
- Claude SDK event normalization;
- provider cancellation;
- approval/waiting transitions;
- transcript pagination;
- CLI fallback handles partial records, malformed JSON, stderr pressure, and forced stop.

### Ingestion/client tests

- delegated provider icon uses `delegateProvider`;
- cross-provider identity does not collide;
- pending/running/waiting/idle/terminal transitions;
- recent activity and usage rollups;
- parent-child grouping;
- result/error summaries;
- older clients tolerate new optional fields.

### Manual verification

After focused automated checks, ask the user to verify these flows in the installed app:

1. Codex delegates to Codex.
2. Codex delegates to Claude.
3. Claude delegates to Codex.
4. Claude delegates to Claude.
5. A worker waits for approval.
6. A resumable worker receives a follow-up.
7. A running worker is stopped.
8. V3 restarts while a worker is running.
9. A terminal result is delivered exactly once.
10. A card opens the correct provider-exposed transcript.

Do not start the app or a development server as part of routine automated verification.

## Decisions to make before implementation

1. **Codex child strategy:** V3-managed linked provider session or adopted native collaboration
   child?
2. **Emitter identity:** should server-owned cross-provider tasks use the parent provider as
   `provider`, or should contracts gain a provider-neutral host/source field?
3. **Result delivery:** extend the internal turn-input contract now, or temporarily retain the
   `[automated]` prefix?
4. **Persistence:** reuse an existing V3 database table/event store or add a dedicated delegation
   registry?
5. **Approval ownership:** does the parent thread own delegated approvals, or does each delegated
   session have a linked approval channel?
6. **Plugin distribution:** bundle only skills against V3's MCP server, or also ship connection
   configuration?
7. **Remote topology:** direct authenticated V3 MCP, relay, or user-operated secure tunnel?
8. **Generic runners:** should arbitrary command-backed agents ever be first-class, or should the
   first release support only structured provider adapters?

Recommended defaults:

- use structured Codex and Claude runners only for the first release;
- infer ownership exclusively from MCP invocation context;
- reuse `task.*` and `agent.snapshot`;
- use a dedicated durable `delegationId`;
- support asynchronous result injection by default;
- keep `/codex:rescue` as a compatibility surface;
- defer remote ChatGPT access until the local control plane is proven and security-reviewed.

## Non-goals for the first release

- treating every background shell as an agent;
- scraping hidden reasoning or decrypting provider reasoning payloads;
- arbitrary cross-workspace delegation;
- unauthenticated remote access;
- replacing the existing Agents panel state model;
- supporting every provider driver immediately;
- inferring agents by executable or command-name regex;
- guaranteeing resumability for providers that expose only one-shot jobs.

## Risks

| Risk                                          | Mitigation                                                      |
| --------------------------------------------- | --------------------------------------------------------------- |
| Duplicate provider/session managers           | Reuse V3 adapters and app-server ownership                      |
| Plugin completion mistaken for job completion | Track the real delegation and settle from runner state only     |
| Recursive agent explosion                     | Depth, fan-out, concurrency, and budget limits                  |
| Orphaned jobs after restart                   | Durable registry and provider reattachment                      |
| Incorrect cross-provider branding             | Populate `delegateProvider` explicitly                          |
| Result delivered twice                        | Persist and atomically claim delivery                           |
| Unauthorized steering/stopping                | Bind every operation to authenticated thread/environment        |
| CLI output changes                            | Prefer SDK/protocol events; isolate CLI fallback parser         |
| Transcript leaks hidden reasoning             | Render only provider-exposed summaries/messages/tools           |
| ChatGPT web exposes local machine             | Require an authenticated, scoped remote gateway                 |
| Vendor/plugin drift                           | Port the behavior behind V3 interfaces and preserve attribution |

## Source inventory

### Repository sources

- `AGENTS.md` — repository rules and current rescue conventions
- `docs/project/ideal-agents-sidebar.md` — existing agent-card design, job inspection, and transcript
  sources
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts` — Codex app-server session runtime and
  collaboration notifications
- `apps/server/src/provider/Layers/CodexAdapter.ts` — Codex provider-runtime normalization
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — Claude Agent SDK lifecycle mapping,
  forwarded child text, and companion integration
- `apps/server/src/provider/codexCompanionJobs.ts` — detached companion discovery, status, progress,
  and result watching
- `apps/server/src/provider/ClaudeDeveloperInstructions.ts` — shipped automated-result contract
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — task lifecycle to agent roster
- `apps/server/src/mcp/McpHttpServer.ts` — V3 MCP server and toolkit registration
- `apps/server/src/mcp/McpProviderSession.ts` — authenticated provider-session binding
- `packages/contracts/src/providerRuntime.ts` — normalized provider-runtime events
- `packages/contracts/src/threadAgents.ts` — agent snapshot contract
- `packages/client-runtime/src/state/threadAgents.ts` — latest snapshot and panel-state derivation
- `apps/web/src/components/AgentsPanel.tsx` — Agents panel rendering

### Inspected installed plugin

- `C:\Users\vasus\.claude\plugins\marketplaces\openai-codex`
- `.claude-plugin/plugin.json`
- `package.json`
- `LICENSE`
- `NOTICE`
- `scripts/codex-companion.mjs`

This installed copy was inspected as implementation and licensing reference. It must not become a
runtime dependency by absolute path.

### External documentation

- OpenAI plugins overview: <https://developers.openai.com/plugins>
- OpenAI plugin construction: <https://developers.openai.com/plugins/build/plugins>
- OpenAI Codex subagents: <https://learn.chatgpt.com/docs/agent-configuration/subagents>
- Claude Code CLI usage: <https://code.claude.com/docs/en/cli-usage>
- Claude Code Agent view/background sessions: <https://code.claude.com/docs/en/agent-view>
- Claude Agent SDK subagents: <https://code.claude.com/docs/en/agent-sdk/subagents>

## Recommended next action

Start with Phase 0 as a short, read-only-plus-prototype design spike. The most consequential choice
is how a server-owned delegated Codex worker relates to Codex's native collaboration child threads.
Resolve that before adding public MCP contracts. Once the runner boundary is proven for both Codex
and Claude, the MVP can reuse the existing task lifecycle, agent roster, and sidebar with relatively
little UI work.
