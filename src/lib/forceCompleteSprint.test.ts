import { canForceCompleteSprint, selectCurrentAdminSprint, type AdminSprintRow } from "./adminSprintSelection";
import {
  buildForceCompleteSessionUpdate,
  planBookingReleaseForForceComplete,
  sessionsEligibleForForceComplete,
  shouldDeleteEmptyUpcomingClass,
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

// 7. Session 1 without lesson_summary still eligible (absent excluded only)
{
  const sessions: ForceCompleteSessionRow[] = [
    { id: "s1", class_id: null, status: "in_progress" },
    { id: "s2", class_id: null, status: "absent" },
  ];
  assertEqual(
    sessionsEligibleForForceComplete(sessions).map((s) => s.id),
    ["s1"],
    "session 1 force-completes; absent skipped"
  );
}

// After force complete sprint 2, selection shows sprint 3 pending
{
  const afterForceComplete = selectCurrentAdminSprint([
    sprint(1, "completed"),
    sprint(2, "completed"),
    sprint(3, "pending"),
  ]);
  assertEqual(afterForceComplete?.sprint_number, 3, "after FC sprint 2, show sprint 3");
}

console.log("forceCompleteSprint tests passed");
