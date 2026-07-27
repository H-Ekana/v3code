import { useEffect, useRef, useState, type ReactNode } from "react";

const PROJECT_NAME_GLIMMER_INTERVALS_MS = [2_000, 2_500, 3_000] as const;

export function pickNextProjectNameGlimmerDelay(
  previousDelay: number | null,
  randomValue = Math.random(),
): number {
  const availableIntervals = PROJECT_NAME_GLIMMER_INTERVALS_MS.filter(
    (interval) => interval !== previousDelay,
  );
  const boundedRandomValue = Math.min(Math.max(randomValue, 0), 0.999_999);
  const intervalIndex = Math.floor(boundedRandomValue * availableIntervals.length);

  return availableIntervals[intervalIndex] ?? PROJECT_NAME_GLIMMER_INTERVALS_MS[0];
}

export function DraftHeroProjectNameAccent({ children }: { children: ReactNode }) {
  const [glimmerCycle, setGlimmerCycle] = useState(0);
  const previousDelayRef = useRef<number | null>(null);

  useEffect(() => {
    const delay = pickNextProjectNameGlimmerDelay(previousDelayRef.current);
    previousDelayRef.current = delay;

    const timeoutId = window.setTimeout(() => {
      setGlimmerCycle((cycle) => cycle + 1);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [glimmerCycle]);

  return (
    <span className="draft-hero-project-name-accent">
      <span className="relative z-10">{children}</span>
      <span
        key={`project-name-glimmer-${glimmerCycle}`}
        className="draft-hero-project-name-glimmer"
        aria-hidden="true"
      >
        {children}
      </span>
      <span className="draft-hero-project-name-underline" aria-hidden="true">
        <span
          key={`project-name-underline-streak-${glimmerCycle}`}
          className="draft-hero-project-name-streak"
        />
      </span>
    </span>
  );
}
