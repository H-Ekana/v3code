import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

const ERROR = "Provider stream closed unexpectedly.";

describe("ThreadErrorBanner", () => {
  it("announces immediately: the alert role and the error text are present in the first render, not gated on the entrance animation", () => {
    const markup = renderToStaticMarkup(<ThreadErrorBanner error={ERROR} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(ERROR);
    // Level 2 entrance is decoration layered onto the already-announced node.
    expect(markup).toContain("motion-arrival");
    // Nothing may hide the live region until motion completes.
    expect(markup).not.toContain("visibility:hidden");
    expect(markup).not.toContain("display:none");
  });

  it("renders nothing when there is no error to announce", () => {
    expect(renderToStaticMarkup(<ThreadErrorBanner error={null} />)).toBe("");
  });
});
