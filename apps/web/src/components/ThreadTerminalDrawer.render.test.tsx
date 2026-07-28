import type { ResolvedKeybindingsConfig, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import ThreadTerminalDrawer from "./ThreadTerminalDrawer";

/**
 * The `unit` project runs in Node, so these are server renders: effects never
 * run and no terminal is ever attached. That is enough to assert the drawer's
 * resize affordance contract, which is static markup.
 */
function renderEmptyDrawer(height = 200): string {
  const noop = vi.fn();
  return renderToStaticMarkup(
    <ThreadTerminalDrawer
      threadRef={{ environmentId: "env", threadId: "thread" } as unknown as ScopedThreadRef}
      threadId={"thread" as unknown as ThreadId}
      cwd="/workspace"
      height={height}
      terminalIds={[]}
      activeTerminalId=""
      terminalGroups={[]}
      activeTerminalGroupId=""
      focusRequestId={0}
      onSplitTerminal={noop}
      onSplitTerminalVertical={noop}
      onNewTerminal={noop}
      onActiveTerminalChange={noop}
      onCloseTerminal={noop}
      onHeightChange={noop}
      onAddTerminalContext={noop}
      keybindings={{} as unknown as ResolvedKeybindingsConfig}
    />,
  );
}

describe("terminal drawer resize affordance", () => {
  it("exposes horizontal separator semantics with a live value trio", () => {
    const html = renderEmptyDrawer();
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-label="Resize terminal drawer"');
    expect(html).toContain('aria-valuemin="180"');
    expect(html).toContain('aria-valuenow="200"');
    expect(html).toMatch(/aria-valuemax="\d+"/);
  });

  it("reports the live height, not a constant", () => {
    expect(renderEmptyDrawer(240)).toContain('aria-valuenow="240"');
    // Below the floor: the reported value is the clamped one the user can act on.
    expect(renderEmptyDrawer(10)).toContain('aria-valuenow="180"');
  });

  it("is keyboard reachable and reports its drag state", () => {
    const html = renderEmptyDrawer();
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("workbench-terminal-resize-handle");
    expect(html).toContain('data-resizing="false"');
  });

  it("carries the thin primary rail that lights up on hover and drag", () => {
    expect(renderEmptyDrawer()).toContain("workbench-terminal-resize-rail");
  });
});
