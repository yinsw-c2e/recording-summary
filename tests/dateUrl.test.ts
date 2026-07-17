import { describe, expect, it } from "vitest";
import { dayParamFromSearch, isValidDayKey, normalizeDayParam, rawDayParamFromSearch, searchWithDayParam } from "../src/dateUrl";

describe("date URL helpers", () => {
  it("accepts real calendar days only", () => {
    expect(isValidDayKey("2026-07-18")).toBe(true);
    expect(isValidDayKey("2026-02-29")).toBe(false);
    expect(isValidDayKey("2026-7-18")).toBe(false);
    expect(isValidDayKey(null)).toBe(false);
  });

  it("reads valid day params while keeping raw invalid values available for repair", () => {
    expect(dayParamFromSearch("?day=2026-07-18")).toBe("2026-07-18");
    expect(dayParamFromSearch("?day=bad")).toBe("");
    expect(rawDayParamFromSearch("?day=bad")).toBe("bad");
  });

  it("falls back to today for invalid or future selections", () => {
    expect(normalizeDayParam("2026-07-17", "2026-07-18")).toBe("2026-07-17");
    expect(normalizeDayParam("2026-07-19", "2026-07-18")).toBe("2026-07-18");
    expect(normalizeDayParam("not-a-day", "2026-07-18")).toBe("2026-07-18");
  });

  it("writes historical day params and omits today from the canonical URL", () => {
    expect(searchWithDayParam("?tab=cards", "2026-07-17", "2026-07-18")).toBe("?tab=cards&day=2026-07-17");
    expect(searchWithDayParam("?tab=cards&day=2026-07-17", "2026-07-18", "2026-07-18")).toBe("?tab=cards");
    expect(searchWithDayParam("?day=2026-07-16&tab=cards", "2026-07-17", "2026-07-18")).toBe(
      "?day=2026-07-17&tab=cards"
    );
  });
});
