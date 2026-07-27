import { describe, expect, it } from "vite-plus/test";

import { revealInFileExplorerLabel } from "./fileExplorerLabel";

describe("revealInFileExplorerLabel", () => {
  it.each([
    ["MacIntel", "Open in Finder"],
    ["darwin", "Open in Finder"],
    ["Win32", "Open in File Explorer"],
    ["Linux x86_64", "Open in File Manager"],
  ])("maps %s to %s", (platform, expected) => {
    expect(revealInFileExplorerLabel(platform)).toBe(expected);
  });
});
