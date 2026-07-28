# Send-Morph Research: making the composer become the user bubble

Research spike for the "message send morph" — the composer (or a double) visually
detaches, slides, shrinks, and _becomes_ the sent user-message bubble (iMessage-grade,
~0.5–0.8s, "feels like one object"). Two prior attempts shipped and were rejected
("black box", "three disjoint steps", "super duper ultra laggy"). This document ranks
the viable rebuilds against our actual stack and constraints.

Environment recap (load-bearing):

- **Electron / Chromium only** → `document.startViewTransition` **is** available; no
  cross-browser fallback burden.
- Timeline is **virtualized** (`@legendapp/list`) in
  `apps/web/src/components/chat/MessagesTimeline.tsx`; the user bubble is
  `UserTimelineRow` → `bubbleRef` (`.rounded-2xl.bg-accent`, translucent).
- Composer is a **Lexical** editor in `ChatComposer.tsx`; its visible surface is a
  translucent gradient card — refs `composerFrameRef` (outer `rounded-[22px]` gradient
  hairline) and `composerSurfaceRef` (inner `rounded-[20px]`). Send is `submitComposer`
  on the `<form data-chat-composer-form>`.
- Arrival is **server-driven and asynchronous**: the bubble mounts when the lifecycle
  ledger flags `arrivingUserMessageIds` (`MessagesTimeline.logic.ts`), _after_ a
  round-trip. There is currently **no optimistic user bubble**.
- `apps/web` already depends on **`@formkit/auto-animate` ^0.9.0** and already ships
  in-repo View-Transition code (`draftHeroTransition.ts`), a retained-layer crossfade
  (`StateCrossfade.tsx`), and hand-rolled WAAPI FLIP (`SidebarV2.tsx`).
- Constraints: **no new animation dependency** unless CSS/WAAPI/View-Transitions/
  auto-animate all prove insufficient; **compositor-only**; must not touch
  `timelineScrollAnchoring.ts` (viewport already stays put on send); reduced-motion
  deferred; **never commit/branch**.

---

## 1. Executive summary

**The root cause of both failures is timing, not technique.** Both attempts started the
animation at the _arrival_ moment — by which point the composer has already cleared its
text and reset. So the "source" the animation flew from was a **stale, re-measured
rectangle**, and attempt 2 painted that source as a _new opaque element_ (`var(--popover)`
over a translucent composer = the "black box"). A morph can only "feel like one object"
if it is captured from the **live composer at the send instant**, while the text is still
there, and if the thing that animates **is** a real snapshot of that surface rather than a
reconstructed look-alike.

### Recommended approach: **View Transitions API + an optimistic user bubble**

Trigger `document.startViewTransition` inside `submitComposer` (the send instant). Give
the composer surface and a newly-mounted **optimistic** user bubble the _same_
`view-transition-name`. The browser snapshots the real composer, morphs its box to the
bubble's box **on the compositor, off the main thread**, and crossfades the (identical)
text. This is the browser's built-in FLIP — it is _the_ native primitive for exactly this
shared-element morph, needs no library, and structurally cannot produce any of the three
reported defects:

- **No black box** — the "source" is a GPU snapshot of the actual translucent composer,
  not a rebuilt opaque `<div>`.
- **No three disjoint steps** — it is a _single_ `::view-transition-group` animation
  (position + size + crossfade run as one interpolation), not ghost-travel → crossfade →
  CSS-rise chained by timers.
- **No lag** — zero per-frame JavaScript, zero layout reads mid-flight, composited off the
  main thread; it does not fight the virtualized list because the list is frozen (snapshot)
  for the duration.

The one real cost is architectural: it wants an **optimistic bubble** so the morph target
exists synchronously at send (this is also what makes iMessage/Messages/Telegram feel
_instant_ — they never wait for the network to animate). If optimistic rendering is deemed
out of scope for this pass, use the fallback.

### Fallback: **fix the WAAPI hero, captured at send, cloning the real composer**

Keep the hand-rolled approach but move the trigger to send, and make the flying element a
**live clone of the composer subtree** (or a snapshot of its computed translucent surface)
rather than an opaque reconstruction — plus one continuous spring and a crossfade that
overlaps the _entire_ morph instead of the last 120 ms. This removes the black box and the
disjoint steps without needing an optimistic bubble, at the price of more code and the
usual FLIP fragility around the virtualized landing slot.

---

## 2. Per-approach analysis

### A. View Transitions API — **recommended**

**Mechanism.** `document.startViewTransition(cb)` snapshots the current visual state,
runs `cb` (your synchronous DOM mutation), snapshots the new state, then interpolates
between them on the compositor. Any element tagged `view-transition-name: x` is lifted out
of the root snapshot into its own old/new `::view-transition-group(x)` pair; the browser
animates the group's `transform`/`width`/`height` from old box → new box and crossfades
the old/new image contents. No CSS is required for the morph itself; the default old→new
is a cross-fade. (MDN "Using the View Transition API"; digitalapplied React 19.2 guide.)

**Fit with our stack.**

- Electron = Chromium 111+, so this is first-class, not a progressive enhancement.
- We _already_ use it in-repo (`runMobileComposerTransition` in `draftHeroTransition.ts`
  wraps `startViewTransition` with graceful fallback) — there is a proven pattern and a
  guard ladder to copy.
- The morph pair is: **composer surface** (`composerSurfaceRef`) → **new user bubble**
  (`UserTimelineRow`'s `bubbleRef`). Same `view-transition-name`, e.g. `message-send`.
- Identical text on both sides means the default content crossfade is nearly invisible —
  this is precisely the "text morph quality" problem the ghost had (font/size mismatch)
  _solved for free_, because the new bubble renders the same string.

**The async-arrival problem and its fix.** VT's model is synchronous: before-state and
after-state must both exist inside one `startViewTransition` call. Our bubble arrives later
from the server, so at send-time there is nothing to morph _into_. Resolution: render an
**optimistic user bubble** at the live edge in the same `flushSync` the composer clears in
(both already imported/used in these files). The optimistic row later reconciles with the
server message by id. This is the canonical chat pattern and independently makes send feel
instant.

**Key pitfalls & how we dodge them (all sourced):**

- _Two visible owners of one name = silent failure_ (one snapshot goes unanimated —
  digitalapplied, MDN, vercel-labs react-view-transitions skill). The composer persists
  after send, so we must **remove** the name from the composer inside the callback and put
  it only on the bubble; set it on the composer _just before_ the call. One owner per side.
- _Root snapshot cost on a large page._ The root group snapshots the **viewport**, not the
  full scroll content, so cost is bounded to visible pixels — fine in Electron. We also
  **suppress the root animation** (`::view-transition-group(root){ animation: none }` or a
  `view-transition-class`) so the whole translucent timeline doesn't cross-fade under the
  morph.
- _Duration._ Guides cite a 200–350 ms sweet spot for navigations; our art direction wants
  0.5–0.8 s. VT durations are fully author-controlled via
  `::view-transition-group(message-send){ animation-duration: … }` — set ~600 ms with our
  `--ease-out-quint`/`--ease-out-quart` ladder from `motion.css`.
- _Virtualization._ The optimistic bubble is a real row LegendList renders at the end;
  because the viewport stays put on send (already fixed) the landing box is stable at the
  after-snapshot. Do **not** scroll inside the callback.

**Risk:** medium-low. The only non-trivial piece is the optimistic bubble in the message
store/`deriveTimelineEntries`. VT itself is ~30 lines and already has a house pattern.
**Effort:** medium (optimistic row is the bulk). **New dep:** none.

### B. Motion / Framer Motion `layoutId` — not recommended (violates non-goal)

**Mechanism.** Two elements sharing a `layoutId` inside `AnimatePresence`/`LayoutGroup`
auto-FLIP between each other (measure, then animate via `transform` translate+scale —
motion.dev "Layout Animations"). This is the textbook "input becomes bubble" recipe and
would work.

**Why not for us:**

- **Explicit plan non-goal** ("no new animation dependency unless … insufficient"). Motion
  is not insufficient — but it is _unnecessary_: the browser's View Transitions give us the
  same FLIP natively.
- **Bundle:** layout animations add ~12 kb, and adopting `motion` for _one_ effect drags in
  its runtime.
- **Scope/virtualization friction:** `layoutId` needs both nodes mounted under a shared
  `LayoutGroup`, with `layoutScroll`/`layoutRoot` hints for scroll containers; wiring that
  across the Lexical composer _and_ a `@legendapp/list` row (which mounts/unmounts rows on
  its own schedule) is exactly the fragile surface we're trying to leave. It also fights
  virtualization: an unmounted exit target breaks the shared animation.
- React 19 compat is fine (motion supports it), so that is not the blocker; the dependency
  policy is.

**Verdict:** strong general recipe, wrong for a single effect under a "no new dep"
constraint. Keep as a "if View Transitions genuinely can't be tuned" escape hatch only.

### C. `@formkit/auto-animate` (already a dependency) — insufficient alone

**Mechanism.** A single `useAutoAnimate()` parent auto-plays add/remove/move via internal
FLIP. It's great for _list_ insertions — and is a candidate for the bubble's _enter_ — but
it only animates children **within one parent container**. It has no concept of a
shared-element morph that crosses from the composer (a different subtree) into a list row.
It could at best replace `.conversation-user-arrival` (the rise-in), not perform the
composer→bubble travel. **Verdict:** useful adjunct for the settle, cannot do the morph.

### D. FLIP libraries (react-flip-toolkit, Motion One) — redundant

Same FLIP math as our existing `SidebarV2.tsx` WAAPI code and as View Transitions, but as a
new dependency. `react-flip-toolkit` supports "flip on unmount"/portal heroes, which maps
to our case, but it is another dep for a capability Chromium now ships. **Verdict:** no
reason to add over View Transitions or in-house WAAPI.

### E. Fixed WAAPI hero (the fallback) — viable without an optimistic bubble

Keep JS-driven, but fix the three defects at their source:

1. **Capture at send, not arrival.** Read the composer rect + text while the composer is
   still full, in `submitComposer`. Stash it (module singleton, like the current
   `activeSendGhost`). This is the single most important change — it makes the source the
   _live_ composer.
2. **Fly a real clone, not a rebuild.** `composerSurfaceRef.current.cloneNode(true)`
   (or snapshot its computed translucent background + backdrop-filter) so the flying
   element _is_ the composer's glass, killing the "black box". The current code hard-codes
   `var(--popover)` opaque — that is the black box.
3. **One continuous motion + full-length crossfade.** Replace the ghost-travel-then-late-
   crossfade with a single spring where the real bubble crossfades in across the _whole_
   morph (or the last ~60%), not a 120 ms tail. Overlap is what removes the "three steps".

**Risk:** medium (FLIP against a virtualized landing slot is inherently finicky — the very
thing attempt 1 tripped on). **Effort:** medium. **New dep:** none. Choose this only if the
optimistic bubble can't land this pass.

---

## 3. Why the current ghost reads as three disjoint steps (code-level)

From `MessagesTimeline.tsx` (`UserTimelineRow`, lines ~1044–1205):

- **Step 1 / the black box.** `ghostSurface` falls back to `var(--popover)` (opaque) and
  the ghost is a _reconstructed_ `<div>` with `textContent`, its own `padding`/`font`
  copied field-by-field. Against the translucent composer this reads as a foreign opaque
  card appearing — not the composer moving. It never matches the glass.
- **Step 2 / the travel.** The ghost animates `translate3d + scale` over 600 ms
  (`MESSAGE_GHOST_MORPH_MS`) with the bubble held at `opacity:0`. For 480 ms nothing but the
  opaque box is visible moving — the eye tracks a separate object, not a transforming
  message.
- **Step 3 / the late crossfade.** The real bubble only fades in over the final 120 ms
  (`MESSAGE_GHOST_HANDOFF_MS`, `delay: 480ms`). Because the crossfade is a short tail rather
  than an overlap, there's a visible "box fades → bubble pops" seam. Combined with the CSS
  `.conversation-user-arrival` rise that was suppressed then restored, you get _box → fade →
  settle_: three cuts.
- **The lag.** The morph runs at the _arrival_ commit, the same frame LegendList is
  inserting/measuring the new row and the timeline is reflowing; `will-change` is set on the
  same tick the animation starts (no warm-up), so the first frames coincide with a paint
  storm inside the virtualized list. WAAPI transforms are cheap, but they're competing with
  layout work on the exact frames they need to be smooth.

**What the polished implementations do differently:** capture the source before it mutates;
animate a _content-identical_ surface (so the crossfade has nothing to jump across —
digitalapplied notes identical named elements morph seamlessly); overlap the crossfade
across the whole travel; warm `will-change` a frame early; and, above all, hand the
interpolation to the compositor (View Transitions) so no main-thread work lands on the
animating frames. Notably, several "polished" chat UIs (ChatGPT, Claude web, Vercel AI
chatbot) do **no morph at all** — instant optimistic append + a subtle rise — which is
itself a valid, zero-risk data point if the morph keeps resisting.

---

## 4. Concrete code sketch (recommended approach)

Real selectors/refs from this repo. Two edit sites: `ChatComposer.tsx` (trigger) and
`MessagesTimeline.tsx` / CSS (target + tuning). Assumes an optimistic user row exists at
the live edge on send (the one new capability required).

### 4a. CSS (`apps/web/src/styles/conversation.css`)

```css
/* Only the paired group animates; the root snapshot is frozen so the whole
   translucent timeline does not cross-fade under the morph. */
::view-transition-group(root) {
  animation: none;
}

::view-transition-group(message-send) {
  animation-duration: 600ms;
  animation-timing-function: var(--ease-out-quint);
}
/* Identical text on both sides => the default content cross-fade is invisible;
   keep it short so the box-morph dominates. */
::view-transition-image-pair(message-send) {
  animation-duration: 220ms;
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(message-send) {
    animation: none;
  } /* deferred, but cheap to stub */
}
```

### 4b. Trigger at the send instant (`ChatComposer.tsx`, inside `submitComposer`)

```ts
// composerSurfaceRef is the translucent glass surface (rounded-[20px]).
const supportsVT =
  typeof document.startViewTransition === "function" &&
  !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const surface = composerSurfaceRef.current;
if (supportsVT && surface) {
  surface.style.viewTransitionName = "message-send"; // sole owner on the OLD side
  const transition = document.startViewTransition(() => {
    flushSync(() => {
      appendOptimisticUserMessage(draft); // mounts the bubble at the live edge
      clearComposer(); // Lexical reset
    });
    // Composer persists after clear => it must NOT keep the name on the NEW side
    // (two owners = silent unanimated snapshot).
    surface.style.viewTransitionName = "";
  });
  void transition.finished.finally(() => {
    surface.style.viewTransitionName = "";
  });
} else {
  // Existing path: server-driven arrival + `.conversation-user-arrival`.
  appendOptimisticUserMessage(draft);
  clearComposer();
}
```

### 4c. Target: tag the new bubble (`MessagesTimeline.tsx`, `UserTimelineRow`)

Replace the whole ghost block (lines ~1044–1205 and the module-level ghost singleton
~193–243) with a one-line name on the bubble while it is the arriving optimistic row:

```tsx
<div
  ref={bubbleRef}
  className={cn("relative max-w-[80%] rounded-2xl bg-accent p-3 border border-primary/12",
    isArriving && "conversation-user-arrival")}
  style={isArriving ? { viewTransitionName: "message-send" } : undefined} // sole owner, NEW side
  data-user-turn-arrival={isArriving ? "true" : undefined}
>
```

`isArriving` (from `arrivingUserMessageIds`) is already scoped to _only_ the newest user
turn and never replays on virtualized remount/scroll restore — exactly the guard the name
needs so no history row ever claims `message-send`. Keep `.conversation-user-arrival` as the
non-VT fallback rise (guard ladder identical to `draftHeroTransition.ts`).

**Net deletion:** the entire opaque-ghost apparatus (`retireActiveSendGhost`,
`activeSendGhostCleanup`, the `useLayoutEffect` measurement/animation, the ghost-radius/
handoff constants). The morph becomes ~20 lines of CSS + name assignment.

---

## 5. How the sketch fixes the three reported failures

| Reported defect               | Cause in current code                                                                                       | Fix in the sketch                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Black box"**               | Ghost is a rebuilt `<div>` with opaque `var(--popover)` background.                                         | No ghost. The browser snapshots the _real_ translucent `composerSurfaceRef`; the morph _is_ the composer's glass, composited.                 |
| **"Three disjoint steps"**    | Opaque travel (600 ms) → 120 ms tail crossfade → CSS rise, chained by timers.                               | One `::view-transition-group(message-send)` interpolates box + content together; identical text makes the crossfade invisible. Single motion. |
| **"Super duper ultra laggy"** | WAAPI + `will-change` set on the same frame LegendList inserts/reflows the new row; main-thread contention. | Compositor-only, off main thread; the page is snapshot-frozen for the morph, so virtualized layout work cannot land on animating frames.      |

Bonus: capturing at **send** (not arrival) plus the optimistic bubble means the morph flies
from the _live_ composer and starts _instantly_, which is the actual iMessage feel — the
network round-trip no longer gates the animation.

**Residual risks to validate in-app:** (1) confirm the root-snapshot cost is imperceptible
with a long timeline in Electron (expected: bounded to viewport); (2) confirm no second
element ever carries `message-send` simultaneously (the two-owner silent bug) — assert one
owner per side in a dev check; (3) confirm the optimistic row's landing box is stable given
`maintainScrollAtEnd`/anchoring (do not scroll inside the callback; leave
`timelineScrollAnchoring.ts` untouched).

---

## 6. Sources

- MDN — Using the View Transition API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using
- MDN — View Transition API (reference): https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- React 19.2 View Transitions / Next.js 16 (component, shared-element, one-owner-per-name, layer budget, duration): https://www.digitalapplied.com/blog/react-19-2-view-transitions-animate-navigation-nextjs-16
- React `<ViewTransition>` overview: https://certificates.dev/blog/react-viewtransition-smooth-animations-made-simple
- vercel-labs agent-skills — react-view-transitions (nested VT for list items, unique names): https://github.com/vercel-labs/agent-skills/blob/main/skills/react-view-transitions/SKILL.md
- Animation Patterns — Shared Element Layout Transition (VT): https://animationpatterns.art/animations/shared-element-layout-transition/
- Web Perf Clinic — View Transitions API guide (2026), snapshot/compositor cost: https://webperfclinic.com/article/view-transitions-api-smooth-page-transitions-perceived-performance
- Motion for React — Layout Animations (`layoutId`, FLIP, `LayoutGroup`, `layoutScroll`/`layoutRoot`, ~12kb): https://motion.dev/docs/react-layout-animations
- Maxime Heckel — Everything about Framer Motion layout animations: https://blog.maximeheckel.com/posts/framer-motion-layout-animations/
- Framer University — iMessage interaction: https://framer.university/resources/imessage-interaction-in-framer
- Samuel Kraft — iOS chat bubbles in CSS (compositor-only transform/opacity, pseudo-element tails): https://samuelkraft.com/blog/ios-chat-bubbles-css
- @formkit/auto-animate (already a dependency): https://auto-animate.formkit.com/

### In-repo prior art referenced

- `apps/web/src/components/chat/draftHeroTransition.ts` — existing `startViewTransition` wrapper + graceful-fallback guard ladder to reuse.
- `apps/web/src/components/StateCrossfade.tsx` — retained-layer overlap crossfade (why enter-only remounts don't overlap).
- `apps/web/src/components/SidebarV2.tsx` — hand-rolled WAAPI FLIP (the fallback's math already lives here).
- `apps/web/src/components/chat/MessagesTimeline.tsx` — current opaque-ghost implementation (`UserTimelineRow`) to be replaced.
- `apps/web/src/styles/conversation.css` — `.conversation-user-arrival` fallback rise + reduced-motion block.
