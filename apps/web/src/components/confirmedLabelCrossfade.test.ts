import { assert, describe, it } from "vite-plus/test";

import { advanceConfirmedChangeGeneration } from "./confirmedLabelCrossfade";

describe("advanceConfirmedChangeGeneration", () => {
  it("does not crossfade on first render or on a remount", () => {
    // Generation 0 is the "no confirmed change observed yet" sentinel: the
    // hook seeds `previousValue` with the current value, so a fresh mount and
    // every re-render at the same value keep it at 0 and no class is applied.
    assert.equal(
      advanceConfirmedChangeGeneration({
        previousValue: "main",
        nextValue: "main",
        generation: 0,
      }),
      0,
    );
  });

  it("advances exactly once per confirmed change", () => {
    const afterFirst = advanceConfirmedChangeGeneration({
      previousValue: "main",
      nextValue: "feature/x",
      generation: 0,
    });
    assert.equal(afterFirst, 1);

    // Idempotent under a repeated render (React StrictMode / concurrent retry).
    const afterRepeatRender = advanceConfirmedChangeGeneration({
      previousValue: "feature/x",
      nextValue: "feature/x",
      generation: afterFirst,
    });
    assert.equal(afterRepeatRender, 1);

    const afterSecond = advanceConfirmedChangeGeneration({
      previousValue: "feature/x",
      nextValue: "feature/y",
      generation: afterRepeatRender,
    });
    assert.equal(afterSecond, 2);
  });

  it("treats clearing the value as a confirmed change", () => {
    assert.equal(
      advanceConfirmedChangeGeneration({
        previousValue: "feature/x",
        nextValue: null,
        generation: 3,
      }),
      4,
    );
  });
});
