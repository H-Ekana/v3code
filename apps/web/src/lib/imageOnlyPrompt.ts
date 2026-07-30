/**
 * Attaching an image with no text still needs *some* prompt for the provider —
 * an empty user turn is not a useful instruction. We send this bootstrap line,
 * but it is scaffolding for the agent, not something the user typed, so the
 * timeline strips it back out and shows the attachment alone.
 */
export const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

/** Prefixes `formatOutgoingPrompt` can put in front of the bootstrap line. */
const BOOTSTRAP_ONLY_PREFIXES = new Set(["", "Ultrathink:"]);

/**
 * Removes the image-only bootstrap line from text destined for the UI (bubble
 * body, copy button, send-morph flyer). Only strips when the line is the whole
 * message — a user who literally types that text keeps it.
 */
export function stripImageOnlyBootstrapPrompt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith(IMAGE_ONLY_BOOTSTRAP_PROMPT)) {
    return text;
  }
  const head = trimmed.slice(0, trimmed.length - IMAGE_ONLY_BOOTSTRAP_PROMPT.length).trim();
  return BOOTSTRAP_ONLY_PREFIXES.has(head) ? "" : text;
}
