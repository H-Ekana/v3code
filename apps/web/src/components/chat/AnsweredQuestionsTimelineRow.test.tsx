import { ApprovalRequestId } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AnsweredQuestionsTimelineRow } from "./MessagesTimeline";
import type { AnsweredUserInput, AnsweredUserInputQuestion } from "../../session-logic";

const LIBRARY_OPTIONS = [
  { label: "date-fns", description: "Small and tree-shakeable" },
  { label: "Luxon", description: "Rich timezone support" },
  { label: "Day.js", description: "Tiny moment-compatible API" },
];

function makeQuestion(
  overrides: Partial<AnsweredUserInputQuestion> = {},
): AnsweredUserInputQuestion {
  return {
    question: {
      id: "Which library should we use?",
      header: "Library",
      question: "Which library should we use?",
      options: LIBRARY_OPTIONS,
      multiSelect: false,
    },
    selectedLabels: ["Luxon"],
    customAnswers: [],
    ...overrides,
  };
}

function render(overrides: Partial<AnsweredUserInput> = {}) {
  const answeredUserInput: AnsweredUserInput = {
    requestId: ApprovalRequestId.make("req-1"),
    createdAt: "2026-02-23T00:00:05.000Z",
    status: "answered",
    questions: [makeQuestion()],
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(AnsweredQuestionsTimelineRow, {
      row: {
        kind: "answered-question",
        id: "answered-question:req-1",
        createdAt: answeredUserInput.createdAt,
        answeredUserInput,
      },
    }),
  );
}

describe("AnsweredQuestionsTimelineRow", () => {
  it("shows the question and the chosen answer", () => {
    const markup = render();
    expect(markup).toContain("Your answers");
    expect(markup).toContain("Which library should we use?");
    expect(markup).toContain("Luxon");
  });

  it("renders the options that were not chosen behind a collapsed disclosure", () => {
    const markup = render();
    // Present in the DOM (so the disclosure has two states to animate between)
    // but closed and inert at rest.
    expect(markup).toContain("date-fns");
    expect(markup).toContain("Day.js");
    expect(markup).toContain('data-expanded="false"');
  });

  it("joins multi-select answers instead of running the labels together", () => {
    const markup = render({
      questions: [makeQuestion({ selectedLabels: ["date-fns", "Day.js"] })],
    });
    expect(markup).toContain("date-fns, Day.js");
    expect(markup).not.toContain("date-fnsDay.js");
  });

  it("shows a free-text answer alongside the picked labels", () => {
    const markup = render({
      questions: [
        makeQuestion({
          selectedLabels: ["date-fns"],
          customAnswers: ["Temporal, once it ships"],
        }),
      ],
    });
    expect(markup).toContain("date-fns");
    expect(markup).toContain("Temporal, once it ships");
  });

  it("marks a question that was never answered", () => {
    const markup = render({
      questions: [makeQuestion({ selectedLabels: [], customAnswers: [] })],
    });
    expect(markup).toContain("no answer");
  });

  it("names the expired and failed terminals instead of leaving a silent gap", () => {
    expect(
      render({ status: "expired", questions: [makeQuestion({ selectedLabels: [] })] }),
    ).toContain("Questions expired before you answered");
    expect(
      render({ status: "failed", questions: [makeQuestion({ selectedLabels: [] })] }),
    ).toContain("Questions were dropped before you answered");
  });

  it("stays inert when every offered option was taken", () => {
    const markup = render({
      questions: [
        makeQuestion({
          question: {
            id: "Ship it?",
            header: "Ship",
            question: "Ship it?",
            options: [{ label: "Yes", description: "Ship now" }],
            multiSelect: false,
          },
          selectedLabels: ["Yes"],
        }),
      ],
    });
    expect(markup).not.toContain("conversation-disclosure");
    expect(markup).not.toContain('role="button"');
  });
});
