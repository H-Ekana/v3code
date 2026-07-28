# Diagnosis — why the interaction/motion polish work was invisible

Salvaged from a 12-agent read-only diagnosis run (`wf_ae2c3275-7c1`) that was stopped early to
conserve usage. **11 of 12 area agents completed**; 6 adversarial verifiers completed. Results were
recovered from the run journal, not re-derived.

Missing coverage, honestly flagged:

- **`timeline-ledger`** (user item 1, the user-message arrival) — did not finish. This is the only
  real gap.
- **`stylesheet-delivery`** — did not finish, but was answered incidentally and thoroughly by the
  global-gating agent (see §1).

---

## 0. Headline: there is no single systemic cause. My reduced-motion theory was wrong.

I proposed that `prefers-reduced-motion: reduce` was on and had killed everything at once. **That was
refuted with hard evidence**, and it is worth recording _how_, because the refutation is stronger than
the hypothesis was.

Every reduced-motion block in this effort was deliberately written to leave a **static artifact** in
place of each animation. So if `reduce` were on, the user would still have seen:

- a permanent violet 42%-opacity ring around every arriving user bubble (`conversation.css:241-244`);
- a static violet bar beside streaming messages (`conversation.css:246-249`, `opacity: 0.92`);
- a solid violet disc on running tool rows (`conversation.css:256-259`);
- a static violet ring around running agent marks (`agents-threads.css:300-303`, `opacity: 0.55`);
- a static ring inside the stop button (`composer-controls.css:255-259`, `opacity: 0.85`);
- and a `conversation-reduced-settle` entry in the DevTools Animations panel.

The user reported the absence of all of them. And decisively, under `reduce` the settle ring's
pseudo-element does not exist at all (`agents-threads.css:307`, `content: none`) and the pink row edge
is not painted — yet **those are the two things the user could see**. The hypothesis predicts the
opposite of the observation.

Also ruled out, each with evidence: stale build/dev server (the untracked `special-states.css` is
being served, and the pre-work ultrathink was a _border_, not the _fill_ in the screenshot); any
app-level motion preference (none exists — one `usePrefersReducedMotion` hook, two consumers, gates
nothing global); `motion-safe:` gating (zero occurrences); the `.no-transitions` theme kill switch
(added and removed within one rAF, and its stranding would have killed the settle ring too); startup
splash residue (attribute goes to `complete`, which no CSS matches; the one dangerous `fill: forwards`
WAAPI target is explicitly cancelled). Cascade order is fine and every motion token resolves.

---

## 1. What actually went wrong: one _mistake_, made independently ~6 times

Not one switch — one **class of error**, repeated across unrelated surfaces by different agents:

> **The element that is supposed to animate is unmounted, remounted, or re-keyed in the very commit
> that would have played the animation.**

React deletes the outgoing subtree in the same commit, so there is nothing left to run the animation
on. Confirmed instances:

| Surface                     | Mechanism                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Agents panel (item 5)       | The card is unmounted into the default-collapsed "Finished" group in the same commit that would play its completion/settle accent           |
| Terminal drawer (items 8/9) | The parent drops the drawer from `mountedTerminalThreadKeys` in the same effect flush that starts the 200ms `exiting` phase                 |
| Files/diffs (item 10)       | Every "crossfade" is a `key` remount + an enter-only animation — the outgoing content is deleted in the same commit, so there is no overlap |
| Settle ack (item 4)         | The acknowledged element is destroyed and recreated as the ring starts; auto-animate then holds the new row at opacity 0 for ~134ms         |
| Right panel (item 7)        | The active-surface selector nulls out the instant `isOpen` flips false, so the empty state renders for the whole 200ms exit                 |
| Command palette (item 6)    | The dialog returns `null` the instant `open` flips false, so the close animation never runs                                                 |

**Second repeated class — one-shots keyed on an identity that changes at the moment of the
transition.** The tool-completion flash keys on a work-log entry id that is _replaced_ exactly when
the tool completes, so `completingToolIds` is always empty.

**Third — micro amplitude on macro surfaces.** 4px / 140ms is a micro-interaction budget; applied to a
whole panel state handoff it reads as a pop, not a fade. `ease-out-quart` at 140ms is ~87% complete
after three frames.

**Why every test passed:** the suites are `renderToStaticMarkup` assertions on class names and
attributes. That shape can verify a string is present in one render. It structurally cannot catch a
dead click handler, an element deleted before its animation runs, or a one-shot that never arms.

---

## 2. Confirmed root causes, by item

### Item 7 — tabs unclickable · **CONFIRMED by a verifier that tried and failed to refute it**

Agent H moved tab activation from a `<button>` onto a `<div role="tab">`. The tab strip carries
`.drag-region` in Electron (`RightPanelTabs.tsx:310, :522`), which sets `-webkit-app-region: drag` —
Chromium routes pointer events there to the **window manager, not the DOM**. The only escape hatch is
`index.css:1564-1569`, which exempts exactly five tag names: `button, input, textarea, select, a`.

The old tab was a `<button>` and was exempt. The new `<div>` is not. The whole tab became window
titlebar chrome. The ✕ still works **because it is still a `<button>`** — which is exactly the symptom
reported.

**Fix:** add `[-webkit-app-region:no-drag]` to the tab's className (the utility is already used at
`PanelLayoutControls.tsx`), or make the tab a `<button>` again.

### Item 7 — empty-state flash · **CONFIRMED, unrefuted**

`rightPanelStore.ts:498-503` retains `surfaces`/`activeSurfaceId` on close, but the selector at
`:564-571` gates on `isOpen` and throws the retained surface away instantly. Fix: select on shell
_presence_, not `isOpen`.

### Item 11 — ultrathink flood · resolves the discrepancy

Agent J's report was half right: the rainbow _was_ deleted and the build _is_ current. J's error was
assuming `p-px` clips a frame background to a ring. It does not — `.ultrathink-frame` sets
`background-image` on the composer's `p-px` frame, and **nothing in the subtree is opaque**
(`ChatComposer.tsx:2742-2752` has no background), so the rim gradient floods the entire composer.

That is why the screenshot shows a fill. The user likes it, so this becomes a feature — but record
that the composer frame is a **full-bleed tint layer, not a clipping gradient border**, because any
future accent on that element will do the same thing.

**Contrast (11a):** every bottom-row control is bound to `text-muted-foreground/70-80` and nothing is
ultrathink-aware. Fixable in pure CSS in `special-states.css` — no props to thread.

**Auto's resting state (11a.3):** the motion work promoted Auto from muted to `text-foreground/95` at
`ChatComposer.tsx:327`. Deleting that one term restores exactly what the user asked for; the star icon
colour is already independent and stays purple.

### Item 4 — settle acknowledgment · four confirmed defects

1. **Ring travel:** `@property --settle-ack-angle` _is_ correctly registered and does ship — that
   theory is disproved. The real cause is that `thread-settle-ack-travel` hits `360deg` at its **72%
   keyframe** while running on `--ease-out-quint`, which is ~90% complete by t=0.3. The entire sweep
   is spent in the first ~60-70ms of 280ms; the remaining 79% is a stationary arc. Fix: put the
   rotation on `linear` across the full 0→100%.
2. **Left edge only:** the only pink layer is literally `inset 2px 0 0 0 var(--astro-highlight)` — a
   left-edge bar by construction. The all-round layer is violet at 18%. Fix: a contained ring
   (`inset 0 0 0 1px` + a soft inset glow).
3. **No FLIP:** the code deliberately unmounts the card and mounts a different element in the settled
   shelf. Relocation is a disappear/reappear plus a ~46px neighbour jump.
4. **Ring invisible from the context menu:** on the card variant the ring's host wrapper is
   `opacity-0` unless hovered or focus-within.

### Item 2 — streaming/tools · two confirmed root causes

1. **The live-response edge is clipped to zero visible pixels** — it is painted into a negative gutter
   outside a pre-existing `overflow-x-clip` ancestor. It renders; it simply cannot be seen.
2. **The tool-completion flash never arms** — keyed on a work-log entry id replaced at completion.
   `WorkLogEntry` already carries a stable `toolCallId`; use it.
3. On Codex specifically, no work-log entry can carry `toolLifecycleStatus: "inProgress"`
   (`session-logic.ts:634` discards `tool.started`), so `data-tool-status` is never `running` and the
   orbit never mounts.
4. Note: `data-live-response-edge` and `data-tool-status` are **inert** — no CSS selects on them —
   yet they are what the tests assert. The tests were checking a string with no styling behind it.

### Item 3 — stop button · confirmed

**At rest the stop button is pixel-identical to HEAD.** Every new pixel is gated behind
`interruptState !== "idle"`, which only exists between the click and the turn settling. The user was
asking for a running-turn ring; that must key on `isRunning`, not on `interruptState === "pending"`.

Also: the press ring is bound to `:active`, so it is cancelled at pointerup and can never coexist with
the pending state. And the "unwired second `<MessagesTimeline>` call site" theory is **false** — there
is one call site and it is wired. Correcting the review doc.

### Item 10 — files/diffs · confirmed

The Files tab has **no loading→content state change at all** — `browserState` is `"tree"` from the
first render, so the keyed container never re-mounts when the index arrives. And the deferred-skeleton
delay is _exactly equal_ to the animation duration (140ms == 140ms), so every loading enter animation
plays over an empty container.

### Items 8/9 — terminal drawer · confirmed

Exit animation destroyed by unmount (above). The clean-close acknowledgment is wired only to the two
sidebar close controls, so **with one terminal open — the normal case — it is not on any code path the
user can take**. And its gate (`status === "exited"`) is unreachable anyway, because `TerminalViewport`
auto-closes the tab the moment the session ends.

### Item 6 — command palette · both root-cause claims REFUTED by verifiers

Worth stating plainly: the palette **already animates on open** (200ms scale 0.98→1 + opacity), via
pre-existing Base UI dialog chrome. The verifiers found that the "no row entrance" behaviour is _the
spec_, not a defect (plan item 14 enumerates the palette's motion deliberately). What the user is
reacting to is that the container moves as one block and the rows have no individual arrival.

This is genuinely a design decision, not a bug fix, and needs the user's call.

---

## 3. What this changes about the plan

- **Phase 0 collapses.** There is no systemic switch to flip. Nothing here is "turn the amplitude up";
  most items are structural.
- **A new Wave 1 item appears and is arguably the most important thing in the whole effort:** a shared
  way to animate an element _out_ before it unmounts, and to keep an element alive across a
  relocation. Six separate bugs are the same missing primitive. Fixing them one at a time re-invents
  it six times.
- **The test strategy must change.** Every interaction item needs a client-render test that dispatches
  a real event and asserts the resulting DOM — not an SSR string match. The agents panel agent put it
  bluntly: no test in the suite ever asserts that an accent class reaches a rendered card, which is
  precisely why everything passed while nothing painted.
- **Two "fixes" are one-line deletions** (Auto's colour; the ring's timing function), and two are
  one-line additions (`no-drag` on the tab; selector on presence). Those are worth doing first purely
  to get visible progress on the board.
