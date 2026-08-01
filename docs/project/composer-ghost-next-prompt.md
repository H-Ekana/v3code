# Composer ghost next-prompt (Claude Code–style suggestions)

Handoff / design note for the **ghost next-prompt** feature: after a turn finishes, a dim suggested follow-up can appear in the empty composer; **Tab** accepts it into the real draft.

Related product inspiration: Claude Code “prompt suggestions” (grayed-out next user line; Tab to accept). We deliberately **do not** auto-send on Enter when only a ghost is shown.

---

## User-visible behavior

| Moment                                                              | Behavior                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Turn is **running**                                                 | No ghost; any existing suggestion is cleared                                       |
| Turn **settles** (phase leaves `running`) and composer is **empty** | Client calls server to generate a short next-user-line suggestion                  |
| Suggestion ready                                                    | Shown as **gray ghost text** over the empty editor, with a small “Tab to use” hint |
| **Tab** (empty draft, no slash/path menu)                           | Ghost becomes real prompt text; cursor at end; user can edit then send             |
| **Enter**                                                           | Only sends real draft text — never treats ghost as submitted content               |
| User **types**, switches **thread/draft**, or starts a **new turn** | Ghost clears                                                                       |
| Generation fails / model returns nothing useful                     | Silent: no ghost (no toast, no error UI)                                           |

### What it is not

- Not IDE path autocomplete (also sometimes Tab elsewhere)
- Not slash commands / skills (`/` menus still win Tab when open)
- Not “replay last sent message”
- Not pair-wrap or list auto-continue (separate composer features)

---

## Why this model setting

Generation reuses **`textGenerationModelSelection`** from server settings — the same picker used for **commit messages** and other short non-agent text jobs.

Rationale:

- Short output, runs **after** the main agent turn
- Should be cheap/fast; should not burn the primary coding model
- One setting for “side” LLM work; credentials/provider wiring already exist

If that model is unset or generation fails, the feature fails closed (no suggestion).

---

## Architecture

```text
Turn settles (client: phase running → not running)
    → ChatComposer: if draft empty, call RPC thread.suggestNextPrompt { threadId }
    → Server: load thread messages + textGenerationModelSelection
    → TextGeneration.generatePromptSuggestion (per-provider adapter)
    → Sanitize model output
    → { suggestion: string | null, generationId }
    → Client: if still empty, show ghost overlay (not in draft value)
Tab → set draft = suggestion, clear ghost
```

### Delivery model

**Client-initiated RPC** after the local session phase settles — not an event-sourced orchestration event and not a push stream.

- Avoids new projection/event types for ephemeral UI
- Only spends a generation when the user is on a thread that just went idle with an empty composer
- Remote clients work the same path (RPC to that environment)

### Key components

| Layer                 | Role                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| Contracts             | `SuggestNextPromptInput` / `Result` / error; `WS_METHODS.threadSuggestNextPrompt` |
| Server TextGeneration | New op `generatePromptSuggestion` on all provider text-gen adapters               |
| Server handler        | `suggestNextPrompt` — load thread, format context, call TextGeneration            |
| WS / auth             | RPC registered on `WsRpcGroup`; scope `AuthOrchestrationReadScope`                |
| Client runtime        | `createPromptSuggestionEnvironmentAtoms` → RPC command                            |
| Web ChatComposer      | Phase edge detection, ghost state, Tab accept                                     |
| ComposerPromptEditor  | `ghostSuggestion` prop → Lexical empty-state overlay (not `value`)                |

---

## Contracts

**File:** `packages/contracts/src/promptSuggestion.ts`

- `SuggestNextPromptInput`: `{ threadId }`
- `SuggestNextPromptResult`: `{ suggestion: string | null, generationId: string }`
- `SuggestNextPromptError`: soft failure message for load errors

**RPC:** `thread.suggestNextPrompt` (`WS_METHODS.threadSuggestNextPrompt`)

Registered in `packages/contracts/src/rpc.ts` on `WsRpcGroup`.  
Authorized in `apps/server/src/auth/RpcAuthorization.ts` as **orchestration read**.

---

## Server: generation

### TextGeneration API

**File:** `apps/server/src/textGeneration/TextGeneration.ts`

```ts
generatePromptSuggestion(input: {
  cwd: string;
  conversation: string; // recent USER/ASSISTANT turns as plain text
  modelSelection: ModelSelection; // textGenerationModelSelection
}): Effect< { suggestion: string | null }, TextGenerationError >
```

Implemented on every text-gen backend (same structured-JSON pattern as thread titles / commits):

- `ClaudeTextGeneration.ts`
- `CodexTextGeneration.ts`
- `CursorTextGeneration.ts`
- `GrokTextGeneration.ts`
- `OpenCodeTextGeneration.ts`

### Prompt builder

**File:** `apps/server/src/textGeneration/TextGenerationPrompts.ts`  
**Function:** `buildPromptSuggestionPrompt`

Full prompt text sent to the model:

```text
You suggest the next user message in a coding agent chat.
Return a JSON object with key: suggestion.
The suggestion must be exactly what the USER would type next into the composer — not what the assistant would say.

Rules:
- suggestion is either a short next user prompt (2-12 words) OR an empty string "" when nothing is obvious
- Prefer silence (empty string) over a weak or generic guess
- Match the user's tone and level of directness
- Be specific to this conversation (not generic advice)
- Continue an obvious workflow when clear (tests, commit, continue, implement plan, fix remaining issue)
- If the assistant asked a yes/no or whether to continue, suggest the natural short reply (e.g. yes, continue)
- If the user already stated what they will do next, suggest that next request
- Never use assistant voice (no "I'll", "Let me", "I can", "Here's")
- Never end with a question mark
- Never use markdown, bullets, quotes wrapping the whole suggestion, or multiple sentences
- Never suggest thanks, praise, or evaluative filler (looks good, great, perfect)
- Never invent unrelated new work the user did not imply

Examples of good suggestions:
- run the tests
- commit this
- add unit tests for the login form
- yes
- continue
- implement the plan

Recent conversation (oldest first):
…truncated conversation context…
```

Output schema: JSON `{ "suggestion": string }`.

### Sanitizer

**File:** `apps/server/src/textGeneration/TextGenerationUtils.ts`  
**Function:** `sanitizePromptSuggestion(raw): string | null`

Rejects / normalizes so bad model output never becomes ghost text:

- Empty, multi-line, markdown, questions
- Assistant voice prefixes (`I'll`, `Let me`, …)
- Filler (`thanks`, `looks good`, …)
- Meta “no suggestion” phrases
- Too long (>80 chars) or too many words (>12)
- Single-word only allowed for a small set: `yes`, `no`, `continue`, `commit`, `ship`, `retry`
- Strip wrapping quotes; drop trailing period

Returns `null` → client shows nothing.

### RPC handler

**File:** `apps/server/src/promptSuggestion/suggestNextPrompt.ts`

Steps:

1. Load thread detail via `ProjectionSnapshotQuery.getThreadDetailById`
2. If missing / session `status === "running"` / no conversation text → `{ suggestion: null, generationId }`
3. Format last ~12 user/assistant messages (cap ~12k chars)
4. Resolve workspace cwd via `resolveThreadWorkspaceCwd`
5. Read `textGenerationModelSelection` from settings; if incomplete → null
6. Call `generatePromptSuggestion`; catch failures → null
7. Return sanitized suggestion + random `generationId`

Wired in `apps/server/src/ws.ts` as `WS_METHODS.threadSuggestNextPrompt`.

---

## Client: when to request + show

### Trigger

**File:** `apps/web/src/components/chat/ChatComposer.tsx`

- Track previous `phase` vs current
- When `previousPhase === "running"` and `phase !== "running"`:
  - Skip if no `activeThreadId` / `environmentId`
  - Skip if draft non-empty
  - Skip if approval UI is active
  - Call `promptSuggestionEnvironment.suggestNextPrompt`
- On success: if draft still empty, set `ghostSuggestion`
- On `phase === "running"`: clear ghost
- On thread/draft change: clear ghost
- On prompt change with non-empty text: clear ghost

### Tab accept

In `onComposerCommandKey`:

1. Shift+Tab → existing interaction-mode toggle
2. Open command/path menu → existing menu Tab
3. Else if Tab + ghost + empty prompt → accept into draft (`setPrompt`), focus end
4. Enter submit path unchanged (real draft only)

### Ghost rendering

**File:** `apps/web/src/components/ComposerPromptEditor.tsx`

- Prop: `ghostSuggestion?: string | null`
- When editor empty (and no terminal/large-paste chips), if ghost is set, Lexical **placeholder** slot shows muted ghost + “Tab to use”
- Ghost is **not** written into controlled `value` until accept (critical so send/undo/stash stay correct)

### Client runtime

- `packages/client-runtime/src/state/promptSuggestion.ts` — `createEnvironmentRpcCommand` for the RPC
- `apps/web/src/state/promptSuggestion.ts` — web wiring via `connectionAtomRuntime`
- Export path: `@t3tools/client-runtime/state/promptSuggestion` in `packages/client-runtime/package.json`

---

## Key files (checklist)

| Path                                                      | Change               |
| --------------------------------------------------------- | -------------------- |
| `packages/contracts/src/promptSuggestion.ts`              | Schemas              |
| `packages/contracts/src/rpc.ts`                           | Method + Rpc + group |
| `packages/contracts/src/index.ts`                         | Export               |
| `apps/server/src/auth/RpcAuthorization.ts`                | Scope                |
| `apps/server/src/textGeneration/TextGeneration.ts`        | Service API          |
| `apps/server/src/textGeneration/TextGenerationPrompts.ts` | Prompt               |
| `apps/server/src/textGeneration/TextGenerationUtils.ts`   | Sanitizer            |
| `apps/server/src/textGeneration/*TextGeneration.ts`       | All providers        |
| `apps/server/src/promptSuggestion/suggestNextPrompt.ts`   | Handler              |
| `apps/server/src/ws.ts`                                   | RPC mount            |
| `packages/client-runtime/src/state/promptSuggestion.ts`   | Client command       |
| `apps/web/src/state/promptSuggestion.ts`                  | Web atom             |
| `apps/web/src/components/chat/ChatComposer.tsx`           | Fetch + Tab          |
| `apps/web/src/components/ComposerPromptEditor.tsx`        | Ghost UI             |

Tests touched/added around prompts/sanitizer, text-generation stubs, reactor harness stubs, composer editor tests (list continuation still separate).

---

## Product research notes (Claude Code)

Closed-source; behavior reconstructed from product reports and open reimplementations (e.g. Pi “prompt suggestions”):

1. **Trigger:** agent/turn end
2. **Generate:** separate short completion predicting the **next user message**, not the assistant’s next thought
3. **Display:** ghost overlay, not draft value
4. **Accept:** Tab materializes; typing dismisses
5. Claude Code sometimes also accepts+runs on Enter — **we intentionally do not**, because Enter already means “send” on desktop and mis-sends are costly

---

## How to verify (manual)

1. Ensure Settings → text generation / commit model is configured
2. In a real thread, send a turn and wait until the session is idle
3. Leave the composer empty
4. Expect a dim suggestion (only if the model returns something that passes the sanitizer)
5. **Tab** → text becomes real; edit if needed; **Enter** to send
6. Confirm bare **Enter** with only a ghost (never accepted) does not send that ghost
7. Confirm typing clears the ghost; starting another run clears it

---

## Follow-ups (not in v1)

- Server push of suggestions (event/stream) for multi-surface without client phase watching
- Heuristics before the model call (`yes` / `run the tests` when obvious) to save latency
- Explicit user setting to disable ghost suggestions
- Mobile: Tab is awkward — would want a “Use suggestion” chip instead
- Mobile RN composer not wired

---

## Design constraints honored

- Complexity at the text-gen / adapter boundary; orchestration stays free of suggestion events
- Fail closed; never block stop / send / approvals
- Ghost ≠ draft value
- Tab priority: menus and Shift+Tab interaction mode beat accept
- Reuse existing text-generation model setting rather than a second picker
