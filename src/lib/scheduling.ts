/**
 * Better Minds live-class scheduling policy (Vietnam weekdays, 0=Sun … 6=Sat).
 *
 * Session 2: Monday–Wednesday (1–3)
 * Session 3: Thursday–Saturday (4–6)
 * Sunday: no live classes
 *
 * Learner book/reschedule/cancel window lives in datetime.ts
 * (Sunday only). Sprint unlock is intentionally separate.
 */

/** Weekday of a YYYY-MM-DD slot date in Vietnam (UTC+7). Noon avoids UTC midnight shifting the day. */
export function weekdayFromSlotDate(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}

/** Live class dates are Monday–Saturday. Sunday is never a teaching day. */
export function isTeachingClassDate(dateStr: string): boolean {
  const dow = weekdayFromSlotDate(dateStr);
  return dow >= 1 && dow <= 6;
}

/**
 * Session 2 = Mon–Wed (1–3). Session 3 = Thu–Sat (4–6).
 * Other session numbers may use any teaching day (Mon–Sat). Sunday is always blocked.
 */
export function isSlotAllowedForSession(sessionNumber: number, dateStr: string): boolean {
  if (!isTeachingClassDate(dateStr)) return false;
  if (sessionNumber !== 2 && sessionNumber !== 3) return true;
  const dow = weekdayFromSlotDate(dateStr);
  if (sessionNumber === 2) return dow >= 1 && dow <= 3;
  return dow >= 4 && dow <= 6;
}

/**
 * Auto-scheduler day filter when session number is known.
 * Never allows Sunday (0). Session 2 Mon–Wed; Session 3 Thu–Sat.
 */
export function isSchedulerDayAllowed(sessionNumber: number, dayOfWeek: number): boolean {
  if (dayOfWeek === 0) return false;
  if (sessionNumber === 2) return dayOfWeek >= 1 && dayOfWeek <= 3;
  if (sessionNumber === 3) return dayOfWeek >= 4 && dayOfWeek <= 6;
  return dayOfWeek >= 1 && dayOfWeek <= 6;
}

export function sessionDayRestrictedError(sessionNumber: number): string {
  if (sessionNumber === 2) return "Session 2 can only be booked on Monday–Wednesday.";
  if (sessionNumber === 3) return "Session 3 can only be booked on Thursday–Saturday.";
  return "This session cannot be booked on the selected day.";
}

export const SUNDAY_CLASS_NOT_ALLOWED = "Live classes cannot be scheduled on Sunday.";
