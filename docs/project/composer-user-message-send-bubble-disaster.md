# The Composer User-Message Send-Bubble Disaster

**Incident report — the send-morph animation and its lag. 2026-07-28.**

The goal, in the user's words: "I want the iMessage send to morph into a user bubble thing" —
the just-sent text visibly lifts out of the composer and becomes the user bubble in the
timeline. The _design_ was approved early ("I see the vision"); the _implementation_ fought us
through five architectures, one failed optimization campaign, one stalled AI investigation, and
one accidental mid-experiment commit. This file records all of it so the next attempt starts
from evidence instead of hope.

Current state (as of commit `157082137`): the **Architecture 5 flyer ships and works
functionally**, with its original look and timing, but the send still stutters — the underlying
main-thread stall is diagnosed (see §4) and **unfixed**. The user's ruling: "it still lags a
bit but works a bit better I guess — we'll circle back to this idea."

---

## 1. The five architectures

### Arch 1 — WAAPI on the arriving bubble

Animate the real timeline bubble from the composer's rect to its own (FLIP-style). Died
quickly: the bubble mounts inside a virtualized list (`@legendapp/list`) mid-commit; by the
time it exists to animate, the send jank is already over, and animating it fought the list's
own layout/scroll work.

### Arch 2 — the composer ghost

A cloned "fake double" of the composer that slides over, shrinks, and becomes the message.
User verdict: works but "very choppy"; later "super duper ultra laggy… a black box." Cloning
the composer subtree (Lexical editor + footer + pickers + send button) put hundreds of nodes
on one composited layer; the send button visibly flew along with the ghost.

### Arch 3 — View Transitions API + optimistic bubble

`document.startViewTransition` pairing the composer text with the optimistic bubble.
Structural failure with a virtualized list: the new-side pairing is not guaranteed to exist
inside the `flushSync` snapshot window, so the API degraded to an exit-only animation plus a
one-frame jump. The double full-page snapshot + forced `flushSync` also added its own lag.
Two real defects were caught in audit before it died: the root suppression targeted
`::view-transition-group(root)` (a no-op — old/new(root) was needed) and the rules leaked
globally instead of being scoped behind an html flag.

### Arch 4 — clone-flight (WAAPI clone of the composer)

`cloneNode(true)` of the composer flown to the bubble. Video-confirmed laggy, same
hundreds-of-nodes problem as Arch 2.

### Arch 5 — the hand-built text flyer (SHIPPED)

`sendMorphTransition.ts`: build ONE `<div>` carrying only the sent text (~11 computed styles
copied from the editor — never a subtree clone), append to `<body>`, and drive it with a
`requestAnimationFrame` loop that **live-retargets** every frame toward the arriving bubble's
current rect (`lerp(start, bubbleRect, easeOutQuint(t))`), so mid-flight timeline shifts bend
the flight to the true landing spot. Phases: `seeking` (poll for
`[data-user-turn-arrival="true"]`, frame-counted cap) → `flying` (700ms, crossfade over the
final 40%) → `fallback` (dissolve in place if the bubble never lands). Optimistic messages are
keyed on the outgoing message id and reconciled by `mergeOptimisticUserMessages`
(reference-preserving dedupe against the server echo). A singleton `retireSendMorph()` handles
second sends / thread switches / unmounts. 19 unit tests cover the mechanism.

The user accepted the _design_ of this one: "the text box going into the chat is definitely
way better now. I like the animation but it is still very laggy."

---

## 2. The measurement that defined the problem

A 60fps NVIDIA capture of one send (1.73s, 103 frames) was frame-diffed with ffmpeg:
**7 distinct frames in the composer region — ~4 effective fps.** The page freezes for
200–400ms stretches between paints. A transform/opacity-only animation cannot cause that;
the main thread is blocked. The flyer was the victim, not the culprit.

## 3. The Codex investigation (and its own mini-disaster)

A Codex rescue task (gpt-5.6-sol, high effort) was dispatched to root-cause the lag. It ran
productively for ~100 seconds, was then aborted by a turn interruption, and sat as a zombie
"running" job for ~55 minutes (log silent the whole time) before being cancelled. Its
reasoning was stored encrypted — unrecoverable — but an Opus salvage agent recovered its two
plain-text findings and completed the trace it never finished:

- **Confirmed:** the flyer is compositor-clean (`contain: layout paint style`,
  `will-change: transform, opacity`, transform/opacity-only writes, exactly one
  `getBoundingClientRect` per frame).
- **Confirmed, root cause:** the send commit — `setOptimisticUserMessages` (full ChatView
  re-render → timeline derivation → LegendList remeasure), the Lexical composer clear, cursor
  reset, and follow-end scroll positioning — is queued **ahead of the flyer's first animation
  frame**. ChatView's render was previously measured at ~500ms. The flyer spends the stall
  frozen over the composer polling for a bubble that cannot exist until the commit renders,
  then teleports. Freeze-then-jump, exactly matching the video.

## 4. The failed optimization campaign

Three fixes were implemented on top of the diagnosis (both send paths):

1. `startTransition` around the optimistic state update — make the mount render
   interruptibly so flyer frames interleave.
2. `deferSendCleanup` — double-rAF deferral of the Lexical clear + cursor reset (invisible
   behind the flyer) off the send-critical frames.
3. Wall-clock landing poll (1500ms) instead of the 10-frame cap, so the later bubble mount
   could not trip the fallback dissolve. (This surfaced a genuine sentinel bug — rAF
   timestamps can legitimately be 0 — caught by the test suite.)

**Result: "Epic fail. Doesn't work."** The likely reason, worth engraving: React's concurrent
rendering yields **between component units**. ChatView is a ~5,700-line monolithic component;
its single render call is one indivisible unit of work. `startTransition` had no boundary to
yield at, so the ~500ms block ran unbroken exactly as before, and the deferred Lexical clear
moved only a minority of the cost. Scheduling cannot fix what granularity forbids.

An earlier micro-fix from the same campaign — stripping the flyer's `backdrop-filter`
(a moving backdrop-blur re-samples the backdrop every frame) — was visually noticeable but did
not move the fundamental stall either; it was reverted with the rest to restore the original
glass look.

## 5. The revert, and the git accident

All three files were reverted to the pre-experiment state by reverse-editing (the tree was
uncommitted). Complication: mid-session, a _different_ agent committed the overhaul history,
and its commit `0b519f43a` happened to snapshot `ChatView.tsx` / `sendMorphTransition.ts` at
the exact moment they contained the failed experiment — so for a few commits, history and the
running app disagreed. Commit `157082137` reconciles them: synchronous commit, frame-counted
poll, glass flyer. The first revert pass also missed the flyer CSS (the backdrop-filter
removal) — caught only when the user compared against the old look. Lesson: a "revert" of
uncommitted work needs a file-by-file sweep of _everything_ the campaign touched, not just the
files in the final diff.

## 6. Where the next attempt should start

Ranked, per the verified diagnosis:

1. **Measure first.** Longtask/PerformanceObserver + bubble-mount-latency probes were built
   and installed in the dev preview when the revert order came; recreate them and profile one
   real send before writing any fix. Decide from data whether the ~500ms is dominated by
   ChatView's render, LegendList remeasure, forced reflow, or Lexical teardown.
2. **Make the commit cheap, not rescheduled.** Memoize the timeline row derivation and row
   components so an optimistic append renders one new row instead of re-deriving the world;
   `mergeOptimisticUserMessages` already preserves referential identity for this purpose.
   Longer-term: split ChatView so concurrent rendering has boundaries to yield between —
   that also unlocks the `startTransition` approach that failed against the monolith.
3. **Predicted-landing flight with a late commit.** Invert the ordering: fly immediately
   toward a _predicted_ landing rect (bottom of the timeline), run the heavy commit at
   ~60% of the flight, and let live-retargeting absorb the prediction error once the real
   bubble mounts. The stall then lands while the flyer is nearly parked, where a freeze is
   imperceptible.
4. Do **not** re-litigate: subtree clones (Arch 2/4), the View Transitions API against a
   virtualized list (Arch 3), or blaming the flyer's paint path (twice-confirmed clean).
