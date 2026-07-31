import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { ComponentProps, Key, ReactNode } from "react";

import { Command, CommandFooter, CommandInput, CommandPanel } from "./ui/command";
import { Kbd, KbdGroup } from "./ui/kbd";

type CommandPaletteContentProps = Omit<ComponentProps<typeof Command>, "children"> & {
  readonly children: ReactNode;
  readonly escapeLabel?: ReactNode;
  readonly footerActionLabel?: ReactNode;
  readonly footerTrailing?: ReactNode;
  readonly inputAccessory?: ReactNode;
  readonly inputProps: ComponentProps<typeof CommandInput>;
  readonly panelClassName?: string;
  /**
   * Remounts the panel so a view change can replay its enter animation, and
   * carries the direction/depth data attributes the motion styles key off.
   * Palette modes without a directional transition can omit both.
   */
  readonly panelKey?: Key;
  readonly panelProps?: Omit<ComponentProps<typeof CommandPanel>, "children" | "className"> &
    Record<`data-${string}`, string | number | undefined>;
  readonly showBackHint?: boolean;
  readonly testId?: string;
};

/**
 * Shared command palette chrome. Palette modes provide their query behavior,
 * results, and optional input accessory while retaining one input, panel, and
 * keyboard-hint gutter.
 */
export function CommandPaletteContent({
  children,
  escapeLabel = "Close",
  footerActionLabel,
  footerTrailing,
  inputAccessory,
  inputProps,
  panelClassName,
  panelKey,
  panelProps,
  showBackHint,
  testId,
  ...commandProps
}: CommandPaletteContentProps) {
  return (
    <div className="contents" data-testid={testId}>
      <Command {...commandProps}>
        <div className="relative">
          <CommandInput {...inputProps} />
          {inputAccessory}
        </div>
        <CommandPanel key={panelKey} className={panelClassName} {...panelProps}>
          {children}
        </CommandPanel>
        <CommandFooter className="gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span>Navigate</span>
            </KbdGroup>
            {footerActionLabel !== undefined ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Enter</Kbd>
                <span>{footerActionLabel}</span>
              </KbdGroup>
            ) : null}
            {showBackHint ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Backspace</Kbd>
                <span>Back</span>
              </KbdGroup>
            ) : null}
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span>{escapeLabel}</span>
            </KbdGroup>
          </div>
          {footerTrailing}
        </CommandFooter>
      </Command>
    </div>
  );
}
