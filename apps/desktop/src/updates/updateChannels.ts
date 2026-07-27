import type { DesktopUpdateChannel } from "@t3tools/contracts";

const V3_FORK_VERSION_PATTERN = /\.v3\.\d+\.\d+\.\d+$/;
const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+(?:\.v3\.\d+\.\d+\.\d+)?$/;

export function isV3ForkDesktopVersion(version: string): boolean {
  return V3_FORK_VERSION_PATTERN.test(version);
}

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}
