import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  SETTINGS_NAV_ITEMS,
  SettingsNavMarker,
  resolveSettingsMarkerOffset,
} from "./SettingsSidebarNav";

describe("settings navigation marker", () => {
  it("travels by transform so no navigation row relayouts", () => {
    const html = renderToStaticMarkup(<SettingsNavMarker offset={64} placed moving={false} />);

    expect(html).toContain("translate3d(0, 64px, 0)");
    expect(html).toContain("nav-settings-marker");
    expect(html).not.toContain("top:");
  });

  it("carries the moving flag only while it is actually travelling", () => {
    const travelling = renderToStaticMarkup(<SettingsNavMarker offset={64} placed moving />);
    const settled = renderToStaticMarkup(<SettingsNavMarker offset={64} placed moving={false} />);

    // The tight glow is keyed off this attribute, so a settled marker is static.
    expect(travelling).toContain('data-nav-moving="true"');
    expect(settled).not.toContain("data-nav-moving");
  });

  it("does not animate its very first placement", () => {
    const firstPaint = renderToStaticMarkup(
      <SettingsNavMarker offset={64} placed={false} moving={false} />,
    );

    expect(firstPaint).toContain('data-nav-initial="true"');
  });

  it("stays inert so route focus is never disturbed", () => {
    const html = renderToStaticMarkup(<SettingsNavMarker offset={0} placed moving={false} />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("role=");
  });

  it("centres itself on the active row", () => {
    // A 32px row starting 8px below the rail: centre is 24px, marker is 16px
    // tall, so it sits at 16px.
    expect(resolveSettingsMarkerOffset({ railTop: 100, rowTop: 108, rowHeight: 32 })).toBe(16);
  });

  it("rounds to whole pixels so the segment never renders blurred", () => {
    expect(resolveSettingsMarkerOffset({ railTop: 100.4, rowTop: 108.1, rowHeight: 33 })).toBe(
      Math.round(108.1 - 100.4 + 16.5 - 8),
    );
  });

  it("has one marker for the whole rail, not one per row", () => {
    // The plan asks for a single compact moving marker between rows; a
    // per-row indicator would be a different, louder treatment.
    expect(SETTINGS_NAV_ITEMS.length).toBeGreaterThan(1);
    const html = renderToStaticMarkup(<SettingsNavMarker offset={0} placed moving={false} />);
    expect(html.match(/data-settings-nav-marker/g)).toHaveLength(1);
  });
});
