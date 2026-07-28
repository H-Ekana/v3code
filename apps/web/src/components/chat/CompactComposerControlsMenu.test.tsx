import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  RUNTIME_MODE_AUTO_GLINT_MS,
  RuntimeModeGlyph,
  runtimeModeConfig,
  runtimeModeOptions,
} from "./CompactComposerControlsMenu";

describe("Auto mode copy", () => {
  it("keeps the visible Auto label and the short AI-review description", () => {
    expect(runtimeModeConfig.auto.label).toBe("Auto");
    expect(runtimeModeConfig.auto.compactDescription).toContain("AI-reviewed");
    expect(runtimeModeConfig.auto.description).toContain("AI reviewer");
  });

  it("states the safety difference between Auto and Full access in words", () => {
    const auto = runtimeModeConfig.auto.description;
    const fullAccess = runtimeModeConfig["full-access"].description;

    // Auto still stops for risky work; Full access never does. The copy has to
    // carry that, not the glow.
    expect(auto.toLowerCase()).toContain("still stops to ask");
    expect(auto.toLowerCase()).toContain("risky");
    expect(fullAccess.toLowerCase()).toContain("no review");
    expect(fullAccess.toLowerCase()).toContain("destructive");
    expect(fullAccess.toLowerCase()).toContain("nothing stops to ask");
    expect(auto).not.toBe(fullAccess);
  });

  it("exposes every runtime mode with a compact description", () => {
    expect(runtimeModeOptions).toEqual([
      "approval-required",
      "auto-accept-edits",
      "auto",
      "full-access",
    ]);
    for (const mode of runtimeModeOptions) {
      expect(runtimeModeConfig[mode].compactDescription.length).toBeGreaterThan(0);
    }
  });
});

describe("RuntimeModeGlyph", () => {
  it("illuminates the sparkles glyph only when Auto is selected", () => {
    const selected = renderToStaticMarkup(<RuntimeModeGlyph mode="auto" selected />);
    expect(selected).toContain("composer-auto-glyph");
    expect(selected).toContain("composer-auto-glyph--illuminated");
    expect(selected).toContain('data-auto-illuminated="true"');

    const unselected = renderToStaticMarkup(<RuntimeModeGlyph mode="auto" selected={false} />);
    expect(unselected).toContain("composer-auto-glyph");
    expect(unselected).not.toContain("composer-auto-glyph--illuminated");
  });

  it("adds the entry glint only while switching in, and never to other modes", () => {
    const glinting = renderToStaticMarkup(<RuntimeModeGlyph mode="auto" selected glinting />);
    expect(glinting).toContain("composer-auto-glyph--glint");

    const settled = renderToStaticMarkup(<RuntimeModeGlyph mode="auto" selected />);
    expect(settled).not.toContain("composer-auto-glyph--glint");

    const otherMode = renderToStaticMarkup(
      <RuntimeModeGlyph mode="full-access" selected glinting />,
    );
    expect(otherMode).not.toContain("composer-auto-glyph");
    expect(RUNTIME_MODE_AUTO_GLINT_MS).toBeLessThanOrEqual(200);
    expect(RUNTIME_MODE_AUTO_GLINT_MS).toBeGreaterThanOrEqual(160);
  });
});
