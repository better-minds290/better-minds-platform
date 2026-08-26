/** All user-facing dates/times on Better Minds are Vietnam time. */
import {
  VN_TIMEZONE,
  getVietnamDateParts,
  vietnamTodayStr,
} from "../../supabase/functions/_shared/vietnamTime.ts";

export {
  VN_TIMEZONE,
  getVietnamDateParts,
  toVietnamDateStr,
  vietnamTodayStr,
  getVietnamDayOfWeek,
  isLearnerBookingWindowOpen,
  vietnamMostRecentSundayYmd,
  hasSundayBookingWindowPassed,
  teachingWeekRangeAfterSunday,
  addCalendarDays,
} from "../../supabase/functions/_shared/vietnamTime.ts";
export type { VietnamDateParts } from "../../supabase/functions/_shared/vietnamTime.ts";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const VN_WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

function parseToDate(input: string | Date): Date {
  if (input instanceof Date) return input;
  const trimmed = String(input).trim();
  if (DATE_ONLY_RE.test(trimmed)) {
    return new Date(`${trimmed}T12:00:00+07:00`);
  }
  return new Date(trimmed);
}

export function formatVietnamDate(
  input: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
  locale = "en-US"
): string {
  if (!input) return "";
  const date = parseToDate(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { timeZone: VN_TIMEZONE, ...options });
}

export function formatVietnamTime(
  input: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
  locale = "vi-VN"
): string {
  if (!input) return "";
  const date = parseToDate(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { timeZone: VN_TIMEZONE, ...options });
}

/** Map i18n language code to Intl locale for Vietnam-time display. */
export function getUiDateLocale(language?: string): string {
  return language?.startsWith("vi") ? "vi-VN" : "en-US";
}

export function formatVietnamDateTime(
  input: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  locale = "vi-VN"
): string {
  if (!input) return "";
  const date = parseToDate(input);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { timeZone: VN_TIMEZONE, ...options });
}

export function calendarDiffDays(fromYmd: string, toYmd: string): number {
  const from = parseToDate(fromYmd).getTime();
  const to = parseToDate(toYmd).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/** Local midnight of a calendar YYYY-MM-DD, for week-grid arithmetic. */
export function calendarDateToLocalDate(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00`);
}

export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function vietnamMondayLocalDate(now: Date = new Date()): Date {
  return getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr(now)));
}

/** Monday–Sunday YMD range for the calendar week containing today (VN timezone). */
export function getCurrentWeekRangeYmd(now: Date = new Date()): { start: string; end: string } {
  const todayStr = vietnamTodayStr(now);
  const weekStart = getMondayOfWeek(calendarDateToLocalDate(todayStr));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return { start: toLocalDateStr(weekStart), end: toLocalDateStr(weekEnd) };
}

/** `20/07 (T2)` — Vietnamese short calendar date. */
export function formatVietnamDateShortVi(dateStr: string): string {
  const parts = getVietnamDateParts(dateStr);
  if (!parts) return "";
  const day = String(parts.day).padStart(2, "0");
  const month = String(parts.month).padStart(2, "0");
  return `${day}/${month} (${VN_WEEKDAYS_SHORT[parts.weekday]})`;
}

/** English `Mon, Aug 18` for YYYY-MM-DD slot dates. */
export function formatVietnamSlotDate(dateStr: string): string {
  return formatVietnamDate(dateStr, { weekday: "short", month: "short", day: "numeric" }, "en-US");
}
