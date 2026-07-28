import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  Settings2Icon,
} from "lucide-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { T3ConnectSidebarAvatar, T3ConnectSidebarSignIn } from "../clerk/T3ConnectSidebarSignIn";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/beta"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Appearance", to: "/settings/appearance", icon: PaletteIcon },
  { label: "Keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { label: "Providers", to: "/settings/providers", icon: BotIcon },
  { label: "Source Control", to: "/settings/source-control", icon: GitBranchIcon },
  { label: "Connections", to: "/settings/connections", icon: Link2Icon },
  { label: "Beta", to: "/settings/beta", icon: FlaskConicalIcon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

/** Height of the moving rail segment, in px. Mirrors `.nav-settings-marker`. */
const SETTINGS_MARKER_HEIGHT = 16;
/** Slightly longer than the marker's `--motion-state` travel. */
const SETTINGS_MARKER_MOVE_MS = 220;

/**
 * Where the marker belongs, in px from the top of the nav rail. Pure so the
 * measurement can be checked without a layout engine.
 */
export function resolveSettingsMarkerOffset(input: {
  railTop: number;
  rowTop: number;
  rowHeight: number;
}): number {
  return Math.round(
    input.rowTop - input.railTop + input.rowHeight / 2 - SETTINGS_MARKER_HEIGHT / 2,
  );
}

/**
 * The marker that travels between active settings rows.
 *
 * Inert by construction: `aria-hidden` and `pointer-events-none`, positioned
 * only by transform. Navigation, route focus, and history never wait on it.
 */
export function SettingsNavMarker(props: { offset: number; placed: boolean; moving: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="nav-settings-marker"
      data-settings-nav-marker="true"
      data-nav-initial={props.placed ? undefined : "true"}
      data-nav-moving={props.moving ? "true" : undefined}
      style={{ transform: `translate3d(0, ${props.offset}px, 0)` }}
    />
  );
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const railRef = useRef<HTMLDivElement>(null);
  const markerOffsetRef = useRef<number | null>(null);
  const [markerOffset, setMarkerOffset] = useState<number | null>(null);
  const [markerPlaced, setMarkerPlaced] = useState(false);
  const [markerMoving, setMarkerMoving] = useState(false);

  // Measure where the marker belongs. This only reads layout and writes a
  // transform; navigation itself (route focus, heading, history) has already
  // happened by the time this runs and never waits on it.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const activeRow =
      Array.from(rail.querySelectorAll<HTMLElement>("[data-settings-nav-item]")).find(
        (row) => row.dataset.settingsNavItem === pathname,
      ) ?? null;
    if (!activeRow) {
      markerOffsetRef.current = null;
      setMarkerOffset(null);
      return;
    }
    const railRect = rail.getBoundingClientRect();
    const rowRect = activeRow.getBoundingClientRect();
    const nextOffset = resolveSettingsMarkerOffset({
      railTop: railRect.top,
      rowTop: rowRect.top,
      rowHeight: rowRect.height,
    });
    const previousOffset = markerOffsetRef.current;
    markerOffsetRef.current = nextOffset;
    setMarkerOffset(nextOffset);
    if (previousOffset !== null && previousOffset !== nextOffset) {
      setMarkerMoving(true);
    }
  }, [pathname]);

  // The very first placement is a measurement, not a navigation, so it lands
  // with transitions suppressed and only becomes animatable a frame later.
  useEffect(() => {
    if (markerOffset === null || markerPlaced) {
      return;
    }
    const frame = window.requestAnimationFrame(() => setMarkerPlaced(true));
    return () => window.cancelAnimationFrame(frame);
  }, [markerOffset, markerPlaced]);

  // The tight glow exists only while the marker is travelling; it settles to a
  // static marker afterwards.
  useEffect(() => {
    if (!markerMoving) {
      return;
    }
    const timer = window.setTimeout(() => setMarkerMoving(false), SETTINGS_MARKER_MOVE_MS);
    return () => window.clearTimeout(timer);
  }, [markerMoving]);
  const handleSectionClick = useCallback(
    (to: SettingsSectionPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, replace: true });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, isMobile, navigate, setOpenMobile]);

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-2 py-3">
          <div className="nav-settings-rail" ref={railRef}>
            {markerOffset === null ? null : (
              <SettingsNavMarker
                offset={markerOffset}
                placed={markerPlaced}
                moving={markerMoving}
              />
            )}
            <SidebarMenu>
              {SETTINGS_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.to;
                return (
                  <SidebarMenuItem key={item.to} data-settings-nav-item={item.to}>
                    <SidebarMenuButton
                      size="sm"
                      isActive={isActive}
                      className={
                        isActive
                          ? "h-8 items-center gap-2 rounded-md border border-astro-highlight/20 bg-sidebar-row-active px-2 py-1.5 text-left text-sm font-medium text-sidebar-foreground transition-[background-color,border-color] duration-200 motion-reduce:transition-none"
                          : "h-8 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm font-medium text-sidebar-muted-foreground/80 transition-[background-color,color] duration-200 hover:bg-sidebar-row-hover hover:text-sidebar-foreground motion-reduce:transition-none"
                      }
                      onClick={() => handleSectionClick(item.to)}
                    >
                      <Icon
                        className={
                          isActive
                            ? "size-4 shrink-0 text-astro-highlight"
                            : "size-4 shrink-0 text-sidebar-muted-foreground/60 transition-colors duration-200 group-hover/menu-item:text-primary motion-reduce:transition-none"
                        }
                      />
                      <span className="truncate">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <T3ConnectSidebarSignIn />
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                className="h-8 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground/80 transition-[background-color,color,border-color] duration-200 hover:border-primary/10 hover:bg-sidebar-row-hover hover:text-sidebar-foreground motion-reduce:transition-none"
                onClick={handleBackClick}
              >
                <ArrowLeftIcon className="size-4" />
                <span>Back</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <T3ConnectSidebarAvatar />
        </div>
      </SidebarFooter>
    </>
  );
}
