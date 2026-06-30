import { config } from "./config";
import type { Period } from "./types";

function zonedParts(date: Date, timeZone = config.timeZone): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

export function dayKey(date = new Date(), timeZone = config.timeZone): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function monthKey(date = new Date(), timeZone = config.timeZone): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function localNoonUtc(day: string): Date {
  return new Date(`${day}T04:00:00.000Z`);
}

function isoWeek(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
}

export function weekKey(date = new Date(), timeZone = config.timeZone): string {
  const day = dayKey(date, timeZone);
  const week = isoWeek(localNoonUtc(day));
  return `${week.year}-W${String(week.week).padStart(2, "0")}`;
}

export function periodKey(period: Period, date = new Date(), timeZone = config.timeZone): string {
  if (period === "day") return dayKey(date, timeZone);
  if (period === "week") return weekKey(date, timeZone);
  return monthKey(date, timeZone);
}

export function periodWhere(period: Period, key: string): { sql: string; params: string[] } {
  if (period === "day") {
    return { sql: "substr(r.created_at, 1, 10) = ?", params: [key] };
  }
  if (period === "month") {
    return { sql: "substr(r.created_at, 1, 7) = ?", params: [key] };
  }
  return { sql: "week_key = ?", params: [key] };
}
