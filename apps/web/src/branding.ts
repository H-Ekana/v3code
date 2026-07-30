import type { DesktopAppBranding } from "@t3tools/contracts";
import { formatAppDisplayName } from "./branding.logic";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const hostedAppChannel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();

export const HOSTED_APP_CHANNEL =
  hostedAppChannel === "latest" || hostedAppChannel === "nightly" ? hostedAppChannel : null;
export const HOSTED_APP_CHANNEL_LABEL =
  HOSTED_APP_CHANNEL === "nightly" ? "Nightly" : HOSTED_APP_CHANNEL === "latest" ? "Latest" : null;
export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "V3 Code";
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ??
  HOSTED_APP_CHANNEL_LABEL ??
  (import.meta.env.DEV ? "Dev" : "Alpha");
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ??
  formatAppDisplayName({ baseName: APP_BASE_NAME, stageLabel: APP_STAGE_LABEL });
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";

// The desktop fork ships versions shaped `<upstream nightly>.v3.X.Y.Z` (see
// docs/project/new-installer-instructions.md). Split the two so Settings can
// always show the upstream nightly base and the fork's own version.
export function splitV3ForkVersion(version: string): {
  readonly base: string;
  readonly fork: string | null;
} {
  const match = /^(.*)\.(v3\.\d+\.\d+\.\d+)$/.exec(version);
  const base = match?.[1];
  const fork = match?.[2];
  return base !== undefined && fork !== undefined ? { base, fork } : { base: version, fork: null };
}

export const APP_UPSTREAM_VERSION = splitV3ForkVersion(APP_VERSION).base;
export const APP_V3_FORK_VERSION = splitV3ForkVersion(APP_VERSION).fork;
