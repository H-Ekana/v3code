# UI polish plan: interaction, motion, and feedback

Status: **implemented, reviewed by the user, and partly superseded.** Design authority for the
intensity ladder, duration tokens and status axes; **no longer the execution order.**
Last updated: 2026-07-28
Scope: `apps/web`

> ## ⚠️ Start here, not at this document
>
> This plan was implemented in full and the user then found that **almost none of it was visible in
> the running app**. Do not begin work from this file.
>
> | Read                                                      | For                                                                     |
> | --------------------------------------------------------- | ----------------------------------------------------------------------- |
> | [**Session log**](./nightly-motion-polish-session-log.md) | **Start here.** The narrative: what broke, what was wrong, what is open |
> | [Amended plan](./nightly-motion-polish-amended-plan.md)   | What gets built next and in what order — **execution authority**        |
> | [Diagnosis](./nightly-motion-polish-diagnosis.md)         | Root causes, evidence-backed                                            |
> | [User feedback](./nightly-motion-polish-user-feedback.md) | The user's verbatim critique, items 1–12                                |
> | [Review log](./nightly-motion-polish-review.md)           | Implementation-time per-agent notes                                     |
>
> **Two amendments below are binding and contradict the original text:**
>
> 1. _"Amendment 2026-07-28 — extraordinary states may animate continuously"_ (in Explicit non-goals).
>    The continuous-animation ban now covers **ordinary surfaces only**; `ultrathink` and the top
>    reasoning tier are exempt.
> 2. **Reduced motion is deferred** — see the standing decision at the top of the amended plan. Do not
>    author, tune, or audit reduced-motion fallbacks until the user lifts it.

## Purpose

Extend the elevated composer and send-button language across V3 Code with a deliberate middle level
of expressiveness: more alive than a purely utilitarian developer tool, but calmer than a
decorative neon interface.

The composer/send sequence remains the signature spectacle. Other surfaces may still earn short,
contained moments of personality when they explain causality, preserve spatial continuity, mark a
meaningful completion, or help the user understand which action owns an in-flight request.

This plan synthesizes code-only audits of:

- the main chat and composer interaction stack;
- the sidebar, projects, threads, and agent lifecycle;
- settings, model/provider selection, commands, dialogs, and menus;
- the wider workspace, including panels, terminal, files, diffs, Git, and status banners;
- shared motion, focus, loading, elevation, accessibility, and responsive behavior.

The audits did not launch the app or use browser automation. Every proposal below must still be
verified in the installed app after its focused automated checks pass.

## Product and visual direction

V3 Code is focused, nocturnal, and quietly cyberpunk. It should feel technically capable and
distinctive during long coding sessions. The target is not "motion everywhere" or "motion only
when strictly necessary." It is a recognizable interaction language with clear intensity limits.

### Experience target

The user should feel:

- an immediate physical response when they act;
- a visible owner for every pending operation;
- continuity when content moves, opens, closes, or changes state;
- a small sense of reward when meaningful work completes;
- calm once the state has settled.

The interface should never make the user wait for choreography before work begins or navigation
completes.

### Intensity ladder

Use the lowest level that communicates the event. One interaction should normally produce one
accent event, not a stack of unrelated glows, shifts, and flashes.

#### Level 0 — resting

- Static, neutral, and low-chroma.
- No ambient pulse, shimmer, gradient travel, or permanent wide glow.
- Selected state may retain a quiet tint, solid outline, or icon illumination.

#### Level 1 — micro feedback

- Press, hover, focus, and compact selection acknowledgment.
- Usually `80–150ms`.
- Up to `2px` translation or approximately `0.98–1.02` scale.
- Color, opacity, or a tight shadow/ring; never a broad aura.

#### Level 2 — state handoff

- Disclosure, pending ownership, streaming handoff, tab/page change, and ordinary completion.
- Usually `150–240ms`.
- Up to `4px` translation.
- One small trace, edge, check arrival, or crossfade may accompany the state change.

#### Level 3 — earned accent

- Explicit thread settlement, a clean terminal-session close, Auto-mode entry, or successful
  repository publishing.
- Usually `240–340ms`.
- A bounded violet-to-pink accent may appear once, no more than roughly `4–6px` beyond the owning
  control or row.
- The surface must become completely quiet when the sequence ends.

#### Level 4 — signature

- Reserved for the first-message composer/send sequence and similarly rare hero moments.
- Usually `420–480ms`.
- May combine multiple coordinated layers because it defines the product's motion signature.
- No other routine interaction should compete with it.

### Color roles

- Violet communicates focus, active selection, navigation, and ongoing activity.
- Pink-purple `astro-highlight` supplies the bright tip of a short accent, not a permanent second
  primary color.
- Green, amber, red, and blue retain their semantic meanings for success, waiting/warning, failure,
  and information.
- Status must remain legible through text, icons, or shape; color is never the only signal.
- Inactive controls and idle surfaces stay neutral and low-chroma.
- A completion accent may travel violet-to-pink, but the settled success state remains semantically
  green when success is the information being conveyed.

### Motion roles

- Press feedback: immediate and compact.
- Hover feedback: quiet color or surface response.
- State changes: selection, disclosure, progress, lifecycle, and seen/unseen transitions.
- Layout motion: preserve spatial continuity between related surfaces.
- Accent moments: short acknowledgment for meaningful, user-initiated completion.
- Signature celebration: reserved for the composer/send sequence.

Motion should normally use opacity, transform, clip, or a small fixed glow layer. Avoid continuously
animating large shadows, filters, code viewports, terminal content, or long virtualized lists.

### Shared state model

Do not force every domain into one flat status enum. Present status through four shared axes:

1. **Activity**: queued, running, waiting, interrupted, complete, failed.
2. **Attention**: none, input required, approval required, unseen result.
3. **Outcome**: neutral, success, warning, failure.
4. **Persistence**: active, idle/resumable, snoozed, settled.

Agents, threads, tool calls, Git operations, connection state, and toasts may expose different
combinations of these axes. Shared status recipes map those combinations to text, icon, color, and
motion without erasing domain-specific meaning.

## Already completed

- The centered first-message composer now sequences:
  1. send-button launch;
  2. a short visual handoff;
  3. the composer flight to the dock;
  4. a contained landing glow.
- Actual dispatch remains immediate, and reduced motion skips the choreography.
- The live-agents awareness bar is centered at `52rem`, slightly wider than the `48rem` composer,
  instead of spanning the application width.
- The live-agents bot glyph now uses the brighter pink-purple `astro-highlight` rather than a dark
  violet.

## Implementation order

### Phase 1 — shared foundation and critical feedback

Build this before spreading more local animation. The foundation should be visible enough to give
the product character, while preventing every feature from inventing its own glow, duration,
focus ring, pending treatment, and replay behavior.

#### 1. Semantic motion and effect recipes

Add a small shared layer in `apps/web/src/index.css`:

```css
--motion-press: 100ms;
--motion-hover: 140ms;
--motion-state: 200ms;
--motion-layout: 240ms;
--motion-accent: 300ms;
--motion-signature: 480ms;

--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

Add reusable recipes, not only raw tokens:

- `focus`: clear ring with a restrained primary tint;
- `pending`: icon or trace plus stable text/geometry;
- `arrival`: short opacity/translate handoff;
- `completion`: check arrival plus one tight accent;
- `selected`: static tint/outline with no ambient animation;
- `destructive`: semantic red response without validation shaking;
- `layer`: semantic cross-portal roles for dropdown, sticky chrome, backdrop, modal, toast, and
  tooltip.

Migrate shared primitives and cross-portal layers first. Component-local stacking values may remain
local when they do not participate in the application-wide overlay hierarchy.

Primary files:

- `apps/web/src/index.css`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/toggle.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/toast.tsx`
- shared overlay primitives in `apps/web/src/components/ui`

#### 2. Reduced motion and accessible interaction completeness

Every touched effect must have an instant state change or short crossfade alternative. Reduced
motion should preserve meaning rather than merely freezing an animated spinner in place.

Complete these as part of Phase 1 rather than leaving them as a later backlog:

- audit overlays, collapsibles, toasts, skeletons, status indicators, view transitions, loading
  spinners, and auto-animation;
- add keyboard resizing, `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` to sidebar, right
  panel, terminal, and other applicable resize handles;
- convert color swatches to a radio-style selection model with arrow-key support;
- give hue and saturation/value controls keyboard-operable slider semantics and visible focus;
- normalize coarse-pointer targets to at least `44px` without increasing desktop visual density;
- preserve focus and `aria-activedescendant` behavior during palette, picker, and route transitions;
- associate provider-wizard errors with their fields and announce them;
- use `role="alert"` only for urgent errors; loading, information, and success use polite status
  semantics;
- test placeholder and muted-text contrast across light and dark themes.

Primary files:

- `apps/web/src/index.css`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/preview/RightPanelResizeHandle.tsx`
- `apps/web/src/hooks/useResizableWidth.ts`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/components/color-selector.tsx`
- `apps/web/src/components/settings/ProviderAccentColorPicker.tsx`
- provider setup/wizard components

#### 3. Shared status presentation

Implement the shared activity, attention, outcome, and persistence axes described above. Build small
presentation helpers or recipes rather than a monolithic status component that knows every domain.

The visual vocabulary should include:

- running: contained violet trace or duty-cycled pulse plus label/icon;
- waiting: amber plus explicit waiting/approval/input text;
- unseen completion: one violet-to-pink arrival plus check and text;
- seen completion: static success or neutral completed treatment;
- interrupted: explicit interrupted label and stable stop/break icon;
- failed: destructive emphasis plus recoverable next action when available;
- idle/resumable: quiet neutral state distinct from completion;
- settled/snoozed: persistence state distinct from success/failure.

Retheme the remaining cyan/blue `Working` treatment in thread rows. Use the shared violet running
recipe for the spinner trace, label, elapsed time, and a contained active-row detail. Keep the
label and icon so activity is never communicated by color alone. Reserve blue for genuinely
informational states elsewhere.

Likely consumers:

- `apps/web/src/components/AgentsPanel.tsx`
- `apps/web/src/components/ThreadStatusIndicators.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/SidebarV2.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- connection indicators
- loading and operation toasts

### Phase 2 — core conversation feedback

#### 4. Agent lifecycle choreography

Make agent state changes feel connected and slightly more expressive than ordinary rows:

- new agents arrive with a `4px`/opacity transition over roughly `180ms`;
- running agents may carry a tight halo or ring no more than `4px` beyond the status mark;
- the running ring contracts into the completion check over roughly `180–220ms`;
- the card border/tint settles into its inactive surface over roughly `220–260ms`;
- activity details reveal over roughly `160–180ms` rather than mounting abruptly;
- phase counts crossfade over roughly `140–160ms` instead of jumping.

Use one coordinated completion sequence. Do not combine a broad card glow, icon flash, border sweep,
and count animation on the same transition.

Do not replay arrival or completion accents when historical or already-completed agents remount.

Primary file:

- `apps/web/src/components/AgentsPanel.tsx`

#### 5. Live-response edge

Give only the newest actively streaming assistant content a small live edge:

- use a `1–2px` edge or compact marker, roughly `12–16px` long;
- let it connect naturally to or replace the working indicator when content begins;
- use violet as the base with at most a small `astro-highlight` tip;
- allow one `120–160ms` completion glint when streaming resolves;
- never animate individual tokens or illuminate the entire message;
- remove the edge immediately when the content is no longer the newest active stream.

This is a Level 2 handoff, not a second signature effect.

Primary files:

- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/ChatMarkdown.tsx`

#### 6. Tool-call lifecycle

Give tool rows explicit running, completion, failure, and disclosure transitions:

- current tool: contained violet icon trace or partial orbit;
- completion: check arrival plus one icon-sized `120–160ms` flash;
- failure: semantic destructive emphasis with no celebratory accent;
- neutral/empty completion: explicit neutral mark rather than a misleading success check;
- details: `160–180ms` height/opacity disclosure transition.

Keep the row geometry stable. Track lifecycle identity so virtualization, history restoration, and
group expansion do not replay one-shot effects.

Primary file:

- `apps/web/src/components/chat/MessagesTimeline.tsx`

#### 7. Stop and interruption feedback

Make the stop interaction both clearer and more expressive:

- acknowledge the press in under `100ms`;
- keep the circular button geometry stable;
- compress/fade the stop square into a compact spinner or progress trace inside the same button;
- add a tight red-to-neutral press ring that disappears as the pending state begins;
- disable repeated stop requests;
- show `Stopping…` in the active response state and announce it politely;
- settle into an explicit interrupted state;
- if interruption fails, restore the stop action and expose the error without leaving the UI stuck.

Use `aria-busy` or a polite status announcement. The animation supports the state contract; it does
not substitute for it.

Primary files:

- `apps/web/src/components/chat/ComposerPrimaryActions.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`

#### 8. Questions and approvals

Make selection and submission feel causally connected:

- acknowledge a selected answer with a compact press response and check arrival;
- directionally crossfade between questions by roughly `4px` over `160–180ms`;
- allow the chosen approval action to become the progress owner;
- retain the chosen action's emphasis while dimming and disabling alternatives;
- place the spinner/status glyph inside the chosen action without changing its outer geometry;
- announce the submitted choice and pending state;
- restore all actions with clear error feedback if submission fails.

Keep approval meaning amber. Violet frames focus and structure; it does not replace semantics.

Primary files:

- `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`
- `apps/web/src/components/chat/ComposerPrimaryActions.tsx`

#### 9. Auto mode distinction

Auto mode should feel special without reading as magical or permanently loud:

- when Auto is selected, give the sparkles glyph a crisp primary outline and a tight afterglow no
  wider than roughly `3–4px`;
- keep the glow anchored to the star shapes rather than illuminating the full trigger;
- use the same selected-state treatment in the full composer control, compact menu, and picker row;
- allow one `160–200ms` violet-to-pink glint when the user switches into Auto;
- leave the icon in a quiet static illuminated state after entry;
- retain the visible `Auto` label and add the short AI-review description where compact space
  permits;
- under reduced motion, omit the entry glint while preserving the outlined icon and text.

The copy must explain the safety difference between Auto and Full Access more strongly than the
visual effect does.

Primary files:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`

#### 10. Composer-to-timeline handoff

Complete the signature send sequence by animating only the newly created user turn:

- a roughly `4px` masked or clipped arrival;
- a `1px` violet edge that brightens once and resolves within `120–160ms`;
- exponential easing;
- no delay before the message becomes readable.

Never animate initial history, restored scroll content, or virtualized remounts. The user-turn
arrival should feel like the landing point of the send sequence, not a second celebration.

Primary file:

- `apps/web/src/components/chat/MessagesTimeline.tsx`

#### 11. Thread-settlement acknowledgment

Explicitly settling a single thread earns a Level 3 acknowledgment, but it should be shorter than
the composer spectacle:

- respond to the press immediately and show a pending owner in the settle control;
- trigger the acknowledgment only after settlement succeeds;
- draw or resolve the settle check while a bounded ring or edge travels around the owning action;
- keep the accent within roughly `4px` of the action and complete it in `240–300ms`;
- give the row one contained `160–200ms` edge illumination before or as it moves into its settled
  presentation;
- preserve spatial continuity when the row relocates.

Use the full acknowledgment only for a user-initiated single-thread settle. Bulk settle, automatic
settlement, remount, reorder, and opening an already-settled thread use a quiet shared completion
summary or no flourish. A failed settlement receives semantic error feedback and no completion
accent. Reduced motion shows the confirmed check and settled label without ring travel.

Primary files:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/SidebarV2.tsx`
- `apps/web/src/components/Sidebar.logic.ts`

### Phase 3 — navigation and workspace continuity

#### 12. Sidebar collapse, resize, and project switching

- Use a coherent `200–220ms` collapse/expand transition.
- Crossfade the open/closed trigger icon over roughly `120ms`.
- During manual resize, illuminate the rail with a `1px` violet line and a very small
  `astro-highlight` tip at drag start.
- Keep drag resizing immediate and RAF-driven; do not animate width while dragging.
- Add keyboard resizing and full separator/value semantics.
- Crossfade project identity over roughly `160ms` and let affected rows settle rather than
  hard-swapping.
- Ensure drag-and-drop animation, list auto-animation, and project switching never compete for the
  same transform.

Primary files:

- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/SidebarV2.tsx`

#### 13. Right panel and tabs

Make the right panel feel physically attached to the workspace:

- preserve the shell through a short `180–220ms` exit rather than hard-unmounting it immediately;
- use transform/FLIP or an equivalent compositor-friendly technique for chat-column and panel
  movement;
- add a slim moving violet indicator with a small pink leading tip for the active tab;
- directionally crossfade panel content by about `4px` over `150–180ms`;
- use proper tablist, tab, and tabpanel semantics with keyboard navigation;
- preserve focus when possible and make closed or exiting content inert;
- do not retain expensive browser/terminal content indefinitely solely for animation—preserve state
  through the existing stores and keep the animated shell lifetime bounded.

Do not animate panel width while the user is dragging the resize handle.

Primary files:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/RightPanelTabs.tsx`
- `apps/web/src/components/preview/PreviewPanelShell.tsx`
- `apps/web/src/components/preview/RightPanelResizeHandle.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`

#### 14. Command palette and settings navigation

Command palette:

- restrained violet selected plane;
- a `1px` leading-icon shift plus brightness response over roughly `100–120ms`;
- directional submenu transition of about `4px` over `140–160ms`;
- no entrance animation per filtering keystroke;
- preserve `aria-activedescendant`, scroll position, and keyboard immediacy.

Settings:

- use one compact moving marker—a short rail segment or `3–4px` dot—between active navigation rows;
- allow a very tight glow only during movement, then settle to a static marker;
- incoming pages settle by about `4px` with a `150–180ms` crossfade;
- route focus, heading announcements, and browser history behavior remain immediate.

Primary files:

- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/CommandPaletteResults.tsx`
- `apps/web/src/components/ui/command.tsx`
- `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- `apps/web/src/routes/settings.tsx`

#### 15. Model picker

- Move the provider-rail marker with transform/FLIP rather than animating `top`.
- Add a clear focus-visible ring rather than relying on background change alone.
- Confirm model selection with a `80–120ms` row/icon response.
- Do not add more than roughly `80ms` of perceived close latency; when possible, let the popup exit
  preserve the selected-row snapshot while closing immediately.
- Preserve existing provider accents without increasing the selected-row glow.
- Keep keyboard focus and active-descendant state correct while the marker moves.

Primary files:

- `apps/web/src/components/chat/ModelPickerSidebar.tsx`
- `apps/web/src/components/chat/ModelListRow.tsx`
- `apps/web/src/components/chat/ModelPickerContent.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`

### Phase 4 — secondary workbench surfaces

#### 16. Terminal drawer

- Replace the `hidden` hard-switch with a deliberate `180–220ms` surface launch and exit.
- Keep mounted terminal state intact while making closed content inert and absent from keyboard
  navigation.
- Use a thin primary illumination on the resize affordance during hover/drag.
- Add keyboard resizing and separator/value semantics.
- Use quiet terminal-tab transitions.
- On a user-initiated close of a cleanly exited session, let the tab glyph resolve into a compact
  check/fade over roughly `180–220ms`.
- Do not celebrate ordinary command completion, forced termination, crash, or background-session
  cleanup.
- Refit xterm at transition boundaries and resize checkpoints rather than on every animation frame.

Primary files:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`

#### 17. Files and diffs

- Preserve continuity between file tree selection and preview.
- Crossfade loading, error, empty, and content states over roughly `140–180ms`.
- Animate diff-scope changes as short directional navigation of roughly `4px`, not as a full-page
  replacement.
- Delay skeleton appearance by roughly `120–160ms` to avoid flashes on fast cached changes.
- Reveal changed-file cards and directories without staggering large trees.
- Keep the prior usable content visible during background refresh when the data contract permits.
- Announce errors and scope changes without waiting for the visual transition.

Primary files:

- `apps/web/src/components/files/FilePreviewPanel.tsx`
- `apps/web/src/components/files/FileBrowserPanel.tsx`
- `apps/web/src/components/DiffPanel.tsx`
- `apps/web/src/components/DiffPanelShell.tsx`
- `apps/web/src/components/chat/ChangedFilesTree.tsx`

#### 18. Git, branch, environment, and publishing feedback

- Keep the invoked control's outer geometry stable while its icon/label crossfades into contained
  progress feedback.
- Crossfade branch/environment labels only after confirmed changes.
- Use a narrow route-progress treatment for pending context changes.
- Keep routine commit, pull, push, and already-up-to-date outcomes quiet.
- For successful repository publishing, use a bounded `260–320ms` acknowledgment: semantic green
  success at the center with one tight violet-to-pink ring or halo no wider than `4–6px`.
- Do not run the publishing accent until the remote exists and the initial push is confirmed.
- Failures retain the invoked control as the recovery owner and receive no completion accent.

Primary files:

- `apps/web/src/components/GitActionsControl.tsx`
- `apps/web/src/components/GitActionsControl.logic.ts`
- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/components/BranchToolbarBranchSelector.tsx`
- `apps/web/src/components/BranchToolbarEnvironmentSelector.tsx`
- route and environment status components

#### 19. Toasts, banners, loading, and empty states

- Shorten toast arrival from `500ms` to approximately `220–240ms`.
- Give outcomes contained semantic accents without changing toast geometry.
- Allow one tight Level 2 completion trace on important success toasts; routine informational toasts
  simply crossfade/slide.
- Animate status-banner entrance and recovery without delaying announcements.
- Keep button geometry stable while compact status glyphs and labels communicate loading.
- Transition from loading to empty states with a short crossfade.
- Empty states should teach the next action and may use a small, semantic icon treatment rather than
  decorative illustration.
- Respect expanded toast stacks, swipe behavior, and reduced motion.

Primary files:

- `apps/web/src/components/ui/toast.tsx`
- `apps/web/src/components/ui/toast.logic.ts`
- chat/provider status banners
- shared skeleton and empty-state primitives

## Visual cleanup

- Replace the continuous rainbow/gradient-text `ultrathink` treatment with a quieter special-state
  recipe: solid readable text, a static multitone or primary rim, and at most one short spectrum
  sweep when the mode is entered. No continuous hue rotation or gradient text.
- Replace hard-coded sidebar/auth colors with semantic theme tokens where practical.
- Reduce permanent combinations of translucent glass, a border, and broad shadow. Keep the composer
  as the richest elevated surface and make secondary cards quieter.
- Consolidate duplicated focus, disclosure, overlay, pending, completion, and status styling into
  reusable recipes.
- Keep accent glows tight: ordinary effects stay within `3–4px`; earned accents stay within `4–6px`;
  only the signature composer sequence may exceed that.

## Explicit non-goals

- No confetti outside a genuinely exceptional future moment; the current plan does not require it.
- No per-token streaming motion.
- No bouncing rows, elastic easing, validation shaking, or magnetic controls.
- No permanent neon outlines or ambient star particles on idle surfaces — **except on an explicitly
  declared extraordinary state** (see below).
- No continuous animation when no work is active **on ordinary surfaces**. Extraordinary states are
  exempt (see below).

### Amendment 2026-07-28 — extraordinary states may animate continuously

The two rules above were originally absolute, and that was wrong. Corrected by the user:

> No continuous animation when no work is active? Who said that? […] Under normal circumstances yes,
> but ultracode, ultrathink, and whatever are not normal.

The rules stand for **ordinary** surfaces, which is nearly everything: rows, tabs, trees, buttons,
panels, toasts, the idle composer. Those must still go completely quiet once state has settled.

An **extraordinary state** is one the user deliberately opted into, that is rare, that is visibly
exceptional, and that they want to feel exceptional for as long as it is active. Continuous motion is
permitted there, because the motion _is_ the signal that the mode is on. Currently:

- `ultrathink` — slow drifting iridescent fill plus a continuously travelling rim streak;
- the top reasoning tier on any provider — Codex **Max**, and the equivalent high/max settings
  elsewhere — with a toned-down member of the same family.

Constraints that still apply to an extraordinary state:

- it must be **user-selected**, never automatic, and it must end when the mode ends;
- it must be **cheap**: `background-position` drift, `opacity`, `transform`, or a registered-angle
  rim. No filter animation, no large shadows, no per-frame layout;
- it must be **slow** — a long period reads as alive without pulling the eye off the work;
- it must not compete with the Level 4 composer/send sequence;
- reduced motion still holds the animation still while keeping the state fully legible.

Adding a surface to this list is a deliberate decision, recorded here. Anything not on the list is
ordinary and the original rules apply unchanged.

- No purple/pink replacement for semantic red, amber, green, or informational blue.
- No full-panel blur/filter animation over terminal, diff, browser, or file content.
- No hover scaling on dense rows, trees, tabs, or icon trays.
- No simultaneous animation systems fighting over the same transform.
- No state-changing action delayed solely so its flourish can finish.
- No new animation dependency unless CSS, WAAPI, View Transitions, and the existing auto-animation
  utilities prove insufficient.

## Verification expectations

For each implementation slice:

1. Add focused tests for state transitions, pending ownership, failure recovery, and replay
   prevention where behavior is stateful.
2. Run only the affected tests, targeted format/lint checks, and the web package typecheck.
3. Verify reduced-motion behavior in code and tests.
4. Ask the user to inspect the exact affected flow in the installed app.
5. Check that historical/virtualized content does not replay one-shot effects.
6. Confirm keyboard focus and assistive status announcements remain immediate.
7. Confirm high-frequency interactions remain quieter than the composer/send sequence.
8. Test both light and dark themes at compact and wide layouts.
9. Confirm no meaningful content is hidden until an animation completes.
10. Confirm long lists, terminals, diffs, and browser surfaces do not animate expensive layout,
    filter, or large-shadow properties.
11. Confirm drag/resize paths remain RAF-driven and visually immediate.
12. Record the effect level used for each new animation so review can reject intensity creep.

## Recommended delivery sequence

Land the work through focused slices rather than one cross-application animation PR.

### Milestone 1 — foundation and trustworthy feedback

1. semantic motion/effect recipes and overlay roles;
2. reduced-motion and accessible resize/color-control work;
3. shared status presentation axes;
4. stop/interruption pending ownership;
5. approval/question ownership and recovery.

### Milestone 2 — expressive core conversation loop

1. agent lifecycle choreography;
2. tool-call lifecycle;
3. live-response edge;
4. composer-to-timeline handoff;
5. single-thread settlement acknowledgment;
6. Auto-mode distinction.

### Milestone 3 — workspace continuity

1. sidebar collapse, resize, and project switching;
2. right-panel shell, tab semantics, and active indicator;
3. command palette and settings navigation;
4. model-picker marker, focus, and selection response.

### Milestone 4 — workbench and system feedback

1. terminal drawer and clean-exit acknowledgment;
2. file/diff state continuity;
3. Git/environment progress and publishing acknowledgment;
4. toast, banner, loading, and empty-state polish;
5. `ultrathink` cleanup.

Each milestone should preserve the intensity ladder: Level 1 for frequent controls, Level 2 for
state handoffs, Level 3 only for explicitly named earned accents, and Level 4 only for the
signature composer/send sequence.
