import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DiffPanelLoadingState } from "./DiffPanelShell";

/**
 * The first paint of the loading state is the frame a cached diff has to beat.
 * These assertions pin that frame: announcement present, skeleton absent.
 */
describe("DiffPanelLoadingState", () => {
  it("withholds the skeleton on the first frame so a cached diff never flashes one", () => {
    const markup = renderToStaticMarkup(<DiffPanelLoadingState label="Loading branch diff..." />);

    expect(markup).toContain('data-diff-loading-skeleton="deferred"');
    expect(markup).not.toContain('data-slot="skeleton"');
    expect(markup).not.toContain("files-state-enter");
  });

  it("announces the loading label immediately, without waiting for the delay", () => {
    const markup = renderToStaticMarkup(<DiffPanelLoadingState label="Loading branch diff..." />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Loading branch diff...");
  });

  it("crossfades the skeleton in once the delay is waived", () => {
    const markup = renderToStaticMarkup(
      <DiffPanelLoadingState label="Loading checkpoint diff..." delayMs={0} />,
    );

    expect(markup).toContain('data-diff-loading-skeleton="visible"');
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).toContain("files-state-enter");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Loading checkpoint diff...");
  });
});
