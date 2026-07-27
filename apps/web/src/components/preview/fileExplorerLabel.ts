export function revealInFileExplorerLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac") || normalized.includes("darwin")) return "Open in Finder";
  if (normalized.includes("win")) return "Open in File Explorer";
  return "Open in File Manager";
}
