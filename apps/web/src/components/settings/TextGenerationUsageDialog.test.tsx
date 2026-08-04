import type { TextGenerationUsageEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  byCostDescending,
  formatCost,
  formatHeadlineCost,
  formatTokens,
  sumTokens,
} from "./TextGenerationUsageDialog";

function entry(overrides: Partial<TextGenerationUsageEntry>): TextGenerationUsageEntry {
  return {
    instanceId: "codex",
    model: "gpt-5.6-luna",
    operation: "generateThreadTitle",
    calls: 1,
    succeededCalls: 1,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    lastUsedAt: null,
    ...overrides,
  } as TextGenerationUsageEntry;
}

describe("token formatting", () => {
  it("never renders an unreported count as zero", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(0)).not.toBe("—");
  });

  it("compacts six-digit counts, which is what overflowed the dialog", () => {
    const compact = formatTokens(252_950);

    expect(compact).not.toBe((252_950).toLocaleString());
    expect(compact.length).toBeLessThan(7);
  });
});

describe("cost formatting", () => {
  it("uses one precision per column so decimal points stay aligned", () => {
    expect(formatCost(0.26)).toBe("$0.26");
    expect(formatCost(0.58)).toBe("$0.58");
  });

  it("does not round a non-zero sub-cent charge down to free", () => {
    // The old formatter emitted $0.0004 here, breaking column alignment; the
    // new one must still distinguish it from a genuine zero.
    expect(formatCost(0.0004)).toBe("<$0.01");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("keeps full precision for the single headline figure", () => {
    expect(formatHeadlineCost(0.0004)).toBe("$0.0004");
    expect(formatHeadlineCost(0.84)).toBe("$0.84");
  });

  it("renders an unpriced model as a dash, not as zero spend", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatHeadlineCost(null)).toBe("—");
  });
});

describe("token totals", () => {
  it("stays null when no row reported tokens", () => {
    const entries = [entry({ inputTokens: null }), entry({ inputTokens: null })];

    expect(sumTokens(entries, (row) => row.inputTokens)).toBe(null);
  });

  it("sums the reported rows and ignores the unreported ones", () => {
    const entries = [
      entry({ inputTokens: 100 }),
      entry({ inputTokens: null }),
      entry({ inputTokens: 250 }),
    ];

    expect(sumTokens(entries, (row) => row.inputTokens)).toBe(350);
  });
});

describe("row ordering", () => {
  it("leads with the most expensive row", () => {
    const cheap = entry({ estimatedCostUsd: 0.26, operation: "generateThreadTitle" });
    const dear = entry({ estimatedCostUsd: 0.58, operation: "generatePromptSuggestion" });

    expect([cheap, dear].sort(byCostDescending)[0]).toBe(dear);
  });

  it("sorts unpriced rows last rather than treating them as free", () => {
    const unpriced = entry({ estimatedCostUsd: null });
    const free = entry({ estimatedCostUsd: 0 });

    expect([unpriced, free].sort(byCostDescending)[0]).toBe(free);
  });

  it("breaks ties on call volume", () => {
    const few = entry({ estimatedCostUsd: 0.1, calls: 2 });
    const many = entry({ estimatedCostUsd: 0.1, calls: 40 });

    expect([few, many].sort(byCostDescending)[0]).toBe(many);
  });
});
