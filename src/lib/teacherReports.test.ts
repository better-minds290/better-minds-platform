import {
  buildStudentReports,
  buildTeacherReports,
  computeAvgRating,
  computeSprintProgress,
  extractEnrollmentIdsFromTeacherSessions,
  type CourseRow,
  type EnrollmentRow,
  type LearnerProfileRow,
  type RatedSessionRow,
  type SprintRow,
  type TeacherProfileRow,
  type TeacherSessionStatRow,
} from "./teacherReports";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const unknownName = "Unknown";

// 1. One teacher + one learner + multiple sprints
{
  const enrollmentId = "enr-1";
  const sprints: SprintRow[] = [
    { id: "sp-1", enrollment_id: enrollmentId, sprint_number: 1, status: "completed" },
    { id: "sp-2", enrollment_id: enrollmentId, sprint_number: 2, status: "active" },
    { id: "sp-3", enrollment_id: enrollmentId, sprint_number: 3, status: "locked" },
  ];
  const progress = computeSprintProgress(sprints);
  assertEqual(progress.total_sprints, 3, "one learner: total sprints");
  assertEqual(progress.completed_sprints, 1, "one learner: completed sprints");
  assertEqual(progress.current_sprint, 2, "one learner: current sprint");

  const reports = buildStudentReports({
    relevantEnrollmentIds: new Set([enrollmentId]),
    enrollments: [{ id: enrollmentId, learner_id: "learner-1", course_id: "course-1", status: "active" }],
    sprintsByEnrollment: new Map([[enrollmentId, sprints]]),
    ratedSessionsBySprint: new Map([
      ["sp-1", [{ sprint_id: "sp-1", completion_rating: 4 }]],
      ["sp-2", [{ sprint_id: "sp-2", completion_rating: 5 }]],
    ]),
    profilesById: new Map<string, LearnerProfileRow>([
      ["learner-1", { id: "learner-1", full_name: "Alice", email: "alice@example.com" }],
    ]),
    coursesById: new Map<string, CourseRow>([["course-1", { id: "course-1", name: "English B1" }]]),
    unknownName,
  });

  assertEqual(reports.length, 1, "one learner: one report row");
  assertEqual(reports[0].avg_rating, 4.5, "one learner: avg rating across sprint sessions");
  assertEqual(reports[0].current_sprint, 2, "one learner: current sprint in report");
}

// 2. One teacher + multiple learners
{
  const reports = buildStudentReports({
    relevantEnrollmentIds: new Set(["enr-a", "enr-b"]),
    enrollments: [
      { id: "enr-a", learner_id: "learner-a", course_id: "course-1", status: "active" },
      { id: "enr-b", learner_id: "learner-b", course_id: "course-1", status: "active" },
    ],
    sprintsByEnrollment: new Map([
      ["enr-a", [{ id: "sp-a", enrollment_id: "enr-a", sprint_number: 1, status: "active" }]],
      ["enr-b", [{ id: "sp-b", enrollment_id: "enr-b", sprint_number: 1, status: "completed" }]],
    ]),
    ratedSessionsBySprint: new Map(),
    profilesById: new Map<string, LearnerProfileRow>([
      ["learner-a", { id: "learner-a", full_name: "Bob", email: "bob@example.com" }],
      ["learner-b", { id: "learner-b", full_name: "Ann", email: "ann@example.com" }],
    ]),
    coursesById: new Map<string, CourseRow>([["course-1", { id: "course-1", name: "English B1" }]]),
    unknownName,
  });

  assertEqual(reports.length, 2, "multiple learners: two rows");
  assertEqual(reports.map((r) => r.learner_id).sort(), ["learner-a", "learner-b"], "multiple learners: ids");
}

// 3. Two teachers sharing the same learner — enrollment included only when relevant
{
  const enrollmentId = "enr-shared";
  const teacherASessions = extractEnrollmentIdsFromTeacherSessions([
    { sprint: { enrollment_id: enrollmentId } },
  ]);
  const teacherBSessions = extractEnrollmentIdsFromTeacherSessions([]);

  assertEqual([...teacherASessions], [enrollmentId], "teacher A sees shared enrollment");
  assertEqual([...teacherBSessions], [], "teacher B sees no enrollment without sessions");

  const teacherAReports = buildStudentReports({
    relevantEnrollmentIds: teacherASessions,
    enrollments: [{ id: enrollmentId, learner_id: "learner-shared", course_id: "course-1", status: "active" }],
    sprintsByEnrollment: new Map([
      [enrollmentId, [{ id: "sp-1", enrollment_id: enrollmentId, sprint_number: 1, status: "active" }]],
    ]),
    ratedSessionsBySprint: new Map(),
    profilesById: new Map<string, LearnerProfileRow>([
      ["learner-shared", { id: "learner-shared", full_name: "Shared Learner", email: "shared@example.com" }],
    ]),
    coursesById: new Map<string, CourseRow>([["course-1", { id: "course-1", name: "English B1" }]]),
    unknownName,
  });

  assertEqual(teacherAReports.length, 1, "shared learner appears for teaching teacher");
}

// 4. Multiple sessions in one sprint — ratings aggregate correctly
{
  const avg = computeAvgRating([
    { sprint_id: "sp-1", completion_rating: 4 },
    { sprint_id: "sp-1", completion_rating: 5 },
    { sprint_id: "sp-1", completion_rating: 3 },
  ]);
  assertEqual(avg, 4, "multiple rated sessions in one sprint");
}

// 5. Learner with no relevant session for current teacher — excluded
{
  const reports = buildStudentReports({
    relevantEnrollmentIds: new Set(["enr-visible"]),
    enrollments: [
      { id: "enr-visible", learner_id: "learner-1", course_id: "course-1", status: "active" },
      { id: "enr-hidden", learner_id: "learner-2", course_id: "course-1", status: "active" },
    ],
    sprintsByEnrollment: new Map([
      ["enr-visible", [{ id: "sp-1", enrollment_id: "enr-visible", sprint_number: 1, status: "active" }]],
      ["enr-hidden", [{ id: "sp-2", enrollment_id: "enr-hidden", sprint_number: 1, status: "active" }]],
    ]),
    ratedSessionsBySprint: new Map(),
    profilesById: new Map<string, LearnerProfileRow>(),
    coursesById: new Map<string, CourseRow>([["course-1", { id: "course-1", name: "English B1" }]]),
    unknownName,
  });

  assertEqual(reports.length, 1, "irrelevant enrollment excluded");
  assertEqual(reports[0].learner_id, "learner-1", "only relevant learner remains");
}

// 6. Teachers comparison aggregates independently from student rows
{
  const teachers: TeacherProfileRow[] = [
    { id: "teacher-a", full_name: "Teacher A" },
    { id: "teacher-b", full_name: "Teacher B" },
  ];
  const sessions: TeacherSessionStatRow[] = [
    { teacher_id: "teacher-a", completion_rating: 5, teacher_feedback: "Great", status: "completed" },
    { teacher_id: "teacher-a", completion_rating: null, teacher_feedback: null, status: "active" },
    { teacher_id: "teacher-b", completion_rating: 4, teacher_feedback: "Good", status: "completed" },
  ];

  const teacherReports = buildTeacherReports(teachers, sessions, unknownName);
  assertEqual(teacherReports.length, 2, "teacher comparison: all teachers");
  assertEqual(teacherReports[0].total_sessions, 2, "teacher A session count");
  assertEqual(teacherReports[0].completed_sessions, 1, "teacher A completed count");
  assertEqual(teacherReports[0].avg_rating_given, 5, "teacher A avg rating");
  assertEqual(teacherReports[1].total_feedbacks, 1, "teacher B feedback count");
}

// 7. No duplicate learner/enrollment rows
{
  const enrollmentId = "enr-dup";
  const reports = buildStudentReports({
    relevantEnrollmentIds: new Set([enrollmentId]),
    enrollments: [
      { id: enrollmentId, learner_id: "learner-1", course_id: "course-1", status: "active" },
      { id: enrollmentId, learner_id: "learner-1", course_id: "course-1", status: "active" },
    ],
    sprintsByEnrollment: new Map([
      [enrollmentId, [{ id: "sp-1", enrollment_id: enrollmentId, sprint_number: 1, status: "active" }]],
    ]),
    ratedSessionsBySprint: new Map(),
    profilesById: new Map<string, LearnerProfileRow>([
      ["learner-1", { id: "learner-1", full_name: "Alice", email: "alice@example.com" }],
    ]),
    coursesById: new Map<string, CourseRow>([["course-1", { id: "course-1", name: "English B1" }]]),
    unknownName,
  });

  assertEqual(reports.length, 1, "duplicate enrollment input yields one row");
}

console.log("teacherReports tests passed");
