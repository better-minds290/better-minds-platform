export interface ForceCompleteSessionRow {
  id: string;
  class_id: string | null;
  status: string;
  /** class_schedules.status for this session's class, when known. */
  scheduleStatus?: string | null;
  /**
   * True when this learner already has non-absent session_attendance
   * (present / pending_review). Attendance is created at teach-time, not booking.
   */
  hasPresentAttendance?: boolean;
}

export interface BookingReleasePlan {
  sessionId: string;
  classId: string;
  /** Remove only this learner's class_enrollment row. */
  removeLearnerEnrollment: true;
  /** Remove only this learner's session_attendance rows for the class schedule. */
  removeLearnerAttendance: true;
  /** Completed session should not remain linked to an upcoming booking. */
  unlinkBookingFieldsOnComplete: true;
}

export interface EmptyClassCleanupPlan {
  classId: string;
  /** Only when zero enrollments remain AND schedule is not already completed. */
  deleteUpcomingClassShell: true;
}

/**
 * A session that was actually taught and is only waiting for teacher feedback.
 * Administrative sprint completion must preserve this historical teaching
 * relationship so the teacher can submit late feedback.
 *
 * Existing product signals (do not invent a new taught definition):
 * - sprint_sessions.status === "awaiting_feedback"
 * - class_schedules.status === "completed"
 * - non-absent session_attendance for this learner
 *
 * Absent sessions are never treated as taught-for-late-feedback.
 */
export function isTaughtSessionForLateFeedback(session: ForceCompleteSessionRow): boolean {
  if (session.status === "absent") return false;
  if (session.status === "awaiting_feedback") return true;
  if (session.scheduleStatus === "completed") return true;
  if (session.hasPresentAttendance === true) return true;
  return false;
}

export function sessionsToPreserveForLateFeedback(
  sessions: ForceCompleteSessionRow[]
): ForceCompleteSessionRow[] {
  return sessions.filter(isTaughtSessionForLateFeedback);
}

/** Incomplete sessions that may be force-completed. Taught-awaiting-feedback is excluded. */
export function sessionsEligibleForForceComplete(sessions: ForceCompleteSessionRow[]): ForceCompleteSessionRow[] {
  return sessions.filter(
    (s) => s.status !== "completed" && s.status !== "absent" && !isTaughtSessionForLateFeedback(s)
  );
}

export function planBookingReleaseForForceComplete(
  sessions: ForceCompleteSessionRow[]
): BookingReleasePlan[] {
  return sessionsEligibleForForceComplete(sessions)
    .filter((s) => !!s.class_id)
    .map((s) => ({
      sessionId: s.id,
      classId: s.class_id!,
      removeLearnerEnrollment: true as const,
      removeLearnerAttendance: true as const,
      unlinkBookingFieldsOnComplete: true as const,
    }));
}

/**
 * After removing one learner from a class, decide whether the class shell can be
 * deleted (upcoming only). Never delete completed/historical schedules.
 */
export function shouldDeleteEmptyUpcomingClass(input: {
  remainingEnrollmentCount: number;
  scheduleStatus: string | null;
}): boolean {
  if (input.remainingEnrollmentCount > 0) return false;
  if (!input.scheduleStatus) return true;
  return input.scheduleStatus !== "completed";
}

export function buildForceCompleteSessionUpdate(
  session: ForceCompleteSessionRow,
  completedAt: string
): Record<string, unknown> {
  const base = { status: "completed", completed_at: completedAt };
  if (session.class_id) {
    return {
      ...base,
      class_id: null,
      teacher_id: null,
      scheduled_at: null,
      meeting_link: null,
    };
  }
  return base;
}

export function sessionsWithAbsentBookings(
  sessions: ForceCompleteSessionRow[]
): ForceCompleteSessionRow[] {
  return sessions.filter((s) => s.status === "absent" && !!s.class_id);
}

export interface AbsentBookingReleasePlan {
  sessionId: string;
  classId: string;
  removeLearnerEnrollment: true;
  removeLearnerAttendance: true;
  unlinkBookingFieldsKeepAbsent: true;
}

export function planBookingReleaseForAbsentBookedSessions(
  sessions: ForceCompleteSessionRow[]
): AbsentBookingReleasePlan[] {
  return sessionsWithAbsentBookings(sessions).map((s) => ({
    sessionId: s.id,
    classId: s.class_id!,
    removeLearnerEnrollment: true as const,
    removeLearnerAttendance: true as const,
    unlinkBookingFieldsKeepAbsent: true as const,
  }));
}

/** Clear active booking from an absent session; preserve status = absent. */
export function buildAbsentSessionBookingReleaseUpdate(): Record<string, unknown> {
  return {
    status: "absent",
    class_id: null,
    teacher_id: null,
    scheduled_at: null,
    meeting_link: null,
  };
}

/** Sessions that need class_enrollment / session_attendance release during force-complete. */
export function sessionsNeedingLearnerClassRelease(
  sessions: ForceCompleteSessionRow[]
): ForceCompleteSessionRow[] {
  const byId = new Map<string, ForceCompleteSessionRow>();
  for (const session of sessionsEligibleForForceComplete(sessions)) {
    if (session.class_id) byId.set(session.id, session);
  }
  for (const session of sessionsWithAbsentBookings(sessions)) {
    byId.set(session.id, session);
  }
  return [...byId.values()];
}

/** Admin Attendance tab: FC Sprint only for unresolved absent_session rows. */
export function shouldShowAttendanceForceComplete(record: {
  type: string;
  related_sprint_id: string | null;
  resolved: boolean;
}): boolean {
  return !record.resolved && record.type === "absent_session" && !!record.related_sprint_id;
}
