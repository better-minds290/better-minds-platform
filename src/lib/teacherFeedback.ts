/**
 * Teacher Dashboard → Feedback discovery.
 * Parent sprint status is intentionally ignored: a completed sprint
 * does not hide a taught session that still needs teacher feedback.
 */

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
