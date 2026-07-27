import { describe, expect, it } from "vite-plus/test";

import { getKeyboardHue, getKeyboardSaturationValue } from "./ProviderAccentColorPicker";

describe("ProviderAccentColorPicker keyboard controls", () => {
  it("maps plane arrows to saturation and brightness", () => {
    expect(getKeyboardSaturationValue({ s: 0.5, v: 0.5 }, "ArrowLeft")).toEqual({
      s: 0.49,
      v: 0.5,
    });
    expect(getKeyboardSaturationValue({ s: 0.5, v: 0.5 }, "ArrowUp")).toEqual({
      s: 0.5,
      v: 0.51,
    });
    expect(getKeyboardSaturationValue({ s: 0.5, v: 0.5 }, "ArrowDown", true)).toEqual({
      s: 0.5,
      v: 0.4,
    });
  });

  it("supports plane and hue endpoints", () => {
    expect(getKeyboardSaturationValue({ s: 0.5, v: 0.5 }, "Home")).toEqual({
      s: 0,
      v: 0.5,
    });
    expect(getKeyboardSaturationValue({ s: 0.5, v: 0.5 }, "End")).toEqual({
      s: 1,
      v: 0.5,
    });
    expect(getKeyboardHue(120, "Home")).toBe(0);
    expect(getKeyboardHue(120, "End")).toBe(360);
  });

  it("uses Shift for larger hue steps and clamps at the limits", () => {
    expect(getKeyboardHue(120, "ArrowRight")).toBe(121);
    expect(getKeyboardHue(120, "ArrowLeft", true)).toBe(110);
    expect(getKeyboardHue(358, "ArrowUp", true)).toBe(360);
    expect(getKeyboardHue(2, "ArrowDown", true)).toBe(0);
  });
});
