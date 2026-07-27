import { ProviderDriverKind, type ThreadAgentSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import AgentsLiveStrip from "./AgentsLiveStrip";

const TIMESTAMP = "2026-07-27T10:00:00.000Z";

const LIVE_AGENT = {
  kind: "subagent",
  agentId: "agent-1",
  name: "Test agent",
  provider: ProviderDriverKind.make("codex"),
  status: "running",
  firstStartedAt: TIMESTAMP,
  lastActivityAt: TIMESTAMP,
  activationCount: 1,
  recentActivity: [],
  updatedAt: TIMESTAMP,
} as ThreadAgentSnapshot;

describe("AgentsLiveStrip", () => {
  it("stays centered just beyond the composer width and uses the pink-purple agent accent", () => {
    const markup = renderToStaticMarkup(
      <AgentsLiveStrip agents={[LIVE_AGENT]} onOpen={() => undefined} />,
    );

    expect(markup).toContain("mx-auto");
    expect(markup).toContain("max-w-[52rem]");
    expect(markup).toContain("text-astro-highlight/80");
    expect(markup).toContain("group-hover/agents-live:text-astro-highlight");
  });
});
