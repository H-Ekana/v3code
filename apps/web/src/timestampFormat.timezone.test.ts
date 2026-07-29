import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { formatElapsedDurationLabel, formatTimestamp } from "./timestampFormat";

const originalTimeZone = process.env.TZ;

describe("timestamp timezone regression", () => {
  beforeAll(() => {
    process.env.TZ = "Asia/Kolkata";
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  it("converts a UTC wall clock to local time without changing elapsed duration semantics", () => {
    const utcInstant = "2026-07-28T12:53:08.906Z";

    const wallClock = formatTimestamp(utcInstant, "24-hour");
    const elapsed = formatElapsedDurationLabel(utcInstant, Date.parse("2026-07-28T13:23:08.906Z"));

    expect(wallClock).toBe("18:23:08");
    expect(wallClock).not.toBe("12:53:08");
    expect(elapsed).toBe("30m");
  });
});
