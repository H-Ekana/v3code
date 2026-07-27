import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Card, CardFrame } from "./card";

describe("card surface accents", () => {
  it("delegates the focus-within accent to the shared motion recipe", () => {
    const html = renderToStaticMarkup(
      <Card>
        <button type="button">Open</button>
      </Card>,
    );

    expect(html).toContain("motion-focus");
  });

  it("keeps the grouped card frame aligned with the card surface treatment", () => {
    const html = renderToStaticMarkup(<CardFrame />);

    expect(html).toContain("motion-focus");
  });

  it("does not re-inline focus styling the recipe already owns", () => {
    // Regression guard: the ring, border tint, duration, and reduced-motion
    // fallback live in styles/motion.css. Re-adding them here is how the two
    // copies drift apart.
    const html = renderToStaticMarkup(
      <>
        <Card />
        <CardFrame />
      </>,
    );

    expect(html).not.toContain("focus-within:ring-primary");
    expect(html).not.toContain("focus-within:border-primary");
    expect(html).not.toContain("motion-reduce:transition-none");
  });
});
