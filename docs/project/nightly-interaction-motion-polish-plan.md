# Nightly interaction and motion polish plan

Status: proposed implementation plan  
Last updated: 2026-07-27  
Scope: `apps/web`

## Purpose

Extend the elevated composer and send-button language across V3 Code without turning the product
into a decorative neon interface. The composer/send sequence remains the signature spectacle.
Other surfaces should feel alive through clear state changes, spatial continuity, restrained
purple/pink accents, and meaningful completion feedback.

This plan synthesizes code-only audits of:

- the main chat and composer interaction stack;
- the sidebar, projects, threads, and agent lifecycle;
- settings, model/provider selection, commands, dialogs, and menus;
- the wider workspace, including panels, terminal, files, diffs, Git, and status banners;
- shared motion, focus, loading, elevation, accessibility, and responsive behavior.

The audits did not launch the app or use browser automation. Every proposal below must still be
verified in the installed app after its focused automated checks pass.

## Product and visual direction

V3 Code is focused, nocturnal, and quietly cyberpunk. It should remain comfortable during long
coding sessions. Personality comes from a consistent interaction language rather than permanent
decoration.

### Color roles

- Violet communicates focus, active selection, navigation, and ongoing activity.
- Pink-purple `astro-highlight` supplies brief emphasis and earned celebration.
- Green, amber, and red retain their semantic meanings for success, waiting/warning, and failure.
- Status must remain legible through text, icons, or shape; color is never the only signal.
- Inactive controls and idle surfaces stay neutral and low-chroma.

### Motion roles

- Press feedback: immediate and compact.
- Hover feedback: quiet color or surface changes.
- State changes: selection, disclosure, progress, and lifecycle transitions.
- Layout motion: preserve spatial continuity between related surfaces.
- Celebration: reserved for important completions, with the send sequence as the richest example.

Motion should normally use opacity, transform, clip, or a small fixed glow layer. Avoid continuously
animating large shadows, filters, code viewports, terminal content, or long virtualized lists.

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

### Phase 1 — shared interaction foundation

Build this before spreading more local animations. It prevents the product from accumulating
slightly different durations, easing curves, focus rings, and status effects.

#### 1. Semantic motion tokens

Add a small shared layer in `apps/web/src/index.css`:

```css
--motion-press: 100ms;
--motion-hover: 140ms;
--motion-state: 200ms;
--motion-layout: 260ms;
--motion-celebration: 480ms;

--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

Also establish semantic focus, surface, status, and z-index roles rather than continuing to add
hard-coded violet/pink shadows and arbitrary stacking values.

Primary files:

- `apps/web/src/index.css`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/toggle.tsx`
- `apps/web/src/components/ui/card.tsx`

#### 2. Reduced-motion completeness

Every touched primitive must have an instant state change or short crossfade alternative. Close
existing gaps in overlays, collapsibles, toasts, skeletons, status indicators, view transitions,
and loading spinners.

#### 3. Shared status lifecycle

Create one reusable status vocabulary for:

- running;
- waiting;
- completed but unseen;
- completed and seen;
- interrupted;
- failed.

The lifecycle should use icons/text as well as color. Running may use a duty-cycled violet pulse;
waiting remains amber; unseen completion gets one violet-to-pink arrival plus a check; seen
completion is static; failure stays destructive.

Retheme the remaining cyan/blue `Working` treatment in thread rows as part of this shared
lifecycle. The spinner trace, `Working` label, elapsed time, and any active-row edge should use the
established violet-to-pink status recipe rather than the generic info-blue tokens. Keep the label
and animated ring so activity is never communicated by color alone, keep the effect contained to
the active row, and provide a static violet indicator under reduced motion. Reserve blue for
genuinely informational states elsewhere in the product.

Likely consumers:

- `apps/web/src/components/AgentsPanel.tsx`
- `apps/web/src/components/ThreadStatusIndicators.tsx`
- sidebar status components
- connection indicators
- timeline working indicators
- loading toasts

### Phase 2 — core conversation feedback

#### 4. Agent lifecycle choreography

Make agent state changes feel connected:

- New agents arrive with a restrained 4px/opacity transition.
- A running halo contracts into the completion check.
- The card border/aura settles into its inactive surface over roughly 240–280ms.
- Activity details reveal over roughly 180ms rather than mounting abruptly.
- Phase counts crossfade instead of jumping.

Do not replay completion flourishes when historical or already-completed agents remount.

Primary file: `apps/web/src/components/AgentsPanel.tsx`

#### 5. Live-response edge

Give only the newest actively streaming assistant content a tiny violet/pink live edge. It should:

- replace or connect naturally to the working indicator when content begins;
- remain confined to a small pseudo-element;
- resolve with one completion glint;
- never animate individual tokens or illuminate the entire message.

Primary files:

- `apps/web/src/components/MessagesTimeline.tsx`
- `apps/web/src/components/ChatMarkdown.tsx`

#### 6. Tool-call lifecycle

Give tool rows explicit running, completion, failure, and disclosure transitions:

- current tool: contained violet icon trace;
- completion: one check arrival and icon-sized flash;
- failure: semantic destructive emphasis;
- details: 180ms disclosure transition.

Track lifecycle identity so virtualization and history restoration do not replay effects.

Primary file: `apps/web/src/components/MessagesTimeline.tsx`

#### 7. Stop and interruption feedback

The stop interaction needs an immediate intermediate state:

- morph the square into a thin progress treatment;
- disable repeated stop requests;
- show “Stopping…” in the active response state;
- settle into an explicit interrupted state.

Press feedback must occur in under 100ms. Assistive technology should receive the state through
`aria-busy` or a polite status announcement.

Primary files:

- `apps/web/src/components/chat/ComposerPrimaryActions.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/MessagesTimeline.tsx`

#### 8. Questions and approvals

Make selection and submission feel causally connected:

- acknowledge a selected answer with a short press/check response;
- directionally crossfade between questions;
- allow the chosen approval action to become the progress owner;
- dim alternatives instead of making every action look equally disabled.

Keep approval meaning amber. Violet frames focus and structure; it does not replace semantics.

Primary files:

- `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`

#### 9. Auto mode distinction

Auto mode is a new, special capability and should be recognizable at a glance without making the
entire runtime-mode control permanently loud:

- when Auto is selected, give the sparkles glyph a crisp purple outline and a contained purple
  afterglow no wider than roughly 6–8px;
- keep the glow anchored to the star shapes rather than illuminating the full trigger;
- use the same selected-state treatment in the compact composer control and Auto's picker row;
- allow one quick violet-to-pink glint when the user switches into Auto, then leave the icon in a
  quiet static illuminated state;
- keep the visible `Auto` label and selection semantics so the mode is never communicated by color
  alone;
- under reduced motion, omit the entry glint while preserving the outlined, softly illuminated
  stars.

Primary files:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`

#### 10. Composer-to-timeline handoff

Complete the signature send sequence by animating only the newly created user turn:

- a roughly 6px masked arrival;
- a brief violet edge illumination;
- 160–180ms exponential easing.

Never animate initial history, restored scroll content, or virtualized remounts.

Primary file: `apps/web/src/components/MessagesTimeline.tsx`

#### 11. Thread-settlement celebration

Settling a thread represents the intentional completion of a substantial body of work and should
earn a richer acknowledgment than an ordinary row action:

- respond to the press immediately, but trigger the celebration only after settlement succeeds;
- draw or resolve the settle check while a bounded violet-to-pink ring travels around the action;
- let the completed row receive one contained edge illumination before it moves into its settled
  presentation;
- preserve spatial continuity if settling relocates the row to another section;
- keep the full sequence to roughly 400–480ms, after which the row becomes completely quiet.

Do not replay the flourish when a settled thread remounts, when the sidebar reorders, or when the
user opens an already-settled thread. A failed settlement receives normal semantic error feedback
and no celebration. Reduced motion shows the confirmed check and settled label without the ring or
row travel.

Primary files:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/SidebarV2.tsx`
- `apps/web/src/components/Sidebar.logic.ts`

### Phase 3 — navigation and workspace continuity

#### 12. Sidebar collapse, resize, and project switching

- Use a coherent 220ms collapse/expand transition.
- Crossfade the open/closed trigger icon.
- During manual resize, illuminate the rail with a thin violet-to-pink active line.
- Keep drag resizing immediate and RAF-driven; do not animate the width while dragging.
- Add keyboard resizing and separator semantics.
- Crossfade project identity and let affected rows settle rather than hard-swapping.

Primary files:

- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/SidebarV2.tsx`

#### 13. Right panel and tabs

Make the right panel feel physically attached to the workspace:

- preserve the shell through exit instead of hard unmounting;
- use shared geometry/FLIP for chat-column and panel movement;
- add a slim moving violet/pink active-tab indicator;
- directionally crossfade panel content by about 6px;
- preserve focus and make closed content inert.

Do not animate while the user is dragging the panel resize handle.

Primary files:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/RightPanelTabs.tsx`
- `apps/web/src/components/preview/PreviewPanelShell.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`

#### 14. Command palette and settings navigation

Command palette:

- restrained violet selected plane;
- small leading-icon shift/brightness response;
- directional submenu transition;
- no animation per filtering keystroke.

Settings:

- one shared orbital marker travels between active navigation rows;
- incoming pages settle by about 5px with a short crossfade;
- route focus and heading announcements remain immediate.

Primary files:

- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/CommandPaletteResults.tsx`
- `apps/web/src/components/ui/command.tsx`
- `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- `apps/web/src/routes/settings.tsx`

#### 15. Model picker

- Move the provider-rail marker with transform/FLIP rather than animating `top`.
- Add a clear focus-visible state.
- Briefly confirm model selection before the picker closes.
- Preserve existing provider accents without increasing the selected-row glow.

Primary files:

- `apps/web/src/components/chat/ModelPickerSidebar.tsx`
- `apps/web/src/components/chat/ModelListRow.tsx`
- `apps/web/src/components/chat/ModelPickerContent.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`

### Phase 4 — secondary workbench surfaces

#### 16. Terminal drawer

- Deliberate surface launch and exit rather than `hidden` hard-switching.
- Thin primary illumination on the resize affordance during hover/drag.
- Quiet terminal-tab transitions.
- Celebrate terminal session exit only, not ordinary command completion.
- Refit xterm after the transition, not on every frame.

#### 17. Files and diffs

- Preserve continuity between file tree and preview.
- Crossfade loading, error, and content states.
- Animate diff-scope changes as navigation, not replacement.
- Delay skeleton appearance briefly to avoid flashes on fast cached changes.
- Reveal changed-file cards and directories without staggering large trees.

Primary files:

- `apps/web/src/components/files/FilePreviewPanel.tsx`
- `apps/web/src/components/files/FileBrowserPanel.tsx`
- `apps/web/src/components/DiffPanel.tsx`
- `apps/web/src/components/DiffPanelShell.tsx`
- `apps/web/src/components/chat/ChangedFilesTree.tsx`

#### 18. Git, branch, environment, and publishing feedback

- Morph the invoked Git action into contained progress feedback.
- Crossfade branch/environment labels after confirmed changes.
- Use a narrow route-progress treatment for pending context changes.
- Reserve a bounded 400–440ms violet/pink halo for successful repository publishing.
- Keep semantic success green and routine commit/pull/push operations quiet.

#### 19. Toasts, banners, loading, and empty states

- Shorten toast arrival from 500ms to approximately 220–240ms.
- Give outcomes contained semantic accents without changing toast geometry.
- Animate status-banner entrance and recovery without delaying announcements.
- Use stable button labels and compact status glyphs for loading.
- Transition from loading to empty states with a short crossfade.
- Empty states should teach the next action instead of adding decorative illustrations.

## Accessibility and hardening backlog

Complete these alongside the relevant visual work:

- Add keyboard and semantic support to sidebar and panel resize handles.
- Fix tiny or pointer-only controls in `components/color-selector.tsx` and
  `settings/ProviderAccentColorPicker.tsx`.
- Test placeholder contrast across light and dark themes.
- Preserve focus and `aria-activedescendant` behavior during palette transitions.
- Associate provider-wizard errors with their fields and announce them.
- Normalize coarse-pointer targets to at least 44px without increasing desktop visual density.
- Ensure collapsed content leaves the keyboard navigation order.
- Use `role="alert"` only for urgent errors; loading, information, and success use polite status
  semantics.

## Visual cleanup to consider

- Retire or quarantine the continuous rainbow/gradient-text `ultrathink` treatment; it conflicts
  with the restrained violet/pink product direction.
- Replace hard-coded sidebar/auth colors with semantic theme tokens where practical.
- Reduce permanent combinations of translucent glass, a border, and broad shadow. Keep the composer
  as the richest elevated surface and make secondary cards quieter.
- Consolidate duplicated focus, disclosure, overlay, and status styling into reusable recipes.

## Explicit non-goals

- No confetti outside a genuinely exceptional send/publish moment.
- No per-token streaming motion.
- No bouncing rows, elastic easing, validation shaking, or magnetic controls.
- No permanent neon outlines or ambient star particles on idle surfaces.
- No continuous animation when no work is active.
- No purple/pink replacement for semantic red, amber, or green.
- No full-panel blur/filter animation over terminal, diff, or file content.
- No hover scaling on dense rows, trees, tabs, or icon trays.
- No new animation dependency unless CSS, WAAPI, View Transitions, and the existing auto-animation
  utilities prove insufficient.

## Verification expectations

For each implementation slice:

1. Add focused tests for state transitions and replay prevention where behavior is stateful.
2. Run only the affected tests, targeted format/lint checks, and the web package typecheck.
3. Verify reduced-motion behavior in code and tests.
4. Ask the user to inspect the exact affected flow in the installed app.
5. Check that historical/virtualized content does not replay one-shot effects.
6. Confirm keyboard focus and assistive status announcements remain immediate.
7. Confirm high-frequency interactions remain quieter than the composer/send sequence.

## Recommended first delivery

Implement one cohesive initial batch:

1. semantic motion and focus tokens;
2. shared status lifecycle;
3. agent lifecycle choreography;
4. live-response and tool-call states;
5. stop and approval feedback;
6. composer-to-timeline handoff;
7. confirmed thread-settlement celebration.

This batch improves the core supervision and conversation loop while establishing the primitives
needed for later workspace and settings polish.
