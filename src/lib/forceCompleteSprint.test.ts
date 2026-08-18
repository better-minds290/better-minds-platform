import { canForceCompleteSprint, selectCurrentAdminSprint, type AdminSprintRow } from "./adminSprintSelection";
import {
  buildAbsentSessionBookingReleaseUpdate,
  buildForceCompleteSessionUpdate,
  planBookingReleaseForAbsentBookedSessions,
  planBookingReleaseForForceComplete,
  sessionsEligibleForForceComplete,
  sessionsNeedingLearnerClassRelease,
  sessionsWithAbsentBookings,
  shouldDeleteEmptyUpcomingClass,
  shouldShowAttendanceForceComplete,
  type ForceCompleteSessionRow,
} from "./forceCompleteSprint";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sprint(n: number, status: string, id = `sp-${n}`): AdminSprintRow {
  return { id, sprint_number: n, status };
}

// 1. Sprint 1 completed, Sprint 2 active → current is Sprint 2
{
  const current = selectCurrentAdminSprint([
    sprint(1, "completed"),
    sprint(2, "active"),
    sprint(3, "pending"),
  ]);
  assertEqual(current?.sprint_number, 2, "active sprint wins over pending");
}

// 2. Sprint 1/2 completed, Sprint 3 pending → show Sprint 3, never Sprint 1
{
  const rows = [sprint(1, "completed"), sprint(2, "completed"), sprint(3, "pending")];
  const current = selectCurrentAdminSprint(rows);
  assertEqual(current?.sprint_number, 3, "pending sprint 3 is current");
  assertEqual(current?.id, "sp-3", "not sprint 1");
}

// Expired before pending
{
  const current = selectCurrentAdminSprint([
    sprint(1, "completed"),
    sprint(2, "expired"),
    sprint(3, "pending"),
  ]);
  assertEqual(current?.sprint_number, 2, "expired before pending");
}

// All completed → latest sprint
{
  const current = selectCurrentAdminSprint([
    sprint(1, "completed"),
    sprint(2, "completed"),
    sprint(3, "completed"),
  ]);
  assertEqual(current?.sprint_number, 3, "all completed shows latest");
}

// Locked counts as next unfinished
{
  const current = selectCurrentAdminSprint([sprint(1, "completed"), sprint(2, "locked")]);
  assertEqual(current?.sprint_number, 2, "locked sprint is next unfinished");
}

// Double force-complete guard
{
  assertEqual(canForceCompleteSprint("active"), true, "active can force complete");
  assertEqual(canForceCompleteSprint("completed"), false, "completed blocked");
}

// 4. Force-complete session with no class booking
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "s1", class_id: null, status: "in_progress" },
  ];
  assertEqual(planBookingReleaseForForceComplete(sessions), [], "no booking release without class");
  const update = buildForceCompleteSessionUpdate(sessions[0], "2026-01-01T00:00:00Z");
  assertEqual(update.status, "completed", "completes session");
  assertEqual(update.class_id, undefined, "no class unlink fields");
}

// 5. Force-complete learner with booked class
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "s2", class_id: "class-1", status: "in_progress" },
  ];
  const plans = planBookingReleaseForForceComplete(sessions);
  assertEqual(plans.length, 1, "one release plan");
  assertEqual(plans[0].classId, "class-1", "targets booked class");
  const update = buildForceCompleteSessionUpdate(sessions[0], "2026-01-01T00:00:00Z");
  assertEqual(update.class_id, null, "unlinks class on complete");
}

// 6. Group class — only sessions in the force-completed sprint are planned
{
  const sprintTwoSessions: ForceCompleteSessionRow[] = [
    { id: "sess-a", class_id: "shared-class", status: "in_progress" },
    { id: "sess-a-s1", class_id: null, status: "completed" },
  ];
  assertEqual(
    planBookingReleaseForForceComplete(sprintTwoSessions).map((p) => p.sessionId),
    ["sess-a"],
    "only sessions in this sprint are planned"
  );
  assertEqual(
    shouldDeleteEmptyUpcomingClass({ remainingEnrollmentCount: 1, scheduleStatus: "scheduled" }),
    false,
    "shared class kept when one learner remains"
  );
}

// Empty upcoming class can be cleaned when last learner removed
{
  assertEqual(
    shouldDeleteEmptyUpcomingClass({ remainingEnrollmentCount: 0, scheduleStatus: "scheduled" }),
    true,
    "delete empty upcoming class"
  );
  assertEqual(
    shouldDeleteEmptyUpcomingClass({ remainingEnrollmentCount: 0, scheduleStatus: "completed" }),
    false,
    "keep completed historical schedule"
  );
}

// 7. Session 1 without lesson_summary still eligible (absent excluded from force-complete only)
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "s1", class_id: null, status: "in_progress" },
    { id: "s2", class_id: null, status: "absent" },
  ];
  assertEqual(
    sessionsEligibleForForceComplete(sessions).map((s) => s.id),
    ["s1"],
    "session 1 force-completes; absent not force-completed"
  );
}

// 1. Absent + booked solo class — release plan + keep absent status on unlink
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "abs-solo", class_id: "solo-class", status: "absent" },
    { id: "s3", class_id: null, status: "available" },
  ];
  assertEqual(
    sessionsWithAbsentBookings(sessions).map((s) => s.id),
    ["abs-solo"],
    "detect absent booked session"
  );
  const absentPlans = planBookingReleaseForAbsentBookedSessions(sessions);
  assertEqual(absentPlans.length, 1, "solo absent booking release plan");
  assertEqual(absentPlans[0].classId, "solo-class", "targets solo class");
  const absentUpdate = buildAbsentSessionBookingReleaseUpdate();
  assertEqual(absentUpdate.status, "absent", "absent status preserved");
  assertEqual(absentUpdate.class_id, null, "class_id cleared");
  assertEqual(
    sessionsNeedingLearnerClassRelease(sessions).map((s) => s.id),
    ["abs-solo"],
    "only booked sessions need class release"
  );
}

// 2. Absent + booked group class — learner A released; class kept when others remain
{
  assertEqual(
    shouldDeleteEmptyUpcomingClass({ remainingEnrollmentCount: 1, scheduleStatus: "scheduled" }),
    false,
    "group class kept when learner B remains"
  );
  const groupAbsent: ForceCompleteSessionRow[] = [
    { id: "abs-a", class_id: "shared-class", status: "absent" },
  ];
  assertEqual(
    planBookingReleaseForAbsentBookedSessions(groupAbsent)[0].removeLearnerEnrollment,
    true,
    "only learner A enrollment removed"
  );
}

// 3. Absent + no booking — no release plan, no error path
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "abs-plain", class_id: null, status: "absent" },
  ];
  assertEqual(
    planBookingReleaseForAbsentBookedSessions(sessions),
    [],
    "no absent booking release without class_id"
  );
  assertEqual(
    sessionsWithAbsentBookings(sessions),
    [],
    "no absent booked sessions"
  );
}

// 4. Non-absent booked session — existing force-complete cleanup unchanged
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "s2", class_id: "class-1", status: "in_progress" },
  ];
  const plans = planBookingReleaseForForceComplete(sessions);
  assertEqual(plans.length, 1, "one release plan");
  assertEqual(plans[0].classId, "class-1", "targets booked class");
  const update = buildForceCompleteSessionUpdate(sessions[0], "2026-01-01T00:00:00Z");
  assertEqual(update.class_id, null, "unlinks class on complete");
}

// 5. Completed historical class — do not delete
{
  assertEqual(
    shouldDeleteEmptyUpcomingClass({ remainingEnrollmentCount: 0, scheduleStatus: "completed" }),
    false,
    "keep completed historical schedule"
  );
}

// 6. Attendance absent_session → FC available
{
  assertEqual(
    shouldShowAttendanceForceComplete({
      type: "absent_session",
      related_sprint_id: "sp-1",
      resolved: false,
    }),
    true,
    "FC shown for unresolved absent_session"
  );
}

// 7. Attendance sprint_unlock_late → FC NOT available
{
  assertEqual(
    shouldShowAttendanceForceComplete({
      type: "sprint_unlock_late",
      related_sprint_id: "sp-2",
      resolved: false,
    }),
    false,
    "FC hidden for sprint_unlock_late"
  );
  assertEqual(
    shouldShowAttendanceForceComplete({
      type: "absent_session",
      related_sprint_id: "sp-1",
      resolved: true,
    }),
    false,
    "FC hidden when resolved"
  );
}

// 8. Next sprint remains pending after force complete
{
  const afterForceComplete = selectCurrentAdminSprint([
    sprint(1, "completed"),
    sprint(2, "completed"),
    sprint(3, "pending"),
  ]);
  assertEqual(afterForceComplete?.sprint_number, 3, "after FC sprint 2, show sprint 3 pending");
}

// 9. Absence history unchanged — FC helpers do not touch learner_attendance (documented contract)
{
  assertEqual(
    planBookingReleaseForAbsentBookedSessions([{ id: "a", class_id: "c", status: "absent" }]).length,
    1,
    "absent booking release is session/class only"
  );
  assertEqual(
    shouldShowAttendanceForceComplete({
      type: "absent_session",
      related_sprint_id: null,
      resolved: false,
    }),
    false,
    "FC requires related_sprint_id"
  );
}

console.log("forceCompleteSprint tests passed");
