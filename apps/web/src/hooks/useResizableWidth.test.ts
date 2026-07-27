import { describe, expect, it } from "vite-plus/test";

import { getKeyboardResizedWidth } from "./useResizableWidth";

describe("getKeyboardResizedWidth", () => {
  const baseInput = {
    currentWidth: 400,
    minWidth: 320,
    maxWidth: 640,
  } as const;

  it("resizes by the default and large arrow-key steps", () => {
    expect(getKeyboardResizedWidth({ ...baseInput, key: "ArrowLeft" })).toBe(392);
    expect(getKeyboardResizedWidth({ ...baseInput, key: "ArrowRight" })).toBe(408);
    expect(getKeyboardResizedWidth({ ...baseInput, key: "ArrowDown", useLargeStep: true })).toBe(
      432,
    );
    expect(getKeyboardResizedWidth({ ...baseInput, key: "ArrowUp", useLargeStep: true })).toBe(368);
  });

  it("uses Home and End for the exact limits", () => {
    expect(getKeyboardResizedWidth({ ...baseInput, key: "Home" })).toBe(320);
    expect(getKeyboardResizedWidth({ ...baseInput, key: "End" })).toBe(640);
  });

  it("clamps arrow-key resizing and ignores unrelated keys", () => {
    expect(getKeyboardResizedWidth({ ...baseInput, currentWidth: 321, key: "ArrowLeft" })).toBe(
      320,
    );
    expect(getKeyboardResizedWidth({ ...baseInput, currentWidth: 639, key: "ArrowRight" })).toBe(
      640,
    );
    expect(getKeyboardResizedWidth({ ...baseInput, key: "Enter" })).toBeNull();
  });
});
