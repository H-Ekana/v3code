import { useAtomValue } from "@effect/atom-react";
import { useId } from "react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";

export type SidebarStageBackdropVariant = "nightly" | "dev";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

// A wide viewBox keeps the 96-unit art height at a fixed scale while sidebar resizing reveals
// more horizontal canvas instead of zooming the scene.
const STAGE_BACKDROP_VIEW_BOX = "0 0 8192 96";
const V3_NIGHTLY_BANNER_URL = new URL(
  "../../../../assets/v3/v3-code-nightly-sidebar-banner-v2.png",
  import.meta.url,
).href;

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  enabled = true,
): SidebarStageBackdropVariant | null {
  if (!enabled) return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdropVariant(enabled = true): SidebarStageBackdropVariant | null {
  return resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), enabled);
}

/** Stage-channel header art; palettes mirror the per-channel app icons in `assets/`. */
export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-28 select-none overflow-hidden"
    >
      <StageBackdropArt variant={variant} />
    </div>
  );
}

export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return variant === "nightly" ? <NightlySkyArt /> : <DevBlueprintArt />;
}

export function StageBackdropButtonArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return variant === "nightly" ? <NightlySendButtonArt /> : <DevBlueprintArt compact />;
}

const NIGHTLY_STARS: ReadonlyArray<{
  cx: number;
  cy: number;
  r: number;
  opacity: number;
}> = [
  { cx: 14, cy: 10, r: 0.6, opacity: 0.85 },
  { cx: 38, cy: 22, r: 0.4, opacity: 0.55 },
  { cx: 58, cy: 8, r: 0.5, opacity: 0.7 },
  { cx: 84, cy: 16, r: 0.4, opacity: 0.5 },
  { cx: 104, cy: 7, r: 0.6, opacity: 0.8 },
  { cx: 126, cy: 20, r: 0.4, opacity: 0.55 },
  { cx: 148, cy: 11, r: 0.5, opacity: 0.7 },
  { cx: 170, cy: 24, r: 0.4, opacity: 0.5 },
  { cx: 192, cy: 9, r: 0.6, opacity: 0.8 },
  { cx: 214, cy: 18, r: 0.4, opacity: 0.55 },
  { cx: 236, cy: 8, r: 0.5, opacity: 0.7 },
  { cx: 258, cy: 20, r: 0.45, opacity: 0.6 },
  { cx: 278, cy: 11, r: 0.55, opacity: 0.75 },
  { cx: 26, cy: 34, r: 0.4, opacity: 0.45 },
  { cx: 118, cy: 34, r: 0.4, opacity: 0.45 },
  { cx: 202, cy: 32, r: 0.4, opacity: 0.5 },
  { cx: 268, cy: 34, r: 0.4, opacity: 0.45 },
];

const NIGHTLY_SPARKLES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 70, y: 28 },
  { x: 160, y: 36 },
  { x: 246, y: 26 },
];

function NightlySkyArt() {
  const idPrefix = useId().replaceAll(":", "");
  const skyId = `${idPrefix}-stage-night-sky`;
  const glowId = `${idPrefix}-stage-night-glow`;
  const cloudId = `${idPrefix}-stage-night-cloud`;
  const softId = `${idPrefix}-stage-night-soft`;
  const starsId = `${idPrefix}-stage-night-stars`;
  const glowsId = `${idPrefix}-stage-night-glows`;

  return (
    <svg
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1995 788"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={skyId}
          x1="24"
          y1="0"
          x2="264"
          y2="96"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop stopColor="#07152F" />
          <stop offset="0.5" stopColor="#151443" />
          <stop offset="1" stopColor="#32155B" />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(216 18) rotate(137) scale(120 84)"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#5165D8" stopOpacity="0.4" />
          <stop offset="0.5" stopColor="#283075" stopOpacity="0.16" />
          <stop offset="1" stopColor="#111635" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={cloudId} x1="0" y1="60" x2="288" y2="96" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4EA4FF" stopOpacity="0.5" />
          <stop offset="0.52" stopColor="#696FEA" stopOpacity="0.62" />
          <stop offset="1" stopColor="#A85BEA" stopOpacity="0.5" />
        </linearGradient>
        <filter id={softId} x="-24" y="-24" width="336" height="144" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <pattern id={starsId} width="288" height="96" patternUnits="userSpaceOnUse">
          <g fill="#E4EAFF">
            {NIGHTLY_STARS.map((star) => (
              <circle
                key={`${star.cx}-${star.cy}`}
                cx={star.cx}
                cy={star.cy}
                r={star.r}
                fillOpacity={star.opacity}
              />
            ))}
          </g>
          <g stroke="#C8D7FF" strokeLinecap="round" strokeOpacity="0.7" strokeWidth="0.6">
            {NIGHTLY_SPARKLES.map((sparkle) => (
              <g key={`${sparkle.x}-${sparkle.y}`}>
                <path d={`M${sparkle.x - 1.5} ${sparkle.y}H${sparkle.x + 1.5}`} />
                <path d={`M${sparkle.x} ${sparkle.y - 1.5}V${sparkle.y + 1.5}`} />
              </g>
            ))}
          </g>
        </pattern>
        <pattern id={glowsId} width="640" height="96" patternUnits="userSpaceOnUse">
          <rect width="640" height="96" fill={`url(#${glowId})`} />
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${skyId})`} />
      <rect width="100%" height="96" fill={`url(#${glowsId})`} />
      <rect width="100%" height="96" fill={`url(#${starsId})`} />

      <g filter={`url(#${softId})`}>
        <path
          d="M-12 88C-12 74 0 63 14 63C18 50 30 41 44 41C58 41 70 49 74 62C79 57 86 54 94 54C110 54 123 66 124 82C132 83 138 88 141 96H-12V88Z"
          fill={`url(#${cloudId})`}
        />
      </g>
      <g filter={`url(#${softId})`}>
        <path
          d="M150 96C151 84 161 75 173 75C176 64 186 57 198 57C210 57 220 64 223 75C231 75 238 80 241 87C250 87 257 91 260 96H150Z"
          fill={`url(#${cloudId})`}
          fillOpacity="0.8"
        />
      </g>
      <image
        width="1995"
        height="788"
        href={V3_NIGHTLY_BANNER_URL}
        preserveAspectRatio="xMidYMid slice"
      />
    </svg>
  );
}

function NightlySendButtonArt() {
  const idPrefix = useId().replaceAll(":", "");
  const skyId = `${idPrefix}-send-night-sky`;
  const cloudFieldId = `${idPrefix}-send-cloud-field`;
  const cloudId = `${idPrefix}-send-cloud`;
  const cloudGlowId = `${idPrefix}-send-cloud-glow`;

  return (
    <svg
      className="h-full w-full"
      data-nightly-send-art=""
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={skyId} x1="3" y1="2" x2="29" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#29316F" />
          <stop offset="0.5" stopColor="#583A88" />
          <stop offset="1" stopColor="#9B469B" />
        </linearGradient>
        <linearGradient
          id={cloudFieldId}
          x1="10"
          y1="31"
          x2="30"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#513083" />
          <stop offset="0.52" stopColor="#9A42A0" />
          <stop offset="1" stopColor="#E85DAE" />
        </linearGradient>
        <linearGradient id={cloudId} x1="10" y1="31" x2="30" y2="17" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7546B4" />
          <stop offset="0.55" stopColor="#C755B0" />
          <stop offset="1" stopColor="#F76DBB" />
        </linearGradient>
        <radialGradient
          id={cloudGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(26 24) rotate(135) scale(17)"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFB4E2" stopOpacity="0.48" />
          <stop offset="1" stopColor="#B849AD" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect className="nightly-send-sky" width="32" height="32" rx="16" fill={`url(#${skyId})`} />

      <g className="nightly-send-stars" fill="#F7F2FF">
        <circle cx="6" cy="6.5" r="0.75" />
        <circle cx="13.5" cy="4.5" r="0.45" fillOpacity="0.82" />
        <circle cx="5" cy="15" r="0.4" fillOpacity="0.72" />
        <path d="M11 8.5C11.25 10 12 10.75 13.5 11C12 11.25 11.25 12 11 13.5C10.75 12 10 11.25 8.5 11C10 10.75 10.75 10 11 8.5Z" />
        <path
          d="M20 3.5C20.2 4.7 20.8 5.3 22 5.5C20.8 5.7 20.2 6.3 20 7.5C19.8 6.3 19.2 5.7 18 5.5C19.2 5.3 19.8 4.7 20 3.5Z"
          fill="#F5A4D8"
        />
      </g>

      <g className="nightly-send-clouds">
        <path
          d="M-2 33V25.8C0.3 22.4 3.9 21.5 7 23.1C8.5 18.2 12.3 15.6 16.9 16C21.2 16.3 23.8 18.7 24.8 22C27.3 19.9 31 20.2 34 23V33H-2Z"
          fill={`url(#${cloudFieldId})`}
          fillOpacity="0.82"
        />
        <circle cx="20" cy="25" r="15" fill={`url(#${cloudGlowId})`} />
        <path
          d="M-1 33V29.8C-1 27.1 1.2 24.9 3.9 24.9C4.8 21.7 7.6 19.5 10.9 19.5C14.2 19.5 17 21.7 17.8 24.7C19 23.6 20.7 22.9 22.5 22.9C25.9 22.9 28.7 25.3 29.3 28.5C31.3 28.4 33 29.2 34 30.8V33H-1Z"
          fill={`url(#${cloudId})`}
        />
        <path
          d="M9 33C9.4 29.9 11.9 27.5 15.1 27.5C16.1 24.5 18.9 22.4 22.2 22.4C26 22.4 29.1 25.1 29.7 28.7C31.7 29.1 33.2 30.7 33.5 33H9Z"
          fill="#EA62B7"
          fillOpacity="0.68"
        />
        <path
          d="M4.1 25.2C5.8 22.3 8.2 21 10.9 21C13.7 21 16 22.6 17 25.1"
          stroke="#FFE3F4"
          strokeLinecap="round"
          strokeOpacity="0.42"
          strokeWidth="0.7"
        />
        <path
          d="M18.8 24.9C20 23.9 21.2 23.5 22.5 23.5C25.4 23.5 27.8 25.5 28.6 28.1"
          stroke="#FFD8F0"
          strokeLinecap="round"
          strokeOpacity="0.25"
          strokeWidth="0.6"
        />
      </g>

      <circle cx="16" cy="16" r="15.4" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.6" />
    </svg>
  );
}

function DevBlueprintArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const paperId = `${idPrefix}-stage-bp-paper`;
  const glowId = `${idPrefix}-stage-bp-glow`;
  const celesteGlowId = `${idPrefix}-stage-bp-glow-celeste`;
  const violetGlowId = `${idPrefix}-stage-bp-glow-violet`;
  const minorGridId = `${idPrefix}-stage-bp-grid-minor`;
  const majorGridId = `${idPrefix}-stage-bp-grid-major`;
  const rulerId = `${idPrefix}-stage-bp-ruler`;
  const glowsId = `${idPrefix}-stage-bp-glows`;
  const annotationsId = `${idPrefix}-stage-bp-annotations`;

  return (
    <svg
      className="stage-blueprint h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "64 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={paperId}
          x1="60"
          y1="0"
          x2="220"
          y2="96"
          gradientUnits="userSpaceOnUse"
          spreadMethod="reflect"
        >
          <stop style={{ stopColor: "var(--stage-bp-bottom)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stage-bp-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--stage-bp-top)" }} />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(216 14) rotate(137) scale(120 84)"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#D4F6FF" stopOpacity="0.4" />
          <stop offset="0.52" stopColor="#65C8FF" stopOpacity="0.16" />
          <stop offset="1" stopColor="#276AF1" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={celesteGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(474 44) rotate(166) scale(156 92)"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#D2FFFF" stopOpacity="0.34" />
          <stop offset="0.5" stopColor="#48DCF5" stopOpacity="0.18" />
          <stop offset="1" stopColor="#277EF1" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={violetGlowId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(704 18) rotate(145) scale(132 88)"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#D9D8FF" stopOpacity="0.3" />
          <stop offset="0.52" stopColor="#7C8BFF" stopOpacity="0.14" />
          <stop offset="1" stopColor="#3155DF" stopOpacity="0" />
        </radialGradient>
        <pattern id={minorGridId} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M8 0H0V8" stroke="#EAF6FF" strokeOpacity="0.14" strokeWidth="0.5" />
        </pattern>
        <pattern id={majorGridId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" stroke="#EAF6FF" strokeOpacity="0.26" strokeWidth="0.6" />
        </pattern>
        <pattern id={rulerId} width="32" height="6" patternUnits="userSpaceOnUse">
          <path
            d="M4 0V2.5M12 0V2.5M20 0V4M28 0V2.5"
            stroke="#DDF7FF"
            strokeOpacity="0.5"
            strokeWidth="0.5"
          />
        </pattern>
        <pattern id={glowsId} width="768" height="96" patternUnits="userSpaceOnUse">
          <rect width="768" height="96" fill={`url(#${glowId})`} />
          <rect width="768" height="96" fill={`url(#${celesteGlowId})`} />
          <rect width="768" height="96" fill={`url(#${violetGlowId})`} />
        </pattern>
        <pattern id={annotationsId} width="768" height="96" patternUnits="userSpaceOnUse">
          <g stroke="#DDF7FF" strokeLinecap="round" strokeOpacity="0.6" strokeWidth="0.7">
            <path d="M180 64H264" strokeDasharray="5 4" />
            <path d="M180 61V67M264 61V67" />
            <path d="M276 10V44" strokeDasharray="4 4" strokeOpacity="0.5" />
            <path d="M273 10H279M273 44H279" strokeOpacity="0.5" />
            <path d="M348 30H428" strokeDasharray="3.5 5" strokeOpacity="0.5" />
            <path d="M348 27V33M428 27V33" strokeOpacity="0.5" />
            <path d="M512 48V80" strokeDasharray="5 3" strokeOpacity="0.45" />
            <path d="M509 48H515M509 80H515" strokeOpacity="0.45" />
            <path d="M590 70H724" strokeDasharray="7 4" strokeOpacity="0.55" />
            <path d="M590 67V73M724 67V73" strokeOpacity="0.55" />
          </g>

          <g stroke="#DDF7FF" strokeLinecap="round" strokeOpacity="0.55" strokeWidth="0.6">
            <g>
              <path d="M34 60L38 64M38 60L34 64" />
            </g>
            <g>
              <path d="M228 26H234M231 23V29" />
            </g>
            <g>
              <path d="M143 51H149M146 48V54" />
            </g>
            <g>
              <path d="M316 16L322 22M322 16L316 22" />
            </g>
            <g>
              <path d="M468 70H476M472 66V74" />
            </g>
            <g>
              <path d="M558 28L564 34M564 28L558 34" />
            </g>
            <g>
              <path d="M742 44H750M746 40V48" />
            </g>
          </g>

          <g stroke="#DDF7FF" strokeOpacity="0.35" strokeWidth="0.6">
            <circle cx="196" cy="38" r="13" strokeDasharray="3.5 4" />
            <path d="M196 33V43M191 38H201" strokeOpacity="0.6" strokeWidth="0.4" />
            <circle cx="414" cy="64" r="10" strokeDasharray="2.5 3.5" />
            <path d="M414 60V68M410 64H418" strokeOpacity="0.6" strokeWidth="0.4" />
            <circle cx="648" cy="32" r="15" strokeDasharray="4 5" />
            <path d="M648 26V38M642 32H654" strokeOpacity="0.6" strokeWidth="0.4" />
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${paperId})`} />
      <rect width="100%" height="96" fill={`url(#${glowsId})`} />
      <rect width="100%" height="96" fill={`url(#${minorGridId})`} />
      <rect width="100%" height="96" fill={`url(#${majorGridId})`} />
      <rect width="100%" height="6" fill={`url(#${rulerId})`} />
      <rect width="100%" height="96" fill={`url(#${annotationsId})`} />
    </svg>
  );
}
