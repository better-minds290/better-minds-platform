import {
  areAllEnrolledLearnersAbsent,
  canCallerCompleteTaughtSession,
  canCallerMarkClassAttendance,
  canCallerSubmitSessionOne,
  evaluateMarkAbsentOwnership,
  isLearnerAlreadyAbsent,
  isLearnerHandledForClassCompletion,
  planMarkAbsentWrites,
  sessionIdsToMarkAbsent,
  shouldCompleteClassSchedule,
  shouldPreserveStoredFeedback,
  type MarkAbsentWritePlan,
} from "./classAttendancePolicy";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function rejectReason(result: { ok: true } | { ok: false; reason: string }): string {
  if (result.ok === false) return result.reason;
  throw new Error("expected ownership rejection");
}

const sessionA = {
  id: "sess-a",
  class_id: "class-1",
  teacher_id: "teacher-1",
  status: "awaiting_feedback",
  sprint_id: "sp-a",
};

const sessionB = {
  id: "sess-b",
  class_id: "class-1",
  teacher_id: "teacher-1",
  status: "awaiting_feedback",
  sprint_id: "sp-b",
};

{
  const result = evaluateMarkAbsentOwnership({
    studentId: "learner-a",
    sessionId: "sess-a",
    classId: "class-1",
    scheduleId: "sch-1",
    session: sessionA,
    enrollmentLearnerId: "learner-a",
    scheduleClassId: "class-1",
    scheduleCountForClass: 1,
  });
  assertEqual(result, { ok: true }, "5: A absent uses A's session — allowed");
}

{
  const result = evaluateMarkAbsentOwnership({
    studentId: "learner-a",
    sessionId: "sess-b",
    classId: "class-1",
    scheduleId: "sch-1",
    session: sessionB,
    enrollmentLearnerId: "learner-b",
    scheduleClassId: "class-1",
    scheduleCountForClass: 1,
  });
  assertEqual(rejectReason(result), "learner_mismatch", "6: A using B session id rejected");
}

{
  const result = evaluateMarkAbsentOwnership({
    studentId: "learner-a",
    sessionId: "sess-a",
    session: sessionA,
    enrollmentLearnerId: "learner-a",
    scheduleCountForClass: 2,
  });
  assertEqual(rejectReason(result), "ambiguous_schedule", "11: ambiguous schedule rejected");
}

{
  const result = evaluateMarkAbsentOwnership({
    studentId: "learner-a",
    sessionId: "sess-missing",
    session: null,
    enrollmentLearnerId: "learner-a",
  });
  assertEqual(result.ok, false, "10: missing session rejected");
}

{
  assertEqual(
    isLearnerAlreadyAbsent({ attendanceStatus: "absent" }),
    true,
    "13: already absent via attendance"
  );
  assertEqual(
    isLearnerAlreadyAbsent({ sessionStatus: "absent" }),
    true,
    "13: already absent via session"
  );
  assertEqual(
    isLearnerAlreadyAbsent({ hasLearnerAttendanceRow: true }),
    true,
    "13: already absent via learner_attendance"
  );
  assertEqual(
    isLearnerAlreadyAbsent({ attendanceStatus: "pending_review", sessionStatus: "awaiting_feedback" }),
    false,
    "13: first mark is not duplicate"
  );
}

{
  const a = {
    studentId: "a",
    sessionId: "sess-a",
    attendanceStatus: "absent" as string | null,
    sessionStatus: "absent" as string | null,
    grade: null as number | null,
    feedback: null as string | null,
  };
  const bMissing = {
    studentId: "b",
    sessionId: "sess-b",
    attendanceStatus: null,
    sessionStatus: "awaiting_feedback",
    grade: null,
    feedback: null,
  };
  assertEqual(areAllEnrolledLearnersAbsent([a, bMissing]), false, "7: missing attendance is not absent");
  assertEqual(shouldCompleteClassSchedule([a, bMissing]), false, "7: class does not complete");
  assertEqual(sessionIdsToMarkAbsent([a, bMissing]), ["sess-a"], "7: only A's session marked absent");
}

{
  const a = {
    studentId: "a",
    sessionId: "sess-a",
    attendanceStatus: "absent",
    sessionStatus: "absent",
    grade: null,
    feedback: null,
  };
  const b = {
    studentId: "b",
    sessionId: "sess-b",
    attendanceStatus: "absent",
    sessionStatus: "absent",
    grade: null,
    feedback: null,
  };
  assertEqual(areAllEnrolledLearnersAbsent([a, b]), true, "8: both verified absent");
  assertEqual(shouldCompleteClassSchedule([a, b]), true, "8: class completes when both absent");
}

{
  const a = {
    studentId: "a",
    sessionId: "sess-a",
    attendanceStatus: "present",
    sessionStatus: "completed",
    grade: 4,
    feedback: "Solid",
  };
  const b = {
    studentId: "b",
    sessionId: "sess-b",
    attendanceStatus: "pending_review",
    sessionStatus: "awaiting_feedback",
    grade: null,
    feedback: null,
  };
  assertEqual(isLearnerHandledForClassCompletion(a), true, "4: A handled when graded");
  assertEqual(isLearnerHandledForClassCompletion(b), false, "4: B not handled");
  assertEqual(shouldCompleteClassSchedule([a, b]), false, "4: schedule waits for B");
}

{
  const unlinked = {
    studentId: "c",
    sessionId: null,
    attendanceStatus: null,
    sessionStatus: null,
    grade: null,
    feedback: null,
  };
  assertEqual(isLearnerHandledForClassCompletion(unlinked), false, "10: unlinked learner blocks class complete");
}

{
  assertEqual(
    shouldPreserveStoredFeedback({ grade: 4, teacher_feedback: "Keep A", status: "present" }),
    true,
    "9: preserve stored A feedback"
  );
  assertEqual(
    shouldPreserveStoredFeedback({ grade: null, teacher_feedback: null, status: "pending_review" }),
    false,
    "9: B without feedback is writable"
  );
}

{
  assertEqual(
    canCallerMarkClassAttendance({
      callerId: "teacher-1",
      callerRole: "vietnamese_teacher",
      sessionTeacherId: "teacher-1",
      classTeacherId: "teacher-1",
    }),
    true,
    "auth: assigned teacher can mark"
  );
  assertEqual(
    canCallerMarkClassAttendance({
      callerId: "other-teacher",
      callerRole: "foreign_teacher",
      sessionTeacherId: "teacher-1",
      classTeacherId: "teacher-1",
    }),
    false,
    "auth: other teacher cannot mark"
  );
  assertEqual(
    canCallerCompleteTaughtSession({
      callerId: "teacher-1",
      callerRole: "foreign_teacher",
      sessionTeacherId: "teacher-1",
    }),
    true,
    "15: 1:1 teacher can complete"
  );
  assertEqual(
    canCallerSubmitSessionOne({
      callerId: "learner-a",
      callerRole: "learner",
      learnerId: "learner-a",
      sessionTeacherId: "teacher-1",
    }),
    true,
    "15: learner can submit session 1"
  );
}

type AbsentSnapshot = {
  attendanceStatus: string | null;
  sessionStatus: string | null;
  learnerAttendance: { id: string; resolved: boolean } | null;
};

function snapshot(overrides: Partial<AbsentSnapshot> = {}): AbsentSnapshot {
  return {
    attendanceStatus: null,
    sessionStatus: "awaiting_feedback",
    learnerAttendance: null,
    ...overrides,
  };
}

/** Same decisions record-learner-attendance applies after ownership succeeds. */
function applyMarkAbsent(state: AbsentSnapshot, fail?: "attendance" | "session" | "history") {
  const plan: MarkAbsentWritePlan = planMarkAbsentWrites(state);
  if (plan.alreadyComplete || plan.preserveResolved) {
    return { success: true as const, alreadyAbsent: true, inserted: false, noticed: false, state };
  }
  let next: AbsentSnapshot = {
    attendanceStatus: state.attendanceStatus,
    sessionStatus: state.sessionStatus,
    learnerAttendance: state.learnerAttendance,
  };
  if (plan.writeAttendance) {
    if (fail === "attendance") {
      return { success: false as const, alreadyAbsent: false, inserted: false, noticed: false, state: next };
    }
    next = { ...next, attendanceStatus: "absent" };
  }
  if (plan.writeSession) {
    if (fail === "session") {
      return { success: false as const, alreadyAbsent: false, inserted: false, noticed: false, state: next };
    }
    next = { ...next, sessionStatus: "absent" };
  }
  if (plan.insertLearnerAttendance) {
    if (fail === "history") {
      return { success: false as const, alreadyAbsent: false, inserted: false, noticed: false, state: next };
    }
    next = { ...next, learnerAttendance: { id: "att-1", resolved: false } };
  }
  return {
    success: true as const,
    alreadyAbsent: false,
    inserted: plan.insertLearnerAttendance,
    noticed: plan.sendAbsenceNotice,
    state: next,
  };
}

{
  const done = snapshot({
    attendanceStatus: "absent",
    sessionStatus: "absent",
    learnerAttendance: { id: "att-1", resolved: false },
  });
  const retry = applyMarkAbsent(done);
  assertEqual(retry.success, true, "1: completed absence retry succeeds");
  assertEqual(retry.alreadyAbsent, true, "1: retry is idempotent");
  assertEqual(retry.inserted, false, "1: retry does not insert another absence");
  assertEqual(retry.noticed, false, "1: retry does not send another notice");
  assertEqual(retry.state.learnerAttendance?.id, "att-1", "1: original absence row kept");
}

{
  const partial = snapshot({ attendanceStatus: "absent", sessionStatus: "awaiting_feedback" });
  const plan = planMarkAbsentWrites(partial);
  assertEqual(plan.alreadyComplete, false, "2: attendance-only is not complete");
  assertEqual(plan.writeSession, true, "2: retry still updates the sprint session");
  assertEqual(plan.insertLearnerAttendance, true, "2: retry still records absence history");
  assertEqual(plan.sendAbsenceNotice, true, "2: notice waits for the history insert");
  const repaired = applyMarkAbsent(partial);
  assertEqual(repaired.success, true, "2: retry completes the absence");
  assertEqual(repaired.state.sessionStatus, "absent", "2: sprint session becomes absent");
  assertEqual(repaired.inserted, true, "2: one history row is inserted");
  const again = applyMarkAbsent(repaired.state);
  assertEqual(again.alreadyAbsent, true, "2: following retry does not duplicate");
  assertEqual(again.inserted, false, "2: history stays a single row");
  assertEqual(again.noticed, false, "2: notice is not sent again");
}

{
  const partial = snapshot({
    attendanceStatus: "absent",
    sessionStatus: "absent",
    learnerAttendance: null,
  });
  const plan = planMarkAbsentWrites(partial);
  assertEqual(plan.writeAttendance, false, "3: saved attendance is not rewritten");
  assertEqual(plan.writeSession, false, "3: saved sprint session is not rewritten");
  assertEqual(plan.insertLearnerAttendance, true, "3: missing history is still required");
  const repaired = applyMarkAbsent(partial);
  assertEqual(repaired.inserted, true, "3: retry inserts the one history row");
  assertEqual(repaired.noticed, true, "3: notice follows the new history row");
  const again = applyMarkAbsent(repaired.state);
  assertEqual(again.inserted, false, "3: second retry does not insert again");
  assertEqual(again.noticed, false, "3: second retry does not notify again");
}

{
  const partial = snapshot({ attendanceStatus: "absent", sessionStatus: "awaiting_feedback" });
  const failed = applyMarkAbsent(partial, "session");
  assertEqual(failed.success, false, "4: failed session write is not success");
  assertEqual(failed.alreadyAbsent, false, "4: failed retry is not already-absent");
  assertEqual(failed.inserted, false, "4: failed retry does not invent history");
  assertEqual(failed.noticed, false, "4: failed retry does not notify");
  assertEqual(planMarkAbsentWrites(failed.state).alreadyComplete, false, "4: stored state stays incomplete");

  const historyFailed = applyMarkAbsent(
    snapshot({ attendanceStatus: "absent", sessionStatus: "absent" }),
    "history"
  );
  assertEqual(historyFailed.success, false, "4: failed history insert is not success");
  assertEqual(historyFailed.state.learnerAttendance, null, "4: history remains missing");
  assertEqual(planMarkAbsentWrites(historyFailed.state).insertLearnerAttendance, true, "4: next retry still requires history");
}

{
  const first = applyMarkAbsent(snapshot());
  assertEqual(first.inserted, true, "5: first success inserts one history row");
  const second = applyMarkAbsent(first.state);
  assertEqual(second.alreadyAbsent, true, "5: retry after success is idempotent");
  assertEqual(second.inserted, false, "5: retry does not duplicate the history row");
  assertEqual(second.noticed, false, "5: retry does not duplicate the notice");
  assertEqual(first.state.learnerAttendance?.id, second.state.learnerAttendance?.id, "5: same absence row");
}

{
  const ownership = evaluateMarkAbsentOwnership({
    studentId: "learner-a",
    sessionId: "sess-b",
    classId: "class-1",
    scheduleId: "sch-1",
    session: sessionB,
    enrollmentLearnerId: "learner-b",
    scheduleClassId: "class-1",
    scheduleCountForClass: 1,
  });
  assertEqual(rejectReason(ownership), "learner_mismatch", "6: retry path still rejects A using B's session");
  assertEqual(
    canCallerMarkClassAttendance({
      callerId: "other-teacher",
      callerRole: "foreign_teacher",
      sessionTeacherId: "teacher-1",
      classTeacherId: "teacher-1",
    }),
    false,
    "6: retry path still rejects another teacher"
  );
  assertEqual(
    canCallerMarkClassAttendance({
      callerId: "teacher-1",
      callerRole: "vietnamese_teacher",
      sessionTeacherId: "teacher-1",
      classTeacherId: "teacher-1",
    }),
    true,
    "6: assigned teacher can still mark"
  );
}

{
  const reopened = snapshot({
    attendanceStatus: null,
    sessionStatus: "available",
    learnerAttendance: { id: "att-old", resolved: true },
  });
  const plan = planMarkAbsentWrites(reopened);
  assertEqual(plan.preserveResolved, true, "reopen: resolved absence is not rewritten");
  assertEqual(plan.writeSession, false, "reopen: session reset stays");
  assertEqual(plan.insertLearnerAttendance, false, "reopen: no second history row");
  const result = applyMarkAbsent(reopened);
  assertEqual(result.alreadyAbsent, true, "reopen: call remains idempotent");
  assertEqual(result.state.sessionStatus, "available", "reopen: session is not marked absent again");
}

console.log("classAttendancePolicy tests passed");
