import { describe, expect, it } from "vite-plus/test";

import {
  INLINE_LARGE_PASTE_PLACEHOLDER,
  LARGE_PASTE_CHAR_THRESHOLD,
  ensureInlineLargePastePlaceholders,
  expandInlineLargePastes,
  largePasteCharacterCount,
  normalizeLargePasteText,
  shouldCollapseLargePaste,
  type LargePasteDraft,
} from "./largePaste";

function paste(id: string, text: string): LargePasteDraft {
  return { id, text, createdAt: "2026-07-31T00:00:00.000Z" };
}

describe("large paste composer model", () => {
  it("collapses only pastes strictly above 2,000 Unicode characters", () => {
    expect(shouldCollapseLargePaste("x".repeat(LARGE_PASTE_CHAR_THRESHOLD))).toBe(false);
    expect(shouldCollapseLargePaste("x".repeat(LARGE_PASTE_CHAR_THRESHOLD + 1))).toBe(true);
    expect(largePasteCharacterCount("😀".repeat(2_001))).toBe(2_001);
  });

  it("normalizes clipboard line endings before storing content", () => {
    expect(normalizeLargePasteText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("expands multiple placeholders in prompt order", () => {
    const prompt = `Before ${INLINE_LARGE_PASTE_PLACEHOLDER} between ${INLINE_LARGE_PASTE_PLACEHOLDER} after`;
    expect(expandInlineLargePastes(prompt, [paste("one", "FIRST"), paste("two", "SECOND")])).toBe(
      "Before FIRST between SECOND after",
    );
  });

  it("repairs a persisted payload whose placeholder write was interrupted", () => {
    expect(ensureInlineLargePastePlaceholders("instruction", 2)).toBe(
      `${INLINE_LARGE_PASTE_PLACEHOLDER}${INLINE_LARGE_PASTE_PLACEHOLDER}instruction`,
    );
  });
});
