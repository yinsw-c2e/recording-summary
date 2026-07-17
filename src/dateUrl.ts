const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDayKey(value: string | null | undefined): value is string {
  if (!value || !dayKeyPattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function dayParamFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("day");
  return isValidDayKey(value) ? value : "";
}

export function rawDayParamFromSearch(search: string): string {
  return new URLSearchParams(search).get("day") ?? "";
}

export function normalizeDayParam(value: string, today: string): string {
  return isValidDayKey(value) && value <= today ? value : today;
}

export function searchWithDayParam(search: string, day: string, today: string): string {
  const params = new URLSearchParams(search);
  if (day && day !== today) {
    params.set("day", day);
  } else {
    params.delete("day");
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}
