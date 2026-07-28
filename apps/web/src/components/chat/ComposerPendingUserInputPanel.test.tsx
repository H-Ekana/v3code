import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { type PendingUserInput } from "../../session-logic";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

const prompt: PendingUserInput = {
  requestId: ApprovalRequestId.make("input-1"),
  createdAt: "2026-07-28T00:00:00.000Z",
  questions: [
    {
      id: "scope",
      header: "Scope",
      question: "What should the plan target first?",
      options: [
        { label: "Orchestration", description: "Focus on orchestration first" },
        { label: "Web", description: "Focus on the web app first" },
      ],
      multiSelect: false,
    },
    {
      id: "areas",
      header: "Areas",
      question: "Which areas should this change cover?",
      options: [{ label: "Server", description: "Server" }],
      multiSelect: true,
    },
  ],
};

const render = (options: {
  questionIndex?: number;
  answers?: Record<string, { selectedOptionLabels?: string[]; customAnswer?: string }>;
  responding?: boolean;
}) =>
  renderToStaticMarkup(
    <ComposerPendingUserInputPanel
      pendingUserInputs={[prompt]}
      respondingRequestIds={options.responding ? [prompt.requestId] : []}
      answers={options.answers ?? {}}
      questionIndex={options.questionIndex ?? 0}
      onToggleOption={vi.fn()}
      onAdvance={vi.fn()}
    />,
  );

describe("ComposerPendingUserInputPanel", () => {
  it("marks the question surface for a directional crossfade", () => {
    const markup = render({});
    expect(markup).toContain("composer-question-panel");
    expect(markup).toContain('data-question-direction="forward"');
  });

  it("gives every option a compact press response", () => {
    const markup = render({});
    expect(markup.match(/composer-answer-option/g)?.length).toBe(2);
    expect(markup).toContain("motion-press");
  });

  it("does not replay the check arrival for a restored answer", () => {
    const markup = render({ answers: { scope: { selectedOptionLabels: ["Orchestration"] } } });
    // The check is present because the answer is selected, but it must not
    // carry the one-shot arrival class on a remount of existing state.
    expect(markup).toContain("text-primary");
    expect(markup).not.toContain("composer-answer-check--arriving");
  });

  it("announces the pending submission politely", () => {
    const markup = render({ responding: true });
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Submitting your answer");
  });
});
