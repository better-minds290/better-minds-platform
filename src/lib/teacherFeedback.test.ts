import {
  buildAbsentConfirmTarget,
  buildTeacherFeedbackSubmitGrades,
  canEnableTeacherGradeSubmit,
  canMutateLearnerOnCard,
  canShowAllAbsentSessionComplete,
  canShowTeacherFeedbackSubmit,
  canTeacherDiscoverFeedbackRow,
  canTeacherDiscoverSession,
  feedbackBlockCopyKey,
  feedbackDraftKey,
  feedbackLayoutWrapsOnlyOnNarrow,
  feedbackPanelLayoutClass,
  groupTeacherFeedbackCards,
  isLegitimateTaughtFeedbackHistory,
  isPendingTeacherFeedbackSession,
  isPresentLearnerMissingFeedback,
  shouldAutoCompleteSessionAfterAbsent,
  shouldShowTeacherGradeSubmit,
  type FeedbackSessionRow,
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
      learners: [{ studentId: "a", sessionId: "sess-a", grade: null, attendanceStatus: "absent" }],
    }),
    true,
    "all-absent can complete without grades"
  );
}

function session(overrides: Partial<FeedbackSessionRow> & Pick<FeedbackSessionRow, "id" | "learner_id" | "class_id">): FeedbackSessionRow {
  return {
    sprint_id: `sp-${overrides.learner_id}`,
    session_number: 2,
    session_type: "vietnamese_teacher",
    status: "awaiting_feedback",
    scheduled_at: "2026-11-15T12:00:00+07:00",
    teacher_id: "teacher-a",
    completion_rating: null,
    teacher_feedback: null,
    feedback: null,
    sprint_number: 1,
    enrollment_id: `enr-${overrides.learner_id}`,
    course_name: "English",
    ...overrides,
  };
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", sprint_number: 5 }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", sprint_number: 3 }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  assertEqual(cards.length, 1, "1: same class different sprints → one card");
  assertEqual(cards[0].cardId, "class:class-1", "1: class card id");
  assertEqual(cards[0].learners.length, 2, "1: both learners listed");
  const a = cards[0].learners.find((l) => l.studentId === "learner-a");
  const b = cards[0].learners.find((l) => l.studentId === "learner-b");
  assertEqual(a?.sessionId, "sess-a", "1: A keeps own session");
  assertEqual(b?.sessionId, "sess-b", "1: B keeps own session");
  assertEqual(a?.sprintNumber, 5, "1: A sprint on learner");
  assertEqual(b?.sprintNumber, 3, "1: B sprint on learner");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1" }),
      session({ id: "sess-c", learner_id: "learner-c", class_id: "class-2" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-2", student_id: "learner-c" },
    ],
    attendance: [],
    schedules: [
      { id: "sch-1", class_id: "class-1" },
      { id: "sch-2", class_id: "class-2" },
    ],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-c", full_name: "Cara", email: "c@x.com" },
    ],
  });
  assertEqual(cards.length, 2, "2: different classes → two cards");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [session({ id: "sess-solo", learner_id: "learner-a", class_id: null, sprint_number: 2 })],
    enrollments: [],
    attendance: [],
    schedules: [],
    profiles: [{ id: "learner-a", full_name: "Ann", email: "a@x.com" }],
  });
  assertEqual(cards.length, 1, "3: standalone session one card");
  assertEqual(cards[0].cardId, "session:sess-solo", "3: session card id");
  assertEqual(cards[0].learners[0].sessionId, "sess-solo", "3: learner session preserved");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", status: "absent" }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", status: "awaiting_feedback" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [
      { id: "att-a", schedule_id: "sch-1", student_id: "learner-a", grade: null, teacher_feedback: null, status: "absent" },
    ],
    schedules: [{ id: "sch-1", class_id: "class-1", status: "scheduled" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  assertEqual(cards.length, 1, "5: mixed absent/present still one card");
  assertEqual(cards[0].status, "awaiting_feedback", "5: class stays pending");
  const a = cards[0].learners.find((l) => l.studentId === "learner-a");
  const b = cards[0].learners.find((l) => l.studentId === "learner-b");
  assertEqual(a?.attendanceStatus, "absent", "5: only A absent");
  assertEqual(b?.attendanceStatus == null || b?.attendanceStatus !== "absent", true, "5: B not absent");
  assertEqual(canShowTeacherFeedbackSubmit({ sessionStatus: cards[0].status, learners: cards[0].learners }), true, "5: B can still be graded");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", status: "absent" }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", status: "absent" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [
      { id: "att-a", schedule_id: "sch-1", student_id: "learner-a", grade: null, teacher_feedback: null, status: "absent" },
      { id: "att-b", schedule_id: "sch-1", student_id: "learner-b", grade: null, teacher_feedback: null, status: "absent" },
    ],
    schedules: [{ id: "sch-1", class_id: "class-1", status: "completed" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  assertEqual(cards.length, 1, "8: both absent → one card");
  assertEqual(cards[0].status, "completed", "8: reviewed after class completion");
  assertEqual(
    canShowAllAbsentSessionComplete({ sessionStatus: cards[0].status, learners: cards[0].learners }),
    false,
    "8: reviewed all-absent hides complete CTA"
  );
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({
        id: "sess-a",
        learner_id: "learner-a",
        class_id: "class-1",
        status: "completed",
        completion_rating: 4,
        teacher_feedback: "Solid work",
      }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", status: "awaiting_feedback" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [
      { id: "att-a", schedule_id: "sch-1", student_id: "learner-a", grade: 4, teacher_feedback: "Solid work", status: "present" },
    ],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const payload = buildTeacherFeedbackSubmitGrades({
    sessionId: cards[0].representativeSessionId || "sess-a",
    learners: cards[0].learners,
    drafts: {
      [feedbackDraftKey("sess-a", "learner-a")]: { grade: 1, feedback: "should not overwrite A" },
      [feedbackDraftKey("sess-b", "learner-b")]: { grade: 5, feedback: "Late feedback for B" },
    },
  });
  assertEqual(payload.find((row) => row.student_id === "learner-a")?.feedback, "Solid work", "9: A preserved with per-learner keys");
  assertEqual(payload.find((row) => row.student_id === "learner-b")?.feedback, "Late feedback for B", "9: B draft submitted");
  assertEqual(cards[0].status, "awaiting_feedback", "9: class remains pending");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1" })],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const b = cards[0].learners.find((l) => l.studentId === "learner-b");
  assertEqual(b?.mutationBlockedReason, "missing_session", "10: unlinked learner shown, blocked");
  assertEqual(canMutateLearnerOnCard({ scheduleAmbiguous: false, learner: b! }), false, "10: mutation disabled");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1" })],
    enrollments: [{ class_id: "class-1", student_id: "learner-a" }],
    attendance: [],
    schedules: [
      { id: "sch-1", class_id: "class-1" },
      { id: "sch-2", class_id: "class-1" },
    ],
    profiles: [{ id: "learner-a", full_name: "Ann", email: "a@x.com" }],
  });
  assertEqual(cards[0].scheduleAmbiguous, true, "11: ambiguous schedule flagged");
  assertEqual(canMutateLearnerOnCard({ scheduleAmbiguous: true, learner: cards[0].learners[0] }), false, "11: mutations blocked");
}

{
  const target = buildAbsentConfirmTarget({
    studentId: "learner-a",
    studentName: "Ann Lee",
    studentEmail: "a@x.com",
    sessionId: "sess-a",
    sprintId: "sp-a",
    sprintNumber: 5,
    enrollmentId: "enr-a",
    attendanceId: null,
    attendanceStatus: null,
    sessionStatus: "awaiting_feedback",
    grade: null,
    feedback: null,
    courseName: "English",
    mutationBlockedReason: null,
  });
  assertEqual(target.studentId, "learner-a", "12: confirm targets A");
  assertEqual(target.sessionId, "sess-a", "12: confirm uses A's session");
  assertEqual(target.studentName, "Ann Lee", "12: confirm includes name");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", status: "awaiting_feedback" }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", status: "in_progress" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const b = cards[0].learners.find((l) => l.studentId === "learner-b");
  assertEqual(cards.length, 1, "13: class with a feedback session still includes other statuses");
  assertEqual(b?.sessionId, "sess-b", "13: in_progress session is matched");
  assertEqual(b?.mutationBlockedReason, null, "13: in_progress is not a missing session");
  assertEqual(b?.sessionStatus, "in_progress", "13: original status is kept");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [session({ id: "sess-b", learner_id: "learner-b", class_id: "class-9", status: "in_progress" })],
    enrollments: [{ class_id: "class-9", student_id: "learner-b" }],
    attendance: [],
    schedules: [{ id: "sch-9", class_id: "class-9" }],
    profiles: [{ id: "learner-b", full_name: "Ben", email: "b@x.com" }],
  });
  assertEqual(cards.length, 0, "13b: a class with no feedback-ready session is not a feedback card");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", status: "awaiting_feedback" })],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const a = cards[0].learners.find((l) => l.studentId === "learner-a")!;
  const b = cards[0].learners.find((l) => l.studentId === "learner-b")!;
  const drafts = {
    [feedbackDraftKey(a.sessionId, a.studentId)]: { grade: 4, feedback: "Clear progress" },
    [feedbackDraftKey(b.sessionId, b.studentId)]: { grade: 3, feedback: "must not be sent" },
  };
  assertEqual(b.mutationBlockedReason, "missing_session", "14: B genuinely missing");
  assertEqual(b.sessionId, null, "14: B has no session id");
  assertEqual(cards[0].status, "awaiting_feedback", "14: class stays pending");
  assertEqual(
    canEnableTeacherGradeSubmit({ scheduleAmbiguous: false, learners: cards[0].learners, drafts }),
    true,
    "14: A unsaved grade enables submit"
  );
  const payload = buildTeacherFeedbackSubmitGrades({
    sessionId: cards[0].representativeSessionId || "sess-a",
    learners: cards[0].learners,
    drafts,
  });
  assertEqual(payload, [{ student_id: "learner-a", grade: 4, feedback: "Clear progress" }], "14: payload is only A's valid grade");
  assertEqual(payload.some((row) => row.student_id === "learner-b"), false, "14: B is not in the payload");
  assertEqual(feedbackBlockCopyKey(b.mutationBlockedReason, false), "feedback.unlinkedLearner", "14: missing copy");
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({
        id: "sess-a",
        learner_id: "learner-a",
        class_id: "class-1",
        status: "completed",
        completion_rating: 5,
        teacher_feedback: "Keep this",
      }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [
      { id: "att-a", schedule_id: "sch-1", student_id: "learner-a", grade: 5, teacher_feedback: "Keep this", status: "present" },
    ],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const payload = buildTeacherFeedbackSubmitGrades({
    sessionId: "sess-a",
    learners: cards[0].learners,
    drafts: {
      [feedbackDraftKey("sess-a", "learner-a")]: { grade: 1, feedback: "overwrite attempt" },
      [feedbackDraftKey(null, "learner-b")]: { grade: 2, feedback: "blocked draft" },
    },
  });
  assertEqual(payload, [{ student_id: "learner-a", grade: 5, feedback: "Keep this" }], "15: stored A is preserved and B is omitted");
  assertEqual(
    canEnableTeacherGradeSubmit({ scheduleAmbiguous: false, learners: cards[0].learners, drafts: {} }),
    false,
    "15: stored A and blocked B do not enable an empty submit"
  );
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", status: "awaiting_feedback" }),
      session({ id: "sess-b1", learner_id: "learner-b", class_id: "class-1", status: "awaiting_feedback" }),
      session({ id: "sess-b2", learner_id: "learner-b", class_id: "class-1", status: "completed" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const a = cards[0].learners.find((l) => l.studentId === "learner-a")!;
  const b = cards[0].learners.find((l) => l.studentId === "learner-b")!;
  assertEqual(a.sessionId, "sess-a", "16: A keeps the single session");
  assertEqual(b.sessionId, null, "16: duplicate learner has no chosen session");
  assertEqual(b.sprintId, null, "16: duplicate learner does not borrow a sprint");
  assertEqual(b.mutationBlockedReason, "duplicate_sessions", "16: duplicate reason");
  assertEqual(canMutateLearnerOnCard({ scheduleAmbiguous: false, learner: a }), true, "16: A remains editable");
  assertEqual(canMutateLearnerOnCard({ scheduleAmbiguous: false, learner: b }), false, "16: B stays blocked");
  assertEqual(feedbackBlockCopyKey(b.mutationBlockedReason, false), "feedback.duplicateSessions", "16: duplicate copy");
  const drafts = { [feedbackDraftKey(a.sessionId, a.studentId)]: { grade: 3, feedback: "A only" } };
  assertEqual(
    canEnableTeacherGradeSubmit({ scheduleAmbiguous: false, learners: cards[0].learners, drafts }),
    true,
    "16: duplicate classmate does not disable A"
  );
}

{
  const cards = groupTeacherFeedbackCards({
    sessions: [
      session({
        id: "sess-a",
        learner_id: "learner-a",
        class_id: "class-1",
        status: "completed",
        completion_rating: 4,
        teacher_feedback: "Solid",
      }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", status: "absent" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [
      { id: "att-a", schedule_id: "sch-1", student_id: "learner-a", grade: 4, teacher_feedback: "Solid", status: "present" },
      { id: "att-b", schedule_id: "sch-1", student_id: "learner-b", grade: null, teacher_feedback: null, status: "absent" },
    ],
    schedules: [{ id: "sch-1", class_id: "class-1", status: "completed" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const a = cards[0].learners.find((l) => l.studentId === "learner-a")!;
  const b = cards[0].learners.find((l) => l.studentId === "learner-b")!;
  assertEqual(cards[0].status, "completed", "17: graded A and absent B complete the card");
  assertEqual(a.sessionId, "sess-a", "17: A session kept");
  assertEqual(b.sessionId, "sess-b", "17: B absent session kept");
  assertEqual(b.attendanceStatus, "absent", "17: B stays absent");
  assertEqual(
    shouldShowTeacherGradeSubmit({ sessionStatus: cards[0].status, scheduleAmbiguous: false, learners: cards[0].learners }),
    false,
    "17: nothing new to grade"
  );
  const pendingA = groupTeacherFeedbackCards({
    sessions: [
      session({ id: "sess-a", learner_id: "learner-a", class_id: "class-1", status: "awaiting_feedback" }),
      session({ id: "sess-b", learner_id: "learner-b", class_id: "class-1", status: "absent" }),
    ],
    enrollments: [
      { class_id: "class-1", student_id: "learner-a" },
      { class_id: "class-1", student_id: "learner-b" },
    ],
    attendance: [
      { id: "att-b", schedule_id: "sch-1", student_id: "learner-b", grade: null, teacher_feedback: null, status: "absent" },
    ],
    schedules: [{ id: "sch-1", class_id: "class-1" }],
    profiles: [
      { id: "learner-a", full_name: "Ann", email: "a@x.com" },
      { id: "learner-b", full_name: "Ben", email: "b@x.com" },
    ],
  });
  const drafts = { [feedbackDraftKey("sess-a", "learner-a")]: { grade: 4, feedback: "After absence" } };
  assertEqual(
    canEnableTeacherGradeSubmit({ scheduleAmbiguous: false, learners: pendingA[0].learners, drafts }),
    true,
    "17: absent B does not block A's new grade"
  );
  assertEqual(
    buildTeacherFeedbackSubmitGrades({ sessionId: "sess-a", learners: pendingA[0].learners, drafts }),
    [{ student_id: "learner-a", grade: 4, feedback: "After absence" }],
    "17: absent B is omitted from the payload"
  );
}

{
  const empty = buildTeacherFeedbackSubmitGrades({
    sessionId: "sess-a",
    learners: [
      { studentId: "learner-a", sessionId: "sess-a", grade: null, feedback: null, attendanceStatus: null },
      { studentId: "learner-b", sessionId: null, grade: null, feedback: null, attendanceStatus: null, mutationBlockedReason: "missing_session" },
    ],
    drafts: {
      [feedbackDraftKey("sess-a", "learner-a")]: { grade: 3, feedback: "   " },
      [feedbackDraftKey(null, "learner-b")]: { grade: 0, feedback: "" },
    },
  });
  assertEqual(empty, [], "18: blank feedback and blocked learners produce no payload");
  assertEqual(
    canEnableTeacherGradeSubmit({
      scheduleAmbiguous: false,
      learners: [
        { studentId: "learner-a", sessionId: "sess-a", grade: null, feedback: null, attendanceStatus: null },
      ],
      drafts: { [feedbackDraftKey("sess-a", "learner-a")]: { grade: 3, feedback: "   " } },
    }),
    false,
    "18: blank draft does not enable submit"
  );
  const valid = buildTeacherFeedbackSubmitGrades({
    sessionId: "sess-a",
    learners: [{ studentId: "learner-a", sessionId: "sess-a", grade: null, feedback: null, attendanceStatus: null }],
    drafts: { [feedbackDraftKey("sess-a", "learner-a")]: { grade: 4, feedback: "  Ready  " } },
  });
  assertEqual(valid, [{ student_id: "learner-a", grade: 4, feedback: "Ready" }], "18: valid draft is trimmed");
  assertEqual(valid.every((row) => row.grade >= 1 && row.grade <= 5 && row.feedback.trim().length > 0), true, "18: payload rows are valid");
}

{
  const wrapping = [
    feedbackPanelLayoutClass.cardHeader,
    feedbackPanelLayoutClass.learnerStatusRow,
    feedbackPanelLayoutClass.actionRow,
    feedbackPanelLayoutClass.absentActionGroup,
  ];
  for (const className of wrapping) {
    assertEqual(feedbackLayoutWrapsOnlyOnNarrow(className), true, `19: ${className} wraps only below sm`);
  }
  assertEqual(feedbackPanelLayoutClass.cardHeaderStatus.includes("max-sm:w-full"), true, "19: header status drops to its own row on narrow");
  assertEqual(feedbackPanelLayoutClass.cardHeaderStatus.includes("flex-wrap"), false, "19: header status does not change the desktop row");
}

assertEqual(shouldAutoCompleteSessionAfterAbsent(), false, "never auto-complete after one absent");
assertEqual(
  canTeacherDiscoverFeedbackRow({
    teacherId,
    status: "absent",
    sessionType: "vietnamese_teacher",
    classId: "class-1",
  }),
  true,
  "8: class-linked absent is discoverable"
);
assertEqual(
  canTeacherDiscoverFeedbackRow({
    teacherId,
    status: "absent",
    sessionType: "vietnamese_teacher",
    classId: null,
  }),
  false,
  "3: standalone absent stays hidden"
);

console.log("teacherFeedback tests passed");
