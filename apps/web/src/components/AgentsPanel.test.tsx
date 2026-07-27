import { ProviderDriverKind, type ThreadAgentSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import AgentsPanel from "./AgentsPanel";

const TIMESTAMP = "2026-07-27T10:00:00.000Z";

function agent(
  overrides: Partial<ThreadAgentSnapshot> & Pick<ThreadAgentSnapshot, "agentId" | "provider">,
): ThreadAgentSnapshot {
  return {
    kind: "subagent",
    name: "Test agent",
    status: "running",
    firstStartedAt: TIMESTAMP,
    lastActivityAt: TIMESTAMP,
    activationCount: 1,
    recentActivity: [],
    updatedAt: TIMESTAMP,
    ...overrides,
  } as ThreadAgentSnapshot;
}

function renderAgent(snapshot: ThreadAgentSnapshot): string {
  return renderToStaticMarkup(<AgentsPanel agents={[snapshot]} mode="embedded" />);
}

describe("AgentsPanel provider identity", () => {
  it("renders the Claude provider icon", () => {
    const markup = renderAgent(
      agent({
        agentId: "claude-agent",
        provider: ProviderDriverKind.make("claudeAgent"),
      }),
    );

    expect(markup).toContain('data-agent-provider="claudeAgent"');
    expect(markup).toContain('aria-label="Claude"');
    expect(markup).toContain('viewBox="0 0 256 257"');
    expect(markup).toContain("fill-[#d97757]");
  });

  it("renders the OpenAI icon for a Codex provider", () => {
    const markup = renderAgent(
      agent({
        agentId: "codex-agent",
        provider: ProviderDriverKind.make("codex"),
      }),
    );

    expect(markup).toContain('data-agent-provider="codex"');
    expect(markup).toContain('aria-label="Codex"');
    expect(markup).toContain('viewBox="0 0 256 260"');
    expect(markup).toContain("fill-black dark:fill-white");
  });

  it("uses the delegated Codex provider as primary and retains the Claude host mark", () => {
    const markup = renderAgent(
      agent({
        agentId: "delegated-agent",
        provider: ProviderDriverKind.make("claudeAgent"),
        delegateProvider: ProviderDriverKind.make("codex"),
      }),
    );

    expect(markup).toContain('data-agent-provider="codex"');
    expect(markup).toContain('data-host-provider="claudeAgent"');
    expect(markup).toContain('data-host-provider-mark="claudeAgent"');
    expect(markup).toContain('aria-label="Codex, run by Claude"');
    expect(markup).toContain('viewBox="0 0 256 260"');
    expect(markup).toContain('viewBox="0 0 256 257"');
  });

  it("falls back to provider initials for an unknown provider slug", () => {
    const markup = renderAgent(
      agent({
        agentId: "unknown-agent",
        provider: ProviderDriverKind.make("mystery-provider"),
      }),
    );

    expect(markup).toContain('data-agent-provider="mystery-provider"');
    expect(markup).toContain(">MP</span>");
  });

  it("preserves the accessible status label beside the provider icon", () => {
    const markup = renderAgent(
      agent({
        agentId: "waiting-agent",
        provider: ProviderDriverKind.make("claudeAgent"),
        status: "waiting",
      }),
    );

    expect(markup).toContain('class="sr-only">Waiting</span>');
  });
});

describe("AgentsPanel sections", () => {
  it("keeps completed sub-agents behind a collapsed Finished toggle", () => {
    const markup = renderAgent(
      agent({
        agentId: "completed-agent",
        provider: ProviderDriverKind.make("codex"),
        name: "Completed agent",
        status: "completed",
      }),
    );
    const finishedToggle = markup.match(
      /<button[^>]*aria-label="Finished sub-agents · 1"[^>]*>.*?<\/button>/,
    )?.[0];

    expect(finishedToggle).toBeDefined();
    expect(finishedToggle).toContain('aria-expanded="false"');
    expect(finishedToggle).toContain("Finished");
    expect(finishedToggle).toContain("· 1");
    expect(markup).not.toContain("Completed agent");
  });

  it("shows running sub-agents while completed siblings stay collapsed", () => {
    const running = agent({
      agentId: "running-agent",
      provider: ProviderDriverKind.make("codex"),
      name: "Running sibling",
    });
    const completed = agent({
      agentId: "completed-agent",
      provider: ProviderDriverKind.make("codex"),
      name: "Completed sibling",
      status: "completed",
    });
    const markup = renderToStaticMarkup(
      <AgentsPanel agents={[completed, running]} mode="embedded" />,
    );

    expect(markup).toContain("Running sibling");
    expect(markup).not.toContain("Completed sibling");
    expect(markup).toContain('aria-label="Finished sub-agents · 1"');
  });

  it("omits the Finished toggle when no sub-agents are settled", () => {
    const markup = renderAgent(
      agent({
        agentId: "running-agent",
        provider: ProviderDriverKind.make("codex"),
        name: "Running agent",
      }),
    );

    expect(markup).toContain("Running agent");
    expect(markup).not.toContain('aria-label="Finished sub-agents"');
  });

  it("keeps background tasks collapsed and countable", () => {
    const markup = renderAgent(
      agent({
        agentId: "shell-1",
        provider: ProviderDriverKind.make("claudeAgent"),
        kind: "shell",
        name: "Background shell",
      }),
    );

    expect(markup).toContain('aria-label="Background tasks"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Background tasks");
    expect(markup).toContain("· 1");
    expect(markup).not.toContain("Background shell");
  });

  it("shows parented shell counts on the sub-agent instead of a top-level shell card", () => {
    const parent = agent({
      agentId: "parent-agent",
      provider: ProviderDriverKind.make("codex"),
      name: "Parent agent",
    });
    const shell = agent({
      agentId: "shell-1",
      provider: ProviderDriverKind.make("codex"),
      kind: "shell",
      parentAgentId: "parent-agent",
      name: "Nested shell",
    });
    const markup = renderToStaticMarkup(<AgentsPanel agents={[parent, shell]} mode="embedded" />);

    expect(markup).toContain('aria-label="Sub-agents"');
    expect(markup).toContain("· 1 shell");
    expect(markup).not.toContain("Nested shell");
  });
});

describe("AgentCard work kind", () => {
  it("labels a live card with the companion job phase alongside its activity", () => {
    const markup = renderAgent(
      agent({
        agentId: "rescue-1",
        provider: ProviderDriverKind.make("claudeAgent"),
        delegateProvider: ProviderDriverKind.make("codex"),
        name: "Trace card title churn",
        status: "running",
        phaseTitle: "verifying",
        currentActivity: "Running focused reducer tests",
      }),
    );

    expect(markup).toContain("verifying");
    expect(markup).toContain("Running focused reducer tests");
  });

  it("renders the phase alone when a live card has no activity line yet", () => {
    const markup = renderAgent(
      agent({
        agentId: "rescue-2",
        provider: ProviderDriverKind.make("claudeAgent"),
        name: "Freshly launched rescue",
        status: "running",
        phaseTitle: "investigating",
      }),
    );

    expect(markup).toContain("investigating");
  });

  // The settled case (a completed card must drop its last phase) is deliberately
  // uncovered: settled sub-agents render inside the collapsed `Finished` group,
  // which `renderToStaticMarkup` never expands, so the card emits no markup at
  // all. An assertion here would pass against an empty string rather than
  // against the behavior.

  it("does not repeat the phase on a workflow child that already sits under a phase header", () => {
    const markup = renderAgent(
      agent({
        agentId: "wf-child",
        provider: ProviderDriverKind.make("claudeAgent"),
        kind: "workflow_agent",
        name: "Reviewer",
        status: "running",
        phaseIndex: 0,
        phaseTitle: "Inspect",
        currentActivity: "Reading the diff",
      }),
    );

    expect(markup).toContain("Reading the diff");
    expect(markup).not.toContain("Inspect");
  });
});
