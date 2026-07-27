import type { EnvironmentId } from "@t3tools/contracts";
import { Globe, RadioTower } from "lucide-react";

import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "~/components/ui/empty";

import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import { useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

interface Props {
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  recentlySeenUrls?: ReadonlyArray<string> | undefined;
  onOpenUrl: (url: string) => void;
}

export function PreviewEmptyState({
  environmentId,
  configuredUrls,
  recentlySeenUrls,
  onOpenUrl,
}: Props) {
  const servers = useDiscoveredLocalServers({
    environmentId,
    configuredUrls,
    recentlySeenUrls,
  });

  if (servers.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon" className="border border-primary/15 bg-primary/8 text-primary">
          <Globe className="size-4.5" />
        </EmptyMedia>
        <EmptyTitle>No preview yet</EmptyTitle>
        <EmptyDescription>
          Type a URL above, or run a dev script. Listening localhost ports will show up here
          automatically.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-5 py-8">
      <div className="m-auto flex w-full max-w-xl flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/8 text-primary ring-1 ring-primary/15">
            <RadioTower className="size-3.5 shrink-0" />
          </span>
          <h2 className="font-medium">Local servers</h2>
        </div>
        <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-primary/10 bg-background">
          {servers.map((server) => (
            <PreviewLocalServerCard
              key={`${server.host}:${server.port}`}
              server={server}
              onOpen={() => onOpenUrl(server.url)}
            />
          ))}
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Select a listening port to open it in this browser tab.
        </p>
      </div>
    </div>
  );
}
