import {
  aggregateLearnerRatings,
  buildLearnerRatingAggregates,
  computeLearnerAverageRating,
  parseValidTeacherRating,
  type SessionAttendanceRatingRow,
  type SprintSessionRatingRow,
} from "./learnerReports";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const activeLearners = new Set(["learner-1", "learner-2"]);
const enrollmentMap = new Map([
  ["enr-1", "learner-1"],
  ["enr-2", "learner-2"],
]);
const sprintEnrollmentMap = new Map([
  ["sp-1", "enr-1"],
  ["sp-2", "enr-1"],
  ["sp-3", "enr-2"],
]);

function baseInput(
  sessions: SprintSessionRatingRow[],
  attendance: SessionAttendanceRatingRow[] = []
) {
  return {
    sessions,
    attendance,
    sprintIdToEnrollmentId: sprintEnrollmentMap,
    enrollmentIdToLearnerId: enrollmentMap,
    activeLearnerIds: activeLearners,
  };
}

function liveSession(overrides: Partial<SprintSessionRatingRow> & Pick<SprintSessionRatingRow, "id" | "sprint_id">): SprintSessionRatingRow {
  return {
    class_id: null,
    session_number: 2,
    session_type: "vietnamese_teacher",
    status: "completed",
    completion_rating: null,
    ...overrides,
  };
}

// 1. One learner, one rating = correct average
{
  const aggregates = buildLearnerRatingAggregates(
    baseInput([
      liveSession({ id: "sess-1", sprint_id: "sp-1", completion_rating: 5 }),
    ])
  );
  const learner1 = aggregates.find((row) => row.learnerId === "learner-1");
  assertEqual(learner1?.avgRating, 5, "one rating average");
  assertEqual(learner1?.totalRated, 1, "one rating count");
}

// 2. Ratings 4 + 5 = 4.5
{
  const avg = computeLearnerAverageRating([4, 5]);
  assertEqual(avg.avgRating, 4.5, "4 and 5 average");
  assertEqual(avg.totalRated, 2, "4 and 5 count");
}

// 3. Ratings 4 + 5 + null = still 4.5
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-1", sprint_id: "sp-1", completion_rating: 4 }),
      liveSession({ id: "sess-2", sprint_id: "sp-2", completion_rating: 5 }),
      liveSession({ id: "sess-3", sprint_id: "sp-1", completion_rating: null }),
    ])
  );
  const avg = computeLearnerAverageRating(ratings.get("learner-1") || []);
  assertEqual(avg.avgRating, 4.5, "null rating ignored");
}

// 4. No rating = empty/no-rating state
{
  const aggregates = buildLearnerRatingAggregates(baseInput([]));
  const learner1 = aggregates.find((row) => row.learnerId === "learner-1");
  assertEqual(learner1?.avgRating, 0, "no ratings average");
  assertEqual(learner1?.totalRated, 0, "no ratings count");
}

// 5. Two learners = ratings do not mix
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-a", sprint_id: "sp-1", completion_rating: 4 }),
      liveSession({ id: "sess-b", sprint_id: "sp-3", completion_rating: 5 }),
    ])
  );
  assertEqual(computeLearnerAverageRating(ratings.get("learner-1") || []).avgRating, 4, "learner 1 isolated");
  assertEqual(computeLearnerAverageRating(ratings.get("learner-2") || []).avgRating, 5, "learner 2 isolated");
}

// 6. Multiple sprints for one learner = correct combined average
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-1", sprint_id: "sp-1", completion_rating: 4 }),
      liveSession({ id: "sess-2", sprint_id: "sp-2", completion_rating: 5 }),
    ])
  );
  assertEqual(computeLearnerAverageRating(ratings.get("learner-1") || []).avgRating, 4.5, "multi-sprint average");
}

// 7. Two sessions for same learner counted exactly once each (no join duplication)
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({
        id: "sess-class",
        sprint_id: "sp-1",
        class_id: "class-1",
        completion_rating: 4,
      }),
    ], [
      {
        student_id: "learner-1",
        class_id: "class-1",
        grade: 5,
        status: "present",
        teacher_feedback: "Great work",
      },
    ])
  );
  assertEqual(ratings.get("learner-1"), [4], "completion_rating preferred over attendance duplicate");
}

// 8. Self-study / session 1 excluded
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-1", sprint_id: "sp-1", session_number: 1, session_type: "self_study", completion_rating: 5 }),
      liveSession({ id: "sess-2", sprint_id: "sp-1", session_number: 2, completion_rating: 4 }),
    ])
  );
  assertEqual(ratings.get("learner-1"), [4], "session 1 excluded");
}

// 9. Absent / unrated session does not become score 0
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-absent", sprint_id: "sp-1", status: "absent", completion_rating: 0 }),
      liveSession({ id: "sess-live", sprint_id: "sp-2", completion_rating: 5 }),
    ], [
      {
        student_id: "learner-1",
        class_id: "class-x",
        grade: 0,
        status: "absent",
        teacher_feedback: "Absent",
      },
    ])
  );
  assertEqual(ratings.get("learner-1"), [5], "absent and zero grades excluded");
}

// 10. Per-learner aggregation across enrollments (existing Admin Reports semantics)
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-enr1", sprint_id: "sp-1", completion_rating: 4 }),
      liveSession({ id: "sess-enr1b", sprint_id: "sp-2", completion_rating: 5 }),
    ])
  );
  assertEqual(computeLearnerAverageRating(ratings.get("learner-1") || []).avgRating, 4.5, "same learner merged across enrollments");
}

// Attendance fallback when completion_rating not yet synced
{
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({
        id: "sess-pending",
        sprint_id: "sp-1",
        class_id: "class-1",
        status: "awaiting_feedback",
        completion_rating: null,
      }),
    ], [
      {
        student_id: "learner-1",
        class_id: "class-1",
        grade: 5,
        status: "present",
        teacher_feedback: "Excellent",
      },
    ])
  );
  assertEqual(ratings.get("learner-1"), [5], "attendance grade used when completion_rating missing");
}

// Numeric strings from Postgres are accepted
{
  assertEqual(parseValidTeacherRating("4"), 4, "string rating parsed");
  const ratings = aggregateLearnerRatings(
    baseInput([
      liveSession({ id: "sess-str", sprint_id: "sp-1", completion_rating: "5" }),
    ])
  );
  assertEqual(ratings.get("learner-1"), [5], "string completion_rating included");
}

console.log("learnerReports tests passed");
