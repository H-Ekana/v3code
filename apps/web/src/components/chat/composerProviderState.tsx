import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@t3tools/shared/model";
import type { ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { shouldRenderTraitsControls, TraitsMenuContent, TraitsPicker } from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  promptInjectionState?: ComposerPromptInjectionState;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

export type ComposerPromptInjectionState = "none" | "ultrathink";

/**
 * The reasoning-intensity ladder surfaced on the composer frame as
 * `data-reasoning-tier`. One recipe, four tiers, escalating from a static rim
 * (`xhigh`) up to the full "oil spill" (`ultrathink`). See
 * `docs/project/nightly-motion-polish-reasoning-tiers.md`. Absent when the
 * selected effort is an ordinary level.
 */
export type ComposerReasoningTier = "xhigh" | "max" | "ultracode" | "ultrathink";

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  /**
   * Reasoning tier for the composer frame's `data-reasoning-tier` attribute.
   * `ChatComposer` applies it verbatim and the whole treatment lives in
   * `styles/special-states.css`, keyed on this attribute.
   */
  reasoningTier?: ComposerReasoningTier;
  /**
   * Reserved for a provider state that needs to restyle the inner composer
   * surface. No state populates it today: `ultrathink` used to add a permanent
   * inset hairline on top of its rim, which both duplicated the rim's job and
   * collided with the drag-over `shadow-[…]` utility on the same element (only
   * one `box-shadow` can win). The rim alone carries the state.
   */
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
};

export function getComposerPromptInjectionState(prompt: string): ComposerPromptInjectionState {
  return isClaudeUltrathinkPrompt(prompt) ? "ultrathink" : "none";
}

/**
 * The ladder — one recipe, four tiers — keyed on the primary select
 * descriptor's *value* so it is provider-agnostic by construction. Per
 * `docs/project/nightly-motion-polish-reasoning-tiers.md`:
 *
 *   tier := "ultrathink"  if prompt-injection active OR effort value == "ultrathink"
 *        |  "ultracode"   if effort value in {"ultracode", "ultra"}
 *        |  "max"         if effort value == "max"
 *        |  "xhigh"       if effort value == "xhigh"
 *        |  (absent)      otherwise
 *
 * Amended after user review 2026-07-28: Codex "ultra" is the equivalent of the
 * Claude "ultracode" flood tier ("ultra should be the same as ultracode"), so it
 * maps onto `ultracode`, not `max`.
 */
export function deriveComposerReasoningTier(input: {
  effortValue: string | null;
  ultrathinkActive: boolean;
}): ComposerReasoningTier | undefined {
  const { effortValue, ultrathinkActive } = input;
  if (ultrathinkActive || effortValue === "ultrathink") return "ultrathink";
  if (effortValue === "ultracode" || effortValue === "ultra") return "ultracode";
  if (effortValue === "max") return "max";
  if (effortValue === "xhigh") return "xhigh";
  return undefined;
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, modelOptions, promptInjectionState = "none" } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: modelOptions });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    promptInjectionState === "ultrathink";
  const reasoningTier = deriveComposerReasoningTier({
    effortValue: promptEffort,
    ultrathinkActive,
  });

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildProviderOptionSelectionsFromDescriptors(descriptors),
    // The reasoning tier drives the composer frame's `data-reasoning-tier`
    // attribute; every treatment lives in `styles/special-states.css`. The
    // illuminated provider glyph is shared by all four tiers (it is the base
    // "this is a reasoning state" cue), so the chroma class rides along too.
    ...(reasoningTier
      ? {
          reasoningTier,
          modelPickerIconClassName: "ultrathink-chroma",
        }
      : {}),
  };
}

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    prompt,
    onPromptChange,
  } = input;
  const hasTarget = threadRef !== undefined || draftId !== undefined;
  if (
    !hasTarget ||
    !shouldRenderTraitsControls({ provider, models, model, modelOptions, prompt })
  ) {
    return null;
  }
  return (
    <Component
      provider={provider}
      {...(instanceId ? { instanceId } : {})}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={modelOptions}
      prompt={prompt}
      onPromptChange={onPromptChange}
    />
  );
}

export function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

export function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}
