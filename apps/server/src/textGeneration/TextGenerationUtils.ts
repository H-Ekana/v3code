import { TextGenerationError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);

/** Convert an Effect Schema to a flat JSON Schema object, inlining `$defs` when present. */
export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

/** Truncate a text section to `maxChars`, appending a `[truncated]` marker when needed. */
export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

/** Normalise a raw commit subject to imperative-mood, ≤72 chars, no trailing period. */
export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

/** Normalise a raw PR title to a single line with a sensible fallback. */
export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

const PROMPT_SUGGESTION_MAX_CHARS = 80;
const PROMPT_SUGGESTION_MAX_WORDS = 12;
const PROMPT_SUGGESTION_ALLOWED_SINGLE_WORDS = new Set([
  "yes",
  "no",
  "continue",
  "commit",
  "ship",
  "retry",
]);

const PROMPT_SUGGESTION_REJECT_EXACT = new Set([
  "no suggestion",
  "nothing to suggest",
  "silence",
  "stay silent",
  "none",
  "n/a",
  "na",
]);

const PROMPT_SUGGESTION_REJECT_PREFIXES = [
  "let me",
  "i'll",
  "i will",
  "i can",
  "here's",
  "here is",
  "suggestion:",
  "user:",
  "assistant:",
];

const PROMPT_SUGGESTION_REJECT_CONTAINS = [
  "thanks",
  "thank you",
  "looks good",
  "great job",
  "perfect",
  "api error",
  "prompt is too long",
  "request timed out",
  "invalid api key",
];

/**
 * Normalize / reject model output for composer ghost next-prompt suggestions.
 * Returns null when silence is better.
 */
export function sanitizePromptSuggestion(raw: string): string | null {
  let value = raw.trim();
  if (value.length === 0) return null;

  // Strip wrapping quotes / brackets the model sometimes adds.
  value = value.replace(/^[[('"`]+|[\)\]'"`]+$/g, "").trim();
  value = value.replace(/^suggestion:\s*/i, "").trim();
  if (value.length === 0) return null;

  // Single line only.
  value = value.split(/\r?\n/g)[0]?.trim() ?? "";
  if (value.length === 0) return null;

  // Drop trailing period (keep other punctuation if rare).
  value = value.replace(/[.]+$/g, "").trim();
  if (value.length === 0) return null;

  if (value.length > PROMPT_SUGGESTION_MAX_CHARS) {
    return null;
  }

  const lower = value.toLowerCase();
  if (PROMPT_SUGGESTION_REJECT_EXACT.has(lower)) return null;
  if (value.includes("?") || value.endsWith("?")) return null;
  if (/^[-*+]\s/.test(value) || /^\d+[.)]\s/.test(value)) return null;
  if (/\*\*|__|`/.test(value)) return null;

  for (const prefix of PROMPT_SUGGESTION_REJECT_PREFIXES) {
    if (lower.startsWith(prefix)) return null;
  }
  for (const needle of PROMPT_SUGGESTION_REJECT_CONTAINS) {
    if (lower.includes(needle)) return null;
  }

  const words = value.split(/\s+/).filter((part) => part.length > 0);
  if (words.length === 0) return null;
  if (words.length === 1 && !PROMPT_SUGGESTION_ALLOWED_SINGLE_WORDS.has(words[0]!.toLowerCase())) {
    return null;
  }
  if (words.length > PROMPT_SUGGESTION_MAX_WORDS) return null;

  // Collapse internal whitespace.
  return words.join(" ");
}

/** Normalise a raw thread title to a compact single-line sidebar-safe label. */
export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= 50) {
    return normalized;
  }

  return `${normalized.slice(0, 47).trimEnd()}...`;
}

/** CLI name to human-readable label, e.g. "codex" → "Codex CLI (`codex`)" */
function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

/**
 * Normalize an unknown error from a CLI text generation process into a
 * typed `TextGenerationError`. Parameterized by CLI name so both Codex
 * and Claude (and future providers) can share the same logic.
 */
export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: fallback,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
