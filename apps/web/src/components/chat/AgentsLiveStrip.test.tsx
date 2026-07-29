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

const BACKGROUND_SHELL = {
  ...LIVE_AGENT,
  kind: "shell",
  agentId: "shell-1",
  name: "Codex background job",
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

  it("keeps a hydrated live roster visually static until live delivery begins", () => {
    const hydratedMarkup = renderToStaticMarkup(
      <AgentsLiveStrip agents={[LIVE_AGENT]} onOpen={() => undefined} initialHydration />,
    );
    expect(hydratedMarkup).toContain('data-agent-live-motion="static"');
    expect(hydratedMarkup).not.toContain("animate-status-pulse");

    const liveMarkup = renderToStaticMarkup(
      <AgentsLiveStrip agents={[LIVE_AGENT]} onOpen={() => undefined} />,
    );
    expect(liveMarkup).toContain('data-agent-live-motion="live"');
    expect(liveMarkup).toContain("animate-status-pulse");
  });

  it("renders when the only live work is a background shell", () => {
    const markup = renderToStaticMarkup(
      <AgentsLiveStrip agents={[BACKGROUND_SHELL]} onOpen={() => undefined} />,
    );

    expect(markup).toContain("1 background task");
  });

  it("shows a background chip alongside live sub-agents", () => {
    const markup = renderToStaticMarkup(
      <AgentsLiveStrip agents={[LIVE_AGENT, BACKGROUND_SHELL]} onOpen={() => undefined} />,
    );

    expect(markup).toContain("1 agent");
    expect(markup).toContain("1 background");
  });

  it("renders nothing when every agent has settled", () => {
    const settled = { ...LIVE_AGENT, status: "completed" } as ThreadAgentSnapshot;
    const markup = renderToStaticMarkup(
      <AgentsLiveStrip agents={[settled]} onOpen={() => undefined} />,
    );

    expect(markup).toBe("");
  });
});
