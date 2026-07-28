import { type ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ModelPickerRailMarker,
  ModelPickerSidebar,
  resolveRailMarkerOffset,
} from "./ModelPickerSidebar";
import type { ProviderInstanceEntry } from "../../providerInstances";

function entry(instanceId: string, displayName: string): ProviderInstanceEntry {
  return {
    instanceId: instanceId as ProviderInstanceId,
    driverKind: "codex",
    displayName,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: { message: null },
    models: [],
  } as unknown as ProviderInstanceEntry;
}

const ENTRIES = [entry("codex", "Codex"), entry("claude", "Claude")];

function renderRail() {
  return renderToStaticMarkup(
    <ModelPickerSidebar
      selectedInstanceId={"codex" as ProviderInstanceId}
      onSelectInstance={() => {}}
      instanceEntries={ENTRIES}
    />,
  );
}

describe("provider rail marker", () => {
  it("moves with transform rather than by animating top", () => {
    const html = renderToStaticMarkup(<ModelPickerRailMarker offset={48} placed />);

    expect(html).toContain("translate3d(0, 48px, 0)");
    expect(html).toContain("nav-model-rail-marker");
    expect(html).not.toContain("transition-[top]");
    expect(html).not.toContain("top:");
  });

  it("suppresses the transition until the first measurement has landed", () => {
    const initial = renderToStaticMarkup(<ModelPickerRailMarker offset={48} placed={false} />);
    const settled = renderToStaticMarkup(<ModelPickerRailMarker offset={48} placed />);

    expect(initial).toContain('data-nav-initial="true"');
    expect(settled).not.toContain("data-nav-initial");
  });

  it("stays inert so it cannot steal focus or clicks while travelling", () => {
    const html = renderToStaticMarkup(<ModelPickerRailMarker offset={12} placed />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    // Never focusable, and never an accessibility node of its own.
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("role=");
  });

  it("centres the marker on the selected button, accounting for rail scroll", () => {
    expect(
      resolveRailMarkerOffset({
        contentTop: 100,
        contentScrollTop: 0,
        buttonTop: 140,
        buttonHeight: 40,
      }),
    ).toBe(50);

    expect(
      resolveRailMarkerOffset({
        contentTop: 100,
        contentScrollTop: 32,
        buttonTop: 140,
        buttonHeight: 40,
      }),
    ).toBe(82);
  });
});

describe("provider rail buttons", () => {
  it("gets a real focus-visible ring rather than only a background change", () => {
    const html = renderRail();

    // The ring itself is the shared `motion-focus` recipe, so the palette,
    // settings, and picker cannot drift apart on what focus looks like.
    expect(html).toContain("motion-focus");
  });

  it("keeps the routing key and label on every rail button", () => {
    // These are what keyboard users land on and what the marker measurement
    // finds. The marker must never be able to disturb them.
    const html = renderRail();

    expect(html).toContain('data-model-picker-provider="favorites"');
    expect(html).toContain('data-model-picker-provider="codex"');
    expect(html).toContain('data-model-picker-provider="claude"');
    expect(html).toContain('aria-label="Codex"');
    expect(html).toContain('aria-label="Claude"');
    expect(html).toContain('aria-label="Favorites"');
  });

  it("does not animate rail buttons themselves", () => {
    // Provider switching is a marker move, not a row entrance. Buttons must not
    // replay anything when the rail re-renders.
    const html = renderRail();

    expect(html).not.toContain("motion-arrival");
    expect(html).not.toContain("motion-completion");
    expect(html).not.toContain("animate-");
  });
});
