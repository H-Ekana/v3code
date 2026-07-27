import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Card, CardFrame } from "./card";

describe("card surface accents", () => {
  it("uses a subtle token-based focus-within accent with reduced-motion support", () => {
    const html = renderToStaticMarkup(
      <Card>
        <button type="button">Open</button>
      </Card>,
    );

    expect(html).toContain("focus-within:border-primary/25");
    expect(html).toContain("focus-within:ring-primary/10");
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("keeps the grouped card frame aligned with the card surface treatment", () => {
    const html = renderToStaticMarkup(<CardFrame />);

    expect(html).toContain("focus-within:ring-primary/10");
    expect(html).toContain("duration-200");
  });
});
