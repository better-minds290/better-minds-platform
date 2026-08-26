import { addCalendarDays, getVietnamDateParts, vietnamTodayStr } from "./datetime";

/** Canonical `learner_attendance.type` for missed Saturday/Sunday sprint unlock. Matches the DB CHECK. */
export const ATTENDANCE_TYPE_LATE_SPRINT = "late_sprint" as const;
export const ATTENDANCE_TYPE_ABSENT_SESSION = "absent_session" as const;

export const DB_SUPPORTED_ATTENDANCE_TYPES = [
  ATTENDANCE_TYPE_LATE_SPRINT,
  ATTENDANCE_TYPE_ABSENT_SESSION,
] as const;

export type AttendanceRecordType = (typeof DB_SUPPORTED_ATTENDANCE_TYPES)[number];

const WAITING_NEXT_SPRINT_STATUSES = new Set(["pending", "locked"]);
const ALREADY_UNLOCKED_STATUSES = new Set(["active", "completed", "expired"]);

export type LateSprintSkipReason =
  | "no_completed_sprint"
  | "missing_completed_at"
  | "no_next_sprint"
  | "already_active_or_completed"
  | "not_waiting"
  | "before_unlock_weekend"
  | "unlock_weekend"
  | "already_recorded";

export interface LateSprintEvalInput {
  lastCompleted: { sprint_number: number; completed_at: string | Date | null } | null;
  nextSprint: { id: string; sprint_number: number; status: string } | null;
  /**
   * True only when an UNRESOLVED `late_sprint` row already exists for this learner + next sprint.
   * A resolved historical row must not be passed as true.
   */
  existingUnresolvedLate: boolean;
  now?: Date;
}

export interface LateSprintEvalResult {
  record: boolean;
  skipped: LateSprintSkipReason | null;
  expectedSaturday: string | null;
  lateFromYmd: string | null;
  type: typeof ATTENDANCE_TYPE_LATE_SPRINT;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function vnYmdFromParts(input: string | Date): string | null {
  const parts = getVietnamDateParts(input);
  if (!parts) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * First Saturday on or after `completedAt` in Asia/Ho_Chi_Minh.
 *
 * Sunday completion rolls to the *following* Saturday (that week's Saturday is already past).
 * Saturday completion keeps that same Saturday (unlock is still allowed that weekend).
 */
export function getExpectedSprintUnlockSaturday(completedAt: string | Date): string | null {
  const parts = getVietnamDateParts(completedAt);
  if (!parts) return null;
  const completedYmd = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const daysUntilSaturday = (6 - parts.weekday + 7) % 7;
  return addCalendarDays(completedYmd, daysUntilSaturday);
}

/** Monday after the Sat+Sun unlock weekend — first VN calendar day that is late. */
export function getLateSprintEligibleFromYmd(expectedSaturdayYmd: string): string {
  return addCalendarDays(expectedSaturdayYmd, 2);
}

export function isNextSprintWaitingForUnlock(status: string): boolean {
  return WAITING_NEXT_SPRINT_STATUSES.has(status);
}

export function isLateSprintAttendance(type: string): boolean {
  return type === ATTENDANCE_TYPE_LATE_SPRINT;
}

export function countUnresolvedLateSprint(records: Array<{ type: string; resolved: boolean }>): number {
  return records.filter((r) => isLateSprintAttendance(r.type) && !r.resolved).length;
}

export function shouldShowLateSprintUnlock(record: {
  type: string;
  related_sprint_id: string | null;
  resolved: boolean;
}): boolean {
  return !record.resolved && isLateSprintAttendance(record.type) && !!record.related_sprint_id;
}

/** Admin unlock (or manual resolve) marks the attendance row resolved. */
export function markAttendanceResolved<T extends { resolved: boolean; resolved_at: string | null; resolved_by: string | null }>(
  record: T,
  at: Date = new Date(),
  by = "admin"
): T {
  return {
    ...record,
    resolved: true,
    resolved_at: at.toISOString(),
    resolved_by: by,
  };
}

/**
 * Dedup is unresolved-only: a resolved `late_sprint` for the same sprint does not block a later insert.
 */
export function shouldDedupLateSprint(existing: { type: string; resolved: boolean } | null | undefined): boolean {
  if (!existing) return false;
  return isLateSprintAttendance(existing.type) && !existing.resolved;
}

export function evaluateLateSprintEligibility(input: LateSprintEvalInput): LateSprintEvalResult {
  const now = input.now ?? new Date();
  const base: LateSprintEvalResult = {
    record: false,
    skipped: null,
    expectedSaturday: null,
    lateFromYmd: null,
    type: ATTENDANCE_TYPE_LATE_SPRINT,
  };

  if (!input.lastCompleted) {
    return { ...base, skipped: "no_completed_sprint" };
  }
  if (!input.lastCompleted.completed_at) {
    return { ...base, skipped: "missing_completed_at" };
  }
  if (!input.nextSprint) {
    return { ...base, skipped: "no_next_sprint" };
  }
  if (ALREADY_UNLOCKED_STATUSES.has(input.nextSprint.status)) {
    return { ...base, skipped: "already_active_or_completed" };
  }
  if (!isNextSprintWaitingForUnlock(input.nextSprint.status)) {
    return { ...base, skipped: "not_waiting" };
  }

  const expectedSaturday = getExpectedSprintUnlockSaturday(input.lastCompleted.completed_at);
  if (!expectedSaturday) {
    return { ...base, skipped: "missing_completed_at" };
  }
  const lateFromYmd = getLateSprintEligibleFromYmd(expectedSaturday);
  const todayYmd = vietnamTodayStr(now);
  const expectedSunday = addCalendarDays(expectedSaturday, 1);

  if (todayYmd < lateFromYmd) {
    const skipped: LateSprintSkipReason =
      todayYmd === expectedSaturday || todayYmd === expectedSunday
        ? "unlock_weekend"
        : "before_unlock_weekend";
    return { ...base, skipped, expectedSaturday, lateFromYmd };
  }

  if (input.existingUnresolvedLate) {
    return { ...base, skipped: "already_recorded", expectedSaturday, lateFromYmd };
  }

  return {
    record: true,
    skipped: null,
    expectedSaturday,
    lateFromYmd,
    type: ATTENDANCE_TYPE_LATE_SPRINT,
  };
}

export function vnCalendarDateOf(input: string | Date): string | null {
  return vnYmdFromParts(input);
}
