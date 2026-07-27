"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "~/lib/utils";

interface ColorSelectorProps {
  colors: string[];
  size?: "default" | "sm" | "lg";
  defaultValue: string;
  value?: string;
  name?: string;
  onColorSelect?: (color: string) => void;
  className?: string;
  "aria-label"?: string;
}

const colorMap = {
  default: "var(--foreground)",
  red: "var(--color-red-500)",
  green: "var(--color-green-500)",
  blue: "var(--color-blue-500)",
  yellow: "var(--color-yellow-500)",
  purple: "var(--color-purple-500)",
  pink: "var(--color-pink-500)",
  indigo: "var(--color-indigo-500)",
  orange: "var(--color-orange-500)",
  teal: "var(--color-teal-500)",
  cyan: "var(--color-cyan-500)",
  lime: "var(--color-lime-500)",
  emerald: "var(--color-emerald-500)",
  violet: "var(--color-violet-500)",
  fuchsia: "var(--color-fuchsia-500)",
  rose: "var(--color-rose-500)",
  sky: "var(--color-sky-500)",
  amber: "var(--color-amber-500)",
} as const;

function getSizeClass(size: "default" | "sm" | "lg") {
  switch (size) {
    case "sm":
      return "size-4";
    case "default":
      return "size-5";
    case "lg":
      return "size-6";
    default:
      return "size-5";
  }
}

function getColorValue(color: string): string {
  return colorMap[color as keyof typeof colorMap] || color;
}

export function ColorSelector({
  colors,
  size = "default",
  defaultValue,
  value,
  name,
  onColorSelect,
  className,
  "aria-label": ariaLabel,
}: ColorSelectorProps) {
  const [uncontrolledColor, setUncontrolledColor] = useState<string>(defaultValue);
  const selectedColor = value ?? uncontrolledColor;
  const selectedIndex = colors.indexOf(selectedColor);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, selectedIndex));
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleColorSelect = (color: string) => {
    if (value === undefined) {
      setUncontrolledColor(color);
    }
    onColorSelect?.(color);
  };

  useEffect(() => {
    if (colors.length === 0) return;
    setActiveIndex((currentIndex) => {
      if (currentIndex < colors.length) return currentIndex;
      return Math.max(0, selectedIndex);
    });
  }, [colors.length, selectedIndex]);

  const moveActiveSwatch = (nextIndex: number) => {
    if (colors.length === 0) return;
    const wrappedIndex = (nextIndex + colors.length) % colors.length;
    setActiveIndex(wrappedIndex);
    swatchRefs.current[wrappedIndex]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveActiveSwatch(index - 1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveActiveSwatch(index + 1);
        break;
      case "Home":
        event.preventDefault();
        moveActiveSwatch(0);
        break;
      case "End":
        event.preventDefault();
        moveActiveSwatch(colors.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        handleColorSelect(colors[index]!);
        break;
    }
  };

  const sizeClass = getSizeClass(size);

  return (
    <div
      className={cn("flex gap-2", className)}
      role="radiogroup"
      aria-label={ariaLabel ?? (name ? `${name} color` : "Color")}
    >
      {name && <input type="hidden" name={name} value={selectedColor} />}
      {colors.map((color, index) => {
        const colorValue = getColorValue(color);
        const selected = selectedColor === color;
        return (
          <button
            key={color}
            type="button"
            ref={(element) => {
              swatchRefs.current[index] = element;
            }}
            className={cn(
              "a11y-color-swatch grid cursor-pointer place-items-center rounded-full outline-none",
              "transition-transform [transition-duration:var(--motion-press,100ms)] active:scale-90 motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              sizeClass,
            )}
            onClick={() => handleColorSelect(color)}
            onFocus={() => setActiveIndex(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            tabIndex={index === activeIndex ? 0 : -1}
            role="radio"
            aria-label={`Select ${color} color`}
            aria-checked={selected}
          >
            <span
              aria-hidden
              className={cn(sizeClass, "rounded-full border border-black/10 dark:border-white/20")}
              style={{
                backgroundColor: colorValue,
                ...(selected
                  ? {
                      boxShadow: `inset 0 0 0 2px var(--card), 0 0 0 2px ${colorValue}`,
                    }
                  : {}),
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
