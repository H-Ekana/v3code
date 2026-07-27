import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ColorSelector } from "./color-selector";

describe("ColorSelector", () => {
  it("renders a named radio group with one selected, roving-tab-stop swatch", () => {
    const html = renderToStaticMarkup(
      <ColorSelector
        aria-label="Provider accent"
        colors={["red", "green", "blue"]}
        defaultValue="green"
      />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Provider accent"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain("focus-visible:ring-2");
  });
});
