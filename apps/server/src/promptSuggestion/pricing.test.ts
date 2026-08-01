import { describe, expect, it } from "vite-plus/test";

import { estimateCostUsd, getModelPrice } from "./pricing.ts";

describe("getModelPrice", () => {
  it("prices the OpenAI models from CodexBar's table", () => {
    expect(getModelPrice("gpt-5.6-luna")).toEqual({
      inputPerMillion: 1.0,
      cachedInputPerMillion: 0.1,
      outputPerMillion: 6.0,
    });
    expect(getModelPrice("gpt-5.6-sol")?.outputPerMillion).toBe(30.0);
  });

  it("resolves the unsuffixed gpt-5.6 alias to Sol", () => {
    expect(getModelPrice("gpt-5.6")).toEqual(getModelPrice("gpt-5.6-sol"));
  });

  it("prices Anthropic models", () => {
    expect(getModelPrice("claude-opus-5")).toEqual({
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 25,
    });
  });

  it("is case-insensitive and strips routing suffixes", () => {
    expect(getModelPrice("GPT-5.6-Luna")?.inputPerMillion).toBe(1.0);
    expect(getModelPrice("claude-opus-5[1m]")?.inputPerMillion).toBe(5);
  });

  it("returns null for an unknown model rather than guessing", () => {
    expect(getModelPrice("some-model-we-have-never-heard-of")).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("estimates from input and output tokens", () => {
    // 200k input @ $1/M + 20 output @ $6/M
    const cost = estimateCostUsd({
      model: "gpt-5.6-luna",
      inputTokens: 200_000,
      outputTokens: 20,
    });
    expect(cost).toBeCloseTo(0.2 + 0.00012, 8);
  });

  it("treats a realistic ghost suggestion as a fraction of a cent", () => {
    // ~1k prompt tokens in, ~5 out — the whole point of the short context.
    const cost = estimateCostUsd({ model: "gpt-5.6-luna", inputTokens: 1_000, outputTokens: 5 });
    expect(cost).toBeLessThan(0.002);
  });

  it("returns null when the model has no price", () => {
    expect(
      estimateCostUsd({ model: "unknown-model", inputTokens: 1_000, outputTokens: 10 }),
    ).toBeNull();
  });

  it("bills cached input at the cache-read rate, not the full rate", () => {
    // The real shape of a measured Codex turn: 17,070 input of which 9,984
    // cached, 5 output. Pricing the cached portion at the full input rate
    // would overstate this call by ~40%.
    const measured = estimateCostUsd({
      model: "gpt-5.6-luna",
      inputTokens: 7_086,
      cachedInputTokens: 9_984,
      outputTokens: 5,
    });
    expect(measured).toBeCloseTo(0.007086 + 0.0009984 + 0.00003, 8);

    const ignoringCache = estimateCostUsd({
      model: "gpt-5.6-luna",
      inputTokens: 17_070,
      outputTokens: 5,
    });
    expect(ignoringCache!).toBeGreaterThan(measured! * 1.35);
  });

  it("returns null when no tokens were reported — unknown is not zero", () => {
    expect(
      estimateCostUsd({ model: "gpt-5.6-luna", inputTokens: null, outputTokens: null }),
    ).toBeNull();
  });

  it("prices a half-reported pair using the side that was reported", () => {
    expect(
      estimateCostUsd({ model: "gpt-5.6-luna", inputTokens: null, outputTokens: 1_000_000 }),
    ).toBe(6);
  });
});
