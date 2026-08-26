/**
 * Vietnam calendar helpers shared by Admin Learners Late and Edge scanners.
 * Deno cannot import src/lib, so this is the canonical Sunday-window source.
 */
export const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Sunday: 0,
  Mon: 1,
  Monday: 1,
  Tue: 2,
  Tuesday: 2,
  Wed: 3,
  Wednesday: 3,
  Thu: 4,
  Thursday: 4,
  Fri: 5,
  Friday: 5,
  Sat: 6,
  Saturday: 6,
};

function parseToDate(input: string | Date): Date {
  if (input instanceof Date) return input;
  const trimmed = String(input).trim();
  if (DATE_ONLY_RE.test(trimmed)) {
    return new Date(`${trimmed}T12:00:00+07:00`);
  }
  return new Date(trimmed);
}

export interface VietnamDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function getVietnamDateParts(input: string | Date): VietnamDateParts | null {
  const date = parseToDate(input);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VN_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekdayName = get("weekday") || "Sun";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_TO_INDEX[weekdayName] ?? 0,
  };
}

/** YYYY-MM-DD in Asia/Ho_Chi_Minh. */
export function toVietnamDateStr(input: string | Date = new Date()): string {
  const parts = getVietnamDateParts(input);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function vietnamTodayStr(now: Date = new Date()): string {
  return toVietnamDateStr(now);
}

/** 0=Sun … 6=Sat in Asia/Ho_Chi_Minh. */
export function getVietnamDayOfWeek(now: Date = new Date()): number {
  return getVietnamDateParts(now)?.weekday ?? 0;
}

/** Learner book / reschedule / cancel window: Sunday only (VN time). */
export function isLearnerBookingWindowOpen(now: Date = new Date()): boolean {
  return getVietnamDayOfWeek(now) === 0;
}

export function addCalendarDays(yyyyMmDd: string, days: number): string {
  const date = parseToDate(yyyyMmDd);
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  return toVietnamDateStr(date);
}

/**
 * YYYY-MM-DD of the most recent Sunday in Vietnam.
 * If `now` is Sunday, that is today — the current booking window, which has not ended.
 */
export function vietnamMostRecentSundayYmd(now: Date = new Date()): string {
  const today = vietnamTodayStr(now);
  const dow = getVietnamDayOfWeek(now);
  return addCalendarDays(today, -dow);
}

/**
 * True Mon–Sat VN: the Sunday booking window for the current teaching week has ended.
 * False on Sunday: learners can still book, so do not mark Late.
 */
export function hasSundayBookingWindowPassed(now: Date = new Date()): boolean {
  return getVietnamDayOfWeek(now) !== 0;
}

/** Teaching week (Mon–Sat) that follows a booking Sunday. */
export function teachingWeekRangeAfterSunday(sundayYmd: string): { start: string; end: string } {
  return {
    start: addCalendarDays(sundayYmd, 1),
    end: addCalendarDays(sundayYmd, 6),
  };
}
