import { hasSundayBookingWindowPassed } from "./datetime";
import { deriveSessionBookingBadge, type LiveSessionRow, type SprintRow } from "./adminLearnerBooking";
import { shouldShowAttendanceForceComplete } from "./forceCompleteSprint";
import {
  ATTENDANCE_TYPE_ABSENT_SESSION,
  ATTENDANCE_TYPE_LATE_SPRINT,
  DB_SUPPORTED_ATTENDANCE_TYPES,
  countUnresolvedLateSprint,
  evaluateLateSprintEligibility,
  getExpectedSprintUnlockSaturday,
  getLateSprintEligibleFromYmd,
  isLateSprintAttendance,
  markAttendanceResolved,
  shouldDedupLateSprint,
  shouldShowLateSprintUnlock,
} from "./sprintUnlockLate";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

const TRANG_COMPLETED_AT = "2026-08-23T13:01:44.000Z"; // Sun Aug 23 20:01 VN
const TUE_AUG_25 = "2026-08-25T10:00:00+07:00";
const FRI_AUG_21 = "2026-08-21T15:00:00+07:00";

const WED_AUG_26 = new Date("2026-08-26T12:00:00+07:00");
const SAT_AUG_22 = new Date("2026-08-22T12:00:00+07:00");
const SUN_AUG_23 = new Date("2026-08-23T20:01:00+07:00");
const SAT_AUG_29 = new Date("2026-08-29T12:00:00+07:00");
const SUN_AUG_30 = new Date("2026-08-30T12:00:00+07:00");
const MON_AUG_24 = new Date("2026-08-24T09:00:00+07:00");
const MON_AUG_31 = new Date("2026-08-31T09:00:00+07:00");

const lastCompleted = (completedAt: string) => ({ sprint_number: 1, completed_at: completedAt });
const nextLocked = { id: "sp-2", sprint_number: 2, status: "locked" };
const nextPending = { id: "sp-2", sprint_number: 2, status: "pending" };

function evalAt(
  completedAt: string,
  now: Date,
  extra: Partial<Parameters<typeof evaluateLateSprintEligibility>[0]> = {}
) {
  return evaluateLateSprintEligibility({
    lastCompleted: lastCompleted(completedAt),
    nextSprint: nextLocked,
    existingUnresolvedLate: false,
    now,
    ...extra,
  });
}

// 1. DB-supported type is late_sprint
assertEqual(ATTENDANCE_TYPE_LATE_SPRINT, "late_sprint", "1. canonical type is late_sprint");
assert(
  DB_SUPPORTED_ATTENDANCE_TYPES.includes(ATTENDANCE_TYPE_LATE_SPRINT),
  "1. late_sprint is DB-supported"
);
assert(
  !DB_SUPPORTED_ATTENDANCE_TYPES.includes("sprint_unlock_late" as typeof ATTENDANCE_TYPE_LATE_SPRINT),
  "1. sprint_unlock_late is not a DB-supported type"
);
assertEqual(evalAt(TUE_AUG_25, MON_AUG_31).type, "late_sprint", "1. detector records late_sprint");

// 2. UI recognizes late_sprint
{
  const records = [
    { type: ATTENDANCE_TYPE_LATE_SPRINT, resolved: false },
    { type: ATTENDANCE_TYPE_LATE_SPRINT, resolved: true },
    { type: ATTENDANCE_TYPE_ABSENT_SESSION, resolved: false },
  ];
  assertEqual(isLateSprintAttendance("late_sprint"), true, "2. UI type match");
  assertEqual(isLateSprintAttendance("sprint_unlock_late"), false, "2. old insert type is not recognized");
  assertEqual(countUnresolvedLateSprint(records), 1, "2. Trễ Mở Sprint counts unresolved late_sprint");
  assertEqual(
    shouldShowLateSprintUnlock({ type: "late_sprint", related_sprint_id: "sp-2", resolved: false }),
    true,
    "2. unlock action shown for unresolved late_sprint"
  );
}

// 3. Sunday completion → next Saturday, not previous weekend
assertEqual(getExpectedSprintUnlockSaturday(TRANG_COMPLETED_AT), "2026-08-29", "3. Sunday Aug 23 → Sat Aug 29");
assertEqual(getExpectedSprintUnlockSaturday(SUN_AUG_23), "2026-08-29", "3. Sunday Date object → Sat Aug 29");

// 4. Tuesday completion → upcoming Saturday
assertEqual(getExpectedSprintUnlockSaturday(TUE_AUG_25), "2026-08-29", "4. Tue Aug 25 → Sat Aug 29");

// 5. Friday completion → next-day Saturday
assertEqual(getExpectedSprintUnlockSaturday(FRI_AUG_21), "2026-08-22", "5. Fri Aug 21 → Sat Aug 22");
assertEqual(
  getExpectedSprintUnlockSaturday("2026-08-22T10:00:00+07:00"),
  "2026-08-22",
  "5b. Saturday completion keeps that Saturday"
);

// 6. Saturday → not late
{
  const r = evalAt(FRI_AUG_21, SAT_AUG_22);
  assertEqual(r.record, false, "6. Saturday of unlock weekend is not late");
  assertEqual(r.skipped, "unlock_weekend", "6. skip reason is unlock_weekend");
}

// 7. Sunday → not late
{
  const r = evalAt(FRI_AUG_21, SUN_AUG_23);
  assertEqual(r.record, false, "7. Sunday of unlock weekend is not late");
  assertEqual(r.skipped, "unlock_weekend", "7. skip reason is unlock_weekend");
  const r29 = evalAt(TUE_AUG_25, SUN_AUG_30);
  assertEqual(r29.record, false, "7. expected Sunday Aug 30 is not late");
}

// 8. Monday after missed weekend → late
{
  const r = evalAt(FRI_AUG_21, MON_AUG_24);
  assertEqual(r.record, true, "8. Mon Aug 24 after Sat Aug 22 weekend is late");
  assertEqual(r.expectedSaturday, "2026-08-22", "8. expected Saturday");
  assertEqual(r.lateFromYmd, "2026-08-24", "8. late from Monday");
  const r31 = evalAt(TUE_AUG_25, MON_AUG_31);
  assertEqual(r31.record, true, "8. Mon Aug 31 after Sat Aug 29 weekend is late");
}

// 9. Next sprint active → not late
{
  const r = evalAt(TUE_AUG_25, MON_AUG_31, { nextSprint: { ...nextLocked, status: "active" } });
  assertEqual(r.record, false, "9. active next sprint is never late");
  assertEqual(r.skipped, "already_active_or_completed", "9. skip already_active_or_completed");
}

// 10. Next sprint completed → not late
{
  const r = evalAt(TUE_AUG_25, MON_AUG_31, { nextSprint: { ...nextLocked, status: "completed" } });
  assertEqual(r.record, false, "10. completed next sprint is never late");
  assertEqual(r.skipped, "already_active_or_completed", "10. skip already_active_or_completed");
}

// 11. Pending/locked before expected weekend → not late
{
  const lockedWed = evalAt(TUE_AUG_25, WED_AUG_26, { nextSprint: nextLocked });
  assertEqual(lockedWed.record, false, "11. locked before weekend is not late");
  assertEqual(lockedWed.skipped, "before_unlock_weekend", "11. locked skip before_unlock_weekend");
  const pendingWed = evalAt(TUE_AUG_25, WED_AUG_26, { nextSprint: nextPending });
  assertEqual(pendingWed.record, false, "11. pending before weekend is not late");
  const satNotLate = evalAt(TUE_AUG_25, SAT_AUG_29, { nextSprint: nextPending });
  assertEqual(satNotLate.record, false, "11. pending on expected Saturday is not late");
}

// 12. Existing unresolved late_sprint → no duplicate
{
  const r = evalAt(TUE_AUG_25, MON_AUG_31, { existingUnresolvedLate: true });
  assertEqual(r.record, false, "12. unresolved late_sprint blocks duplicate");
  assertEqual(r.skipped, "already_recorded", "12. skip already_recorded");
  assertEqual(
    shouldDedupLateSprint({ type: "late_sprint", resolved: false }),
    true,
    "12. unresolved dedup"
  );
}

// 13. Resolved late_sprint does not permanently block a later legitimate record
{
  assertEqual(
    shouldDedupLateSprint({ type: "late_sprint", resolved: true }),
    false,
    "13. resolved row does not dedup"
  );
  const r = evalAt(TUE_AUG_25, MON_AUG_31, { existingUnresolvedLate: false });
  assertEqual(r.record, true, "13. after resolved-only history, a new late_sprint may be recorded");
}

// 14. Nguyễn Thùy Trang exact timestamp
{
  assertEqual(getExpectedSprintUnlockSaturday(TRANG_COMPLETED_AT), "2026-08-29", "14. Trang expected Sat Aug 29");
  assertEqual(getLateSprintEligibleFromYmd("2026-08-29"), "2026-08-31", "14. Trang late from Mon Aug 31");
  const wed = evalAt(TRANG_COMPLETED_AT, WED_AUG_26);
  assertEqual(wed.record, false, "14. Trang Wed Aug 26 is NOT late_sprint");
  assertEqual(wed.skipped, "before_unlock_weekend", "14. Trang still waiting for Aug 29–30");
  const sat = evalAt(TRANG_COMPLETED_AT, SAT_AUG_29);
  assertEqual(sat.record, false, "14. Trang Sat Aug 29 not late");
  const sun = evalAt(TRANG_COMPLETED_AT, SUN_AUG_30);
  assertEqual(sun.record, false, "14. Trang Sun Aug 30 not late");
  const mon = evalAt(TRANG_COMPLETED_AT, MON_AUG_31);
  assertEqual(mon.record, true, "14. Trang Mon Aug 31 is late if Sprint 2 still locked");
}

// 15. Admin unlock resolves attendance row
{
  const row = {
    type: ATTENDANCE_TYPE_LATE_SPRINT,
    related_sprint_id: "sp-2",
    resolved: false,
    resolved_at: null,
    resolved_by: null,
  };
  const unlockedAt = new Date("2026-08-26T10:00:00+07:00");
  const resolved = markAttendanceResolved(row, unlockedAt);
  assertEqual(resolved.resolved, true, "15. attendance becomes resolved after admin unlock");
  assertEqual(resolved.resolved_at, unlockedAt.toISOString(), "15. resolved_at set");
  assertEqual(resolved.resolved_by, "admin", "15. resolved_by admin");
  assertEqual(
    shouldShowLateSprintUnlock(resolved),
    false,
    "15. unlock action hidden after resolve"
  );
  assertEqual(countUnresolvedLateSprint([resolved]), 0, "15. Trễ Mở Sprint count drops");
}

// 16. After unlock, Admin Learners Late derivation is unchanged (Sunday booking window, not attendance type)
{
  const unlockedSprint: SprintRow = {
    id: "sp-2",
    enrollment_id: "enr-1",
    sprint_number: 2,
    status: "active",
  };
  const unbookedS2: LiveSessionRow = {
    id: "sess-2",
    sprint_id: "sp-2",
    session_number: 2,
    session_type: "vietnamese_teacher",
    status: "available",
    teacher_id: null,
    scheduled_at: null,
    class_id: null,
    meeting_link: null,
  };
  assertEqual(
    deriveSessionBookingBadge({
      session: unbookedS2,
      sprint: unlockedSprint,
      enrollmentStatus: "active",
      windowPassed: hasSundayBookingWindowPassed(MON_AUG_31),
    }),
    "late",
    "16. after sprint unlock, unbooked S2 on Monday is Admin Learners Late"
  );
  assertEqual(
    deriveSessionBookingBadge({
      session: unbookedS2,
      sprint: unlockedSprint,
      enrollmentStatus: "active",
      windowPassed: hasSundayBookingWindowPassed(SUN_AUG_30),
    }),
    "neutral",
    "16. Sunday booking window still open → not Admin Learners Late"
  );
  assertEqual(
    shouldShowAttendanceForceComplete({
      type: ATTENDANCE_TYPE_LATE_SPRINT,
      related_sprint_id: "sp-2",
      resolved: false,
    }),
    false,
    "16. attendance late_sprint never shows Force Complete"
  );
}

// Extra: Case A timeline from the spec
{
  assertEqual(evalAt(TUE_AUG_25, WED_AUG_26).record, false, "A. Wed Aug 26 not late");
  assertEqual(evalAt(TUE_AUG_25, SAT_AUG_29).record, false, "A. Sat Aug 29 not late");
  assertEqual(evalAt(TUE_AUG_25, SUN_AUG_30).record, false, "A. Sun Aug 30 not late");
  assertEqual(evalAt(TUE_AUG_25, MON_AUG_31).record, true, "A. Mon Aug 31 late if still locked");
}

console.log("sprintUnlockLate tests passed");
