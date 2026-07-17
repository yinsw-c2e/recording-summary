import { describe, expect, it } from "vitest";
import { countRecordingFilters, matchesRecordingFilter } from "../src/recordingFilters";

describe("recording status filters", () => {
  it("groups unfinished recordings as open", () => {
    const openStatuses = ["uploaded", "transcription_queued", "transcribing", "transcript_pending", "transcribed", "organizing"];

    expect(openStatuses.map((status) => matchesRecordingFilter({ status }, "open"))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true
    ]);
    expect(matchesRecordingFilter({ status: "organized" }, "open")).toBe(false);
    expect(matchesRecordingFilter({ status: "failed" }, "open")).toBe(false);
  });

  it("separates review-needed recordings from normal completed recordings", () => {
    expect(matchesRecordingFilter({ status: "no_content" }, "needs_review")).toBe(true);
    expect(matchesRecordingFilter({ status: "transcript_suspect" }, "needs_review")).toBe(true);
    expect(matchesRecordingFilter({ status: "failed" }, "needs_review")).toBe(true);
    expect(matchesRecordingFilter({ status: "organized" }, "needs_review")).toBe(false);
    expect(matchesRecordingFilter({ status: "organized" }, "organized")).toBe(true);
  });

  it("counts all filter tabs consistently", () => {
    const recordings = [
      { status: "transcription_queued" },
      { status: "transcribing" },
      { status: "organizing" },
      { status: "transcript_suspect" },
      { status: "failed" },
      { status: "organized" }
    ];

    expect(countRecordingFilters(recordings)).toEqual({
      all: 6,
      open: 3,
      needs_review: 2,
      organized: 1
    });
  });
});
