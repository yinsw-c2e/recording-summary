import { describe, expect, it } from "vitest";
import { selectNextStep, type NextStepInput } from "../src/nextStep";

function input(overrides: Partial<NextStepInput>): NextStepInput {
  return {
    reviewRecordingCount: 0,
    openRecordingCount: 0,
    reviewDueCount: 0,
    openActionCount: 0,
    confirmCount: 0,
    cardCount: 0,
    recordingCount: 0,
    ...overrides
  };
}

describe("selectNextStep", () => {
  it("prioritizes recording problems over other pending work", () => {
    expect(
      selectNextStep(
        input({
          reviewRecordingCount: 1,
          openRecordingCount: 2,
          reviewDueCount: 3,
          openActionCount: 4,
          confirmCount: 5,
          cardCount: 5
        })
      )
    ).toBe("recording_review");
  });

  it("surfaces processing recordings before review and action work", () => {
    expect(selectNextStep(input({ openRecordingCount: 2, reviewDueCount: 1, openActionCount: 1, cardCount: 1 }))).toBe(
      "recording_open"
    );
  });

  it("surfaces review due cards before action items", () => {
    expect(selectNextStep(input({ reviewDueCount: 2, openActionCount: 1, cardCount: 2 }))).toBe("review_due");
  });

  it("surfaces confirmation work before normal review and action work", () => {
    expect(selectNextStep(input({ confirmCount: 1, reviewDueCount: 2, openActionCount: 1, cardCount: 2 }))).toBe("confirm");
  });

  it("falls back to action items, ready state, then empty state", () => {
    expect(selectNextStep(input({ openActionCount: 1, cardCount: 1 }))).toBe("action");
    expect(selectNextStep(input({ cardCount: 1 }))).toBe("ready");
    expect(selectNextStep(input({ recordingCount: 1 }))).toBe("empty");
  });
});
