import { describe, expect, it } from "vite-plus/test";

import { IMAGE_ONLY_BOOTSTRAP_PROMPT, stripImageOnlyBootstrapPrompt } from "./imageOnlyPrompt";

describe("stripImageOnlyBootstrapPrompt", () => {
  it("drops the bootstrap line when it is the whole message", () => {
    expect(stripImageOnlyBootstrapPrompt(IMAGE_ONLY_BOOTSTRAP_PROMPT)).toBe("");
    expect(stripImageOnlyBootstrapPrompt(`\n${IMAGE_ONLY_BOOTSTRAP_PROMPT}\n`)).toBe("");
  });

  it("drops it behind the ultrathink prefix the send path can add", () => {
    expect(stripImageOnlyBootstrapPrompt(`Ultrathink:\n${IMAGE_ONLY_BOOTSTRAP_PROMPT}`)).toBe("");
  });

  it("keeps text the user actually wrote", () => {
    expect(stripImageOnlyBootstrapPrompt("Look at this")).toBe("Look at this");
    const withPrompt = `Look at this\n\n${IMAGE_ONLY_BOOTSTRAP_PROMPT}`;
    expect(stripImageOnlyBootstrapPrompt(withPrompt)).toBe(withPrompt);
  });
});
