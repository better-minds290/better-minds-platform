import {
  canTeacherDiscoverSession,
  isLegitimateTaughtFeedbackHistory,
  isPendingTeacherFeedbackSession,
} from "./teacherFeedback";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const teacherId = "teacher-a";

// After admin FC: taught Sprint 1 session remains visible and pending
{
  const taught = {
    teacherId,
    status: "awaiting_feedback",
    sessionType: "vietnamese_teacher",
  };
  assertEqual(canTeacherDiscoverSession(taught), true, "teacher can find taught Sprint 1 session");
  assertEqual(isPendingTeacherFeedbackSession(taught.status), true, "missing feedback still pending");
  assertEqual(isLegitimateTaughtFeedbackHistory(taught), true, "shown in Teacher → Feedback pending");
}

// Parent sprint completed is not an input — discovery does not require sprint status
{
  assertEqual(
    isPendingTeacherFeedbackSession("awaiting_feedback"),
    true,
    "completed sprint does not hide pending feedback"
  );
}

// Upcoming/unattended force-completed session — booking unlinked, not taught history
{
  const cleanedUpcoming = {
    teacherId: null,
    status: "completed",
    sessionType: "foreign_teacher",
  };
  assertEqual(canTeacherDiscoverSession(cleanedUpcoming), false, "cleared teacher_id hides untaught FC session");
  assertEqual(
    isLegitimateTaughtFeedbackHistory(cleanedUpcoming),
    false,
    "upcoming FC session is not legitimate taught feedback history"
  );
}

// Already reviewed historical session stays discoverable as reviewed, not pending
{
  const reviewed = {
    teacherId,
    status: "completed",
    sessionType: "vietnamese_teacher",
  };
  assertEqual(canTeacherDiscoverSession(reviewed), true, "reviewed session still listed");
  assertEqual(isPendingTeacherFeedbackSession(reviewed.status), false, "reviewed is not pending");
}

// Self-study never appears in teacher live-session feedback
{
  assertEqual(
    canTeacherDiscoverSession({
      teacherId,
      status: "awaiting_feedback",
      sessionType: "self_study",
    }),
    false,
    "self_study excluded"
  );
}

console.log("teacherFeedback tests passed");
