# Reasoning-tier composer treatments — design spec

Written 2026-07-28 after code research, superseding the open questions in the amended plan §4.4 and
the feedback log item 11c. **Amended after user review 2026-07-28** (see "Amendment" below) — the
ladder was re-cut after the user saw screenshots of the first build. This is the design authority for
the "extraordinary state" composer treatments. The user's ruling that extraordinary states may
animate continuously is already recorded in the main plan's non-goals amendment.

## Amendment 6 (after fifth user review 2026-07-28, frame analysis) — binding

The fifth review supplied screenshots + frame analysis. The theme: the xhigh→max handoff still
jumped, the flood shimmer/dither and the cross-flood transitions were wrong, and the exits/entries
needed to be direction-aware in every cell. All CSS is in `styles/special-states.css`;
`ChatComposer.tsx` gains a transient flood-drain state and the pour/sparkle children;
`composerProviderState` is unchanged.

1. **xhigh→max no longer jumps — a stop-driven cup/seal, not a centre-anchored conic reveal.** The
   old conic-arc reveal was angle-parameterised from the frame centre; on a wide-short frame the
   angle→edge-distance map is `tan()`-nonlinear, so most of the ring filled in one frame, and the
   background swapped cups→bright instantly. Replaced: the horizontal cup gradient consumes a new
   registered one-shot `@property --reasoning-cup-reach` (`<percentage>`, initial 0%) — the lit
   half-width measured **inward from each side edge**. It animates **0%→34%** (xhigh grow,
   `reasoning-cup-grow`), **34%→50%** (max seal, `reasoning-cup-seal`; the two lit bands meet at
   centre), reversed for downgrades. This is **pixel-uniform along the top/bottom edges** (no `tan`
   blowup) and the corners — at the extreme x — light progressively (no zoop). There is **no gradient
   swap**: max's seal extends the SAME cup gradient; the solid bright ring on `::after` then
   **brightens in** with the completion double-beat (`reasoning-ring-seal`, opacity 0→…→0.9 + scale,
   delayed by the seal). The plain 2-layer ring mask (content-box XOR full) stays; the conic third
   mask layer is gone for xhigh/max's cups.

2. **max→none exit READS as receding.** The flood/ring drains hold opacity near full until the last
   quarter, then fade (`reasoning-drain`: clip 118%→3%, opacity held to 74% then to 0; the max ring
   `reasoning-ring-unwrap`: half 180deg→0deg + fade).

3. **The dither is gone — three-layer staggered pour.** Deleted the SVG dither tiles, the
   `.reasoning-edge-dither` child/keyframes/role. Replaced with three concentric pours from the pill
   origin on aria-hidden `.reasoning-pour` children: `--under` (bottom, peak opacity **0.20**, starts
   first), `--mid` (**0.50**, +`--reasoning-pour-stagger-1` 150ms), `--top` (the tier's full opacity, +`--reasoning-pour-stagger-2` 300ms). Each runs the 4.5s/sine pour. The two wave layers fade back
   to 0 at the end (transient wavefronts) so the three translucent same-hue layers never
   over-saturate the resting fill, which the `--top` layer alone carries (with the 18s flow drift).
   _(Allocation note: the ruling suggested `::before` as the top layer; a dedicated `--top` span is
   used instead so `::before` stays free and the cross-flood `--base` substrate paint-orders cleanly
   below all three pours.)_

4. **Ripple on border-hit.** Each pour clip overshoots then settles — 112%→**122%→118%** with a soft
   tail — so the liquid "ripples back" off the border (`reasoning-pour-fill` / `reasoning-pour-wave`).

5. **Cross-flood never collapses to grey.** Context-aware via `data-reasoning-tier-prev`. ultracode is
   the persistent substrate: a static full-coverage `.reasoning-pour--base` (ultracode fill) is
   rendered on any cross-flood switch. **ultracode→ultrathink**: the ultracode base holds while the
   ultrathink hue pours over it in the three layers. **ultrathink→ultracode**: the ultrathink hue
   _drains_ back into the pill in three staggered layers (`reasoning-drain`), revealing the ultracode
   base underneath. The overlay hue is forced to ultrathink in both directions; the layers remount on
   a `pourKey` change so the pour/drain actually retriggers (same animation-name would not).

6. **Flood→ring and cold-ring entries are context-dependent.** A transient
   `data-reasoning-tier-drain="<flood>"` (held `REASONING_EXIT_MS` by a ChatComposer effect, like the
   exit state) keeps the pour layers mounted while a flood recedes under an incoming ring.
   **ultracode/ultrathink → max/xhigh**: the flood drains first, then the ring/cups build in, chained
   via `animation-delay: var(--reasoning-exit)`. **Cold entry into max** (from high/low/none, or after
   a flood drain): the bright ring **builds from bottom-centre wrapping both ways** (the reused
   `--ultrathink-ring-half` geometry), NOT the cup-seal. **From xhigh**: the stop-extension seal.

7. **Flow sweep 25% faster** — `--reasoning-fill-flow` 24s → **18s**.

8. **Ultrathink sparkles.** A handful of absolutely-positioned star spans (the four-point spark reused
   from the startup-splash banner `public/v3-splash-stars.svg`, as a tintable mask) pop in/out over a
   brief window of long coprime laps (`--reasoning-sparkle-a/b/c` = 6.5/8.5/10.5s), scattered along
   the LEFT/RIGHT/BOTTOM edges only, fanned out with per-star negative delays so pops feel occasional.
   Opacity/transform only — sanctioned under the extraordinary-state exemption.

9. Everything else stays: 4.5s pour, sine easing, per-tier hues, pink ring/halo, streak timings,
   contrast rules, `Auto` resting state, ultrathink ring-wrap-after-pour.

### Registered `@property` budget note

The PERMANENT one-angle budget (`--reasoning-rim-angle`) is unchanged. Amendment 6 keeps two ONE-SHOT
registered properties used only during entry/exit: `--reasoning-cup-reach` (percentage — the cup/seal
half-width, replacing Amendment 5's `--reasoning-cup-half` angle) and `--ultrathink-ring-half` (angle
— the bottom-up ring wrap, now shared by ultrathink AND max's cold entry).

### Transition matrix as implemented (tier ← prev)

- **xhigh ← none/high/low**: cups grow 0%→34%. **xhigh ← max**: cups un-seal 50%→34%. **xhigh ←
  flood**: flood drains, then cups grow (delayed).
- **max ← xhigh**: cups seal 34%→50%, bright ring brightens + double-beat. **max ← none/high/low**:
  bright ring wraps in from bottom, pulse, streak. **max ← flood**: flood drains, then the cold ring
  build (delayed), pulse, streak.
- **ultracode ← none/max/xhigh**: three-layer pour. **ultracode ← ultrathink**: ultrathink hue drains
  in three layers over the static ultracode base.
- **ultrathink ← none/max/xhigh**: three-layer pour, then pink ring wraps from bottom, streak, halo,
  sparkles. **ultrathink ← ultracode**: ultrathink pours over the static ultracode base (no grey).
- **any → none**: cups retract (xhigh), ring un-wraps (max), or flood drains toward the pill
  (ultracode/ultrathink), each reading as a recede.

## Amendment 5 (after fifth user review 2026-07-28) — binding

The FINAL polish pass, from screenshots of the live app. Theme: the reveal _geometry_ must follow the
ring's curve (no corner "zoop"), the tier handoffs must be continuous (no snap, in either direction),
and the flood shimmer must be a fine **dither at the pour edge only** — not a resting checkerboard.
All CSS is in `styles/special-states.css`; `ChatComposer.tsx` gains the previous-tier / exit-state
plumbing; `composerProviderState` is unchanged except that the tier type is now imported by name.

1. **xhigh cup grow — conic arc reveal, not a clip band.** The old `clip-path: inset()` band revealed
   whole rows at once, so the lit top/bottom trailing portions "zooped" in at the corner radius. The
   reveal is now a **conic-arc pair** centred at the two side-edge midpoints (90°/270° from the frame
   centre): a single `conic-gradient` mask layer opaque within ±`--reasoning-cup-half` of each
   midpoint. A new registered one-shot `@property --reasoning-cup-half` (`<angle>`, initial 0deg)
   animates **0deg→`--reasoning-cup-rest`** (`reasoning-cup-grow`, 560ms, `--ease-out-sine`), so the
   glow **slides continuously around the corners**. The cup GRADIENT's soft side→middle fade is
   unchanged — only the reveal geometry changed. The reveal is the FIRST mask layer with
   `source-in`/`intersect` (the load-bearing order the other rim tiers already use).

2. **xhigh→max — one shared geometry, seamless by construction.** max's `::before` now uses the SAME
   conic-arc reveal parameterised by the SAME `--reasoning-cup-half`. Its gap close CONTINUES from the
   cups' resting extent: `reasoning-gap-close` animates **`--reasoning-cup-rest`→90deg** so the two lit
   arcs sweep around the corners until they meet at the top/bottom centres (a complete ring). Because
   xhigh rests exactly where max begins (`--reasoning-cup-rest`, a shared token referenced by both
   keyframes), the handoff has no discontinuity — the old hard-coded 15% band that snapped most of the
   ring in on frame one is gone. (Pragmatic note: the lit gradient is _not_ crossfaded cups→bright
   over the window — "may", not must — so the two side arcs shift hue from cup-astro to bright-ring at
   the instant of entry; the geometry is continuous, which was the defect. Documented, not fixed.)

3. **Completion pulse — clearly visible double-beat.** `reasoning-ring-pulse` (raised 360ms→**520ms**)
   now runs the ring dim (opacity **0.7**) up to **1.0 twice**, each beat paired with a small
   `transform: scale` bloom of the masked ring (1.0→1.016→1.0→1.01→1.0). No animated box-shadow (the
   cost band forbids it); the "wider glow" is the masked ring itself scaling. Reads as "the ring
   sealed".

4. **Direction-aware transitions.** The frame now also carries `data-reasoning-tier-prev` (surfaced
   from a render-stable ref pair in `ChatComposer`, updated only in a post-commit layout effect so it
   does not churn) and, on a downgrade to no tier, a transient `data-reasoning-tier-exit="<tier>"` held
   for `--reasoning-exit` (560ms) by a small effect (module const `REASONING_EXIT_MS = 640`, a hair
   longer to cover the commit delay) so there is still an element to animate. The matrix actually
   implemented:
   - **xhigh→max** (up): seal — `--reasoning-cup-half` rest→90 + pulse. **max→xhigh** (down): a
     dedicated `[tier=xhigh][prev=max]` variant plays `reasoning-cup-unseal` (90→rest) — the ring
     literally un-seals back to the cups. _(The one true adjacent reverse — same mechanism.)_
   - **max↔ultracode / ultracode↔ultrathink**: both directions animate via the destination tier's own
     entry (the flood pour restarts on any tier change; max's gap-close+pulse plays on arrival). The
     flood pair's down-shift (ultrathink→ultracode) re-pours the pink from the pill. _Pragmatic
     simplification (documented):_ across the flood↔ring boundary the mechanisms differ (a fill vs an
     outline), so DOWN-shifts use the destination entry rather than a bespoke reverse of the source.
   - **tier→none EXIT** for **all four** tiers (exceeds the xhigh/max minimum): xhigh cups retract to
     the midpoints (`reasoning-cup-drain`, rest→0 + fade); max's ring retracts through the cups
     (`reasoning-ring-drain`, 90→0 + fade); ultracode/ultrathink flood **drains back toward the pill**
     (`reasoning-flood-drain`, the pour clip run in reverse 120%→3% + fade), using the still-set origin
     vars. The exit selectors re-establish the pseudo geometry by sharing the base rules' selector
     lists; ultrathink's ring un-wrap on exit is skipped (the flood drain + static halo carry it).

5. **The checkerboard is gone — fine leading-edge dither instead.** RESEARCH (below): the Claude Code
   effort/"Ultracode" shimmer is a fine **ordered-dither** (Bayer-matrix-style threshold noise), not a
   checkerboard. Rebuilt:
   - **Rest: no tile pattern anywhere.** The resting tile conic-checkerboard layers are deleted from
     both flood `::before`; the flood at rest is the clean gradient + its slow flow drift only
     (`reasoning-fill-flow` reduced from 4 layers to 2).
   - **Pour edge only:** a dedicated aria-hidden **`.reasoning-edge-dither` child** (rendered by
     `ChatComposer` for both flood tiers) carries two coprime SVG data-URI dither tiles (an 8×8
     Bayer-ordered 1px scatter at **5px / 7px**, low alpha). A growing `clip-path` circle (offset
     slightly AHEAD of the fill) plus a radial-gradient annulus mask confine the visible dither to a
     moving edge ring; a small `background-position` drift baked into the one-shot makes it
     shimmer/resolve; opacity ramps to 0 by the end so **nothing dithered survives at rest**.
   - **Child vs `::after` choice (reported):** used the child for BOTH tiers (one mechanism) rather
     than ultracode's free `::after`, because ultrathink's `::after` is the ring+streak and cannot
     carry the edge band — the child keeps the two flood tiers symmetric.

6. **ultrathink ring timing — pour ends at just-covering.** The clip end radius drops **150%→120%**.
   `circle()` percentages resolve against `sqrt(w²+h²)/sqrt(2)`; from a bottom-area (pill) origin the
   farthest corner sits at `sqrt(dx²+dy²)` where `dx ≤ ~0.75·W`, giving a just-covering percentage of
   `sqrt(2·(dx²+dy²)/(w²+h²))` ≈ **106–120%** across realistic pill positions and the composer's
   wide-short → tall aspect range. 120% is the safe upper end of that band (guarantees no permanently
   unfilled corner — a worse regression than a tiny tail) while cutting the old 150% dead tail, so
   **coverage completes at ~t=1.0**. The ring delay stays `--reasoning-spread`, so the wrap now begins
   the instant the colour is fully filled; fill-flow and streak delays chain as before.

### Research — the Claude Code effort/"Ultracode" shimmer (ruling 5)

Direct product docs on the slider's _pixel_ rendering are thin, but the visual is a fine **ordered
(Bayer-matrix) dither**, not a checkerboard. Key properties that shaped the rebuild:

- Ordered dithering maps a continuous tone to a threshold matrix; the **2×2 Bayer** matrix is
  `[0, 0.5; 0.75, 0.25]`, recursively grown to 4×4 / 8×8 for higher-frequency, less-regular noise —
  the larger matrices "avoid obvious geometric repetition and create organic, irregular dithering".
- Ordered dither is **stable under animation** (fixed threshold pattern), which is why a _fine_
  dithered edge reads as a crisp shimmer rather than boiling noise — the opposite of the big scrolling
  checkerboard the user rejected.
- Sources:
  [Codrops — Bayer dithering guide](https://tympanus.net/codrops/2025/07/30/interactive-webgl-backgrounds-a-quick-guide-to-bayer-dithering/),
  [Wikipedia — Ordered dithering](https://en.wikipedia.org/wiki/Ordered_dithering),
  [ASCII Magic — complete guide to dithering](https://www.ascii-magic.com/blog/complete-guide-to-dithering).

Cheap CSS translation: two tiny static SVG data-URI tiles carrying a Bayer-ordered 1px scatter, at
coprime sizes so their overlap beats irregularly under a slow `background-position` drift — no filter,
no runtime noise, a static asset per the ruling's allowance.

## Amendment 4 (after fourth user review 2026-07-28) — binding

The fourth review's core theme: **every tier transition is an animated event with a start and an end;
nothing just appears.** All changes are in `styles/special-states.css` (plus this doc);
`ChatComposer.tsx`'s pour-origin effect already re-measures on any transition into a flood tier
(including ultracode→ultrathink), so no logic changed there. Net ladder is still additive: **xhigh =
growing side cups → max = closing full ring + pulse + streak → ultracode = colour pour + tile shimmer
→ ultrathink = colour pour + wrapping pink ring + streak + halo + tile shimmer.**

1. **high → xhigh — the side cups GROW in.** The two lit side edges are revealed from the vertical
   midpoints of the left/right edges outward. Implemented as a one-shot `clip-path` band on
   `xhigh::before` (`reasoning-cup-grow`, `--reasoning-cup-grow: 560ms`, `--ease-out-sine`): `from
inset(48% 0 48% 0)` (a thin slice at mid-height, opacity 0) → `to inset(0)` (full, opacity 1). The
   band opens up and down so the cups envelop along the ring. Holds full (`both`).

2. **xhigh → max — the gap CLOSES, then PULSES once.** max's `::before` gains a THIRD mask layer (a
   `linear-gradient(90deg,…)` reveal whose central transparent band is `50% ± var(--reasoning-rim-gap)`),
   intersected with the 1px ring (`mask-composite: exclude, intersect`). `reasoning-gap-close`
   (`--reasoning-gap-close: 640ms`) animates the registered `@property --reasoning-rim-gap` 15%→0%, so
   the lit regions grow toward each other until the ring is whole. A second animation
   `reasoning-ring-pulse` (`--reasoning-ring-pulse: 360ms`, `--ease-out-quart`) chains via
   `animation-delay: var(--reasoning-gap-close)`: the ring lives at 0.85 opacity and pops to 1.0 and
   back — one completion pulse.

3. **Pour 50% slower again.** `--reasoning-spread` 3000ms → **4500ms**, keeping `--ease-out-sine`.

4. **New hues.** `--reasoning-fill-ultracode` = **pink-dominant** (astro-highlight, magenta 330);
   `--reasoning-fill-ultrathink` = **purplish-pinkish** (primary/violet 292 dominant with
   astro-highlight accents). Because the centre panel is now purplish, ultrathink's **ring + halo are
   PINK**: a new `--reasoning-rim-pink` (astro-highlight dominant) replaces `--reasoning-rim-bright` on
   ultrathink's ring, and the halo box-shadow is recoloured astro-highlight. The old shared
   `--reasoning-fill` token is retired in favour of the two per-tier fills.

5. **ultracode → ultrathink animates.** The single shared `reasoning-spread` name meant the browser
   did NOT restart the pour on a direct switch. Split into per-tier keyframe names
   (`reasoning-spread-ultracode` / `reasoning-spread-ultrathink`); the flood `::before` references its
   tier's name, so switching restarts the pour and the purple re-pours from the "Ultrathink · 1M"
   pill. (The clip collapses to the origin puddle and re-grows — the literal "re-run the pour"; the
   pink is replaced by the pouring purple rather than persisting beneath, which a single clipped
   pseudo cannot express.) `reasoning-fill-flow` keeps its name so the drift is uninterrupted.

6. **ultrathink ring WRAPS from the bottom.** ultrathink's `::after` gains a third mask layer — a
   `conic-gradient(from 180deg, …)` reveal opaque only within ±`var(--ultrathink-ring-half)` of
   bottom-centre — intersected with the ring. `reasoning-ring-build` (`--reasoning-ring-build: 900ms`,
   delay `var(--reasoning-spread)`) animates the registered `@property --ultrathink-ring-half`
   0deg→180deg, so the pink ring grows from bottom-centre around both ways and closes at the top. The
   streak then follows (`animation-delay: calc(var(--reasoning-spread) + var(--reasoning-ring-build))`).

7. **Ring + halo visibility.** ultrathink's ring is thickened to **2px** (its `::after` `padding`) and
   the halo is clearly stronger — blur tokens raised (`--reasoning-halo-blur-tight` 9px→14px,
   `--reasoning-halo-blur-wide` 22px→38px) and alphas raised (astro-highlight 46%/30%). The halo stays
   a **static** box-shadow (the hard constraint forbids animating it; it is present from tier entry as
   a static backdrop while the ring/streak animate in).

8. **"Ultracode slider" dither shimmer.** Two tiled conic checkerboards
   (`--reasoning-tile-a` astro-highlight, `--reasoning-tile-b` white; sizes 18px / 27px) are layered
   ABOVE the fill on the flood `::before`. They are revealed by the pour's `clip-path` (so they "grow
   in in small tiles" at the advancing edge) and drift at rest on the shared `reasoning-fill-flow`
   keyframe; the differing tile sizes make their overlaps beat in and out like "random puddles."
   Everything is `background-position` / `clip-path` / `opacity` — no filter animation.
   _Within-constraints deviation:_ the dedicated second-clip-circle annulus band was folded into the
   pour reveal itself (the growing clip already reveals fresh tiles at the leading edge), because
   neither flood tier has a free pseudo for a second clip (ultracode's `::after` is unused but
   ultrathink's carries the ring+streak, and the treatment is kept symmetric).

Registered `@property` budget note: the PERMANENT one-angle budget (`--reasoning-rim-angle`) is
unchanged. Amendment 4 adds two ONE-SHOT registered properties used only during entry —
`--reasoning-rim-gap` (percentage) and `--ultrathink-ring-half` (angle) — as the mechanics allowance
for one-shot entry transitions permits.

## Amendment 3 (after third user review 2026-07-28) — binding

A third review re-cut the outline scheme and the pour. Changes are in
`styles/special-states.css` and the pour-origin layout effect in `ChatComposer.tsx` (now measures on
entry into either flood tier), plus a new even ease-out token in `styles/motion.css`. The net ladder
is strictly additive: **xhigh = side cups → max = full ring + streak → ultracode = colour pour →
ultrathink = colour pour + full ring + streak + halo.**

1. **The pour is far too slow-_down_.** At 1300ms + `--ease-out-expo` the flood still "happens in
   half a second" because expo front-loads ~80% of the radius into the opening third. Fixed BOTH
   levers:
   - `--reasoning-spread` 1300ms → **3000ms**.
   - Introduced **`--ease-out-sine: cubic-bezier(0.61, 1, 0.88, 1)`** in `motion.css` (special-states
     may not hold a raw `cubic-bezier` — its guard bans it — so the token lives in `motion.css` and
     special-states references `var(--ease-out-sine)`). Unlike the quart/quint/expo family (first
     control point far left → front-loaded), sine's control point at x=0.61 tracks close to the
     diagonal: ≈49% of the radius at t=0.33, ≈70% at t=0.5, ≈92% at t=0.75, easing off only near the
     end. The fill is therefore _seen progressing_ across the whole ~3s — a theatrical pour, not a
     snap-then-coast. The streak's `animation-delay` still rides `--reasoning-spread`, so it keeps
     starting only once the pour settles.

2. **ultracode gets the pour too.** The pour (origin-anchored `clip-path: circle()` from the
   thinking-level pill) is now shared by ultracode and ultrathink on the flood `::before`. Each tier
   sets only its resting `--reasoning-fill-opacity` (ultracode 0.56, ultrathink 0.82); the
   `reasoning-spread` keyframe's `to` reads that token, so both pour from the same keyframe and settle
   at their own opacity. The `ChatComposer.tsx` layout effect now measures the origin on the
   transition into **ultracode OR ultrathink** (`isPourTier`), not ultrathink only.

3. **New outline scheme** ("Extra High and Max feel a little too samey"):
   - **xhigh = side cups.** Same masked 1px ring geometry, but painted with a new **horizontal**
     gradient token `--reasoning-rim-cups` (`linear-gradient(90deg, …)`): bright astro-highlight at
     0% and 100%, fading to fully transparent across the 34%→66% middle band. The visible ring is two
     lit side edges + their rounded corners, dark across the top/bottom centres. Static (bar the one
     entry sweep).
   - **max = the full bright ring** (`--reasoning-rim-bright`) + the **7s travelling streak**, kept.
     _(The streak is a one-line removal — delete `[data-reasoning-tier="max"]::after` — if the user
     later wants max quiet.)_
   - **ultracode = colour pour only.** No ring, no streak (unchanged pseudo allocation; it never had
     them).
   - **ultrathink = colour pour + full ring + streak + halo.** Because ultrathink's `::before` is the
     flood layer, the full static ring and the streak share the **one** `::after`: two background
     layers under the 1px ring mask — the conic streak on top, `--reasoning-rim-bright` (max's ring)
     beneath — so the whole outline stays lit while the brighter glint orbits. The **halo** is a soft
     STATIC outer `box-shadow` on the frame (two low-alpha astro/violet layers, blur radii held in
     `--reasoning-halo-blur-tight: 9px` / `--reasoning-halo-blur-wide: 22px`). Static by mandate —
     the cost band bans animated large shadows, permits static ones. The blur radii are tokens so no
     raw blur literal sits in the box-shadow body, which keeps the ordinary-effect shadow-budget
     guard (it scans box-shadow px literals) from tripping on this sanctioned exception.

## Amendment 2 (after second user review 2026-07-28) — binding

A second review, after the outline/flood re-cut below was in place, produced two more rulings.
Changes are all in `styles/special-states.css` (plus this doc); no logic changed in
`composerProviderState`/`ChatComposer`.

1. **max's streak must be clearly visible.** xhigh (outline only) and max (outline + travelling
   streak) were reading as near-identical because max's streak was too slow and too dim to notice.
   Diagnosis: **no rendering bug** — the masked-ring geometry and `z-index` layering (static ring
   `::before` z2, streak `::after` z3) are correct and the streak does paint. It was purely too
   subtle: peak ~0.45 effective alpha (64% astro-highlight × 0.7 layer opacity) crawling around a
   16s orbit over an already-bright static ring, so the travelling delta never registered. Fix:
   - `--reasoning-rim-streak-max` 16s → **7s** (user's ~6-8s band). Faster travel is what makes the
     glint read; max stays _calmer than ultrathink_ through brightness/arc, **not** a slower lap.
   - Brightened the `max::after` conic gradient: peak ~0.7 effective alpha (82% astro-highlight ×
     0.85 layer opacity), with a tighter/narrower bright arc than ultrathink's. ultrathink still tops
     it: full-astro-highlight peak, wider arc, plus the flood + spread it alone carries.

2. **ultrathink flood must pour, slower, from the Ultrathink · 1M pill.**
   - `--reasoning-spread` 720ms → **1300ms** (user's ~1.2-1.4s), keeping `var(--ease-out-expo)`
     (fast initial surge, long decelerating fill — the "liquid poured" curve). Because this token
     also feeds the rim streak's `animation-delay`, the streak still begins only once the spread
     settles.
   - `@keyframes reasoning-spread` `from` now starts at a **nonzero** radius (`circle(3%)` at
     opacity 0.32) instead of `circle(0%)` at 0.2, so the very first painted frame is a visible
     puddle sitting AT the origin rather than nothing emerging from a point.
   - **Origin wiring verified.** The `[data-composer-reasoning-origin]` marker (a `display:contents`
     span, transparent to flex) wraps the real `TraitsPicker` trigger — the "Ultrathink · 1M" pill —
     in the **normal (non-compact) footer** (`ChatComposer.tsx` ~3308); the layout effect's
     `querySelector("button")` finds its trigger. The measurement runs in a `useLayoutEffect` keyed
     on the transition into ultrathink, which React guarantees fires **before paint**, so
     `--spread-origin-x/y` land on the frame before the spread animation's first frame — no race, and
     no common fallback on desktop widths. The **compact footer** collapses the traits control into
     the `CompactComposerControlsMenu` overflow menu, so there is no visible pill there; that path
     keeps the bottom-centre fallback by design (nothing visible to pour from). Adding the marker to
     the compact menu was intentionally not done.

## Amendment (after user review 2026-07-28) — binding

The first build set `background-image` on the composer frame per tier. Because the frame is a
full-bleed tint layer, not a clipping border (§ below, and diagnosis §2 item 11), **every** tier
flooded — even xhigh. The user ruled:

- **Only ultracode and ultrathink may flood** ("the full composer color should only be on Ultracode
  or Ultrathink"). xhigh and max become an **outline difference only**.
- **xhigh = rim only**: a static multitone 1px ring + one entry sweep. Quiet. "Special but not that
  special."
- **max = rim only + the travelling light streak** orbiting the composer outline continuously
  ("an outline difference where the streak is going around the composer"). Toned down — dimmer and
  slower than ultrathink's streak.
- **Codex "ultra" moves from `max` to `ultracode`** ("ultra should be the same as ultracode").
- **ultracode / ultra = flood**: violet-dominant full-bleed fill, slow _seamless_ flow, full contrast
  treatment. No spread, no streak.
- **ultrathink = flood, top**: the fill visibly **spreads from the thinking-level control on entry**,
  then flows; travelling rim streak; full contrast treatment.

Implementation consequences, all now in `styles/special-states.css`:

1. The rim for xhigh/max is a **masked 1px ring pseudo-element** (`-webkit-mask`/`mask-composite:
exclude` padding-box, the streak's existing technique), on `::before`. The frame's own
   `background-image` is left untouched on every tier — nothing sets a background on the frame, so
   nothing floods except the explicit fill layer.
2. **Seam fix**: the flowing fill runs `animation-direction: alternate` (ping-pong), so
   `background-position` reverses at the ends instead of wrapping. The user could "see the seam of
   where the asset for the color is ending" on the old linear loop. The rim streak is a
   `conic-gradient` driven by a registered angle 0deg→360deg, which is periodic and already seamless.
3. **Contrast rule now also recolours the editor placeholder** (`[data-testid="composer-editor"] ~
div`, whose resting `text-muted-foreground/55` was invisible on a flood), for both flood tiers —
   not just the footer controls.
4. **Spread triggers on tier ENTRY, not just mount**: switching the `data-reasoning-tier` attribute
   into `ultrathink` swaps the `::before` pseudo's `animation-name` set, so `reasoning-spread`
   restarts each time the tier is entered. ChatComposer measures the spread origin in a layout effect
   keyed on the tier transition into ultrathink.

Pseudo-element allocation (one recipe, still two pseudos): `::before` = static rim ring (xhigh/max)
_or_ fill layer (ultracode/ultrathink); `::after` = entry sweep (xhigh) _or_ travelling streak
(max/ultrathink).

The tier-by-tier sections below describe the _original_ build; where they conflict with this
amendment, the amendment wins.

## What the code actually offers (research findings, verified 2026-07-28)

The docs' open question "confirm the UI label Max maps to `xhigh`" was based on a false premise —
**Max and Extra High are separate values on both providers.** The real ladders:

| Provider                           | Option id         | Values (label)                                                                                                                                      | Source                                                     |
| ---------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Claude Fable 5 / Opus 5 / Opus 4.8 | `effort`          | low, medium, high (default), **xhigh** ("Extra High"), **max** ("Max"), **ultracode** ("Ultracode"), **ultrathink** ("Ultrathink", prompt-injected) | `apps/server/src/provider/Layers/ClaudeProvider.ts:59-153` |
| Claude Opus 4.7                    | `effort`          | …, xhigh (default), max, ultrathink — no ultracode                                                                                                  | `ClaudeProvider.ts:154-179`                                |
| Codex                              | `reasoningEffort` | none…high, **xhigh** ("Extra High"), **max** ("Max"), **ultra** ("Ultra") — model-dependent                                                         | `CodexProvider.ts:53-62`                                   |
| Cursor                             | `reasoning`       | includes xhigh ("Extra High")                                                                                                                       | `CursorProvider.test.ts:383`                               |

Mechanics worth knowing:

- `ultrathink` is **prompt-injected**: typing the word in the message triggers it
  (`isClaudeUltrathinkPrompt`, `packages/shared/src/model.ts:231`), gated on the effort descriptor
  having `promptInjectedValues`. It can also be selected directly as an effort value.
- `ultracode` is a Claude Code _setting_, normalized server-side to `xhigh` +
  `settings.ultracode: true` (`ClaudeAdapter.ts:4177-4205`). To the composer it is just the effort
  value `"ultracode"`.
- The current treatment (`composerProviderState.tsx:84-89`) applies `ultrathink-frame` +
  `ultrathink-chroma` only for ultrathink. The "fill" the user likes is an accident: the frame's
  `background-image` floods because nothing in the composer subtree is opaque
  (diagnosis §2 item 11). **This spec formalizes the fill as an explicit layer.**

## The ladder — one recipe, four tiers

A single recipe parameterized by tier, expressed as `data-reasoning-tier` on the composer frame:

```
tier := "ultrathink"  if prompt-injection active OR effort value == "ultrathink"
     |  "ultracode"   if effort value in {"ultracode", "ultra"}   # "ultra" remapped 2026-07-28
     |  "max"         if effort value == "max"
     |  "xhigh"       if effort value == "xhigh"
     |  (absent)      otherwise
```

Provider-agnostic by construction: it keys on the primary select descriptor's _value_, which is the
same mechanism `promptEffort` already uses in `composerProviderState`.

### Tier: xhigh — "Extra High" (any provider)

- Static multitone rim (the existing `--ultrathink-rim` gradient, reused).
- One entry sweep when the tier is entered (existing `ultrathink-entry-sweep`, shared token).
- Illuminated provider glyph (existing `ultrathink-chroma`, shared).
- **No continuous motion.** xhigh is not the top of any ladder; the continuous-animation exemption
  stays narrow (amendment lists ultrathink and the _top_ tier).

### Tier: max — "Max" / Codex "Ultra"

Everything in xhigh, plus:

- The rim itself **drifts continuously and slowly** (`background-position` on an oversized rim
  gradient, ~30s cycle). Rim-only motion — this is the "toned-down member of the same family" the
  amendment names for top tiers.
- Slightly brighter rim mix than xhigh (more astro-highlight in the gradient stops).

### Tier: ultracode

Everything in max (continuous drifting rim), plus:

- **Full-bleed fill**: an explicit `::after` tint layer (inset 0, behind content), violet-dominant
  iridescence at a lower opacity than ultrathink (~70% of it). Slow drift, same ~30s family.
- **Contrast rule engages** (see below).
- No rim streak — the travelling light streak is reserved for ultrathink so the top two tiers stay
  distinguishable at a glance: ultracode = deep violet flood, ultrathink = pink-violet flood + streak.

### Tier: ultrathink — the oil spill (feedback item 11b, all three components)

1. **Origin-anchored spread** (entry only): the fill does not crossfade in — it spreads from the
   thinking-level control and floods the composer. Animated `clip-path: circle()` on the fill layer,
   origin set once at entry via JS measuring the control's center relative to the frame
   (`--spread-origin-x/y`). Iridescent, organic edge (layer a soft radial edge gradient on the fill's
   leading rim), not a clean circular wipe. ~600–800ms — this is an extraordinary-state entry, one
   deliberate step above Level 3; it must not compete with the send sequence (different surface,
   different trigger).
2. **Rim streak, afterwards**: a light streak travels the composer rim. Conic-gradient border driven
   by a registered `@property` angle — copy the `@property --settle-ack-angle` precedent in
   `agents-threads.css`. Starts after the spread completes (`animation-delay` = spread duration),
   then loops continuously, slow (~8–10s per lap).
3. **Continuously flowing fill**: `background-position` drift on an oversized pink-violet gradient,
   20–30s cycle, permanent while the mode is on. "Not too fast, just slightly."

### Contrast rule (feedback 11a) — applies to both fill tiers (ultracode, ultrathink)

While a fill is present, every bottom-row control goes light. `Auto` is the reference — match its
white/near-white treatment. Pure CSS in `special-states.css`, scoped under the frame's tier
attribute; no props threaded. `Auto` itself is already correct and its quiet resting state
(purple star only, muted label when no fill) must not regress.

### Exit

When the tier drops to a lower one or none, every layer goes quiet immediately (classes/attribute
removed). No residue, no exit choreography for now.

## Cost discipline (binding)

Permanent animation on an always-visible surface: `background-position`, `opacity`, `transform`,
and one registered-angle custom property only. No `filter` animation, no large animated shadows, no
per-frame JS/layout. Slow cycles are the point — they read as alive without pulling the eye.

## Test guards (must be rewritten in the same change — amended plan §"guards that WILL fight")

`scripts/special-states.test.ts:70-85` bans `infinite` and `:112` allows exactly one duration
literal. Both encode the superseded rule. Rewrite:

- The `infinite` ban becomes scoped: continuous animation is allowed only in rules under the
  extraordinary-state selectors (`[data-reasoning-tier]`/tier classes); still banned elsewhere in
  the file.
- The single-duration assertion becomes: every duration in a rule body must be a named `:root`
  token (no raw ms literals in rule bodies), with the token list free to grow.

## Wiring notes for the implementer

- `getComposerProviderState` (`apps/web/src/components/chat/composerProviderState.tsx`) already
  computes `promptEffort` (the primary select value) — derive the tier there and return the frame
  attribute/class. Existing consumers pass `composerFrameClassName` through; a data attribute needs
  a small ChatComposer change.
- `ChatComposer.tsx` contains genuine NUL bytes — directory-wide ripgrep silently skips it (exit 0);
  use `rg --text` or explicit-path searches.
- The fill must be an explicit layer, not the accidental frame-background bleed: record from the
  diagnosis that the `p-px` frame is a full-bleed tint layer, not a clipping border — any opaque
  child added later would otherwise silently kill the effect.
- Reduced motion is deferred by standing decision — author no `prefers-reduced-motion` blocks. (The
  eventual pass is already specced in the amended plan: spread/streak omitted, flow held still,
  fill retained.)

## Amendment 6.1 — three regressions fixed after the sixth review (2026-07-28, Fable directly)

User report: Extra High and Max rendered NOTHING; the pour's border ripple was invisible; the
ultrathink bottom-up ring wrap was still far too delayed. All three root-caused empirically in the
running app (animation seeking via `getAnimations()` — the hidden preview tab's timeline clock does
not advance, so wait-and-read is a false negative there).

1. **Substitution site (the Extra High/Max blackout).** `--reasoning-rim-cups` and
   `--reasoning-cup-center` were declared on the frame while `--reasoning-cup-reach`/`--reasoning-cup-bloom`
   animate on the `::before`. A custom property substitutes its inner `var()`s at computed-value
   time on the element that declares it, so the gradient baked in the frame's static `0%/0%` —
   every stop collapsed and the cups/ring painted fully transparent, animation running or not.
   Both tokens now live under `[data-reasoning-tier]::before` (load-bearing comment in the CSS;
   guard test locks the declaration site). Hardening on top: the xhigh `::before` declares a static
   resting `--reasoning-cup-reach: var(--reasoning-cup-rest)` and the max/ultrathink ring pseudos a
   static `--reasoning-ring-half: 180deg`, so any future selector hole degrades to a visible
   resting state instead of nothing (backwards fill keeps these inert while animations run).
2. **Pixel-true ripple.** The old ripple (118%→124%→120%) sat entirely at/above the covering
   radius for every real geometry, changing zero pixels. ChatComposer now measures the true
   just-covering radius (origin → farthest corner, px) into `--spread-cover-r` alongside the origin
   (CSS default 121% for the unmeasured first paint). The pour makes border contact at the 75%
   keyframe (`cover + 6px`), reflects back to `cover × 0.86` at 87%, and settles at `cover + 3px`;
   the drain and the static `--base`/resting clip use the same settle radius. Three staggered
   wavefronts → three visible reflections.
3. **Ring at border contact.** `--reasoning-ring-start: calc(var(--reasoning-pour-stagger-top) +
var(--reasoning-spread) * 0.75)` (= 3675ms) replaces the full `--reasoning-spread` (4500ms) as
   the ultrathink ring-build delay; the streak follows the build as before. The 0.75 factor mirrors
   the pour's 75% contact keyframe — keep them in step.

## Amendment 6.2 — seventh review re-cut (2026-07-28, Fable directly)

User rulings, all implemented and verified live (animation-seek in the preview):

1. **One shared flood fill.** Both Ultra tiers now paint the SAME gradient, matched to the
   user-supplied reference image: `#f04380 → #d638c4 → #9a32e6 → #5c2bd6 → #232779` at 115deg
   (`--reasoning-fill-flood`, shared opacity 0.74). The ultrathink↔ultracode transition is now a
   fill NO-OP — `reasoningPourKey` is flood-stable ("flood"), nothing remounts, nothing drains —
   which structurally removes the grey-flash bug ("ultrathink→ultracode goes gray"). The `--base`
   substrate span, the per-hue fills, the cross-down drain selector and `isCrossFloodTransition`
   are all deleted. Ultrathink is distinguished ONLY by the pink ring, its streak, and the halo.
2. **Ripple removed.** The clip-circle reflection read as the colour disc contracting, not a
   ripple. `reasoning-pour` is back to a single eased grow (3% → measured cover) with the opacity
   ramp; `--spread-cover-r` (6.1) is retained for pixel-true settle/drain radii.
3. **Pour re-timed.** `--reasoning-spread` 4500→3800ms — with contact at the eased keyframe end,
   perceived fill lands ~2.9s, the round-6 sweet spot. `--reasoning-ring-start` factor 0.75→0.85
   of the spread (+ top stagger = 3530ms) since contact now sits at 100% of the keyframe.
4. **Ultracode white streak.** New `[data-reasoning-tier="ultracode"]::after`: a PROMINENT WHITE
   arc (rgb 255/96% core) lapping the 1px rim every `--reasoning-rim-streak-max`, fading in at
   `--reasoning-ring-start`. Ultracode's ::after was previously unused.
5. **Max stroke.** The sealed max ring is 2px (xhigh cups stay 1px); `reasoning-cup-seal` /
   `reasoning-cup-unseal` animate `padding` 1px↔2px so the xhigh↔max handoff grows/shrinks the
   stroke smoothly (the ring mask is padding-derived).
6. **Sparkles on both Ultra tiers.** Host renders for ultracode AND ultrathink; 7→12 stars, whiter
   (94% white mix), cycles 7.5/9.5s → 4.6/6.2s so pops are markedly more frequent.
7. **Send-morph GPU pass.** Removed the flyer's `backdrop-filter: blur(6px)` (a moving
   backdrop-blur re-samples the backdrop every frame — the lag) and bumped the wash to 94% opacity
   for readability; flight remains transform/opacity-only per frame with `will-change`.

## Amendment 6.3 — eighth review tweaks (2026-07-28, Fable directly)

1. **Mesh-gradient flood.** The 6.2 five-stop linear had bands so wide the composer often read as
   one flat colour. `--reasoning-fill-flood` is now a soft blurred-swirl-style MESH — four radial
   hue blobs (hot pink 14%/22%, magenta 38%/72%, violet 56%/30%, blue 78%/68%) over the diagonal
   wash — modelled on the user's fluid-swirl reference. `background-size` 200% with a base
   position of 50% 50%; `reasoning-fill-flow` re-cut from a corner-to-corner slide into a
   six-stop WANDER (up/down/left/right) clamped to the 35-65% mid-diagonal band so the window
   never parks in the all-pink or all-blue corners. Single position pair repeats across layers.
2. **Ring wrap at 60% of spread** (~2.58s): the "very delayed ultrathink outline" plague, third
   and hopefully final cut — the wrap now rises WITH the fill.
3. **Ultrathink ring re-coloured**: `--reasoning-rim-pink` is now a pink→purple→blue gradient
   (#ff4d94→#e243e0→#a63cf5→#5b48ff→#3f6aff→#c04df0 at 135deg), not flat astro pink.
4. **Ultracode streak stroke** 1px→2px.
5. **xhigh entry slowed**: `--reasoning-cup-grow` 560→860ms.
6. **Sparkle frequency doubled**: cycles 4.6/6.2s → 2.4/3.2s.

## Amendment 6.4 — ninth review (2026-07-28, Fable directly; Codex probing send-morph lag)

1. **Pour easing inverted.** `--ease-in-swell` (new motion.css token, cubic-bezier(0.4,0.1,0.8,0.5)):
   slow puddle start that keeps ACCELERATING to the end, so the far left/right edges (the origin is
   off-centre) arrive fast instead of crawling. Applied to all three pour wavefronts; drain/grow
   unchanged.
2. **Ultrathink ring immediate.** `--reasoning-ring-start` is now a plain 260ms — the ring wraps in
   right after the click, rising alongside the flood, no longer gated on the pour at all.
3. **Ultracode streak decoupled + gentle.** New `--reasoning-streak-start` (top stagger + 35% of
   spread ≈ 1.63s) and `--reasoning-streak-fade` (1600ms): the white streak fades in slowly once
   the flood is clearly underway instead of popping with the click.
4. **Sparkles: quantity, not tempo.** 6.3's halved cycles read as firecrackers — reverted to slow
   4.8/6.4s cycles with a slightly longer pop window (4%/10%), and quantity 12→20 stars (spans now
   generated via Array.from in ChatComposer).
5. **Send-morph lag quantified**: ffmpeg frame-diff on the user's 60fps capture (1.73s, 103 frames)
   shows only 7 DISTINCT frames in the composer region ≈ 4 effective fps — main-thread freezes of
   200-400ms between paints, i.e. the React commit, not the flyer's own rAF motion. Codex rescue
   agent (gpt-5.6-sol, high) dispatched for the code-level root cause.

## Amendment 6.5 — tenth review (2026-07-28, Fable directly)

1. **Swell curve re-cut**: cubic-bezier(0.4,0.1,0.8,0.5) → (0.3,0.3,0.72,0.5). The first cut's slow
   opening beat made the whole pour READ slower ("even slower now") — the new curve starts at
   ~linear speed and still accelerates to an ~1.8x finish. `--reasoning-spread` 3800→3400ms.
2. **Sparkles 50% slower with a HOLD**: cycles 7.2/9.6s; pop keyframes 0/3/12/16% — pop in by 3%,
   HOLD near-full until 12%, out by 16% (~900ms visible per pop at cycle a).
3. **max→ultracode streak pop fixed**: max's streak reused the `reasoning-rim-appear` keyframes and
   CSS does not restart an animation whose name survives a style change, so the finished fade
   carried over and the white streak appeared instantly. Ultracode now uses a dedicated
   `reasoning-streak-appear` (identical body, load-bearing comment) so every ring→flood entry
   restarts the fade.
4. **Ultrathink drift doubled**: `--reasoning-flow-speed` indirection on the top pour layer —
   default `--reasoning-fill-flow` (18s), ultrathink overrides to `--reasoning-fill-flow-fast`
   (9s). Same animation name, so flood↔flood switches retime in place without restarting.

## Amendment 6.6 — eleventh review, the differentiation pass (2026-07-28, Fable directly)

User picked from the two differentiation menus; all implemented and verified live:

1. Pour 1.5x faster: `--reasoning-spread` 3400→2300ms.
2. Ultrathink breathing halo: floods' unused `::before` becomes a glow layer (static tokened
   box-shadow, OPACITY breathes 0.35↔1 over `--reasoning-halo-breathe` 5s).
3. Ultrathink comet streak: long fading tail → white-hot head → sharp cutoff; ultracode keeps the
   crisp white sliver.
4. Tone split REVERSED from my pitch per user: ULTRACODE deep/dark (dark tone overlay + weight
   0.6), ULTRATHINK bright (light sheen overlay + weight 0.92) via `--reasoning-fill-tone` +
   per-tier `--reasoning-pour-opacity`; the shared-fill cross-flood no-op is preserved.
5. Sparkle split: ultrathink's stars 5 and 10 become 20px four-point FLARES that rotate while
   fading (`reasoning-flare-pop`, 11s cycle); ultracode keeps small twinkles only.
6. RAINBOW INK (user ruling, supersedes the plan's solid-text rule — guard rewritten to a scope
   check): flood-tier footer pill labels (Claude / Fable / Ultra Code / Auto Build =
   `[data-chat-composer-footer] button span.truncate`) get gradient-clipped rainbow +
   `-webkit-text-fill-color: transparent` (outranks per-pill colour rules) + a static 3px white
   drop-shadow FILTER for contrast (text-shadow would bleed through transparent glyph fill).
7. max vs xhigh: (a) `--reasoning-cup-edge` hue split — xhigh cool violet, max hot pink-white —
   declared on the ::before pseudos (substitution site!); (b) max resting ring BREATHES
   (`reasoning-ring-breathe` 4.2s, appended last in all three entry animation lists so it takes
   over after the pulse's forward fill); (c) max inward top-edge cast light (inset frame shadow
   via `--reasoning-cast-*` length tokens).

## Amendment 6.7 — twelfth review (2026-07-28, Fable directly)

1. **Rainbow re-scoped: ULTRATHINK ONLY** (ultracode reverted to plain ink) and broadened: all
   footer pill labels — `.truncate` spans AND text-leaf spans ("Ultracode · 1M" and "Build" are
   bare leaf spans) — plus the editor placeholder. The placeholder needed a real hook: Lexical
   renders it as a detached absolute div, so the old `[data-testid="composer-editor"] ~ div`
   selector NEVER matched (the 6.x contrast rule was silently dead too) — it now carries
   `data-composer-placeholder` (ComposerPromptEditor.tsx) and both rules target that.
2. **Rainbow ICONS**: lucide svgs put stroke="currentColor" on the svg root, so a CSS `stroke:
url(#reasoning-rainbow-ink)` on the root cascades into every path; ChatComposer mounts a 0x0
   <defs> gradient while ultrathink is active.
3. **Contrast shadow flipped DARK**: white glow was invisible on ultrathink's bright field; the
   rainbow text/icons now sit on a stacked dark drop-shadow FILTER (2px/3px, inside budget).
4. **Outburst spark-lines**: white dashes that fire OFF the composer into the app (anime speed
   lines; separate non-clipping host, marks sit outside the frame, rotate+scaleX+translateX along
   their own angle via per-span vars). Ultracode shows 6, ultrathink all 10.
5. **Sparkles spread inward**: six of the twenty stars moved from the edges into a mid-field band
   (30-66% x, 48-78% y) per user ruling — "more sparkles in the middle, not completely center".
6. **xhigh→max seal de-jittered** (root causes): (a) the inward cast light appeared INSTANTLY at
   tier switch — read as "the top bar fills first"; it now transitions in delayed by
   `--reasoning-gap-close` so it lands after the seal. (b) the hue split snapped hot at t=0;
   `--reasoning-cup-edge` is now a REGISTERED <color> and the seal/unseal keyframes morph
   cool↔hot as part of the closing motion (endpoints declared on the pseudo — substitution site).

## Amendment 6.8 — thirteenth review (2026-07-28, Fable directly)

1. **Ink reveals, never snaps**: the rainbow rule now runs `reasoning-ink-reveal` (900ms) — the
   glyph fill fades from `--reasoning-contrast-ink` to transparent over the clipped gradient, so
   entering ultrathink melts the labels from white into rainbow.
2. **Meteor sparks** (user's sparkler reference): each outburst is a white TAIL fading up to a
   colourful themed HEAD (pink/purple/blue per spark via `--outburst-head`), flying OUTWARD, with
   a tiny pink-purple endpoint POP on its `::after` (`animation-delay: inherit` keeps the pop in
   phase). All ten angles re-derived so +x genuinely points away from the composer — several of
   the 6.7 angles fired INWARD (the "janky direction" report).
3. **Ultrathink slightly darker**: the light sheen tone flipped to a mild dark veil
   (rgb(24 12 48 / 20%) → 14%), pour weight 0.9 — still brighter than ultracode's deep field —
   plus a THREE-layer dark drop-shadow stack behind the rainbow ink for legibility.
4. **Injected "Ultrathink:" prefix runs rainbow, typed text stays white**: the prefix is injected
   as "Ultrathink:\n" (TraitsPicker) so it owns the editor's FIRST paragraph; ChatComposer sets
   `data-reasoning-prompt-injected` only when the injection is active (never for picker-selected
   ultrathink), and the rainbow rule targets `> p:first-child` under that attr.

## Amendment 6.9 — fourteenth review (2026-07-28, Fable directly)

1. **Rainbow retired** (user: "liking it less and less"): flood-tier labels are back to solid
   contrast ink; the stacked dark drop-shadow backing REMAINS, but ULTRATHINK-ONLY per follow-up
   ruling (ultracode keeps plain ink). The ink-reveal keyframes, icon gradient stroke, <defs>
   mount, and injected-prefix rainbow all deleted; the solid-text guard is restored.
2. **Meteor tails doubled**: 18px → 36px.
3. **Pour**: 2300 → 2000ms.
4. **xhigh→max de-jitter, second attempt — the real fixes**: the completion pulse animated
   `transform: scale` on a masked 2px ring (constant mask re-raster shimmer = the jitter) — now an
   opacity-only single swell; the max streak faded in near the TOP of the ring right at seal-end
   (the "top bar fills first" read) — its conic is now offset +180deg so the head rises from
   bottom-centre, with the slow `--reasoning-streak-fade` fade-in instead of the 240ms pop; the
   post-pulse breathe dip softened 0.84 → 0.9 (read as flicker). The reverse path was smooth
   precisely because it had none of these layered events.

## Amendment 6.10 — fifteenth review (2026-07-28, Fable directly)

ONE rainbow survivor: the thinking-level pill label ("Ultrathink · 1M") under ultrathink runs a
BRIGHT saturated rainbow that FILLS letter-by-letter left→right over 2s — a white cover layer
(top gradient) recedes as registered `--reasoning-ink-sweep` animates 0→100% (initial 100% =
fully rainbow if the animation is ever dropped). Sits over the ultrathink dark drop-shadow
backing. The solid-text guard is now a scope check confined to
`[data-composer-reasoning-origin]` under ultrathink.
