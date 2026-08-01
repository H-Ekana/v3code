/**
 * Pull real token usage out of `codex exec --json` output.
 *
 * The CLI emits JSONL events; the last `turn.completed` carries the turn's
 * usage, e.g.
 *
 *   {"type":"turn.completed","usage":{"input_tokens":17070,
 *    "cached_input_tokens":9984,"cache_write_input_tokens":0,
 *    "output_tokens":5,"reasoning_output_tokens":0}}
 *
 * `input_tokens` is the TOTAL, cached included — so the uncached remainder we
 * bill at the full rate is `input_tokens - cached_input_tokens`. Treating the
 * total as uncached overstates a typical call by roughly 40%.
 *
 * Anything unparseable yields nulls: "not reported" must never become zero.
 */
export interface ParsedCodexUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
}

const NONE: ParsedCodexUsage = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
};

const readNumber = (source: Record<string, unknown>, key: string): number | null => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
};

export function parseCodexUsage(stdout: string): ParsedCodexUsage {
  let latest: ParsedCodexUsage = NONE;

  for (const line of stdout.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes("turn.completed")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Interleaved non-JSON log lines are expected on this stream.
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const event = parsed as Record<string, unknown>;
    if (event["type"] !== "turn.completed") continue;

    const usage = event["usage"];
    if (!usage || typeof usage !== "object") continue;
    const usageRecord = usage as Record<string, unknown>;

    const totalInput = readNumber(usageRecord, "input_tokens");
    const cachedInput = readNumber(usageRecord, "cached_input_tokens");
    const output = readNumber(usageRecord, "output_tokens");
    const reasoningOutput = readNumber(usageRecord, "reasoning_output_tokens");

    latest = {
      // Uncached remainder, floored so a malformed pair can't go negative.
      inputTokens: totalInput === null ? null : Math.max(0, totalInput - (cachedInput ?? 0)),
      cachedInputTokens: cachedInput,
      // Reasoning tokens are billed as output but reported separately.
      outputTokens: output === null ? null : output + (reasoningOutput ?? 0),
    };
  }

  return latest;
}
