import { FileText, RotateCcw, X } from "lucide-react";

import { type LargePasteDraft, largePasteCharacterCount } from "~/lib/largePaste";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

interface ComposerLargePasteChipProps {
  paste: LargePasteDraft;
  onRestore: () => void;
  onRemove: () => void;
}

export function ComposerLargePasteChip({
  paste,
  onRestore,
  onRemove,
}: ComposerLargePasteChipProps) {
  const characterCount = largePasteCharacterCount(paste.text);
  const formattedCount = characterCount.toLocaleString();

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={`${COMPOSER_INLINE_CHIP_CLASS_NAME} cursor-pointer outline-none hover:border-primary/30 hover:bg-accent/65 focus-visible:ring-1 focus-visible:ring-ring data-popup-open:border-primary/35 data-popup-open:bg-accent/70`}
            aria-label={`Pasted text attachment, ${formattedCount} characters. Preview`}
          >
            <FileText className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} aria-hidden />
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>Pasted text.txt</span>
            <span className="shrink-0 font-normal tabular-nums text-muted-foreground">
              · {formattedCount} chars
            </span>
          </button>
        }
      />
      <PopoverPopup
        side="top"
        align="start"
        sideOffset={6}
        className="max-w-none overflow-hidden"
        viewportClassName="p-0!"
      >
        <div className="w-[min(34rem,calc(100vw-2rem))]">
          <div className="flex items-center justify-between gap-3 border-b border-border/65 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">Pasted text.txt</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formattedCount} characters
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="motion-focus motion-press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground outline-none hover:bg-foreground/6 hover:text-foreground"
                onClick={onRestore}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Insert as text
              </button>
              <button
                type="button"
                aria-label="Remove pasted text"
                className="motion-destructive motion-focus motion-press inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                onClick={onRemove}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word bg-muted/25 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
            {paste.text}
          </pre>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
