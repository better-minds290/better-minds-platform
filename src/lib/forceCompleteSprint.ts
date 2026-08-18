export interface ForceCompleteSessionRow {
  id: string;
  class_id: string | null;
  status: string;
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

export function sessionsEligibleForForceComplete(sessions: ForceCompleteSessionRow[]): ForceCompleteSessionRow[] {
  return sessions.filter((s) => s.status !== "completed" && s.status !== "absent");
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
