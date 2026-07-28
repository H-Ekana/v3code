// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  deriveComposerReasoningTier,
  getComposerPromptInjectionState,
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";

// Everything in composerProviderState is now data-driven by the model's
// optionDescriptors, so these tests use a single synthetic provider/model and
// vary only the descriptor shape per scenario.

const PROVIDER: ProviderDriverKind = ProviderDriverKind.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
    ...(promptInjectedValues && promptInjectedValues.length > 0
      ? { promptInjectedValues: [...promptInjectedValues] }
      : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

// The ultrathink tier surfaces the reasoning-tier attribute plus the shared
// illuminated provider glyph. The frame treatment itself lives entirely in
// `styles/special-states.css`, keyed on `data-reasoning-tier`.
const ULTRATHINK_REASONING_STATE = {
  reasoningTier: "ultrathink",
  modelPickerIconClassName: "ultrathink-chroma",
} as const;

describe("getComposerProviderState", () => {
  it("derives a stable prompt injection state for ordinary prompt edits", () => {
    expect(getComposerPromptInjectionState("Investigate this failure")).toBe("none");
    expect(getComposerPromptInjectionState("Ultrathink:\nInvestigate this failure")).toBe(
      "ultrathink",
    );
  });

  it("returns descriptor defaults when no selections are provided", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      modelOptions: selections(["effort", "max"], ["thinking", false]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
    });
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      modelOptions: selections(["agent", "plan"]),
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["contextWindow", "200k"], ["agent", "plan"]),
    );
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      modelOptions: selections(["anything", "value"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("surfaces the ultrathink tier when the prompt triggers a promptInjectedValues descriptor", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: selections(["effort", "medium"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
      ...ULTRATHINK_REASONING_STATE,
    });
  });

  it("styles ultrathink through the rim alone, never an inline surface shadow", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      promptInjectionState: getComposerPromptInjectionState("Ultrathink:\nGo"),
      modelOptions: undefined,
    });

    // The inner composer surface also carries the drag-over `shadow-[…]`
    // utility, and only one `box-shadow` can win. Emitting a second shadow here
    // silently dropped one of them, so the state must not claim that property.
    expect(state).not.toHaveProperty("composerSurfaceClassName");
    // Both remaining classes are owned by `styles/special-states.css`; no
    // inline color literals leak into the returned state.
    expect(JSON.stringify(state)).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3}/);
  });

  it("stays untiered when the descriptor has no promptInjectedValues", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: undefined,
    });

    expect(state).not.toHaveProperty("reasoningTier");
    expect(state).not.toHaveProperty("composerSurfaceClassName");
    expect(state).not.toHaveProperty("modelPickerIconClassName");
  });

  it("derives each ladder tier from the selected effort value", () => {
    const tierFor = (effortId: string): string | undefined =>
      getComposerProviderState({
        provider: PROVIDER,
        model: MODEL,
        models: modelWith([
          selectDescriptor("effort", [
            { id: "high", label: "High", isDefault: true },
            { id: effortId, label: effortId },
          ]),
        ]),
        modelOptions: selections(["effort", effortId]),
      }).reasoningTier;

    expect(tierFor("xhigh")).toBe("xhigh");
    expect(tierFor("max")).toBe("max");
    // Amended 2026-07-28: Codex "ultra" is the ultracode flood tier, not max.
    expect(tierFor("ultra")).toBe("ultracode");
    expect(tierFor("ultracode")).toBe("ultracode");
    expect(tierFor("ultrathink")).toBe("ultrathink");
    expect(tierFor("high")).toBeUndefined();
    expect(tierFor("medium")).toBeUndefined();
  });
});

describe("deriveComposerReasoningTier", () => {
  it("maps every extreme effort onto a tier and everything else onto none", () => {
    const tier = (effortValue: string | null, ultrathinkActive = false) =>
      deriveComposerReasoningTier({ effortValue, ultrathinkActive });

    // Prompt injection wins even while a lesser value is selected.
    expect(tier("medium", true)).toBe("ultrathink");
    // Directly selected ultrathink resolves the same way.
    expect(tier("ultrathink")).toBe("ultrathink");
    expect(tier("ultracode")).toBe("ultracode");
    expect(tier("max")).toBe("max");
    // Codex "ultra" maps onto the ultracode flood tier (amended 2026-07-28).
    expect(tier("ultra")).toBe("ultracode");
    expect(tier("xhigh")).toBe("xhigh");
    expect(tier("high")).toBeUndefined();
    expect(tier(null)).toBeUndefined();
  });
});

describe("data-reasoning-tier application (client render)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Mirrors ChatComposer's frame attribute expression against the real DOM, so
  // the derivation and the attribute wiring are verified together — no
  // renderToStaticMarkup string matching.
  function ReasoningFrame({ effortId }: { effortId: string }) {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "high", label: "High", isDefault: true },
          { id: effortId, label: effortId },
        ]),
      ]),
      modelOptions: selections(["effort", effortId]),
    });
    return (
      <div
        data-testid="frame"
        {...(state.reasoningTier ? { "data-reasoning-tier": state.reasoningTier } : {})}
      />
    );
  }

  function frame(): HTMLElement {
    const node = container.querySelector<HTMLElement>("[data-testid='frame']");
    if (!node) throw new Error("frame not rendered");
    return node;
  }

  it("stamps the tier attribute onto the frame for an extreme effort", () => {
    act(() => root.render(<ReasoningFrame effortId="ultracode" />));
    expect(frame().getAttribute("data-reasoning-tier")).toBe("ultracode");
  });

  it("stamps ultrathink for the top tier", () => {
    act(() => root.render(<ReasoningFrame effortId="ultrathink" />));
    expect(frame().getAttribute("data-reasoning-tier")).toBe("ultrathink");
  });

  it("leaves the attribute off entirely for an ordinary effort", () => {
    act(() => root.render(<ReasoningFrame effortId="high" />));
    expect(frame().hasAttribute("data-reasoning-tier")).toBe(false);
  });
});

describe("provider traits render guards", () => {
  it("returns null when no thread target is provided", () => {
    const models = modelWith([
      selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
    ]);
    const args = {
      provider: PROVIDER,
      model: MODEL,
      models,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    };

    expect(renderProviderTraitsPicker(args)).toBeNull();
    expect(renderProviderTraitsMenuContent(args)).toBeNull();
  });
});
