import {
  buildTeacherFeedbackSubmitGrades,
  canShowAllAbsentSessionComplete,
  canShowTeacherFeedbackSubmit,
  canTeacherDiscoverSession,
  isLegitimateTaughtFeedbackHistory,
  isPendingTeacherFeedbackSession,
  isPresentLearnerMissingFeedback,
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

// 1. Active sprint + awaiting feedback → teacher can submit
{
  assertEqual(
    canShowTeacherFeedbackSubmit({
      sessionStatus: "awaiting_feedback",
      learners: [{ grade: null, attendanceStatus: "present" }],
    }),
    true,
    "active/awaiting session can submit"
  );
}

// 2. Force-completed sprint + awaiting feedback → teacher can submit
// 3. Parent sprint completed must NOT hide submit (sprint status is not an input)
{
  assertEqual(
    canShowTeacherFeedbackSubmit({
      sessionStatus: "awaiting_feedback",
      learners: [{ grade: null, attendanceStatus: "present" }],
    }),
    true,
    "force-completed parent sprint does not hide submit"
  );
}

// 4. Session displayed under Completed + one learner ungraded → submit still available
{
  assertEqual(
    isPendingTeacherFeedbackSession("completed"),
    false,
    "completed session stays in Completed filter"
  );
  assertEqual(
    canShowTeacherFeedbackSubmit({
      sessionStatus: "completed",
      learners: [
        { grade: 4, feedback: "Good", attendanceStatus: "present" },
        { grade: null, attendanceStatus: "present" },
      ],
    }),
    true,
    "completed + ungraded learner still shows submit"
  );
}

// 5. Group class: A graded, B ungraded → B can be graded
{
  const group = [
    { studentId: "a", grade: 4, feedback: "Solid work", attendanceStatus: "present" },
    { studentId: "b", grade: null, attendanceStatus: "present" },
  ];
  assertEqual(
    canShowTeacherFeedbackSubmit({ sessionStatus: "completed", learners: group }),
    true,
    "group class B can still be graded"
  );
  assertEqual(isPresentLearnerMissingFeedback(group[0]), false, "A is not missing feedback");
  assertEqual(isPresentLearnerMissingFeedback(group[1]), true, "B is missing feedback");
}

// 6. Existing A feedback preserved when B is graded
{
  const payload = buildTeacherFeedbackSubmitGrades({
    sessionId: "sess-1",
    learners: [
      { studentId: "a", grade: 4, feedback: "Solid work", attendanceStatus: "present" },
      { studentId: "b", grade: null, attendanceStatus: "present" },
    ],
    drafts: {
      "sess-1_a": { grade: 1, feedback: "should not overwrite A" },
      "sess-1_b": { grade: 5, feedback: "Late feedback for B" },
    },
  });
  const a = payload.find((row) => row.student_id === "a");
  const b = payload.find((row) => row.student_id === "b");
  assertEqual(a, { student_id: "a", grade: 4, feedback: "Solid work" }, "A stored feedback preserved");
  assertEqual(b, { student_id: "b", grade: 5, feedback: "Late feedback for B" }, "B draft submitted");
}

// 7. All learners graded → session completed, no submit
{
  assertEqual(
    canShowTeacherFeedbackSubmit({
      sessionStatus: "completed",
      learners: [
        { grade: 4, feedback: "A", attendanceStatus: "present" },
        { grade: 5, feedback: "B", attendanceStatus: "present" },
      ],
    }),
    false,
    "all graded hides submit"
  );
}

// 8. Absent learner does not require feedback
{
  assertEqual(
    isPresentLearnerMissingFeedback({ grade: null, attendanceStatus: "absent" }),
    false,
    "absent does not require feedback"
  );
  assertEqual(
    canShowTeacherFeedbackSubmit({
      sessionStatus: "awaiting_feedback",
      learners: [{ grade: null, attendanceStatus: "absent" }],
    }),
    false,
    "only-absent session does not show grade submit"
  );
  assertEqual(
    canShowAllAbsentSessionComplete({
      sessionStatus: "awaiting_feedback",
      learners: [{ grade: null, attendanceStatus: "absent" }],
    }),
    true,
    "all-absent can complete without grades"
  );
}

console.log("teacherFeedback tests passed");
