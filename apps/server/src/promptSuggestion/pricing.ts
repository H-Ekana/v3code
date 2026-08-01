/**
 * Local price table for estimating what ghost suggestions cost.
 *
 * These are ESTIMATES from a hand-maintained table, not amounts billed by a
 * provider. A model missing from the table returns null rather than a guess —
 * the UI shows "no price" instead of implying $0.
 *
 * Sources:
 *  - OpenAI / Codex rates are transcribed from the CodexBar project's
 *    `CodexBar.Core/Codex/CodexModelPricing.cs`, which is the maintained table
 *    that app prices its own token ledger from.
 *  - Anthropic rates are first-party API list prices (2026-06-24).
 *
 * Upstream, CodexBar refreshes against https://models.dev/api.json on a 24h
 * TTL. We deliberately do NOT fetch at runtime here: a settings dialog must
 * not depend on network egress, and a stale-but-sourced number beats a
 * request that hangs. Re-sync this table from CodexBar when prices move.
 *
 * Two tiers CodexBar models are intentionally omitted, because neither can
 * apply to a ghost suggestion:
 *  - long-context rates above a 272k-token threshold — our whole prompt is
 *    capped at ~4k characters (see `suggestNextPrompt.ts`)
 *  - priority/"fast" rates — the text-generation path never requests them
 * If either ever becomes reachable, add the tier rather than scaling the base
 * rate: CodexBar documents that fast is 2.5x on gpt-5.5 but 2x elsewhere, so
 * a multiplier would be wrong by 25% on that model.
 */
export interface ModelPrice {
  /** USD per million input tokens. */
  readonly inputPerMillion: number;
  /** USD per million cached input tokens, when the provider reports them. */
  readonly cachedInputPerMillion: number;
  /** USD per million output tokens. */
  readonly outputPerMillion: number;
}

const ANTHROPIC = (inputPerMillion: number, outputPerMillion: number): ModelPrice => ({
  inputPerMillion,
  // Anthropic cache reads are ~0.1x base input.
  cachedInputPerMillion: inputPerMillion * 0.1,
  outputPerMillion,
});

const OPENAI = (
  inputPerMillion: number,
  cachedInputPerMillion: number,
  outputPerMillion: number,
): ModelPrice => ({ inputPerMillion, cachedInputPerMillion, outputPerMillion });

/** Exact model id → base rates. Matched case-insensitively. */
const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // ── Anthropic ────────────────────────────────────────────────────────────
  "claude-fable-5": ANTHROPIC(10, 50),
  "claude-mythos-5": ANTHROPIC(10, 50),
  "claude-opus-5": ANTHROPIC(5, 25),
  "claude-opus-4-8": ANTHROPIC(5, 25),
  "claude-opus-4-7": ANTHROPIC(5, 25),
  "claude-opus-4-6": ANTHROPIC(5, 25),
  "claude-sonnet-5": ANTHROPIC(3, 15),
  "claude-sonnet-4-6": ANTHROPIC(3, 15),
  "claude-haiku-4-5": ANTHROPIC(1, 5),

  // ── OpenAI / Codex (from CodexBar's CodexModelPricing) ───────────────────
  "gpt-5": OPENAI(1.25, 0.125, 10.0),
  "gpt-5-codex": OPENAI(1.25, 0.125, 10.0),
  "gpt-5-mini": OPENAI(0.25, 0.025, 2.0),
  "gpt-5-nano": OPENAI(0.05, 0.005, 0.4),
  "gpt-5-pro": OPENAI(15.0, 15.0, 120.0),
  "gpt-5.1": OPENAI(1.25, 0.125, 10.0),
  "gpt-5.1-codex": OPENAI(1.25, 0.125, 10.0),
  "gpt-5.1-codex-max": OPENAI(1.25, 0.125, 10.0),
  "gpt-5.1-codex-mini": OPENAI(0.25, 0.025, 2.0),
  "gpt-5.2": OPENAI(1.75, 0.175, 14.0),
  "gpt-5.2-codex": OPENAI(1.75, 0.175, 14.0),
  "gpt-5.2-pro": OPENAI(21.0, 21.0, 168.0),
  "gpt-5.3-codex": OPENAI(1.75, 0.175, 14.0),
  "gpt-5.3-codex-spark": OPENAI(0, 0, 0),
  "gpt-5.4": OPENAI(2.5, 0.25, 15.0),
  "gpt-5.4-mini": OPENAI(0.75, 0.075, 4.5),
  "gpt-5.4-nano": OPENAI(0.2, 0.02, 1.25),
  "gpt-5.4-pro": OPENAI(30.0, 30.0, 180.0),
  "gpt-5.5": OPENAI(5.0, 0.5, 30.0),
  "gpt-5.5-pro": OPENAI(30.0, 30.0, 180.0),
  "gpt-5.6-sol": OPENAI(5.0, 0.5, 30.0),
  "gpt-5.6-terra": OPENAI(2.5, 0.25, 15.0),
  "gpt-5.6-luna": OPENAI(1.0, 0.1, 6.0),
};

/** OpenAI routes the unsuffixed `gpt-5.6` alias to Sol (per CodexBar). */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "gpt-5.6": "gpt-5.6-sol",
};

/**
 * Price for a model id, or null when we have no sourced figure.
 *
 * Deployment/routing suffixes (`[1m]`, `@20260101`) are stripped before
 * lookup since they are not distinct price points. A variant that genuinely
 * prices differently must be added to the table explicitly.
 */
export function getModelPrice(model: string): ModelPrice | null {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/@[^@]*$/, "")
    .trim();
  const resolved = MODEL_ALIASES[normalized] ?? normalized;
  return MODEL_PRICES[resolved] ?? null;
}

/**
 * Estimated USD for a token count, or null when the model has no price or the
 * provider never reported tokens. Null means "unknown", never zero.
 *
 * `inputTokens` must be the UNCACHED remainder. Cached input is billed at a
 * far cheaper rate (10x cheaper on every model in the table), and a measured
 * Codex turn came back 9,984 cached of 17,070 input — folding those into the
 * full rate overstates a typical call by roughly 40%.
 */
export function estimateCostUsd(input: {
  readonly model: string;
  readonly inputTokens: number | null;
  readonly cachedInputTokens?: number | null;
  readonly outputTokens: number | null;
}): number | null {
  const price = getModelPrice(input.model);
  if (price === null) return null;
  const cachedInputTokens = input.cachedInputTokens ?? null;
  if (input.inputTokens === null && cachedInputTokens === null && input.outputTokens === null) {
    return null;
  }

  const inputCost = ((input.inputTokens ?? 0) / 1_000_000) * price.inputPerMillion;
  const cachedCost = ((cachedInputTokens ?? 0) / 1_000_000) * price.cachedInputPerMillion;
  const outputCost = ((input.outputTokens ?? 0) / 1_000_000) * price.outputPerMillion;
  return inputCost + cachedCost + outputCost;
}
