# Send-morph animation fix — research + implementation handoff

**Date:** 2026-07-29
**Repo:** `C:\Users\Hritwik\Documents\GitHub\v3code`
**Status:** Implemented, tests green, typecheck clean. Changes are **uncommitted working-tree edits** awaiting the user's visual check in the running app.

> Context for a new session: this work was done from a Claude Code session
> accidentally rooted in `Auto-Ballooning-Sunren`. Claude's file tools could
> edit v3code directly, so the fix landed anyway; only the Codex rescue agent
> was blocked (its sandbox is fixed to the session root, and
> `codex-windows-sandbox-setup.exe` was reported missing — run `/codex:setup`
> in a v3code-rooted session if Codex is wanted later).

---

## 1. The problem

The chat "send morph": when you press send, the drafted text lifts out of the
composer and flies into the newly arriving user message bubble. The user
reported it looks glitchy/unpolished — text gets squished, warped, and blurry,
and it's especially bad with image attachments.

## 2. Research: video frame analysis

Source: `C:\Users\Hritwik\Videos\NVIDIA\Desktop\Desktop 2026.07.29 - 15.18.21.03.DVR.mp4`
(1.83 s, 2560×1440, ~30 fps). Extracted all 56 frames with ffmpeg
(installed via winget: `Gyan.FFmpeg`) to `%TEMP%\composer-frames\`, plus
bubble-region crops (`crop=880:560:840:940`) to `%TEMP%\composer-crops\`.

Findings by frame:

- **Frames ~25–30 (lift-off):** the flyer detaches at the composer's full
  width and glides up, passing over unrelated content (the "Working for 0s"
  indicator). Its text is wrapped at composer width.
- **Frames ~36–40 (landing):** clear **double-exposure** — the real bubble's
  text plus a translucent, differently-wrapped ghost copy of the same sentence
  overlapping underneath it ("…back the stored path value where you stored the
  file" readable twice in frame 40). Text also looks compressed/blurry.

## 3. Root causes (in code)

File: `apps\web\src\components\chat\sendMorphTransition.ts`
(flyer motion; the landing hook `data-user-turn-arrival` is rendered by
`UserTimelineRow` in `apps\web\src\components\chat\MessagesTimeline.tsx`; the
flyer's glass look is `.conversation-send-flyer` in
`apps\web\src\styles\conversation.css`).

The flyer was a single text `<div>` snapshotted from the composer, animated
per-frame with:

```ts
flyer.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;
```

Three compounding defects:

1. **Non-uniform scale = squish + blur.** `sx`/`sy` were computed
   independently from (composer box → bubble box). Different width and height
   ratios stretch the text by different factors per axis; scaling a rasterized
   text layer also softens it. With an image attachment the bubble is much
   taller, so `sy >> sx` and everything warps dramatically.
2. **Text never reflows.** The flyer's text wrapped at composer width and was
   merely scaled; the real bubble wraps at bubble width with different
   padding. The two layouts could never match, even at a perfect landing.
3. **Crossfade started far too early.** `SEND_MORPH_CROSSFADE_FRACTION = 0.6`
   meant the mis-scaled flyer and the real bubble were both visible for the
   final ~280 ms of the 700 ms flight → the doubled/ghosted text.

## 4. Solutions considered (ranked as presented to the user)

1. **Destination-layout flyer + translate-only motion** ← _chosen (with #3)_
   Build/restyle the flyer at the destination bubble's layout so text wraps
   identically, and animate position only — nothing is ever scaled.
2. **Container-transform variant** (Material pattern): morph only the
   container box (width/height/radius) while inner text stays at final layout
   and is clipped. _Kept as the upgrade path if the user wants the box to
   visibly stretch out of the composer._
3. **Tighten the crossfade** to the final ~15 % with offset ramps ← _chosen_
4. Uniform scale + fade-through (cheapest patch; rejected — still blurry).
5. Attachments guard: never let images ride a non-uniform scale (moot once
   scale is removed; height differences absorbed by the crossfade).

## 5. Changes made (all uncommitted)

### `apps/web/src/components/chat/sendMorphTransition.ts`

- **Removed scale entirely** from `stepFlight` — transform is now
  `translate3d(dx, dy, 0)` only. Dropped the now-unused
  `startWidth`/`startHeight` from `ActiveSendMorph`.
- **Added `adoptDestinationLayout(flyer, bubble)`**, called at the top of
  `beginFlight` (the moment the arriving bubble is found): copies the bubble's
  computed width, padding, border-radius, background-color, font family/size/
  weight, line-height, letter-spacing, color, and text-align onto the flyer,
  so its text wraps exactly like the landing bubble for the whole flight.
  One-time layout write; every frame after remains transform + opacity only.
  (During the brief seeking phase — a frame or two, hidden under the composer
  clearing — the flyer still shows composer geometry; imperceptible.)
- **Crossfade:** `SEND_MORPH_CROSSFADE_FRACTION` 0.6 → **0.85**; new
  `SEND_MORPH_FLYER_FADE_END = 0.95`. The flyer's fade-out ramp runs
  0.85→0.95 while the bubble's fade-in runs 0.85→1.0, so two full-strength
  copies never coexist.
- Flyer height cap changed from fixed `height` to **`max-height`** (natural
  height, clipped by the class's `overflow: hidden`) — no longer a scale
  input.
- Explanatory comment blocks rewritten to describe the new mechanism.
- **Preserved:** singleton flight, live per-frame retargeting (one
  `getBoundingClientRect` on the bubble), fallback dissolve when no bubble
  lands within 10 frames, reduced-motion/headless bailout
  (`canRunSendMorph`), `retireSendMorph` clearing bubble inline styles,
  `mergeOptimisticUserMessages` untouched.

### `apps/web/src/components/chat/sendMorphTransition.test.ts`

- Flight test now asserts the transform contains `translate3d` and **not**
  `scale`.
- Crossfade test rewritten: no crossfade at t=0.8; at t=0.9 flyer opacity 0.5
  vs bubble ⅓ (flyer leads); at t=0.96 flyer fully out while bubble still
  fading in.
- New test: flyer adopts the bubble's width at landing
  (`flyer.style.width === "240px"` for a 240px bubble rect) and stays
  translate-only afterward.

### `apps/web/src/styles/conversation.css`

- `.conversation-send-flyer` comment block updated (destination layout,
  translate-only, tight crossfade). No rule changes.

## 6. Verification

- `bun run test src/components/chat/sendMorphTransition.test.ts
src/components/chat/MessagesTimeline.lifecycle.test.tsx` (from `apps/web`,
  runner is `vp test run --project unit`): **28/28 passed**.
- `bun run typecheck` (`tsgo --noEmit`): **clean**.
- Note: the v3code working tree carries many **pre-existing unrelated
  modifications** (dozens of files). Only the three files above were touched
  by this work — do not sweep the rest into a commit for this fix.
- A design-lint hook flagged pre-existing `border-radius: 1rem` on
  `.conversation-send-flyer` (design-system-radius). Intentional — it matches
  the bubble's `rounded-2xl` and is overridden by the bubble's computed radius
  at landing. Left as-is, not suppressed.

## 7. Next steps

1. **User visual check** in the running V3 Code app: send a text message and
   one with image attachments; confirm no squish, no blur, no doubled text.
2. If the takeoff reads too abrupt (text becomes bubble-shaped immediately at
   lift-off), implement **solution #2 (container transform)**: interpolate the
   flyer's box (width/height/border-radius) from composer rect → bubble rect
   while the inner text stays at final layout and is clipped.
3. Optionally include attachment thumbnails in the flyer at final aspect
   ratio (currently the flyer is text-only; attachments simply arrive with
   the bubble via the crossfade).
4. Commit when the user confirms (they prefer batching commits at feature
   boundaries they pick).
