export const LARGE_PASTE_CHAR_THRESHOLD = 2_000;

// Kept distinct from the terminal-context object replacement character so the
// composer can preserve the relative order of both kinds of inline object.
export const INLINE_LARGE_PASTE_PLACEHOLDER = "\uFFFB";

export interface LargePasteDraft {
  id: string;
  text: string;
  createdAt: string;
}

export function normalizeLargePasteText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function largePasteCharacterCount(text: string): number {
  return Array.from(text).length;
}

export function shouldCollapseLargePaste(text: string): boolean {
  return largePasteCharacterCount(text) > LARGE_PASTE_CHAR_THRESHOLD;
}

export function countInlineLargePastePlaceholders(prompt: string): number {
  let count = 0;
  for (const char of prompt) {
    if (char === INLINE_LARGE_PASTE_PLACEHOLDER) {
      count += 1;
    }
  }
  return count;
}

export function ensureInlineLargePastePlaceholders(
  prompt: string,
  largePasteCount: number,
): string {
  const missingCount = largePasteCount - countInlineLargePastePlaceholders(prompt);
  if (missingCount <= 0) {
    return prompt;
  }
  return `${INLINE_LARGE_PASTE_PLACEHOLDER.repeat(missingCount)}${prompt}`;
}

export function expandInlineLargePastes(
  prompt: string,
  largePastes: ReadonlyArray<LargePasteDraft>,
): string {
  let pasteIndex = 0;
  let expanded = "";
  for (const char of prompt) {
    if (char !== INLINE_LARGE_PASTE_PLACEHOLDER) {
      expanded += char;
      continue;
    }
    expanded += largePastes[pasteIndex]?.text ?? "";
    pasteIndex += 1;
  }
  return expanded;
}
