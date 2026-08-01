import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  EllipsisIcon,
  ListTodoIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

/*
 * Runtime-mode presentation lives here rather than in ChatComposer because both
 * the full footer control and this compact menu need it, and ChatComposer
 * already imports this module (importing the other direction would cycle).
 */

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; compactDescription: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands & edits.",
    compactDescription: "Asks first",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Edits free; ask for the rest.",
    compactDescription: "Edits free",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "AI-reviewed; still asks before risky work.",
    compactDescription: "AI-reviewed",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "No prompts, including destructive.",
    compactDescription: "No prompts",
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

export const RUNTIME_MODE_AUTO_GLINT_MS = 200;

/**
 * True for one short window after the user switches *into* Auto. Never true on
 * mount, so opening a thread already in Auto stays quiet.
 */
export function useRuntimeModeAutoGlint(runtimeMode: RuntimeMode): boolean {
  const previousModeRef = useRef<RuntimeMode | null>(null);
  const [glinting, setGlinting] = useState(false);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = runtimeMode;
    if (previousMode === null || previousMode === runtimeMode || runtimeMode !== "auto") {
      if (runtimeMode !== "auto") setGlinting(false);
      return;
    }
    setGlinting(true);
    const timer = window.setTimeout(() => setGlinting(false), RUNTIME_MODE_AUTO_GLINT_MS);
    return () => window.clearTimeout(timer);
  }, [runtimeMode]);

  return glinting;
}

/**
 * Runtime-mode icon. Auto gets a crisp outline plus a tight afterglow anchored
 * to the star shapes (drop-shadow follows the glyph alpha, so it never lights
 * the whole trigger). The entry glint is one bounded violet-to-pink pass.
 */
export const RuntimeModeGlyph = memo(function RuntimeModeGlyph({
  mode,
  selected,
  glinting = false,
  className,
}: {
  mode: RuntimeMode;
  selected: boolean;
  glinting?: boolean;
  className?: string;
}) {
  const Icon = runtimeModeConfig[mode].icon;
  const isAuto = mode === "auto";
  return (
    <Icon
      aria-hidden="true"
      data-runtime-mode-glyph={mode}
      data-auto-illuminated={isAuto && selected ? "true" : undefined}
      className={cn(
        "shrink-0",
        isAuto && "composer-auto-glyph",
        isAuto && selected && "composer-auto-glyph--illuminated",
        isAuto && selected && glinting && "composer-auto-glyph--glint",
        className,
      )}
    />
  );
});

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const autoGlinting = useRuntimeModeAutoGlint(props.runtimeMode);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/80 hover:text-foreground/95"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem value="default">Chat</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const selected = props.runtimeMode === mode;
            return (
              <MenuRadioItem key={mode} value={mode} className="py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <RuntimeModeGlyph
                    mode={mode}
                    selected={selected}
                    glinting={autoGlinting}
                    className="size-3.5"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{option.label}</span>
                    <span className="truncate text-[11px] leading-4 text-muted-foreground">
                      {option.compactDescription}
                    </span>
                  </span>
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
