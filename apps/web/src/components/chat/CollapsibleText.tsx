import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/**
 * Clamps a long block of plain text behind a fade with a show/hide control.
 *
 * Thresholds and the fade mask mirror `CollapsibleUserMessageBody` in
 * `MessagesTimeline` so long text reads the same wherever it appears. It is a
 * separate component rather than a reuse of that one because this renders
 * plain text — no markdown, terminal contexts or skill chips — and pulling
 * `UserMessageBody` along for a header field would couple the two surfaces far
 * more than the shared look is worth.
 */

const MAX_COLLAPSED_LINES = 8;
const MAX_COLLAPSED_LENGTH = 600;
const FADE_HEIGHT_REM = 1.75;
const FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${FADE_HEIGHT_REM}rem), transparent)`;

export function shouldCollapseText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return trimmed.length > MAX_COLLAPSED_LENGTH || trimmed.split("\n").length > MAX_COLLAPSED_LINES;
}

export function CollapsibleText({
  text,
  className,
  expandLabel = "Show more",
  collapseLabel = "Show less",
}: {
  text: string;
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = shouldCollapseText(text);
  const isCollapsed = canCollapse && !expanded;

  return (
    <div>
      <div
        className={cn("relative", isCollapsed && "max-h-44 overflow-hidden")}
        data-collapsible-text-collapsed={isCollapsed ? "true" : "false"}
        style={isCollapsed ? { WebkitMaskImage: FADE_MASK, maskImage: FADE_MASK } : undefined}
      >
        <p className={cn("whitespace-pre-wrap text-sm leading-6", className)}>{text}</p>
      </div>
      {canCollapse ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="mt-1 h-auto px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? collapseLabel : expandLabel}
        </Button>
      ) : null}
    </div>
  );
}
