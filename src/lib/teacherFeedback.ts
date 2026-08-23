/**
 * Teacher Dashboard → Feedback discovery.
 * Parent sprint status is intentionally ignored: a completed sprint
 * does not hide a taught session that still needs teacher feedback.
 */

export type TeacherFeedbackLearner = {
  studentId?: string;
  grade: number | null;
  feedback?: string | null;
  attendanceStatus?: string | null;
};

export function isPendingTeacherFeedbackSession(status: string): boolean {
  return status === "awaiting_feedback";
}

export function canTeacherDiscoverSession(input: {
  teacherId: string | null | undefined;
  status: string;
  sessionType: string | null | undefined;
}): boolean {
  if (!input.teacherId) return false;
  if (input.sessionType === "self_study") return false;
  return input.status === "awaiting_feedback" || input.status === "completed";
}

export function isLegitimateTaughtFeedbackHistory(input: {
  teacherId: string | null | undefined;
  status: string;
  sessionType: string | null | undefined;
}): boolean {
  return canTeacherDiscoverSession(input) && isPendingTeacherFeedbackSession(input.status);
}

export function isPresentLearnerMissingFeedback(learner: TeacherFeedbackLearner): boolean {
  if (learner.attendanceStatus === "absent") return false;
  return learner.grade === null;
}

/**
 * Session-level Save / Submit is allowed for taught sessions that still have
 * an ungraded present learner. Parent sprint status is not an input.
 * Session status "completed" must not hide the action (group class + force-complete).
 */
export function canShowTeacherFeedbackSubmit(input: {
  sessionStatus: string;
  learners: TeacherFeedbackLearner[];
}): boolean {
  if (input.sessionStatus !== "awaiting_feedback" && input.sessionStatus !== "completed") {
    return false;
  }
  return input.learners.some(isPresentLearnerMissingFeedback);
}

export function canShowAllAbsentSessionComplete(input: {
  sessionStatus: string;
  learners: TeacherFeedbackLearner[];
}): boolean {
  if (!isPendingTeacherFeedbackSession(input.sessionStatus)) return false;
  return input.learners.length > 0 && input.learners.every((learner) => learner.attendanceStatus === "absent");
}

/** Already-graded learners keep stored values; only missing learners use draft input. */
export function buildTeacherFeedbackSubmitGrades(input: {
  sessionId: string;
  learners: TeacherFeedbackLearner[];
  drafts: Record<string, { grade: number; feedback: string }>;
}): Array<{ student_id: string; grade: number; feedback: string }> {
  return input.learners
    .filter((learner) => learner.studentId && learner.attendanceStatus !== "absent")
    .map((learner) => {
      const key = `${input.sessionId}_${learner.studentId}`;
      const draft = input.drafts[key];
      if (learner.grade !== null && learner.feedback) {
        return {
          student_id: learner.studentId!,
          grade: learner.grade,
          feedback: learner.feedback,
        };
      }
      return {
        student_id: learner.studentId!,
        grade: draft?.grade || 3,
        feedback: draft?.feedback || "",
      };
    });
}
