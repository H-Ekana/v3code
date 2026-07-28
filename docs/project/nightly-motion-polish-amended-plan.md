# Amended plan — interaction/motion polish, after the user's review

Supersedes the execution order in [`nightly-interaction-motion-polish-plan.md`](./nightly-interaction-motion-polish-plan.md).
That document remains the design spec (intensity ladder, duration tokens, status axes); this one says
**what actually gets built next and in what order**, based on
[`nightly-motion-polish-user-feedback.md`](./nightly-motion-polish-user-feedback.md).

**For the story behind this document — why the first attempt failed, which theories were disproved,
and what is still open — read [`nightly-motion-polish-session-log.md`](./nightly-motion-polish-session-log.md)
first.** Root causes with evidence are in
[`nightly-motion-polish-diagnosis.md`](./nightly-motion-polish-diagnosis.md).

Written 2026-07-28, after the user reviewed all 19 implemented items and found that essentially none
of the motion was visible in the running app.

---

## ⛔ Standing decision — reduced motion is DEFERRED. Do not build it.

**User ruling, 2026-07-28:**

> The first priority is to implement all the motion and then reduce it. Let's not overwhelm ourselves
> with having to reduce motion at the same time as doing all the motion. Let's stop working on the
> reduced-motion versions from now on until I say so in the future.

Binding on every agent and every wave below, until the user explicitly lifts it:

- **Do not author new `@media (prefers-reduced-motion: reduce)` blocks.** Not "while I'm in the file",
  not "it's only three lines", not for a new stylesheet.
- **Do not tune, audit, or refactor the existing ones.** Leave them exactly as they are. They are not
  causing the current bug (see `nightly-motion-polish-diagnosis.md` §0 — the reduced-motion theory was
  refuted), so touching them buys nothing now.
- **Do not let a reduced-motion fallback constrain a design choice.** If the honest answer to "what
  does this look like with motion off" is "we'll work that out later", that is the correct answer for
  now. Design the full-motion version first and let it be as ambitious as it wants.
- **Do not report reduced-motion coverage as part of an item being done.** An item is done when the
  user can see it working.

The reason this is a good call and not a shortcut: every effect in this effort was built with its
reduced-motion fallback authored _simultaneously_, by the same agent, in the same pass — and the
fallbacks came out better specified than the animations they were falling back from. Item 4's
"truncated ring" is the tell. Building both at once split the attention that the primary effect needed.

### It is still required, later — recorded as debt

This is deferred, **not cancelled**. Two things make it a real obligation rather than a nice-to-have:

1. Any user with Windows' "Show animations" off, or macOS "Reduce motion" on, gets whatever we leave
   behind. Today that is a total blackout of the new work, because the existing blocks disable rather
   than shorten.
2. `ultrathink` (Wave 4) is a **permanently running** animation on an always-visible surface. That one
   genuinely needs a considered still state eventually, since "hold it still, keep the fill" is the
   difference between a legible mode indicator and a dead composer.

Scheduled as its own dedicated pass, **after** Waves 1–5 are visibly working and signed off — see
"Deferred work" at the end of this document.

### Test guards — no change needed. (Correcting an earlier claim.)

An earlier note in this document said `scripts/motion-recipes.test.ts` and
`scripts/special-states.test.ts` "require every motion stylesheet to contain a reduced-motion block",
and proposed relaxing them to an allowlist. **That was wrong**, and it was wrong in a specific way
worth naming: it was a loose paraphrase of an agent's summary, asserted without opening the files.

What the guards actually do: each reads **one hard-coded file** — `motion.css` and
`special-states.css` respectively — and asserts a reduced-motion block inside _that_ file. They do not
scan the stylesheet directory. A new stylesheet added during Waves 1–5 is not covered by them at all.

So the deferral is free. Leave both files alone (which the standing decision already requires) and
the guards keep passing. **No allowlist, no stub blocks, no edit.**

### The guards that WILL fight approved work — and it is not reduced motion

`scripts/special-states.test.ts:70-85` asserts that `special-states.css` **never animates
continuously**: `assert.notMatch(source, /infinite/)` and exactly one animation, playing `1 both`.
Line 112 additionally allows **exactly one duration literal** in the entire file.

Wave 4.3 (`ultrathink`: continuously flowing gradient + travelling rim streak) violates both by
design. That is not a regression — it is the user's explicit ruling, already recorded in the plan's
_"Amendment 2026-07-28 — extraordinary states may animate continuously"_. These guards encode the
superseded rule and must be rewritten as part of Wave 4.3, not worked around:

- replace the blanket `infinite` ban with one scoped to _ordinary_ surfaces, so the ban still has
  teeth everywhere it should;
- allow the named duration tokens the oil-spill recipe needs, keeping the "no raw ms literals in rule
  bodies" intent that the single-duration assertion was really protecting.

---

## The thing that actually went wrong

Not amplitude. Not taste. **The verification loop was blind.**

Nineteen items were implemented across eight agents, and the only evidence anyone checked was
"tests pass" and "the class appears in the rendered markup". Both were true. Neither is evidence that
the screen looks different. Nobody looked at the screen — the orchestrator is forbidden from starting
the app, and no substitute was put in place, so 19 items shipped with zero visual feedback in the
loop and the user absorbed the entire cost in one review pass.

Two structural changes, both binding on this amended plan:

1. **Batch size drops to 1–3 items.** The user looks, then the next batch starts. No more 19-item
   waves.
2. **"Tests pass" is never reported as "it works".** Every item below carries a _user-observable
   check_ — a UI action and the thing they should see. If an item cannot be given one, it does not
   ship.

---

## Phase 0 — Why was everything invisible at once? (diagnosis, in flight)

Seven unrelated surfaces went dark simultaneously. Static styling stayed visible (the composer
gradient), and a functional regression stayed visible (dead tab clicks). **Twelve independent tuning
bugs do not produce that pattern. One systemic cause does.**

Leading hypothesis, pending the diagnosis run: **`prefers-reduced-motion: reduce` is on.** On
Windows 10, `Settings → Accessibility → Visual effects → Animation effects = Off` makes the browser
report `reduce` permanently, and every recipe in this effort has a reduced-motion block that holds it
still. DevTools' _Rendering → Emulate CSS media feature prefers-reduced-motion_ does the same thing
and is sticky across reloads.

How well it fits the report:

| Observation                                           | Explained?                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| All motion dead across seven unrelated surfaces       | ✅ single switch, global                                                                                                |
| Nothing even at DevTools Animations 10% speed         | ✅ there is no animation to slow down                                                                                   |
| Static gradient fill still visible                    | ✅ not motion                                                                                                           |
| Dead tab clicks still visible                         | ✅ not motion                                                                                                           |
| Settle ring "barely travels", row "jankily goes down" | ✅ its reduced-motion fallback holds the ring and drops the FLIP — which reads _exactly_ as a truncated ring and a jump |

That last row is the one that moved this from "possible" to "probable". The single effect the user
could partly see failed in precisely the shape a reduced-motion fallback produces.

**20-second check, worth doing before anything else** — any one of these:

- Windows: `Settings → Accessibility → Visual effects → Animation effects` — is it **Off**?
- DevTools → `⋮` → More tools → **Rendering** → `Emulate CSS media feature prefers-reduced-motion` —
  is it set to `reduce`?
- DevTools Console: `matchMedia('(prefers-reduced-motion: reduce)').matches` → if this prints `true`,
  that is the answer and most of the item list below collapses into a re-review rather than a rebuild.

If it prints `false`, the systemic cause is something else and the diagnosis run will name it.

**Either way this changes the plan**, because a reduced-motion fallback that renders an effect as
_broken_ rather than as _still_ is itself a defect worth fixing — item 4's truncated ring is a bad
fallback, not an acceptable one.

---

## Wave 1 — Unblock the review (nothing else is reviewable until this lands)

### 1.1 — Right-panel tabs are unclickable · item 7 · **BLOCKING**

`RightPanelTabs.tsx`. Agent H converted the strip to roving `tabindex` + `tablist`/`tab` semantics
and the pointer-activation path was lost; only the per-tab ✕ still responds. The user cannot switch
surfaces at all, which also blocks reviewing the moving tab indicator.

H's tests were `renderToStaticMarkup` assertions on roles and attributes — a shape that _structurally
cannot_ catch a dead click handler. The fix is not just the handler:

- restore pointer activation;
- **add a test that actually dispatches a click** and asserts the tab changed. Every remaining
  interactive item in this plan gets the same treatment. SSR attribute assertions do not count as
  coverage for interaction.

Size: S. Check: click each right-panel tab; the panel changes and the indicator slides.

### 1.2 — Empty-state cards flash on panel close · item 7

The "what to open" suggestion cards render for ~0.5s during the shell's new 180–220ms exit window.
An exiting shell must keep painting its _previous_ content, not fall back to the empty state while
animating out.

Size: S. Check: close the right panel; you see the panel you were on slide away, never the suggestion
cards.

### 1.3 — Whatever Phase 0 names

If reduced-motion is confirmed: no code fix is required to see the work, but every reduced-motion
block gets audited so the fallbacks are _meaning-preserving_ rather than _broken-looking_ (see 3.1).

---

## Wave 2 — Prove the effects exist, then tune back down

The user's own instruction, and it is the right method:

> Just overexaggerate everything here so that I can at least fucking see it and then maybe we can
> turn it back down.

### 2.1 — A real intensity control, not a one-off hack

Rather than hand-editing amplitudes up and back down (which is how values silently ship wrong), add a
**motion intensity scalar** driving the recipes, with a dev-only "loud" setting several times past
the ladder's caps. Turn it on, walk every surface, confirm each effect _exists and is attached to the
right element_, then turn it off and tune each one to its plan band with the knowledge that it fires.

The `scripts/motion-recipes.test.ts` intensity guards will fail while loud is active. That is correct
and is the signal it must not ship that way.

Size: M. Check: flip loud on, and every effect below should be unmissable — cartoonishly so.

### 2.2 — Then, per surface, in this order

Each of these is "confirm it fires under loud, fix it if it doesn't, then tune":

| #   | Surface                                  | Item | Reported                                                |
| --- | ---------------------------------------- | ---- | ------------------------------------------------------- |
| a   | Live-response edge + tool-call lifecycle | 2    | no streaming marker, no orbit, no glint, no check flash |
| b   | Agents panel lifecycle                   | 5    | no arrival, no ring, no ring→check, no settle           |
| c   | Stop / interruption feedback             | 3    | indistinguishable from before                           |
| d   | Files and diffs                          | 10   | no state crossfade, no directional scope slide          |
| e   | Terminal drawer + clean-close            | 8, 9 | "it's just there"                                       |

Note on (e): the xterm per-frame refit fix is a genuine performance win that is **invisible by
design**. It should not be judged by feel and will not be re-tuned.

Note on (c): the state machine underneath (repeat-press refusal, failure restoration, 6s watchdog) is
real and tested. Only the visual half failed. Also: `interruptState` was wired into one of the _two_
`<MessagesTimeline>` call sites in `ChatView.tsx` — if the user's path uses the other one, the
treatment was simply absent, which would fully explain "no difference".

---

## Wave 3 — Fix the one effect that was visible

### 3.1 — Thread settlement acknowledgment · item 4

Three separate defects, not one:

1. **Ring travel is truncated** — likely a missing/invalid `@property` registration for the angle (a
   non-registered custom property cannot interpolate, so it jumps instead of travelling), or keyframes
   that do not cover the full sweep, or a mask clipping the path.
2. **Only the left edge illuminates** — the plan asks for a contained edge illumination on the row;
   this is a single-side `box-shadow`/`border-image`/gradient-stop bug, not a timing problem.
3. **The relocation into the settled shelf jumps** — the plan explicitly requires spatial continuity
   (FLIP with `translate3d`). Either it was never built or it is being discarded.

This is the only Level 3 accent in the whole effort, so it is the most conspicuous thing built — and
it is conspicuously broken. It also doubles as the test case for the reduced-motion audit, since its
current failure shape is what a bad fallback looks like.

Size: M. Check: let a thread finish; the ring completes a full lap, the whole row edge lights, and the
row _slides_ into the settled shelf.

---

## Wave 4 — `ultrathink` and the reasoning-tier ladder · item 11

The biggest new build, and the part the user is actually enthusiastic about. Ordered so the cheap
readability fix lands before the surface gets busier.

### 4.1 — Contrast · item 11a · do this first

The composer fills pink→violet and `Claude Opus 5`, `Ultrathink · 1k` and `Build` go dark-on-saturated
and vanish. Only `Auto` survives, because it is white.

Fix: while ultrathink is active, the bottom-row controls go light. `Auto` is the reference — match it.

Also resolve a live discrepancy first: agent J reported replacing the treatment with a **static 1px
rim** and deleting the rainbow, but the screenshot shows a full gradient **fill**. Those do not match,
and nothing should be built on the surface until it is clear what actually renders.

Size: S. Check: turn ultrathink on; every control in the bottom row is readable.

### 4.2 — `Auto`'s resting state gets quieter · item 11a

With ultrathink **off**, the `Auto` label drops to the same colour as the rest of the bottom row and
keeps only its purple star icon.

> I think that alone is special enough.

Honouring this exactly as stated — it is the user asking for _less_, which is the same instinct the
intensity ladder encodes.

Size: S. Check: ultrathink off; `Auto` reads like its neighbours, star still purple.

### 4.3 — "Oil spill" · item 11b

Three components, explicitly sequenced:

1. **Origin-anchored spread.** The fill does not crossfade in — it spreads _from the thinking-level
   dropdown_ and floods the composer. Iridescent, organic edge, not a clean circular wipe.
   Technique: animated `clip-path: circle()` / radial mask anchored at the control. No `filter`
   animation — forbidden by the plan, and this sits directly above the message list.
2. **Rim streak.** A light streak travels the composer's rim. Conic-gradient border driven by a
   registered `@property` angle — precedent already exists in `agents-threads.css`
   (`@property --settle-ack-angle`), so this is copied, not invented.
3. **Continuously flowing fill.** The settled state keeps drifting — "not too fast, just slightly".

**This required amending the plan, and the plan has been amended.** The original non-goals banned
continuous animation on idle surfaces; the user's ruling:

> Under normal circumstances yes, but ultracode, ultrathink, and whatever are not normal.

See _"Amendment 2026-07-28 — extraordinary states may animate continuously"_ in the plan's non-goals.
The rule still binds every ordinary surface; a short enumerated list of user-selected extraordinary
states is exempt, and adding to that list is a recorded decision, not an implementation-time judgement.

Cost discipline, because this runs permanently on an always-visible surface: `background-position`
drift plus one registered-angle rim. No filters, no large shadows, no per-frame layout. A 20–30s cycle
reads as alive without pulling the eye and costs a fraction of a fast one.

Reduced motion: spread and streak omitted, flow held still, **fill retained** — the state must stay
legible with no motion at all.

Size: L. Check: switch to ultrathink and watch the fill bloom out of the thinking-level control, then
a streak run the rim, then the colours keep slowly moving.

### 4.4 — Toned-down tier for top reasoning levels · item 11c

> …a little bit of special pizzazz when you click those insane thinking reasoning levels.

`ultrathink` stops being an easter egg and becomes the **top of a ladder**. Codex's member is
confirmed: **Max**. (Wiring note: confirm the UI label `Max` maps to `reasoningEffort: "xhigh"` and
not `"high"` — both exist.) The equivalent top settings on the other providers still need pinning.

Recommended approach: **one recipe parameterised by a 0–1 intensity** driven by the reasoning level,
so medium/high/max/ultrathink differ by _degree_ rather than by _kind_. More work up front than
hand-authoring a treatment per provider per level, but it is the only option that stays coherent as
providers add levels, and it composes with the Wave 2 intensity scalar rather than fighting it.

Size: L. Check: pick Max on Codex; you get a visibly related but quieter version of the ultrathink
treatment. Pick a middling level; you get little or nothing.

---

## Wave 5 — New effects the user asked for

### 5.1 — "Mitosis": the bubble is born from the composer · item 1

The user does not want the current 4px settle made more visible. They want a different effect, built
on the parent/child relationship between composer and message:

> The composer is like the parent… the user message bubble pops into the chat through the composer
> like mitosis. It's like a water droplet separating from the bigger water droplet.

Surface tension: bulge, neck, pinch off, settle. Not a slide, not a fade.

Open questions, to settle before building:

- Does the composer visibly deform as the bubble separates, or does only the child animate away?
- Does this replace the current arrival, or follow it?
- Where on the intensity ladder? Level 4 is reserved for the composer/send sequence and the plan warns
  against a "second celebration" at the timeline landing. Mitosis is either _part of that same
  signature moment_ or a deliberate revision — the user's call, but a conscious one.
- Cost: a true metaball pinch usually means an SVG goo filter (`feGaussianBlur` + `feColorMatrix`) or
  a canvas pass. The plan forbids animating large filters, and this sits directly above the message
  list. A cheaper approximation — `border-radius` + `scale` + `clip-path` across two elements — may
  read as close enough, and should be prototyped first.

Size: L. Check: send a message; the bubble emerges out of the composer and travels into the timeline.

### 5.2 — Command palette entrance · item 6 · **needs a decision**

> This row is filled with zero animation… I just don't like things appearing out of nowhere.

This contradicts the plan as written. Agent E built three guards specifically to _prevent_ row
animation and wrote tests asserting its absence.

The tension is reconcilable, because the plan's ban targets re-animating rows **on every filtering
keystroke** — which strobes. It says nothing about the palette's _initial open_.

Recommended: **entrance on open only; filtering stays instant.** That gives the user the "not
appearing out of nowhere" feel at the moment it matters, and keeps the anti-strobe guarantee. Needs an
explicit yes, because agent E's tests change either way.

Size: S–M. Check: open the palette with the shortcut; the rows arrive. Type to filter; the list
updates instantly with no re-animation.

---

## Deferred work — not scheduled, do not start

### Reduced motion · item 12 · **blocked on an explicit user go-ahead**

See the standing decision at the top of this document. Nothing here gets built until the user says so.

The user's original refusal to review it still stands and was correct on its own terms:

> No I'm not gonna do that because you haven't even implemented any emotions to be reduced.

When it is eventually picked up, it is **one dedicated pass over the finished set**, not a tax paid
per item. What that pass will need to decide, recorded now so the thinking is not lost:

- **Disable vs. shorten.** Today's blocks mostly set `animation: none`. A held-still-but-present
  fallback reads better than a deletion, and the existing files already lean that way for some
  recipes (a static bar, a solid disc, a 1px ring) — that instinct is right and should become the
  rule rather than the exception.
- **`ultrathink` specifically:** spread and rim streak omitted, flow held still, **fill retained**.
  The mode must stay legible with no motion at all.
- **Item 4's fallback is currently a defect, not a fallback** — it removes the ring pseudo-element
  entirely (`agents-threads.css:307`) while the base rule paints no static edge, so a reduced-motion
  user sees nothing where an acknowledgment should be.
- The two test guards relaxed during Waves 1–5 get re-tightened at the end of this pass, with the
  full stylesheet list restored.

---

## Decisions needed from the user

1. **Phase 0 check** — is `prefers-reduced-motion` on? (20 seconds, reframes everything.)
2. **Preview access.** `AGENTS.md` forbids launching the app or using browser automation, which is the
   direct cause of the blind verification loop. Preview tooling is available in this harness. Lifting
   that restriction _for this work_ would let the orchestrator see what it built instead of asking the
   user to be the display.
3. **Item 6** — entrance on palette open only (recommended), or something more?
4. **Item 1 mitosis** — replaces the current arrival or follows it; does the composer itself deform?
5. **Order** — Waves as listed, or pull item 11 (ultrathink) forward? It is the item with the most
   enthusiasm behind it and the least dependency on the invisibility diagnosis.
