export interface SprintSessionRatingRow {
  id: string;
  sprint_id: string;
  class_id: string | null;
  session_number: number;
  session_type: string | null;
  status: string | null;
  completion_rating: number | string | null;
}

export interface SessionAttendanceRatingRow {
  student_id: string;
  class_id: string | null;
  grade: number | string | null;
  status: string | null;
  teacher_feedback: string | null;
}

export interface LearnerRatingAggregate {
  learnerId: string;
  avgRating: number;
  totalRated: number;
}

/** Teacher feedback stores 1–5; absent/unrated rows use null or 0. */
export function parseValidTeacherRating(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) return null;
  return numeric;
}

export function isTeacherRatedLiveSession(session: Pick<
  SprintSessionRatingRow,
  "session_number" | "session_type" | "status"
>): boolean {
  if (session.session_number === 1) return false;
  if (session.session_type === "self_study") return false;
  if (session.status === "absent") return false;
  return true;
}

export function computeLearnerAverageRating(ratings: number[]): { avgRating: number; totalRated: number } {
  if (ratings.length === 0) {
    return { avgRating: 0, totalRated: 0 };
  }
  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return {
    avgRating: Math.round((sum / ratings.length) * 10) / 10,
    totalRated: ratings.length,
  };
}

/**
 * Aggregate per-learner average teacher ratings across all enrollments/sprints.
 * Prefers sprint_sessions.completion_rating; falls back to session_attendance.grade
 * for class sessions where the rating was saved before sprint sync completed.
 */
export function aggregateLearnerRatings(input: {
  sessions: SprintSessionRatingRow[];
  attendance: SessionAttendanceRatingRow[];
  sprintIdToEnrollmentId: Map<string, string>;
  enrollmentIdToLearnerId: Map<string, string>;
  activeLearnerIds: Set<string>;
}): Map<string, number[]> {
  const { sessions, attendance, sprintIdToEnrollmentId, enrollmentIdToLearnerId, activeLearnerIds } = input;

  const learnerSessionRatings = new Map<string, Map<string, number>>();

  const ensureLearner = (learnerId: string) => {
    if (!learnerSessionRatings.has(learnerId)) {
      learnerSessionRatings.set(learnerId, new Map());
    }
    return learnerSessionRatings.get(learnerId)!;
  };

  const resolveLearnerId = (sprintId: string): string | null => {
    const enrollmentId = sprintIdToEnrollmentId.get(sprintId);
    if (!enrollmentId) return null;
    return enrollmentIdToLearnerId.get(enrollmentId) || null;
  };

  // Map learner + class → sprint_session id (for attendance fallback without double-counting).
  const learnerClassSessionId = new Map<string, string>();
  sessions.forEach((session) => {
    if (!session.class_id || !isTeacherRatedLiveSession(session)) return;
    const learnerId = resolveLearnerId(session.sprint_id);
    if (!learnerId) return;
    learnerClassSessionId.set(`${learnerId}|${session.class_id}`, session.id);
  });

  sessions.forEach((session) => {
    if (!isTeacherRatedLiveSession(session)) return;

    const rating = parseValidTeacherRating(session.completion_rating);
    if (rating === null) return;

    const learnerId = resolveLearnerId(session.sprint_id);
    if (!learnerId || !activeLearnerIds.has(learnerId)) return;

    ensureLearner(learnerId).set(session.id, rating);
  });

  attendance.forEach((row) => {
    if (row.status === "absent") return;

    const rating = parseValidTeacherRating(row.grade);
    if (rating === null) return;
    if (!row.teacher_feedback || row.teacher_feedback.trim().length === 0) return;
    if (!row.student_id || !activeLearnerIds.has(row.student_id)) return;

    const sessionId =
      row.class_id != null ? learnerClassSessionId.get(`${row.student_id}|${row.class_id}`) : undefined;

    const learnerRatings = ensureLearner(row.student_id);
    if (sessionId) {
      if (!learnerRatings.has(sessionId)) {
        learnerRatings.set(sessionId, rating);
      }
      return;
    }

    // Legacy rows without class_id — keep a stable synthetic key so they still count once.
    const legacyKey = `attendance:${row.student_id}:${row.class_id ?? "none"}:${rating}`;
    if (!learnerRatings.has(legacyKey)) {
      learnerRatings.set(legacyKey, rating);
    }
  });

  const result = new Map<string, number[]>();
  activeLearnerIds.forEach((learnerId) => {
    const sessionMap = learnerSessionRatings.get(learnerId);
    result.set(learnerId, sessionMap ? [...sessionMap.values()] : []);
  });

  return result;
}

export function buildLearnerRatingAggregates(input: {
  sessions: SprintSessionRatingRow[];
  attendance: SessionAttendanceRatingRow[];
  sprintIdToEnrollmentId: Map<string, string>;
  enrollmentIdToLearnerId: Map<string, string>;
  activeLearnerIds: Set<string>;
}): LearnerRatingAggregate[] {
  const ratingsByLearner = aggregateLearnerRatings(input);

  return [...ratingsByLearner.entries()].map(([learnerId, ratings]) => ({
    learnerId,
    ...computeLearnerAverageRating(ratings),
  }));
}
