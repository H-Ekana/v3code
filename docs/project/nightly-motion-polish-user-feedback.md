# User review of the interaction/motion polish work

The user's own pass over what was implemented, item by item. They number each piece of feedback to
match the click-through guide in `nightly-motion-polish-review.md`.

**This is a capture log of the user's words.** Do not act on an item from this file alone — the
diagnosis disproved several theories recorded here, and the execution order lives elsewhere.

- Narrative and current state: [`nightly-motion-polish-session-log.md`](./nightly-motion-polish-session-log.md)
- What gets built next: [`nightly-motion-polish-amended-plan.md`](./nightly-motion-polish-amended-plan.md)
- Root causes: [`nightly-motion-polish-diagnosis.md`](./nightly-motion-polish-diagnosis.md)

⚠️ **The cross-cutting note immediately below is now known to be wrong.** It blames the timeline
lifecycle ledger and a stale dev server for the invisibility. Both were refuted — see the diagnosis.
It is left in place unedited because it is a record of what the user was told at the time.

---

## ⚠️ Cross-cutting: items 1 and 2 are both completely invisible

Two consecutive timeline effects report as "nothing on screen" — item 1 even under DevTools
Animations at 10% speed. These are **not independent tuning problems**. Both are driven by the same
machinery in `MessagesTimeline.tsx`:

- agent B's lifecycle ledger (`advanceTimelineLifecycle` / `useTimelineLifecycle`), which decides
  `isArriving`, the live-edge flag, and the tool one-shots;
- the same `conversation.css` stylesheet;
- the same dev server process.

If the ledger never reports a live transition — or the dev server predates this work — then **every
timeline effect is dead**, and amplitude changes will accomplish nothing because the animation is
never applied in the first place.

**Diagnose before tuning.** Cheapest discriminators, in order:

1. Hard-restart the dev server. It was running before this work landed.
2. In DevTools Elements, send a message and watch for `conversation-user-arrival` /
   `data-user-turn-arrival="true"` appearing on the new row at all.
3. Check `data-live-response-edge` and `data-tool-status` while a response streams.
4. If the classes never appear, the bug is the ledger, not the CSS.

Turning amplitudes up on code that never runs produces the same blank screen, and burns the user's
review pass.

---

## 1 — User-turn arrival (plan item 10)

### Observed

**The effect does not appear to run at all.** The user bubble "just pops into existence out of
nowhere." Checked with Chrome DevTools → Animations at **10% speed**, which should make a 140ms
animation trivially visible — still nothing.

This is a defect signal, not a taste judgement. At 10% speed the arrival should read as an obvious
half-second slide. Candidate causes, none yet investigated:

- the dev server was started before this work landed and is serving stale code;
- `isArriving` is never true in practice, so `conversation-user-arrival` is never applied
  (`MessagesTimeline.tsx:993-995`);
- the lifecycle ledger's one-shot expires or is marked seen before the row first paints;
- the animation is on an element whose `clip-path`/`translate` is overridden by a parent.

Worth confirming which, because the same ledger drives the live-response edge and the tool-call
one-shots — if it is the ledger, several other item-5/6 effects are silently dead too.

### Requested direction — "mitosis"

The user does not want the current 4px settle made more visible. They want a different, more
ambitious effect, and they like the parent/child relationship between the composer and the message:

> The composer is like the parent, right? So how about we have the user message bubble pop into the
> chat through the composer like mitosis? It's like a water droplet separating from the bigger water
> droplet and then the chat bubble goes into the chat.

So: the bubble is _born from_ the composer rather than appearing above it. The reference is surface
tension — a droplet bulging out of a larger droplet, necking, pinching off, and settling. Not a
slide, not a fade.

Open questions to settle before building:

- Does the composer visibly deform (bulge/neck) as the bubble separates, or does only the child
  animate away from it?
- Does this replace the current 4px arrival, or follow it?
- Where does this sit on the intensity ladder? The plan reserves Level 4 for the composer/send
  sequence and explicitly warns against a "second celebration" at the timeline landing — a mitosis
  effect is either part of that same signature moment or a deliberate revision of the plan's stance.
  The user's call, but it should be a conscious one.
- Cost: a true metaball/surface-tension pinch usually means an SVG `feGaussianBlur` +
  `feColorMatrix` goo filter, or a canvas/WebGL pass. The plan's non-goals forbid animating large
  filters, and this sits directly above the message list. A cheaper approximation —
  `border-radius` + `scale` + `clip-path` on two elements — may read as close enough.
- Reduced motion needs a meaning-preserving fallback.

**Status:** captured, not implemented.

---

## 2 — Live-response edge and tool-call lifecycle (plan items 5, 6)

### Observed

> Basically nothing. I don't see anything. […] right now the text is just appearing on the screen.

No violet streaming marker beside the assistant text, no orbit on running tool rows, no completion
glint, no check flash. Same result as item 1: the surface behaves exactly as it did before any of
this work.

### Requested direction

> Just overexaggerate everything here so that I can at least fucking see it and then maybe we can
> turn it back down.

Explicitly a two-step process, and the user has named it as such: **crank it far past the intended
intensity first to establish that the effect exists and is visible, then tune back down.** The
target end state is still the plan's Level 2 — this is a debugging amplitude, not a design decision,
and the exaggerated values must not be mistaken for the intended ones later.

Practical read: build a temporary "loud mode" — durations several times longer, translations and
glow radii well past the ladder's caps, saturated colour — confirm every effect fires and is
attached to the right element, then walk each one back to its plan band. The
`scripts/motion-recipes.test.ts` intensity guards will fail while loud mode is active, which is
correct and is the signal that it must not ship that way.

**But see the cross-cutting note above first.** If the animations are never applied, exaggerating
them changes nothing.

**Status:** captured, not implemented.

---

## 3 — Stop / interruption feedback (plan item 7)

> Still it was very subtle […] did you mean there should be a loading circle around the red button,
> inside the red button around the white square, because I thought that was already there? Basically
> nothing here too.

The user could not tell the new pending treatment apart from what already shipped. That is the
sharpest possible verdict on this slice: the intended change is _indistinguishable from the previous
state_. Note the state machine underneath (repeat-press refusal, failure restoration, 6s watchdog) is
real and tested — it is only the visual half that fails to register.

Confirm what the stop button actually renders while pending, versus what it rendered before.

**Status:** captured, not implemented.

---

## 4 — Thread settlement acknowledgment (plan item 11) — **the only effect the user could see**

> The ring barely travels around the button and the whole thing looks super janky. Only the left
> side of the card illuminates pink and it kinda jankily goes down. This needs refinement.

Three distinct defects, not one:

1. **Ring travel is truncated** — it does not complete its path around the control.
2. **The row edge illuminates on the left side only**, where the plan asks for a contained edge
   illumination on the row. Likely an `inset`/`border-image` or single-side `box-shadow` bug rather
   than a timing problem.
3. **The row's relocation into the settled shelf is janky.** The plan explicitly requires
   preserving spatial continuity when the row moves; right now it reads as a jump.

This is the one Level 3 accent in the whole effort, so it is the most visible thing built — and it
is visibly broken. Highest-value fix target once the invisibility root cause is resolved.

**Status:** captured, not implemented.

---

## 5 — Agent lifecycle choreography (plan item 4)

> Yeah nothing to see here. Basically nothing.

No arrival, no running ring, no ring→check contraction, no card settle. Same null result.

**Status:** captured, not implemented.

---

## 6 — Command palette (plan item 14)

> This row is filled with zero animation. Well let's add animation there. Something subtle […] I
> just don't like things appearing out of nowhere.

Note the tension with the plan, which forbids entrance animation per filtering keystroke — agent E
built three separate guards to _prevent_ row animation, and tested for its absence. The user is
asking for the opposite of what the plan specifies.

Reconcilable: the plan's ban targets re-animating rows **on every keystroke while filtering**, which
reads as strobing. It does not forbid animating the palette's _initial open_, or a row's selected
plane. The likely right answer is an entrance on open only, with filtering staying instant — but
this needs an explicit decision, because agent E's tests will fail if rows animate on filter.

**Status:** captured, not implemented. Needs a plan decision, not just a value change.

---

## 7 — Right panel and tabs (plan item 13) — 🔴 **FUNCTIONAL REGRESSION, BLOCKING**

> Found a bug where if I toggle the right panel, all the cards on a new side panel, which suggests
> what to open, show up briefly for half a second before it closes […] I cannot switch between the
> tabs. I cannot click between the tabs anymore. They're not clickable. I can only click on the
> little x to close the tabs.

**Two regressions, both introduced by agent H's work on `RightPanelTabs.tsx`:**

1. **Tabs are not clickable at all.** Only the per-tab ✕ still responds. This is a hard functional
   break — the user cannot switch surfaces. Agent H converted the strip to roving `tabindex` with
   `tablist`/`tab` semantics and moved the `+` menu outside the tablist; the activation handler was
   evidently lost or is now gated on a keyboard path (`Enter`/`Space`) that never fires for pointer
   clicks. H's own tests are SSR `renderToStaticMarkup` assertions on roles and attributes, which
   cannot catch a dead click handler.
2. **Empty-state cards flash for ~0.5s on close.** The "what to open" suggestion cards render during
   the shell's new 180–220ms exit window. The exiting shell should keep showing its _previous_
   content, not fall back to the empty state while animating out.

This also blocks verification of the moving tab indicator, since the user cannot change tabs.

**Status:** must be fixed before any further review. Not a tuning item.

---

## 8 & 9 — Terminal drawer and clean-close acknowledgment (plan item 16)

> Yeah looks pretty normal I guess. Really I just don't feel anything. It's not making me feel
> anything. It's just there.

Not reported as broken — reported as inert. Worth separating: the xterm per-frame refit fix is a
genuine performance win the user would never _see_, and should not be judged by feel. The drawer
launch/exit and the clean-close check are the parts that were supposed to register, and don't.

**Status:** captured, not implemented.

---

## 10 — Files and diffs (plan item 17)

> File type is basically the same, no difference. And the diff tab is basically the same, no
> difference.

No visible state crossfade, no directional diff-scope navigation. The deferred skeleton is
_designed_ to be invisible on cached content, so its absence is expected and not a defect — but the
scope-change slide and the state crossfades should have been visible and were not.

**Status:** captured, not implemented.

---

## 11 — `ultrathink` (visual cleanup) — **real, actionable design feedback**

The user's screenshot shows the whole composer filled with a pink→purple gradient.

**Note the discrepancy:** agent J reported replacing the treatment with a _static 1px rim_ and
deleting the rainbow. The screenshot shows a large gradient **fill**, which matches neither the old
treatment (a 2px scrolling rainbow border) nor J's described replacement. Either the build is stale,
or J's change renders very differently from its description. Resolve before acting on the below.

The user **likes** the gradient fill:

> The whole composer just turns into that rainbow thingy pink purple thingy, which I actually kinda
> like.

### Requested changes

1. **Contrast bug — the composer controls become unreadable against the gradient.** In the
   screenshot, `Claude Opus 5`, `Ultrathink · 1k`, and `Build` are dark on a saturated
   pink/violet fill and effectively disappear. Only `Auto` stays legible, because it is white.
   Fix: make the other bottom-row controls white, or at least substantially lighter, while
   ultrathink is active.
2. **Use `Auto` as the model.** The white `Auto` label reads well against the gradient — apply the
   same treatment to the rest of the bottom-row text in ultrathink mode.
3. **Auto's own resting state should be quieter.** When ultrathink is _off_, the `Auto` label should
   match the color of the other bottom-row text, and keep only its purple/highlighted star icon:
   > I think that alone is special enough.

That last point is the user voluntarily asking for _less_ emphasis, which is worth honouring exactly
as stated — it is the same instinct the plan's intensity ladder encodes.

### 11b — Requested direction: "oil spill"

A second, larger request for the same surface. The user wants ultrathink to become a _signature_
treatment rather than a state tint:

> I kind of want the Ultra Think to be like an oil spill — it would spread out from the thinking
> level setting dropdown area and it would just fill the whole composer. It would also have a streak
> of light going around the rim of the composer as well afterwards. And also I don't just want the
> rainbow to be static. I want the purplish, pinkish, whatever rainbow to be kind of flowing, so it's
> dynamic and looks better.

Three components, in sequence:

1. **Origin-anchored spread.** The fill does not crossfade in — it _spreads_ from the thinking-level
   dropdown control and floods the composer. Oil-on-water reference: iridescent, organic edge, not a
   clean circular wipe.
2. **Rim streak, afterwards.** Once the fill settles, a streak of light travels around the composer's
   rim. Explicitly sequenced after the spread, not simultaneous.
3. **Continuously flowing gradient.** The settled state is _not_ static — the pink/violet iridescence
   keeps moving while ultrathink is on.

#### ⚠️ This deliberately reverses two rules the plan currently enforces

The plan's non-goals include **"No continuous animation when no work is active"** and "no permanent
neon outlines on idle surfaces". Agent J removed exactly this behaviour — the previous treatment ran
two permanent 10s infinite loops, and killing them was the point of the cleanup slice. Point 3 above
asks for that continuous motion back.

That is the user's call to make, but it should be made consciously, and the plan text should be
amended rather than silently contradicted. A reconciling option worth putting to the user: let the
gradient **flow only while a turn is actually running**, and hold still when idle. That satisfies
"dynamic and looks better" during the moment it matters, keeps the composer quiet when nothing is
happening, and stays inside the plan's stated rule rather than breaking it.

#### Settled by the user — the settled state IS animated

> Now I kinda want a gradient to be moving, not too fast, just slightly, and also have a rim of
> light around it, a streak of light going around the edge of the composer.

This resolves the open question above, against the reconciling suggestion. The user was offered
"flow only while a turn is running, hold still when idle" and chose **continuous, slow motion**
instead. So:

- the gradient drifts **permanently** while ultrathink is on, deliberately slow — "not too fast,
  just slightly";
- the rim streak is **also part of the settled state**, travelling continuously around the composer
  edge, not just a one-shot after the spread as first described in 11b.

**The plan's "no continuous animation when no work is active" non-goal no longer holds here.**

Provenance, since it was asked: that rule was `nightly-interaction-motion-polish-plan.md:601`, added
in commit `99965f318` (Jul 27 17:42), the commit that created the plan — before this session. It was
committed under the user's git identity but the document describes itself as synthesizing code-only
audits, so it was drafted in a prior agent session, not written by the user. The orchestrator then
read the plan as binding and propagated that to all eight implementation agents, which is why agent
J stripped the continuous loops out of `ultrathink`.

**Corrected by the user:**

> Under normal circumstances yes, but ultracode, ultrathink, and whatever are not normal.

The plan has been amended accordingly — see "Amendment 2026-07-28 — extraordinary states may animate
continuously" in the non-goals section. The rule still binds every ordinary surface; a short,
explicitly enumerated list of user-selected extraordinary states is exempt. `ultrathink` and the
top reasoning tier are on that list. Nothing else is, and adding to it is a deliberate recorded
decision rather than a judgement call at implementation time.

Practical consequence: this is a permanently-running animation on a surface that is always on screen,
so it must be cheap. Keep it to `background-position` drift and a single registered-angle rim; no
filters, no large shadows, no per-frame layout. Slow periods also help — a 20–30s cycle reads as
"alive" without drawing the eye, and costs far less than a fast one.

#### Implementation notes for whoever builds it

- **Spread**: animate a `clip-path: circle()` or a radial mask with its origin at the dropdown's
  centre. Cheap and compositor-friendly. Avoid animating `filter` — the plan forbids it and the
  composer sits above the message list.
- **Rim streak**: a conic-gradient border driven by an `@property` angle. There is already precedent
  in this codebase — `agents-threads.css` registers `@property --settle-ack-angle` for the settle
  ring, so the technique is established and can be copied rather than invented.
- **Flow**: animating `background-position` on an oversized gradient is far cheaper than
  interpolating gradient stops or a registered angle, and is the safer default for a permanently
  visible surface.
- **Reduced motion**: spread and streak omitted, flow held still, fill retained — the state must stay
  legible without any of the motion.
- Fix the 11a contrast problem first or in the same pass; a busier, flowing fill makes unreadable
  controls worse, not better.

### 11c — Requested: a toned-down tier for high/max reasoning levels

> Also want to implement something similar but a bit toned down for the ultra code as well as the
> high/max thinking levels for other models. Let's workshop an idea for that as well, to give it just
> a little bit of special pizzazz when you click those insane thinking reasoning levels.

Intent: ultrathink stops being a one-off easter egg and becomes the **top of a ladder** of reasoning-
intensity treatments, so picking any extreme setting feels like something.

**Confirmed by the user: "codex is Max."** So the Codex member of this tier is its top reasoning
setting, surfaced in the UI as **Max**. The underlying option value is `reasoningEffort: "xhigh"`
(see `apps/web/src/composerDraftStore.test.ts:1164`) — worth confirming the UI label "Max" maps to
`xhigh` and not to `high` before wiring anything, since both exist.

Still to pin: the equivalent top settings on the non-Codex providers this should also cover.

Candidate directions to workshop (none chosen):

- **Same recipe, dialled down** — the spread happens but only floods the bottom control row rather
  than the whole composer; no rim streak; static fill. Ultrathink stays the only full-flood.
- **Rim only** — the streak travels once on selection, and the composer keeps its ordinary surface.
  Cheapest, and it reads clearly as "a lesser member of the same family".
- **Intensity-scaled single recipe** — one treatment parameterised by a 0–1 "intensity" value driven
  by the reasoning level, so medium/high/max/ultrathink differ by degree rather than by kind. Most
  systematic, most work, and the easiest to keep coherent as providers add levels.

The third is the most defensible if this is going to cover several providers with differently-named
levels, since it avoids hand-authoring a treatment per provider per level.

**Status:** captured, not implemented.

---

## 12 — Reduced motion

> No I'm not gonna do that because you haven't even implemented any emotions to be reduced.

Declined, and correctly: there is no point verifying reduced-motion fallbacks for effects that are
not visible in the first place. Re-request only once items 1–10 actually render.

**Status:** not reviewed, deferred by the user.
