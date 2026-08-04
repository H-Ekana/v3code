import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  Sidebar,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { resolveSidebarState } from "./sidebarState";

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses mobile sheet visibility for the shared responsive state", () => {
    expect(resolveSidebarState({ isMobile: true, open: true, openMobile: false })).toBe(
      "collapsed",
    );
    expect(resolveSidebarState({ isMobile: true, open: false, openMobile: true })).toBe("expanded");
    expect(resolveSidebarState({ isMobile: false, open: true, openMobile: false })).toBe(
      "expanded",
    );
  });

  it("exposes collapsed state for shared titlebar inset styling", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen={false}>
        <div />
      </SidebarProvider>,
    );

    expect(html).toContain('data-sidebar-state="collapsed"');
  });

  it("keeps the sidebar trigger interactive inside Electron drag regions", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(html).toContain("[-webkit-app-region:no-drag]");
    expect(html).toContain("size-[var(--workspace-titlebar-control-size)]!");
    expect(html).toContain("sidebar-trigger-icon-open");
    expect(html).toContain('data-open="true"');
  });

  it("gives a resizable rail full separator and value semantics", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar resizable={{ minWidth: 240, maxWidth: 480 }}>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="240"');
    expect(html).toContain('aria-valuemax="480"');
    expect(html).toContain('aria-valuenow="256"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("sidebar-resize-tip");
  });

  it("uses shared geometry and icon constraints for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("h-8");
    expect(html).toContain("rounded-[var(--control-radius)]");
    expect(html).toContain("px-[var(--sidebar-row-content-inset)]");
    expect(html).toContain("py-1.5");
    expect(html).toContain("]:size-4");
    expect(html).toContain("]:shrink-0");
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("hover:bg-sidebar-row-hover");
    expect(html).not.toContain("hover:bg-primary/10");
    expect(html).toContain("motion-reduce:transition-none");
    expect(html).toContain("gap-[var(--sidebar-control-gap)]");
    expect(html).toContain("text-[var(--sidebar-icon-color)]");
    expect(html).not.toContain("[&amp;&gt;svg]:opacity-60");
  });

  it("gives the active navigation state a subtle primary-token accent", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarMenuButton isActive>Projects</SidebarMenuButton>
      </SidebarProvider>,
    );

    expect(html).toContain("data-[active=true]:bg-primary/10");
    expect(html).toContain("data-[active=true]:ring-primary/15");
  });

  it("applies the shared default treatment to icon-only menu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarMenuButton size="icon">
          <span>+</span>
        </SidebarMenuButton>
      </SidebarProvider>,
    );

    expect(html).toContain("size-8");
    expect(html).toContain("justify-center");
    expect(html).toContain("p-0");
    expect(html).toContain("font-medium");
    expect(html).toContain("text-sidebar-muted-foreground/80");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for menu actions", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuAction aria-label="Create thread">
        <span>+</span>
      </SidebarMenuAction>,
    );

    expect(html).toContain('data-slot="sidebar-menu-action"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
  });
});
