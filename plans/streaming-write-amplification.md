# Streaming write amplification

## Problem

With token streaming enabled, every assistant text delta crosses the full command, event-store,
projection, receipt, and websocket path. Static inspection shows avoidable work inside that path.

## Evidence already established

- `ProviderRuntimeIngestion.ts` dispatches one `thread.message.assistant.delta` command per provider
  assistant-text delta when streaming is enabled.
- The decider converts every delta to a streaming `thread.message-sent` event.
- `OrchestrationEngine.ts` persists and projects every event transactionally.
- `ProjectionPipeline.ts` handles every streaming message by loading and rewriting the accumulated
  message text.
- The thread projector also runs `refreshThreadShellSummary` for every `thread.message-sent`; that
  reloads all messages, plans, activities, and approvals even though assistant text deltas do not
  change those summary fields.
- A final non-streaming assistant completion event is emitted, so summary refresh can occur at the
  semantic boundary instead of on every text fragment.
- Assistant streaming defaults to off. This benchmark and fix apply to the opt-in streaming path;
  buffered mode is the control rather than evidence of default-install overhead.

## Benchmark gate

For identical synthetic streams at 100, 1,000, and 5,000 deltas, record:

- elapsed time and backend CPU;
- SQLite writes/bytes;
- orchestration events and websocket messages;
- final projected text and shell summary.

Repeat with streaming disabled to establish the lower bound.

## Candidate changes, in order

1. Skip the full shell-summary refresh for assistant events where `streaming === true`; keep it for
   user messages and assistant completion. Keep the lightweight `updatedAt` upsert.
2. If measurement still shows material per-delta overhead, coalesce adjacent assistant deltas over a
   short bounded window before dispatch while flushing synchronously at approval/input/completion
   boundaries.
3. Do not redesign projection consistency or remove event history without separate evidence.

## Verification

- Focused projector tests proving streaming deltas preserve existing shell summary fields and final
  completion refreshes them.
- Provider-ingestion tests for ordering, pause/resume, completion, interruption, and empty final
  delta.
- Benchmark output proves identical final text and fewer reads/writes.
