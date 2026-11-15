/**
 * Learner-scoped attendance / class-completion predicates.
 * Used by Edge Functions and mirrored in frontend tests via src/lib re-export.
 * Missing session_attendance is never treated as absent.
 */

export type MarkAbsentSession = {
  id: string;
  class_id: string | null;
  teacher_id: string | null;
  status: string;
  sprint_id: string;
};

export type MarkAbsentOwnershipInput = {
  studentId: string;
  sessionId: string;
  classId?: string | null;
  scheduleId?: string | null;
  session: MarkAbsentSession | null;
  enrollmentLearnerId: string | null;
  scheduleClassId?: string | null;
  scheduleCountForClass?: number;
};

export type MarkAbsentRejectReason =
  | "session_not_found"
  | "learner_mismatch"
  | "class_mismatch"
  | "schedule_mismatch"
  | "ambiguous_schedule"
  | "missing_schedule";

export type MarkAbsentOwnershipResult =
  | { ok: true }
  | { ok: false; reason: MarkAbsentRejectReason };

export function evaluateMarkAbsentOwnership(input: MarkAbsentOwnershipInput): MarkAbsentOwnershipResult {
  if (!input.session || input.session.id !== input.sessionId) {
    return { ok: false, reason: "session_not_found" };
  }
  if (!input.enrollmentLearnerId || input.enrollmentLearnerId !== input.studentId) {
    return { ok: false, reason: "learner_mismatch" };
  }
  if (input.classId && input.session.class_id && input.classId !== input.session.class_id) {
    return { ok: false, reason: "class_mismatch" };
  }
  if (input.session.class_id && input.scheduleCountForClass != null && input.scheduleCountForClass > 1) {
    return { ok: false, reason: "ambiguous_schedule" };
  }
  if (input.session.class_id && input.scheduleCountForClass === 0) {
    return { ok: false, reason: "missing_schedule" };
  }
  if (input.scheduleId && input.scheduleClassId && input.session.class_id && input.scheduleClassId !== input.session.class_id) {
    return { ok: false, reason: "schedule_mismatch" };
  }
  return { ok: true };
}

export function isLearnerAlreadyAbsent(flags: {
  attendanceStatus?: string | null;
  sessionStatus?: string | null;
  hasLearnerAttendanceRow?: boolean;
}): boolean {
  return (
    flags.attendanceStatus === "absent" ||
    flags.sessionStatus === "absent" ||
    flags.hasLearnerAttendanceRow === true
  );
}

export type MarkAbsentLearnerRow = {
  id: string;
  resolved: boolean;
};

/**
 * Which mark_absent writes are still required.
 * A single stored signal is not success. Admin Reopen (resolved row, live records
 * no longer absent) is left unchanged and does not start a new absence.
 */
export type MarkAbsentWritePlan = {
  alreadyComplete: boolean;
  preserveResolved: boolean;
  writeAttendance: boolean;
  writeSession: boolean;
  insertLearnerAttendance: boolean;
  sendAbsenceNotice: boolean;
};

export function planMarkAbsentWrites(input: {
  attendanceStatus: string | null;
  sessionStatus: string | null;
  learnerAttendance: MarkAbsentLearnerRow | null;
}): MarkAbsentWritePlan {
  const attendanceAbsent = input.attendanceStatus === "absent";
  const sessionAbsent = input.sessionStatus === "absent";
  const row = input.learnerAttendance;
  const none: MarkAbsentWritePlan = {
    alreadyComplete: false,
    preserveResolved: false,
    writeAttendance: false,
    writeSession: false,
    insertLearnerAttendance: false,
    sendAbsenceNotice: false,
  };

  if (row?.resolved && !(attendanceAbsent && sessionAbsent)) {
    return { ...none, preserveResolved: true };
  }

  if (attendanceAbsent && sessionAbsent && row) {
    return { ...none, alreadyComplete: true };
  }

  return {
    ...none,
    writeAttendance: !attendanceAbsent,
    writeSession: !sessionAbsent,
    insertLearnerAttendance: !row,
    sendAbsenceNotice: !row,
  };
}

export type EnrolledLearnerState = {
  studentId: string;
  sessionId: string | null;
  attendanceStatus: string | null;
  sessionStatus: string | null;
  grade: number | null;
  feedback: string | null;
};

export function isVerifiedAbsent(learner: EnrolledLearnerState): boolean {
  return learner.attendanceStatus === "absent" || learner.sessionStatus === "absent";
}

export function isFullyGradedPresent(learner: EnrolledLearnerState): boolean {
  if (isVerifiedAbsent(learner)) return false;
  return (
    learner.grade != null &&
    learner.grade >= 1 &&
    !!learner.feedback &&
    learner.feedback.trim().length > 0
  );
}

/** Class can close only when every enrolled learner is absent or fully graded — and has a session. */
export function isLearnerHandledForClassCompletion(learner: EnrolledLearnerState): boolean {
  if (!learner.sessionId) return false;
  return isVerifiedAbsent(learner) || isFullyGradedPresent(learner);
}

export function areAllEnrolledLearnersAbsent(learners: EnrolledLearnerState[]): boolean {
  return learners.length > 0 && learners.every((learner) => isVerifiedAbsent(learner) && !!learner.sessionId);
}

export function shouldCompleteClassSchedule(learners: EnrolledLearnerState[]): boolean {
  return learners.length > 0 && learners.every(isLearnerHandledForClassCompletion);
}

export function sessionIdsToMarkAbsent(learners: EnrolledLearnerState[]): string[] {
  return learners.filter((learner) => isVerifiedAbsent(learner) && learner.sessionId).map((learner) => learner.sessionId as string);
}

export function canCallerMarkClassAttendance(input: {
  callerId: string;
  callerRole: string | null | undefined;
  sessionTeacherId: string | null;
  classTeacherId: string | null;
}): boolean {
  const role = input.callerRole || "";
  if (role === "admin") return true;
  if (input.sessionTeacherId && input.sessionTeacherId === input.callerId) return true;
  if (input.classTeacherId && input.classTeacherId === input.callerId) return true;
  return false;
}

export function canCallerCompleteTaughtSession(input: {
  callerId: string;
  callerRole: string | null | undefined;
  sessionTeacherId: string | null;
}): boolean {
  const role = input.callerRole || "";
  if (role === "admin") return true;
  return !!input.sessionTeacherId && input.sessionTeacherId === input.callerId;
}

export function canCallerSubmitSessionOne(input: {
  callerId: string;
  callerRole: string | null | undefined;
  learnerId: string | null;
  sessionTeacherId: string | null;
}): boolean {
  const role = input.callerRole || "";
  if (role === "admin") return true;
  if (input.learnerId && input.learnerId === input.callerId) return true;
  if (input.sessionTeacherId && input.sessionTeacherId === input.callerId) return true;
  return false;
}

/** Skip overwriting a stored grade+feedback when the teacher is submitting for a classmate. */
export function shouldPreserveStoredFeedback(existing: {
  grade: number | null;
  teacher_feedback: string | null;
  status: string | null;
}): boolean {
  if (existing.status === "absent") return true;
  return (
    existing.grade != null &&
    existing.grade >= 1 &&
    !!existing.teacher_feedback &&
    existing.teacher_feedback.trim().length > 0
  );
}
