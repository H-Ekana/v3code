import { ChevronDown, MessageSquareQuote, X } from "lucide-react";

import type { ConversationReference } from "~/conversationReference";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

interface ComposerConversationReferencesProps {
  references: ReadonlyArray<ConversationReference>;
  onRemove: (referenceId: string) => void;
  className?: string;
}

interface ConversationReferenceListProps {
  references: ReadonlyArray<ConversationReference>;
  onRemove: (referenceId: string) => void;
}

export function ConversationReferenceList({
  references,
  onRemove,
}: ConversationReferenceListProps) {
  return (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <div className="flex items-center justify-between gap-3 border-b border-border/65 px-3 py-2">
        <span className="text-xs font-medium text-foreground">References</span>
        <span className="text-[11px] text-muted-foreground">In prompt order</span>
      </div>
      <ol className="max-h-72 divide-y divide-border/55 overflow-y-auto overscroll-contain">
        {references.map((reference, index) => (
          <li
            key={reference.id}
            className="group/reference flex min-w-0 items-start gap-2 px-3 py-2.5"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                Selected {reference.sourceRole === "assistant" ? "response" : "prompt"} text
              </p>
              <p className="line-clamp-4 whitespace-pre-wrap wrap-break-word font-mono text-[11px] leading-relaxed text-foreground/82">
                {reference.text}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Remove reference ${index + 1}`}
              className="motion-destructive motion-focus motion-press inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive active:bg-destructive/15"
              onClick={() => onRemove(reference.id)}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ComposerConversationReferences({
  references,
  onRemove,
  className,
}: ComposerConversationReferencesProps) {
  if (references.length === 0) return null;
  const label = `${references.length} ${references.length === 1 ? "reference" : "references"}`;

  return (
    <div className={cn("flex flex-wrap", className)}>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`${label}. Show referenced text`}
              className="group/reference-trigger motion-focus motion-press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-primary/18 bg-primary/[0.055] px-2 text-xs font-medium text-foreground outline-none hover:border-primary/30 hover:bg-primary/[0.085] data-popup-open:border-primary/35 data-popup-open:bg-primary/10"
            >
              <MessageSquareQuote className="size-3.5 text-primary" aria-hidden />
              <span>{label}</span>
              <ChevronDown
                className="size-3 text-muted-foreground transition-transform duration-150 group-data-popup-open/reference-trigger:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
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
          <ConversationReferenceList references={references} onRemove={onRemove} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}
