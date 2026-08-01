import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

describe("RightPanelResizeHandle", () => {
  it("exposes separator values, keyboard focus, and drag state", () => {
    const handler = vi.fn();
    const html = renderToStaticMarkup(
      <RightPanelResizeHandle
        handlers={{
          onKeyDown: handler,
          onPointerCancel: handler,
          onPointerDown: handler,
          onPointerMove: handler,
          onPointerUp: handler,
        }}
        separatorProps={{
          role: "separator",
          tabIndex: 0,
          "aria-orientation": "vertical",
          "aria-valuemin": 360,
          "aria-valuemax": 900,
          "aria-valuenow": 540,
        }}
        isResizing
      />,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="360"');
    expect(html).toContain('aria-valuemax="900"');
    expect(html).toContain('aria-valuenow="540"');
    expect(html).toContain('data-resizing="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("group-focus-visible:bg-primary/65");
  });

  it("supports a right-edge handle with a surface-specific label", () => {
    const handler = vi.fn();
    const html = renderToStaticMarkup(
      <RightPanelResizeHandle
        handlers={{
          onKeyDown: handler,
          onPointerCancel: handler,
          onPointerDown: handler,
          onPointerMove: handler,
          onPointerUp: handler,
        }}
        separatorProps={{
          role: "separator",
          tabIndex: 0,
          "aria-orientation": "vertical",
          "aria-valuemin": 224,
          "aria-valuemax": 520,
          "aria-valuenow": 288,
        }}
        isResizing={false}
        ariaLabel="Resize agent roster"
        edge="right"
      />,
    );

    expect(html).toContain('aria-label="Resize agent roster"');
    expect(html).toContain("-right-1");
    expect(html).not.toContain("-left-1");
  });
});
