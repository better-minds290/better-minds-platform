/**
 * Teacher Dashboard → Feedback discovery.
 * Parent sprint status is intentionally ignored: a completed sprint
 * does not hide a taught session that still needs teacher feedback.
 *
 * Group classes by class_id only (never sprint number). One class = one card.
 */

export type TeacherFeedbackLearner = {
  studentId?: string;
  sessionId?: string | null;
  grade: number | null;
  feedback?: string | null;
  attendanceStatus?: string | null;
};

export type FeedbackMutationBlock = "missing_session" | "ambiguous_schedule" | null;

export type FeedbackCardLearner = {
  studentId: string;
  studentName: string;
  studentEmail: string;
  sessionId: string | null;
  sprintId: string | null;
  sprintNumber: number | null;
  enrollmentId: string | null;
  attendanceId: string | null;
  attendanceStatus: string | null;
  sessionStatus: string | null;
  grade: number | null;
  feedback: string | null;
  courseName: string | null;
  mutationBlockedReason: FeedbackMutationBlock;
};

export type FeedbackCard = {
  cardId: string;
  classId: string | null;
  scheduleId: string | null;
  scheduleAmbiguous: boolean;
  representativeSessionId: string | null;
  sessionNumber: number;
  sessionType: string;
  scheduledAt: string | null;
  courseName: string;
  /** Card-level filter status: awaiting_feedback = pending, completed = reviewed. */
  status: "awaiting_feedback" | "completed";
  learners: FeedbackCardLearner[];
};

export type FeedbackSessionRow = {
  id: string;
  sprint_id: string;
  session_number: number;
  session_type: string;
  status: string;
  scheduled_at: string | null;
  class_id: string | null;
  teacher_id: string | null;
  completion_rating: number | null;
  teacher_feedback: string | null;
  feedback: string | null;
  sprint_number: number;
  enrollment_id: string | null;
  learner_id: string | null;
  course_name: string | null;
};

export type FeedbackEnrollmentRow = { class_id: string; student_id: string };
export type FeedbackAttendanceRow = {
  id: string;
  schedule_id: string;
  student_id: string;
  grade: number | null;
  teacher_feedback: string | null;
  status: string | null;
};
export type FeedbackScheduleRow = { id: string; class_id: string; status?: string | null };
export type FeedbackProfileRow = { id: string; full_name: string | null; email: string | null };

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

/** Class-linked absent sessions are included so all-absent classes can appear in Reviewed. */
export function canTeacherDiscoverFeedbackRow(input: {
  teacherId: string | null | undefined;
  status: string;
  sessionType: string | null | undefined;
  classId: string | null | undefined;
}): boolean {
  if (!input.teacherId) return false;
  if (input.sessionType === "self_study") return false;
  if (input.status === "awaiting_feedback" || input.status === "completed") return true;
  return input.status === "absent" && !!input.classId;
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
  if (input.learners.length === 0) return false;
  if (input.learners.some((learner) => !learner.studentId || !learner.sessionId)) return false;
  return input.learners.every((learner) => learner.attendanceStatus === "absent");
}

export function feedbackDraftKey(sessionId: string | null | undefined, studentId: string): string {
  return `${sessionId || "none"}_${studentId}`;
}

export function shouldAutoCompleteSessionAfterAbsent(): boolean {
  return false;
}

export function canMutateLearnerOnCard(input: {
  scheduleAmbiguous: boolean;
  learner: Pick<FeedbackCardLearner, "sessionId" | "mutationBlockedReason">;
}): boolean {
  if (input.scheduleAmbiguous) return false;
  if (!input.learner.sessionId) return false;
  if (input.learner.mutationBlockedReason) return false;
  return true;
}

export function buildAbsentConfirmTarget(learner: FeedbackCardLearner): {
  studentId: string;
  studentName: string;
  sessionId: string | null;
  sprintId: string | null;
  sprintNumber: number | null;
  enrollmentId: string | null;
} {
  return {
    studentId: learner.studentId,
    studentName: learner.studentName,
    sessionId: learner.sessionId,
    sprintId: learner.sprintId,
    sprintNumber: learner.sprintNumber,
    enrollmentId: learner.enrollmentId,
  };
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
      const key = feedbackDraftKey(learner.sessionId || input.sessionId, learner.studentId!);
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

function resolveSchedule(schedules: FeedbackScheduleRow[]): {
  scheduleId: string | null;
  scheduleAmbiguous: boolean;
  scheduleStatus: string | null;
} {
  if (schedules.length > 1) {
    return { scheduleId: null, scheduleAmbiguous: true, scheduleStatus: null };
  }
  if (schedules.length === 1) {
    return {
      scheduleId: schedules[0].id,
      scheduleAmbiguous: false,
      scheduleStatus: schedules[0].status || null,
    };
  }
  return { scheduleId: null, scheduleAmbiguous: false, scheduleStatus: null };
}

function deriveCardStatus(input: {
  learners: FeedbackCardLearner[];
  scheduleStatus: string | null;
}): "awaiting_feedback" | "completed" {
  if (input.learners.length === 0) return "awaiting_feedback";
  const unresolved = input.learners.some((learner) => !learner.sessionId);
  if (unresolved) return "awaiting_feedback";

  const allAbsent = input.learners.every((learner) => learner.attendanceStatus === "absent" || learner.sessionStatus === "absent");
  if (allAbsent) {
    return input.scheduleStatus === "completed" ? "completed" : "awaiting_feedback";
  }

  const allHandled = input.learners.every((learner) => {
    if (learner.attendanceStatus === "absent" || learner.sessionStatus === "absent") return true;
    if (learner.sessionStatus === "completed" && learner.grade !== null) return true;
    return false;
  });
  if (allHandled) return "completed";
  return "awaiting_feedback";
}

function buildLearnerFromSession(
  session: FeedbackSessionRow,
  attendance: FeedbackAttendanceRow | undefined,
  profile: FeedbackProfileRow | undefined,
  mutationBlockedReason: FeedbackMutationBlock
): FeedbackCardLearner {
  const grade = attendance?.grade ?? session.completion_rating ?? null;
  const feedback = attendance?.teacher_feedback ?? session.teacher_feedback ?? session.feedback ?? null;
  return {
    studentId: session.learner_id || "",
    studentName: profile?.full_name || "",
    studentEmail: profile?.email || "",
    sessionId: session.id,
    sprintId: session.sprint_id,
    sprintNumber: session.sprint_number,
    enrollmentId: session.enrollment_id,
    attendanceId: attendance?.id || null,
    attendanceStatus: attendance?.status || (session.status === "absent" ? "absent" : null),
    sessionStatus: session.status,
    grade,
    feedback,
    courseName: session.course_name,
    mutationBlockedReason,
  };
}

export function groupTeacherFeedbackCards(input: {
  sessions: FeedbackSessionRow[];
  enrollments: FeedbackEnrollmentRow[];
  attendance: FeedbackAttendanceRow[];
  schedules: FeedbackScheduleRow[];
  profiles: FeedbackProfileRow[];
  fallbackName?: string;
}): FeedbackCard[] {
  const fallbackName = input.fallbackName || "Unknown";
  const profileMap = new Map(input.profiles.map((p) => [p.id, p]));
  const enrollmentsByClass = new Map<string, FeedbackEnrollmentRow[]>();
  input.enrollments.forEach((row) => {
    const list = enrollmentsByClass.get(row.class_id) || [];
    list.push(row);
    enrollmentsByClass.set(row.class_id, list);
  });
  const schedulesByClass = new Map<string, FeedbackScheduleRow[]>();
  input.schedules.forEach((row) => {
    const list = schedulesByClass.get(row.class_id) || [];
    list.push(row);
    schedulesByClass.set(row.class_id, list);
  });

  const withClass: FeedbackSessionRow[] = [];
  const standalone: FeedbackSessionRow[] = [];
  input.sessions.forEach((session) => {
    if (session.session_type === "self_study") return;
    if (session.class_id) {
      withClass.push(session);
    } else if (session.status === "awaiting_feedback" || session.status === "completed") {
      standalone.push(session);
    }
  });

  const cards: FeedbackCard[] = [];
  const classIds = [...new Set(withClass.map((s) => s.class_id!))];

  for (const classId of classIds) {
    const classSessions = withClass.filter((s) => s.class_id === classId);
    const { scheduleId, scheduleAmbiguous, scheduleStatus } = resolveSchedule(schedulesByClass.get(classId) || []);
    const attendanceForSchedule = scheduleId
      ? input.attendance.filter((row) => row.schedule_id === scheduleId)
      : [];
    const attendanceByStudent = new Map(attendanceForSchedule.map((row) => [row.student_id, row]));

    const sessionsByLearner = new Map<string, FeedbackSessionRow[]>();
    classSessions.forEach((session) => {
      if (!session.learner_id) return;
      const list = sessionsByLearner.get(session.learner_id) || [];
      list.push(session);
      sessionsByLearner.set(session.learner_id, list);
    });

    const rosterIds = new Set<string>();
    (enrollmentsByClass.get(classId) || []).forEach((row) => rosterIds.add(row.student_id));
    classSessions.forEach((session) => {
      if (session.learner_id) rosterIds.add(session.learner_id);
    });

    const learners: FeedbackCardLearner[] = [];
    rosterIds.forEach((studentId) => {
      const learnerSessions = sessionsByLearner.get(studentId) || [];
      const profile = profileMap.get(studentId);
      const att = attendanceByStudent.get(studentId);
      if (learnerSessions.length === 1) {
        const built = buildLearnerFromSession(
          learnerSessions[0],
          att,
          profile,
          scheduleAmbiguous ? "ambiguous_schedule" : null
        );
        if (!built.studentName) built.studentName = fallbackName;
        learners.push(built);
      } else if (learnerSessions.length === 0) {
        learners.push({
          studentId,
          studentName: profile?.full_name || fallbackName,
          studentEmail: profile?.email || "",
          sessionId: null,
          sprintId: null,
          sprintNumber: null,
          enrollmentId: null,
          attendanceId: att?.id || null,
          attendanceStatus: att?.status || null,
          sessionStatus: null,
          grade: att?.grade ?? null,
          feedback: att?.teacher_feedback ?? null,
          courseName: classSessions[0]?.course_name || null,
          mutationBlockedReason: scheduleAmbiguous ? "ambiguous_schedule" : "missing_session",
        });
      } else {
        const built = buildLearnerFromSession(
          learnerSessions[0],
          att,
          profile,
          "missing_session"
        );
        built.sessionId = null;
        built.mutationBlockedReason = "missing_session";
        if (!built.studentName) built.studentName = fallbackName;
        learners.push(built);
      }
    });

    learners.sort((a, b) => a.studentName.localeCompare(b.studentName));
    const prototype = classSessions[0];
    const resolved = learners.find((learner) => learner.sessionId);
    const status = deriveCardStatus({ learners, scheduleStatus });
    cards.push({
      cardId: `class:${classId}`,
      classId,
      scheduleId,
      scheduleAmbiguous,
      representativeSessionId: resolved?.sessionId || prototype.id,
      sessionNumber: prototype.session_number,
      sessionType: prototype.session_type,
      scheduledAt: prototype.scheduled_at,
      courseName: prototype.course_name || fallbackName,
      status,
      learners,
    });
  }

  for (const session of standalone) {
    const profile = session.learner_id ? profileMap.get(session.learner_id) : undefined;
    const learner: FeedbackCardLearner = {
      studentId: session.learner_id || "",
      studentName: profile?.full_name || fallbackName,
      studentEmail: profile?.email || "",
      sessionId: session.id,
      sprintId: session.sprint_id,
      sprintNumber: session.sprint_number,
      enrollmentId: session.enrollment_id,
      attendanceId: null,
      attendanceStatus: session.status === "absent" ? "absent" : null,
      sessionStatus: session.status,
      grade: session.completion_rating,
      feedback: session.teacher_feedback || session.feedback,
      courseName: session.course_name,
      mutationBlockedReason: null,
    };
    cards.push({
      cardId: `session:${session.id}`,
      classId: null,
      scheduleId: null,
      scheduleAmbiguous: false,
      representativeSessionId: session.id,
      sessionNumber: session.session_number,
      sessionType: session.session_type,
      scheduledAt: session.scheduled_at,
      courseName: session.course_name || fallbackName,
      status: session.status === "completed" ? "completed" : "awaiting_feedback",
      learners: learner.studentId ? [learner] : [],
    });
  }

  return cards;
}
