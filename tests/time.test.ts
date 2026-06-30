import { describe, expect, it } from "vitest";
import { dayKey, monthKey, weekKey } from "../server/time";

describe("period keys", () => {
  it("uses Asia/Shanghai calendar days", () => {
    const date = new Date("2026-06-29T16:30:00.000Z");
    expect(dayKey(date, "Asia/Shanghai")).toBe("2026-06-30");
    expect(monthKey(date, "Asia/Shanghai")).toBe("2026-06");
  });

  it("uses Monday-based ISO week keys", () => {
    expect(weekKey(new Date("2026-06-30T04:00:00.000Z"), "Asia/Shanghai")).toBe("2026-W27");
  });
});
