import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  DraftHeroProjectNameAccent,
  pickNextProjectNameGlimmerDelay,
} from "./DraftHeroProjectNameAccent";

describe("DraftHeroProjectNameAccent", () => {
  it("keeps the project name readable while rendering decorative underline layers", () => {
    const markup = renderToStaticMarkup(
      <DraftHeroProjectNameAccent>V3 Agent Playground</DraftHeroProjectNameAccent>,
    );

    expect(markup).toContain("V3 Agent Playground");
    expect(markup).toContain("draft-hero-project-name-accent");
    expect(markup).toContain("draft-hero-project-name-glimmer");
    expect(markup).toContain("draft-hero-project-name-underline");
    expect(markup).toContain("draft-hero-project-name-streak");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("varies the glimmer cadence without repeating the previous interval", () => {
    expect(pickNextProjectNameGlimmerDelay(null, 0)).toBe(2_000);
    expect(pickNextProjectNameGlimmerDelay(2_000, 0)).toBe(2_500);
    expect(pickNextProjectNameGlimmerDelay(2_500, 0.999)).toBe(3_000);
    expect(pickNextProjectNameGlimmerDelay(3_000, 0.999)).toBe(2_500);
  });
});
