import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ContextCompactAction } from "./ContextWindowMeter";

describe("ContextCompactAction", () => {
  it("renders the compact context shortcut as a primary action", () => {
    const markup = renderToStaticMarkup(
      createElement(ContextCompactAction, {
        onCompact: vi.fn(async () => true),
      }),
    );

    expect(markup).toContain('aria-label="Compact context now"');
    expect(markup).toContain("Compact context");
    expect(markup).not.toContain("/compact");
    expect(markup).not.toContain(' disabled=""');
  });

  it("disables compaction while the thread cannot accept it", () => {
    const markup = renderToStaticMarkup(
      createElement(ContextCompactAction, {
        disabled: true,
        onCompact: vi.fn(async () => true),
      }),
    );

    expect(markup).toContain(' disabled=""');
  });

  it("shows active and completed compaction states in the single action button", () => {
    const compactingMarkup = renderToStaticMarkup(
      createElement(ContextCompactAction, {
        status: { state: "compacting", createdAt: "2026-07-27T00:00:00.000Z" },
        onCompact: vi.fn(async () => true),
      }),
    );
    const completedMarkup = renderToStaticMarkup(
      createElement(ContextCompactAction, {
        status: { state: "completed", createdAt: "2026-07-27T00:00:01.000Z" },
        onCompact: vi.fn(async () => true),
      }),
    );

    expect(compactingMarkup).toContain('role="status"');
    expect(compactingMarkup).toContain("Compacting\u2026");
    expect(compactingMarkup).toContain("lucide-loader-circle");
    expect(compactingMarkup).toContain(' disabled=""');
    expect(completedMarkup).toContain("Context compacted");
    expect(completedMarkup).toContain("lucide-check");
    expect(completedMarkup).toContain("bg-primary/55");
    expect(completedMarkup).not.toContain("emerald");
    expect(completedMarkup).not.toContain("The reduced context is ready to use");
    expect(completedMarkup).toContain(
      'aria-label="Context compacted. Send a message before compacting again"',
    );
    expect(completedMarkup).toContain(' disabled=""');
  });
});
