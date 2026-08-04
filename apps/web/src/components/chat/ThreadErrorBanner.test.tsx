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

  it("aligns the warning and dismiss icons with the first line of a multi-line error", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        error={"The first error line\ncontinues on a second line"}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Dismiss error"');
    expect(markup).not.toContain("controlAlignment");
    expect(markup).toContain("flex gap-2 items-start");
    expect(markup).toContain("min-h-7 pt-1 sm:min-h-6 sm:pt-0.5");
    expect(markup).toContain("h-lh w-4");
    expect(markup).toContain("h-lh self-start");
  });
});
