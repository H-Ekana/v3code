# Splash screen motion research

Research gathered 2026-07-28 while reworking the cold-start splash → app arrival
choreography. Captured verbatim so we can reference it rather than re-derive it.

Scope: `apps/web/index.html` (inline boot-shell `<style>` block and markup),
`apps/web/src/startupSplash.ts`, `apps/web/public/v3-splash-stars.svg`,
`apps/web/public/v3-splash-signal.svg`, composer glass rules in `apps/web/src/index.css`.

---

## A. Research findings

### A1. Why parallax layers fail to read as depth

The perception literature is unambiguous about what parallax actually needs, and it is not
"two layers moving at different speeds."

**Occlusion alone produces no depth percept.** Ono, Rogers, Ohmi & Ono showed that
accretion–deletion (one surface progressively covering/uncovering another) in isolation
yields _no_ depth impression despite being theoretically sufficient for depth _ordering_. It
only works "in the presence of relative motion."
([Ono et al. 1988, Perception](https://journals.sagepub.com/doi/10.1068/p170255) ·
[PubMed](https://pubmed.ncbi.nlm.nih.gov/3226867/))

**Which cue wins depends on separation magnitude.** For small depth separations, motion
parallax dominates perceived depth order; for large separations, dynamic occlusion dominates.
When parallax is ambiguous, occlusion takes over entirely.
([Ichikawa et al., _Journal of Vision_](https://jov.arvojournals.org/article.aspx?articleid=2121256) ·
[PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4521857/))

**The practical failure modes:**

1. **No trackable texture.** Motion parallax is computed from _feature_ displacement. A
   smooth, low-contrast, blurred gradient has almost no high-frequency features to track.
   Different velocities across textureless fields are literally invisible. Foreground
   elements need _sharp, intricate detail_; only background loses it.
   ([Pictorial depth cues guide](https://brainvoyage.blog/pictorial-depth-cues-guide))
2. **No real occlusion.** At 43% opacity over `#161616`, a foreground band is a haze, not an
   occluder. Accretion–deletion never happens: nothing is ever fully hidden and then revealed.
3. **Atmospheric perspective inverted or flat.** Depth reads when contrast, saturation and
   sharpness _step_ between planes. Two planes rendered with near-identical treatment read as
   one. ([D5 on atmospheric perspective](https://www.d5render.com/posts/atmospheric-perspective-for-aerial-rendering))
4. **Users don't look.** NN/g's parallax testing found the effect frequently goes _unnoticed_
   — users have learned to ignore movement (ad blindness). If the depth story isn't carried by
   the primary focal object, it won't land.
   ([NN/g, "What Parallax Lacks"](https://www.nngroup.com/articles/parallax-usability/))

### A2. Cold-start / splash → app transitions in well-regarded apps

- **Apple HIG is openly hostile to splash-as-branding.** "A launch screen isn't an onboarding
  experience or a splash screen, and it isn't an opportunity for artistic expression. A launch
  screen's sole function is to enhance the perception of your experience as quick to launch and
  immediately ready to use." If you want a branded moment, put it _after_ launch completes.
  ([Apple HIG — Launching](https://developers.apple.com/design/human-interface-guidelines/patterns/launching))
- **Hardcoded holds are the named anti-pattern.** An artificially extended splash that
  dismisses on a timer rather than on readiness is flagged in App Store review as a quality
  signal. Drop-off begins around 2s and accelerates past 3s.
  ([AuditBuffet AB-001938](https://auditbuffet.com/patterns/ab-001938) ·
  [Android splash screens](https://developer.android.com/develop/ui/views/launch/splash-screen))
- **But motion genuinely buys perceived time.** A 2s animated wait tests as faster than a 1s
  blank screen. The budget is ~1.5s.
  ([Splash screen best practices](https://www.appypie.com/blog/app-splash-screen-best-practices) ·
  [UXPin](https://www.uxpin.com/studio/blog/splash-screen/))
- **Non-blocking splash is the modern pattern.** Droidcon documented cutting launch time ~90%
  by making the splash non-blocking — the app initializes _behind_ the art rather than the art
  gating init.
  ([droidcon 2025](https://www.droidcon.com/2025/10/31/breaking-the-speed-barrier-how-non-blocking-splash-screens-cut-android-app-launch-time-by-90/))
- **What makes it "expensive" rather than "slow":** ambient continuous motion (so the screen
  is alive, not frozen) + short, snappy _transitions_ on top. VALORANT's menu motion brief was
  exactly this: "magic as ambient animation throughout every screen," with transitions kept
  "snappy and fluid," max 1–1.5s per animation.
  ([Riot on VALORANT's interface](https://playvalorant.com/en-us/news/game-updates/preview-the-future-of-valorant-s-interface/) ·
  [Envar Studio](https://www.artstation.com/artwork/Ny1lXb))
- **Emil Kowalski (Linear, Vaul, Sonner):** delight scales with _rarity_. Something seen once
  per session can be lavish; something seen 100×/day must be near-invisible. Never make
  animation the thing the user waits on.
  ([You don't need animations](https://emilkowal.ski/ui/you-dont-need-animations) ·
  [Great animations](https://emilkowal.ski/ui/great-animations))

### A3. Shared-element / hero transition best practices

- **Arc, not line.** "The movement of an element between two points within the bounds of the
  screen follows a natural, concave arc." Material specifies _asymmetric_ arcs: moving
  **upward**, start with a shallow ascent and end with a steep one (effort against gravity);
  moving **downward**, steep then shallow. Single-axis motion should _not_ arc.
  ([Material — Movement](https://m1.material.io/motion/movement.html))
- **Arc strength is a tunable.** Motion.dev's `arc()` parameterizes bend from 0 (straight) to
  1 (peak height = distance between the points). ([motion.dev/docs/arc](https://motion.dev/docs/arc))
- **Overshoot: when it helps vs hurts.** With a spring, progress overshoots t=1 and oscillates
  back. Great when the element arrives into open space; bad when it must _register precisely
  with a destination slot_ — a shared element that visibly overshoots reads as "missed and
  corrected." Entrances should never use `scale(0)`; use `scale(0.95)` + opacity.
  ([review-animations SKILL.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/SKILL.md))
- **Keep shared elements lightweight.** Complex/filtered shared elements are the standard cause
  of janky hero transitions.
  ([Droids on Roids](https://www.thedroidsonroids.com/blog/meaningful-motion-with-shared-element-transition-and-circular-reveal-animation))
- **Timing tokens:** Material 3 — fast 150ms, medium 300ms, slow 600ms; standard
  `cubic-bezier(0.2, 0, 0, 1)`, emphasized `cubic-bezier(0.2, 0, 0, 1.5)`. Material 1 entrances
  225ms, permanent exits 195ms, relative movement 300ms. Emphasized easing on short
  (50–100ms) micro-interactions feels _sluggish_ because the slow head becomes perceptible.
  ([M3 easing & duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) ·
  [M1 duration & easing](https://m1.material.io/motion/duration-easing.html))

### A4. Disney's 12 principles, as they actually apply

- **Anticipation** — a pre-motion in the _opposite_ direction of the coming action. Overdone,
  it reads as lag.
  ([IxDF](https://ixdf.org/literature/article/ui-animation-how-to-apply-disney-s-12-principles-of-animation-to-ui-design) ·
  [Marvel](https://marvelapp.com/blog/disneys-motion-principles-in-designing-interface-animations/))
- **Follow-through & overlapping action** — parts of a composite don't stop simultaneously.
  Critically: "overlapping action requires a _hierarchy_; if every element overlaps by the same
  amount, it's just stagger. True overlap has a heavier parent and lighter children trailing."
  ([Moro](https://moro.davidumoru.me/lesson/follow-through) ·
  [Wikipedia](https://en.wikipedia.org/wiki/Follow_through_and_overlapping_action))
- **Slow in / slow out** — `ease-out` for entrances, `ease-in` for permanent exits. "`ease-in`
  on UI is problematic" because the slow head blocks perception of the change.
- **Secondary action** — a supporting motion that reinforces the primary one without competing
  (a glow bloom on landing, a shadow that settles after the object does). This is where you get
  "expensive" cheaply.
- **Arcs** — see A3. Straight lines read mechanical.
- **Staggering** — 30–60ms between siblings; lists ~40ms, grids ~30ms, cards ~60ms. 100ms+
  reads as a slideshow.
  ([Aninix](https://www.aninix.com/wiki/how-to-create-a-good-stagger-in-the-ui-animation) ·
  [Motion stagger](https://motion.dev/docs/stagger) ·
  [LogRocket](https://blog.logrocket.com/css-staggered-animations/))

### A5. Concrete CSS/WAAPI techniques for organic motion

- **`linear()` springs.** Sample a real spring (mass/stiffness/damping) into 40–75 stops and
  hand it to `linear()`. Actual spring motion in pure CSS, GPU-driven — something
  `cubic-bezier()` mathematically cannot express. Shipped in all major browsers by Dec 2023.
  ([Chrome docs](https://developer.chrome.com/docs/css-ui/css-linear-easing-function) ·
  [Josh Comeau](https://www.joshwcomeau.com/animation/linear-timing-function/) ·
  [Carmen Ansio](https://www.carmenansio.com/articles/spring-physics-css/) ·
  [PQINA](https://pqina.nl/blog/css-spring-animation-with-linear-easing-function/))
  - Generators: [Linear Easing Generator](https://linear-easing-generator.netlify.app/) ·
    [kvin.me/css-springs](https://www.kvin.me/css-springs) ·
    [spring-easing](https://spring-easing.okikio.dev/functions/cssspringeasing)
  - Caveats: springs aren't time-bounded, so pick a duration; ~11 stops is visibly jerky, use
    40+; interruption mid-flight is unnatural (irrelevant for a one-shot splash).
- **Per-property timing offsets.** CSS keyframes apply one timing function per _interval_ to
  _all_ properties in that interval. To give `opacity` and `transform` different curves you
  must use two animations. **This is the single most under-used technique for organic motion.**
- **`steps()` vs continuous.** `steps()` for deliberate mechanical/telemetry beats; continuous
  for anything physical. Mixing intentionally — a stepped readout over continuous drift — is a
  strong "instrument panel" flavor.
- **Compositor-only discipline.** Animate `transform` and `opacity` only. Never
  `width/height/margin/padding/top/left`; never `transition: all`.
  - `will-change` is not free: every promoted element is a full-resolution texture in VRAM.
    "Layer explosion" can make things _slower_.
    ([MSPK](https://mspk.substack.com/p/what-will-change-actually-does-to) ·
    [Alibaba Cloud](https://www.alibabacloud.com/blog/front-end-performance-optimization-with-accelerated-compositing-part-1_594194))
  - `backdrop-filter` is GPU-composited but costly; reduce affected area aggressively.
    ([OpenReplay](https://blog.openreplay.com/creating-blurred-backgrounds-css-backdrop-filter/))
- **Motion blur substitutes.** CSS has no motion blur ([csswg-drafts#3837](https://github.com/w3c/csswg-drafts/issues/3837)).
  1. **Staggered ghost clones** — N copies at ~8–12% opacity with progressive
     `transition-delay`. ([CSS-Tricks](https://css-tricks.com/how-to-create-a-realistic-motion-blur-with-css-transitions/))
  2. **SVG directional blur** — `feGaussianBlur stdDeviation="x,y"` from measured velocity.
     Axis-aligned only, and _resource intensive_, especially at 2× DPR.
     ([Codrops](https://tympanus.net/codrops/2015/04/08/motion-blur-effect-svg/))
  - The cheap and correct substitute is a **pre-baked tapered tail in the SVG art**.
- **Mask-based reveals & specular sweeps.** `mask-image` with a rotated/skewed gradient swept
  across an element. **Animate the sweep via `transform` on an overflow-clipped
  pseudo-element, not via `mask-position`** — `mask-position` repaints every frame.
  ([Sabatino](https://www.sabatino.dev/recreating-the-ios-16-shimmer-effect/) ·
  [MDN CSS masking](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_masking/Masking) ·
  [Smashing](https://www.smashingmagazine.com/2024/01/css-blurry-shimmer-effect/) ·
  [Robb Owen — CSS-only shaders](https://robbowen.digital/wrote-about/css-blend-mode-shaders/))
- **SVG line-draw.** `stroke-dasharray` = path length, animate `stroke-dashoffset` → 0. Get
  length with `getTotalLength()` or normalize with `pathLength`. Not compositor-only, but
  negligible on thin short paths.
  ([CSS-Tricks](https://css-tricks.com/svg-line-animation-works/) ·
  [MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dashoffset))
- **`feTurbulence`** (Perlin noise) for aurora/cloud/smoke. **Animating its parameters is very
  expensive** — full re-rasterization per frame. Bake to a static texture and animate
  `transform`.
  ([Codrops](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/) ·
  [O'Reilly _Using SVG_](https://oreillymedia.github.io/Using_SVG/extras/ch16-feTurbulence.html))

---

## B. Specific suggestions for this splash

Ranked by impact-to-effort. Values reflect the code as of 2026-07-28.

### B1. ⭐ The composer's opacity fade completes when it has already traveled 91% of the distance

CSS applies the timing function **per keyframe interval, to every property in that interval**.
So `transform` was driven by `cubic-bezier(0.16, 1, 0.3, 1)` across the 0%→78% interval, and
opacity rode the same clock. Solving that bezier: at time-fraction **0.34**, output ≈ **0.909**.

Of 560px of travel: fully invisible for the first ~385px; fully opaque ~50px below rest.
That is exactly "it just appears from the bottom," and no cloud retiming fixes it.

**Fix — split the properties onto two animations with different curves:**

```css
html[data-startup-splash="exiting"] [data-startup-composer-target] {
  animation:
    v3-composer-fade 220ms 140ms linear both,
    v3-composer-rise 1040ms 140ms var(--ease-rise) both;
}
@keyframes v3-composer-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes v3-composer-rise {
  from {
    transform: translate3d(0, var(--composer-rise, 32vh), 0) scale(0.972);
  }
  to {
    transform: translate3d(0, 0, 0) scale(1);
  }
}
```

Two companion changes:

- **`--ease-rise` must not be ease-out-expo.** Use a spring `linear()` (mass 1, stiffness 110,
  damping 18), or `cubic-bezier(0.33, 0.9, 0.25, 1)` as a stand-in.
- **Cut travel to ~28–34vh.** Long travel in ~1s moves too fast to track; you can't perceive
  parallax against something you can't follow.

Apply the identical split to the sidebar.

### B2. ⭐ Give the foreground bands trackable texture and real occlusion

Per Ono et al., relative motion without trackable features and without genuine
accretion–deletion produces no depth percept.

- Foreground clouds at `opacity: 0.43` + `blur(0.25px)` over `#161616` never _hide_ anything.
- The center band's mask (`transparent 34%, #000 44%, #000 56%, transparent 66%`) leaves only
  ~12vw opaque. The composer is `max-w-3xl` (768px) — at 1440px that's ~53vw. **The band
  occludes roughly a quarter of the composer's width, at 43% opacity.**

**Fixes, in order:**

1. **Widen and darken the center band during the parting only.** Push the mask plateau to
   roughly `transparent 18%, #000 30%, #000 70%, transparent 82%`; raise dark-mode opacity to
   ~0.62–0.70 for the first ~40% of the fall, easing back to 0 as it clears.
2. **Add a hard-ish rim on the foreground band.** Occlusion needs a _contour_. Replace
   `blur(0.25px)` with `blur(0px)` and add a thin bright rim — a second masked copy, or a
   `drop-shadow(0 -1px 0 rgb(219 122 255 / 22%))`-style lip.
3. **Separate the planes atmospherically.** Currently mid (`0.25 / blur .45 / bright .74`) and
   fore (`0.43 / blur .25 / bright .76`) are nearly identical. Push apart:
   mid → `opacity .18, blur 1.6px, saturate .55, brightness .60`;
   fore → `opacity .55, blur 0, saturate .95, brightness .88`.
4. **Add a mote layer.** 30–60 1–2px `#DB7AFF`/`#FFF9FF` dots drifting at a _different_ rate
   than each band. Small high-contrast points are the ideal parallax feature.

### B3. ⭐ Give the three foreground bands genuinely different velocities

`getCloudExitTransform()` sent _every_ foreground band 78vh with `scale(1.1)`, varying duration
by only `index * 45ms` on a 980ms base — a ≤14% spread. Three bands moving nearly identically
is one plane, not three.

| band      | vertical | horizontal | scale  | duration |
| --------- | -------- | ---------- | ------ | -------- |
| mid       | `34vh`   | `-1.5vw`   | `1.04` | 1180ms   |
| fg-left   | `86vh`   | `-9vw`     | `1.16` | 900ms    |
| fg-center | `96vh`   | `0`        | `1.20` | 840ms    |
| fg-right  | `88vh`   | `9vw`      | `1.16` | 920ms    |

~2.8× velocity ratio instead of ~1.6×, plus a scale gradient (an independent depth cue). Keep
the midground decelerating (`cubic-bezier(0.3, 0, 0.5, 1)`) and the foreground accelerating
(`cubic-bezier(0.45, 0, 0.75, 0.6)`).

### B4. ⭐ Retime the overlap so the composer crosses the band while it is still in frame

- **Delay the composer's rise** ~120ms so the clouds get a head start — relative motion
  requires an established reference.
- **Target the crossing at 45–60% of the composer's rise.**
- **Overlapping action:** the composer (heavy parent) should _lead_; context strip / banner
  stack / sidebar rail (lighter children) trail by 40–60ms. "If every element overlaps by the
  same amount, it's just stagger."

### B5. Make the hold adaptive instead of hardcoded

A splash that dismisses on a timer rather than readiness is a documented quality defect.
Drop-off starts at 2s.

```ts
export const STARTUP_SPLASH_MIN_HOLD_MS = 900; // signal lock (840ms) + settle
export const STARTUP_SPLASH_MAX_HOLD_MS = 1_800; // ceiling if init is slow
```

Resolve at `max(MIN_HOLD, min(MAX_HOLD, timeToReady))`. Fast machines see ~2.0s, slow machines
see the current 3.2s. Same craft, no manufactured wait.

### B6. Fix the logo flight's anticipation, follow-through, and handoff

1. **Anticipation too long.** `0.32 × 1150ms = 368ms` covering 9% of the path, with a
   quadratic ease-_in_. Beyond ~250ms a wind-up reads as lag. Drop to **0.18–0.20**.
2. **Anticipation isn't opposite the action.** Travel is up-and-left; the dip was down and
   _also left_. Flip the first control point's X to lag _right_:
   `controlOneX = sourceCenterX - deltaX * 0.10`.
3. **No follow-through.** Do **not** add positional overshoot — the mark registers with a fixed
   24px slot, and overshoot there reads as "missed and corrected." Put follow-through in
   rotation: `-9 * sin(π·p) + 2.2 * sin(2π·p) * p²`. Then add a **secondary action**: a small
   radial glow at the target scaling `0.6 → 1.25`, fading `0 → 0.5 → 0` over 260ms from
   touchdown.
4. **Handoff double-image.** The flying logo held `fill: forwards` at full opacity while the
   target cross-faded in — both painted for 140ms, with mismatched shadows. Fade the flying
   mark `1 → 0` over the same window.

### B7. `#root`'s opacity animation makes the composer's glass blank, then pop

Per the Filter Effects spec, an element with `opacity < 1` forms a **Backdrop Root**. While
`#root` is mid-fade, the composer's `backdrop-filter` samples only _within_ `#root` — which is
transparent — so the glass renders flat, then snaps when opacity hits 1. The analogous trap for
`filter` was already documented in the code; the `opacity` case was still live.

**Fix:** move the fade off the backdrop ancestor, or drop it and let the veil + per-region
entrances carry the reveal.

### B8. Preload the cloud/star assets

```html
<link rel="preload" as="image" href="/v3-splash-clouds-foreground-v2.webp" fetchpriority="high" />
<link rel="preload" as="image" href="/v3-splash-clouds-midground-v2.webp" fetchpriority="high" />
<link rel="preload" as="image" href="/v3-splash-stars.svg" />
<link rel="preload" as="image" href="/v3-splash-signal.svg" />
```

### B9. Layer-count hygiene

`.v3-splash-cloud-layer` sets `will-change: transform` on four ~120vw × 52–64vh textures; the
starfield adds hints on dozens of nodes; two full-viewport layers use `mix-blend-mode: screen`.
All during React mount — the window where you can least afford compositor contention. Keep the
hint on the cloud bands; drop it from starfield nodes that only twinkle.

### B10. Reduced motion should be a graded downgrade, not `animation: none`

Blanket removal is the wrong default: keep fades and dissolves, drop only _translation, scaling
and parallax_ — those are the vestibular triggers. Hold the reduced exit around 260–320ms
rather than 180ms; 180ms linear on a full-screen cross-dissolve reads as a _cut_.
WCAG 2.3.3 (AAA) explicitly names parallax as in-scope motion that must be disable-able.
([CSS-Tricks](https://css-tricks.com/nuking-motion-with-prefers-reduced-motion/) ·
[Craft CMS](https://craftcms.com/blog/designing-for-reduced-motion) ·
[W3C SC 2.3.3](https://w3c.github.io/wcag/understanding/animation-from-interactions))

### B11. Convert the shared easing to a small spring token set

One curve (`cubic-bezier(0.16, 1, 0.3, 1)`) was doing eight jobs — every object with identical
apparent mass is a large part of "mechanical."

```css
:root {
  --ease-veil: cubic-bezier(0.16, 1, 0.3, 1); /* massless: opacity-only */
  --ease-rise: linear(/* spring: mass 1, stiffness 110, damping 18 */); /* heavy */
  --ease-slide: linear(/* spring: mass 1, stiffness 170, damping 26 */); /* light */
  --ease-fall: cubic-bezier(0.45, 0, 0.75, 0.6); /* gravity */
}
```

---

## C. Flourish ideas (replacing the hand-built hero meteor)

The old meteor looked cheap because a 3px gradient bar + `box-shadow` has a _uniform_
cross-section and an isotropic glow, whereas `v3-splash-stars.svg` meteors have `.meteor-core`
(`#FFF9FF`, `stroke-width: 1`, round cap), `.meteor-glow` (`#B56FFF`, `stroke-width: 7`,
`stroke-opacity: .24`), a `meteor-tail` gradient with four stops falling to zero, and a
`.meteor-head` with stacked `drop-shadow`s. Build any flourish _from that vocabulary_.

### C1. ⭐ The hero meteor _becomes_ the logo — reuse the existing meteor `<g>` verbatim

Make the punctuation _causal_. The same `.meteor-core` / `.meteor-glow` / `url(#meteor-tail)`
group, scaled ~2.2×, enters on a long tapered arc, and its head arrives exactly at the logo's
center as the signal-lock completes. On contact, the logo's existing `.v3-splash-card::before`
radial glow blooms (scale 0.7 → 1.15, opacity 0 → 1) and the tail retracts into it.
**Why it reads expensive:** it has a _reason_. Anticipation → impact → follow-through.
**Cost:** cheap. Transform + opacity on one SVG group. **Reuse:** ~100% existing markup.

### C2. ⭐ Constellation ignition along the signal-lock links

`v3-splash-signal.svg` already has `.signal-link` paths and `.signal-node` groups that merely
fade in. Convert links to a **line-draw** with a bright travelling dash riding ahead of the
drawn segment, and stagger nodes to pop 40ms behind their incoming link. A network lighting
itself up rather than fading in. **Cost:** cheap. **Reuse:** 100% existing paths.

### C3. ⭐ Rim-light bloom at the cloud parting seam

As bands separate, a wide soft horizontal light bar (`rgb(219 122 255 / 0.30)` core →
transparent, ~14vh tall) at the seam does `scaleX(0.4) → scaleX(1.6)` + `opacity 0 → 0.55 → 0`
over ~500ms, peaking as the composer crosses the band.
**Double duty:** it's a flourish _and_ the hard contrast edge at the occlusion boundary that
B2 says is missing. **Cost:** cheap.

### C4. Specular sweep across the logo at the handoff

A `-25deg`-skewed white gradient bar inside an `overflow: hidden` wrapper, translated across the
mark over ~420ms. **Cost:** cheap via `transform`; expensive via `mask-position`.
**Caveat:** on a 64px mark this is near-invisible alone; worth it only with C1's bloom.

### C5. Parallax dust motes / embers between the bands

40–60 1–2px points in one inline SVG, three drift groups at different rates, `#DB7AFF` and
`#FFF9FF`, opacity 0.25–0.7. Functional (B2.4) _and_ atmospheric. **Cost:** cheap.

### C6. Volumetric shaft through the parting ("god ray")

Tall skewed rect with a `linear-gradient`, masked to soft top/bottom falloff, `scaleY`ing up as
the clouds separate. **Cost:** cheap if pre-baked. **Risk:** easy to overdo into stock lens
flare — keep peak opacity ≤ 0.12 in dark mode.

### C7. Aurora ribbon — **not recommended at runtime**

`feTurbulence` is beautiful but animating `baseFrequency`/`seed` forces full re-rasterization
every frame, full-viewport, during app mount. Bake to a static texture; animate `transform`.

### C8. Runtime motion blur on the flying logo — **not recommended**

SVG directional blur is axis-aligned only (the flight is a diagonal arc) and stutters at 2× DPR.
Ghost clones mean N extra promoted layers mid-transition. Use a pre-baked tapered tail instead —
that's what real motion blur looks like anyway.

**Compositor summary**

| Idea                      | Cost                       | Why                                           |
| ------------------------- | -------------------------- | --------------------------------------------- |
| C1 meteor→logo            | **cheap**                  | transform/opacity on one SVG group            |
| C2 constellation ignition | **cheap**                  | tiny stroke repaints                          |
| C3 seam bloom             | **cheap**                  | transform/opacity, baked gradient             |
| C5 motes                  | **cheap**                  | one layer, `<g>` transforms                   |
| C6 god ray                | **cheap**                  | if pre-baked                                  |
| C4 specular sweep         | cheap _or_ moderate        | transform cheap; `mask-position` repaints     |
| C7 aurora                 | **expensive** unless baked | `feTurbulence` re-rasterizes                  |
| C8 motion blur            | **expensive**              | large-area filter @2× DPR, or layer explosion |

---

## D. Anti-patterns and warnings

1. **Hardcoded holds.** Dismiss on readiness, not a timer. Drop-off begins at 2s.
2. **Blocking init behind the art.** `root.inert = true` during the hold means keystrokes typed
   in the first moments are dropped. Buffer them, or release `inert` on first keydown and cut
   to the exit.
3. **Fading in during travel.** If an element is invisible for the first 90% of its path, the
   path doesn't matter. Always split `opacity` and `transform`.
4. **One easing curve for everything.** Identical curves = identical apparent mass = mechanical.
5. **`ease-in` on UI entrances.** The slow head blocks perception of the change.
6. **Emphasized/expo easing on short durations.** Feels _sluggish_ at 50–100ms.
7. **Overshoot on a shared element landing in a fixed slot.** Reads as a miss.
8. **Uniform stagger masquerading as overlapping action.** Real overlap needs a mass hierarchy.
9. **Stagger > 100ms.** Reads as a slideshow. Stay in 30–60ms.
10. **Non-compositor properties.** Never animate `width/height/top/left/margin/padding`, never
    `transition: all`, never `filter: blur()` or `box-shadow` — use a scaled/faded
    pseudo-element.
11. **Layer explosion.** Every promoted element is a full-res VRAM texture.
12. **`backdrop-filter` under an animating ancestor.** Both an ancestor `filter` **and** an
    ancestor `opacity < 1` make the element a backdrop root. Symptom: glass renders flat, then
    pops.
13. **Unskippable.** Any click/keypress/Escape should jump to the end state immediately.
14. **`animation: none` for reduced motion.** Downgrade, don't delete.
15. **Parallax is named in WCAG 2.3.3 (AAA)** as motion that must be disable-able.
16. **Assuming users will notice.** If the depth story is carried only by background clouds it
    will not land; it must be carried by the object the user is already looking at.
17. **Un-preloaded art.** A cloud band that decodes late is a visible hitch at the worst moment.
18. **Screen-reader churn.** `#boot-shell` is `role="status" aria-live="polite"`, then `#root`
    un-hides — an AT user hears the status and then a sudden full-app announcement. Consider
    dropping `aria-live` after the first announcement, and confirm focus lands on the composer
    when `inert` is released.

---

## Three-line summary

1. **Problem "the composer just appears" has an arithmetic cause**: `cubic-bezier(0.16, 1, 0.3, 1)`
   puts an element at **91% of its travel** by the 34% keyframe where opacity reaches 1. Split
   opacity from transform, gentler curve, halve the distance (B1). Then give the bands real
   occlusion and trackable texture (B2) and genuinely different velocities (B3) — occlusion
   without relative motion produces _no depth percept at all_.
2. **"Mechanical"** is mostly one curve doing eight jobs (B11), the backdrop-root pop (B7), and
   a 368ms wind-up that reads as lag (B6).
3. **The flourish** should be _motivated_, not decorative — rebuild the meteor from the SVG group
   already in `v3-splash-stars.svg` and make it _cause_ the logo's arrival (C1).
