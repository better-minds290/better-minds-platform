import {
  absenceEventYmd,
  aggregateMonthlyAbsences,
  aggregateMonthlyRatings,
  aggregateMonthlySprints,
  buildMonthlyAdminReport,
  buildMonthlyHonor,
  buildMonthlyTeacherHours,
  currentVietnamMonthYear,
  isTimestampInVietnamMonth,
  monthlyAbsenceStatus,
  monthlyReportFilename,
  monthlyReportHasActivity,
  systemAverageOfLearnerAverages,
  vietnamMonthBounds,
  writeMonthlyReportWorkbook,
  type MonthlyProfile,
  type MonthlyReportLabels,
  type MonthlyReportSources,
} from "./adminMonthlyReport";
import type { TeachingSessionUnit } from "./teacherHours";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

const labels: MonthlyReportLabels = {
  sheets: {
    summary: "Summary",
    absence: "Absence Summary",
    hours: "Teacher Working Hours",
    sprints: "Sprints Completed",
    ratings: "Average Ratings",
    honor: "Teacher Honor",
  },
  summary: {
    metric: "Metric",
    value: "Value",
    month: "Month",
    timezone: "Timezone",
    sessionsTaught: "Sessions Taught",
    teachingHours: "Teaching Hours",
    sprintsCompleted: "Sprints Completed",
    averageRating: "Average Rating",
    absenceEvents: "Absence Events",
    criticalAbsenceRows: "Critical Absence Rows",
    teachersCounted: "Teachers Counted",
    learnersCounted: "Learners Counted",
    notes: "Notes",
    notesText:
      "This workbook is for the selected month. Table searches on the Reports page are not applied. Absence counts in this workbook are monthly events, not lifetime cumulative.",
  },
  columns: {
    learner: "Learner",
    email: "Email",
    course: "Course",
    absenceCountMonth: "Absence Count (Month)",
    unresolvedMonth: "Unresolved (Month)",
    status: "Status",
    latestDate: "Latest Date",
    teacher: "Teacher",
    role: "Role",
    sessionsTaught: "Sessions Taught",
    teachingHours: "Teaching Hours",
    bookedSessions: "Booked Sessions",
    completedThisMonth: "Completed This Month",
    sprintNumbers: "Sprint Numbers",
    avgRating: "Avg Rating",
    ratingCount: "Rating Count",
    rank: "Rank",
  },
  status: { critical: "Critical", unresolved: "Unresolved", normal: "Normal" },
  roles: { vietnameseTeacher: "VN Teacher", foreignTeacher: "Foreign Teacher" },
  unknownCourse: "Unknown course",
  unknownName: "Unknown",
};

const learnerA: MonthlyProfile = {
  id: "learner-a",
  name: "Nguyễn Thị Ánh",
  email: "anh@example.com",
  role: "learner",
  isActive: true,
};
const learnerB: MonthlyProfile = {
  id: "learner-b",
  name: "Trần Văn Bình",
  email: "binh@example.com",
  role: "learner",
  isActive: true,
};
const inactiveLearner: MonthlyProfile = {
  id: "learner-inactive",
  name: "Inactive",
  email: "off@example.com",
  role: "learner",
  isActive: false,
};
const teacherA: MonthlyProfile = {
  id: "teacher-a",
  name: "Cô Mai",
  email: "mai@example.com",
  role: "vietnamese_teacher",
  isActive: true,
};
const teacherB: MonthlyProfile = {
  id: "teacher-b",
  name: "Mr Smith",
  email: "smith@example.com",
  role: "foreign_teacher",
  isActive: true,
};

function unit(overrides: Partial<TeachingSessionUnit> & Pick<TeachingSessionUnit, "key" | "teacherId">): TeachingSessionUnit {
  return {
    date: "2026-09-10",
    durationHours: 1,
    booked: true,
    taught: true,
    ...overrides,
  };
}

function emptySources(overrides: Partial<MonthlyReportSources> = {}): MonthlyReportSources {
  return {
    year: 2026,
    month: 9,
    units: [],
    teachers: [teacherA, teacherB],
    learners: [learnerA, learnerB, inactiveLearner],
    absences: [],
    sprints: [],
    enrollments: [],
    courses: [],
    ratingSessions: [],
    ratingAttendance: [],
    ...overrides,
  };
}

// Month boundaries
{
  const dec = vietnamMonthBounds(2026, 12);
  assertEqual(dec.range, { start: "2026-12-01", end: "2026-12-31" }, "December 2026 range");
  assertEqual(dec.startIso, "2026-12-01T00:00:00+07:00", "December start ISO");
  assertEqual(dec.endExclusiveIso, "2027-01-01T00:00:00+07:00", "December exclusive end is January");

  const jan = vietnamMonthBounds(2027, 1);
  assertEqual(jan.range, { start: "2027-01-01", end: "2027-01-31" }, "January 2027 range");
  assertEqual(jan.startIso, "2027-01-01T00:00:00+07:00", "January start ISO");

  const leap = vietnamMonthBounds(2024, 2);
  assertEqual(leap.range.end, "2024-02-29", "February 2024 leap day");
  assertEqual(leap.endExclusiveIso, "2024-03-01T00:00:00+07:00", "leap exclusive end");

  const nonLeap = vietnamMonthBounds(2025, 2);
  assertEqual(nonLeap.range.end, "2025-02-28", "February 2025 last day");
}

{
  const range = vietnamMonthBounds(2026, 9).range;
  assertEqual(isTimestampInVietnamMonth("2026-08-31T23:30:00+07:00", range), false, "Aug 31 23:30 VN not September");
  assertEqual(isTimestampInVietnamMonth("2026-09-01T00:00:00+07:00", range), true, "Sep 1 00:00 VN is September");
  assertEqual(isTimestampInVietnamMonth("2026-09-30T23:59:00+07:00", range), true, "Sep 30 23:59 VN is September");
  assertEqual(isTimestampInVietnamMonth("2026-10-01T00:00:00+07:00", range), false, "Oct 1 00:00 VN not September");
  assertEqual(isTimestampInVietnamMonth(null, range), false, "null timestamp excluded");
}

{
  assertEqual(absenceEventYmd({ date: "2026-09-05" }), "2026-09-05", "stored date used as-is");
  assertEqual(
    absenceEventYmd({ date: null, createdAt: "2026-09-05T01:00:00+07:00" }),
    "2026-09-05",
    "created_at fallback when date missing"
  );
}

{
  assertEqual(monthlyAbsenceStatus(4, 4), "unresolved", "4 absences not critical");
  assertEqual(monthlyAbsenceStatus(5, 0), "critical", "5 absences critical");
  assertEqual(monthlyAbsenceStatus(2, 0), "normal", "2 resolved absences normal");
}

{
  assertEqual(monthlyReportFilename(2026, 9), "better-minds-monthly-report-2026-09.xlsx", "filename");
  const vn = currentVietnamMonthYear(new Date("2026-09-05T01:00:00+07:00"));
  assertEqual(vn, { year: 2026, month: 9 }, "Vietnam default month not browser-local guess");
}

// Empty month
{
  const report = buildMonthlyAdminReport(emptySources(), labels);
  assertEqual(report.absences.length, 0, "empty absences");
  assertEqual(report.teacherHours.length, 0, "empty hours");
  assertEqual(report.sprints.length, 0, "empty sprints");
  assertEqual(report.ratings.length, 0, "empty ratings");
  assertEqual(report.honor.length, 0, "empty honor");
  assertEqual(report.summary.sessionsTaught, 0, "empty sessions");
  assertEqual(report.summary.averageRating, 0, "empty average");
  assertEqual(monthlyReportHasActivity(report), false, "empty has no activity");
}

// One learner / multiple learners / multiple courses / Unicode
{
  const range = vietnamMonthBounds(2026, 9).range;
  const absences = aggregateMonthlyAbsences(
    [
      {
        learnerId: "learner-a",
        enrollmentId: "enr-eng",
        courseName: "English",
        learnerName: "Nguyễn Thị Ánh",
        date: "2026-09-02",
        createdAt: "2026-09-02T10:00:00+07:00",
        resolved: false,
      },
      {
        learnerId: "learner-a",
        enrollmentId: "enr-math",
        courseName: "Toán",
        learnerName: "Nguyễn Thị Ánh",
        date: "2026-09-08",
        createdAt: "2026-09-08T10:00:00+07:00",
        resolved: true,
      },
      {
        learnerId: "learner-b",
        enrollmentId: "enr-eng-b",
        courseName: "English",
        learnerName: "Trần Văn Bình",
        date: "2026-08-20",
        createdAt: "2026-08-20T10:00:00+07:00",
        resolved: false,
      },
      {
        learnerId: "learner-inactive",
        enrollmentId: "enr-off",
        courseName: "English",
        learnerName: "Inactive",
        date: "2026-09-03",
        createdAt: "2026-09-03T10:00:00+07:00",
        resolved: false,
      },
    ],
    range,
    new Map([
      [learnerA.id, learnerA],
      [learnerB.id, learnerB],
      [inactiveLearner.id, inactiveLearner],
    ]),
    "Unknown course",
    "Unknown"
  );
  assertEqual(absences.length, 2, "two learner+course rows in September");
  assertEqual(absences[0].learnerName, "Nguyễn Thị Ánh", "Unicode learner name");
  assert(
    absences.some((row) => row.courseName === "English") && absences.some((row) => row.courseName === "Toán"),
    "same learner stays separated by course"
  );
  assert(!absences.some((row) => row.learnerId === "learner-b"), "August absence excluded");
  assert(!absences.some((row) => row.learnerId === "learner-inactive"), "inactive learner excluded");
}

// Absence 4 vs 5
{
  const range = vietnamMonthBounds(2026, 9).range;
  const four = Array.from({ length: 4 }, (_, i) => ({
    learnerId: "learner-a",
    enrollmentId: "enr-eng",
    courseName: "English",
    learnerName: learnerA.name,
    date: `2026-09-0${i + 1}`,
    createdAt: `2026-09-0${i + 1}T10:00:00+07:00`,
    resolved: false,
  }));
  const fourRows = aggregateMonthlyAbsences(
    four,
    range,
    new Map([[learnerA.id, learnerA]]),
    "Unknown course",
    "Unknown"
  );
  assertEqual(fourRows[0].status, "unresolved", "4 monthly absences not critical");

  const fiveRows = aggregateMonthlyAbsences(
    [
      ...four,
      {
        learnerId: "learner-a",
        enrollmentId: "enr-eng",
        courseName: "English",
        learnerName: learnerA.name,
        date: "2026-09-05",
        createdAt: "2026-09-05T10:00:00+07:00",
        resolved: false,
      },
    ],
    range,
    new Map([[learnerA.id, learnerA]]),
    "Unknown course",
    "Unknown"
  );
  assertEqual(fiveRows[0].status, "critical", "5 monthly absences critical");
  assertEqual(fiveRows[0].absenceCount, 5, "monthly count is 5");
}

// Multiple teachers + honor sort
{
  const range = vietnamMonthBounds(2026, 9).range;
  const units = [
    unit({ key: "s1", teacherId: "teacher-a", date: "2026-09-04", durationHours: 2, taught: true }),
    unit({ key: "s2", teacherId: "teacher-b", date: "2026-09-05", durationHours: 1, taught: true }),
    unit({ key: "s3", teacherId: "teacher-b", date: "2026-08-05", durationHours: 8, taught: true }),
    unit({ key: "s4", teacherId: "teacher-a", date: "2026-09-06", durationHours: 1, taught: false }),
  ];
  const teachers = new Map([
    [teacherA.id, teacherA],
    [teacherB.id, teacherB],
  ]);
  const hours = buildMonthlyTeacherHours(units, range, teachers, "Unknown");
  assertEqual(hours.length, 2, "two teachers with September activity");
  assertEqual(hours[0].teacherId, "teacher-a", "hours sorted by teaching hours");
  assertEqual(hours[0].taughtSessions, 1, "teacher-a taught 1");
  assertEqual(hours[0].bookedSessions, 2, "teacher-a booked 2 including untaught");
  assertEqual(hours[0].teachingHours, 2, "teacher-a hours from taught only");

  const honor = buildMonthlyHonor(units, range, teachers, "Unknown");
  assertEqual(honor.map((row) => row.teacherId), ["teacher-a", "teacher-b"], "honor rank order");
  assertEqual(honor[0].rank, 1, "rank 1");
  assertEqual(honor[0].teachingHours, 2, "honor hours monthly only");
}

// Sprints: completed once, null completed_at excluded, multi-course
{
  const range = vietnamMonthBounds(2026, 9).range;
  const rows = aggregateMonthlySprints(
    [
      { id: "sp-1", enrollmentId: "enr-eng", sprintNumber: 3, status: "completed", completedAt: "2026-09-12T09:00:00+07:00" },
      { id: "sp-1", enrollmentId: "enr-eng", sprintNumber: 3, status: "completed", completedAt: "2026-09-12T09:00:00+07:00" },
      { id: "sp-2", enrollmentId: "enr-math", sprintNumber: 1, status: "completed", completedAt: "2026-09-18T09:00:00+07:00" },
      { id: "sp-3", enrollmentId: "enr-eng", sprintNumber: 2, status: "completed", completedAt: null },
      { id: "sp-4", enrollmentId: "enr-eng", sprintNumber: 4, status: "completed", completedAt: "2026-08-12T09:00:00+07:00" },
      { id: "sp-5", enrollmentId: "enr-eng-b", sprintNumber: 1, status: "completed", completedAt: "2026-09-20T09:00:00+07:00" },
    ],
    range,
    new Map([
      ["enr-eng", { id: "enr-eng", learnerId: "learner-a", courseId: "c-eng" }],
      ["enr-math", { id: "enr-math", learnerId: "learner-a", courseId: "c-math" }],
      ["enr-eng-b", { id: "enr-eng-b", learnerId: "learner-b", courseId: "c-eng" }],
    ]),
    new Map([
      ["c-eng", { id: "c-eng", name: "English" }],
      ["c-math", { id: "c-math", name: "Toán" }],
    ]),
    new Map([
      [learnerA.id, learnerA],
      [learnerB.id, learnerB],
    ]),
    "Unknown course",
    "Unknown"
  );
  const anhEng = rows.find((row) => row.learnerId === "learner-a" && row.courseName === "English");
  const anhMath = rows.find((row) => row.learnerId === "learner-a" && row.courseName === "Toán");
  assertEqual(anhEng?.completedThisMonth, 1, "duplicate sprint id counted once");
  assertEqual(anhEng?.sprintNumbers, "3", "sprint numbers");
  assertEqual(anhMath?.completedThisMonth, 1, "second course separate");
  assertEqual(rows.length, 3, "two courses for Anh + one for Binh");
}

// Ratings: in-month only, no ratings, unweighted average
{
  const range = vietnamMonthBounds(2026, 9).range;
  const none = aggregateMonthlyRatings(
    [],
    [],
    range,
    new Map(),
    new Map(),
    new Map([[learnerA.id, learnerA]]),
    "Unknown"
  );
  assertEqual(none.length, 0, "no ratings sheet rows");

  const ratings = aggregateMonthlyRatings(
    [
      {
        id: "sess-1",
        sprint_id: "sp-1",
        class_id: "c1",
        session_number: 2,
        session_type: "vietnamese_teacher",
        status: "completed",
        completion_rating: 5,
        completedAt: "2026-09-10T18:00:00+07:00",
      },
      {
        id: "sess-2",
        sprint_id: "sp-1",
        class_id: "c2",
        session_number: 3,
        session_type: "foreign_teacher",
        status: "completed",
        completion_rating: 3,
        completedAt: "2026-09-20T18:00:00+07:00",
      },
      {
        id: "sess-old",
        sprint_id: "sp-1",
        class_id: "c3",
        session_number: 2,
        session_type: "vietnamese_teacher",
        status: "completed",
        completion_rating: 1,
        completedAt: "2026-08-10T18:00:00+07:00",
      },
    ],
    [],
    range,
    new Map([["sp-1", "enr-eng"]]),
    new Map([["enr-eng", "learner-a"]]),
    new Map([[learnerA.id, learnerA]]),
    "Unknown"
  );
  assertEqual(ratings.length, 1, "one rated learner");
  assertEqual(ratings[0].avgRating, 4, "September 5+3 average, August 1 excluded");
  assertEqual(ratings[0].totalRated, 2, "two September ratings");
  assertEqual(ratings[0].learnerName, "Nguyễn Thị Ánh", "rating unicode name");
}

{
  assertEqual(systemAverageOfLearnerAverages([{ avgRating: 5 }, { avgRating: 3 }]), 4, "unweighted learner averages");
  assertEqual(systemAverageOfLearnerAverages([{ avgRating: 0 }]), 0, "zeros ignored");
}

// Full report + search cannot shrink export (API takes no search)
{
  const report = buildMonthlyAdminReport(
    emptySources({
      units: [unit({ key: "s1", teacherId: "teacher-a" })],
      absences: [
        {
          learnerId: "learner-a",
          enrollmentId: "enr-eng",
          courseName: "English",
          learnerName: learnerA.name,
          date: "2026-09-02",
          createdAt: "2026-09-02T10:00:00+07:00",
          resolved: false,
        },
        {
          learnerId: "learner-b",
          enrollmentId: "enr-eng-b",
          courseName: "English",
          learnerName: learnerB.name,
          date: "2026-09-03",
          createdAt: "2026-09-03T10:00:00+07:00",
          resolved: false,
        },
      ],
      sprints: [
        {
          id: "sp-1",
          enrollmentId: "enr-eng",
          sprintNumber: 2,
          status: "completed",
          completedAt: "2026-09-12T09:00:00+07:00",
        },
      ],
      enrollments: [{ id: "enr-eng", learnerId: "learner-a", courseId: "c-eng" }],
      courses: [{ id: "c-eng", name: "English" }],
    }),
    labels
  );
  const uiSearch = "bình";
  const uiFiltered = report.absences.filter((row) =>
    row.learnerName.toLowerCase().includes(uiSearch)
  );
  assertEqual(uiFiltered.length, 1, "UI search would hide one absence row");
  assertEqual(report.absences.length, 2, "export still contains both absence rows");
  assertEqual(report.summary.absenceEvents, 2, "summary uses unfiltered monthly rows");
  assertEqual(report.summary.timezone, "Asia/Ho_Chi_Minh", "timezone label");
}

// Workbook: 6 sheets, empty headers kept, formula-safe names
{
  const report = buildMonthlyAdminReport(
    emptySources({
      units: [unit({ key: "s1", teacherId: "teacher-a", durationHours: 1.5 })],
      absences: [
        {
          learnerId: "learner-a",
          enrollmentId: "enr-eng",
          courseName: "=HYPERLINK(\"http://x\",\"x\")",
          learnerName: learnerA.name,
          date: "2026-09-02",
          createdAt: "2026-09-02T10:00:00+07:00",
          resolved: false,
        },
      ],
      sprints: [
        {
          id: "sp-1",
          enrollmentId: "enr-eng",
          sprintNumber: 2,
          status: "completed",
          completedAt: "2026-09-12T09:00:00+07:00",
        },
      ],
      enrollments: [{ id: "enr-eng", learnerId: "learner-a", courseId: "c-eng" }],
      courses: [{ id: "c-eng", name: "English" }],
      ratingSessions: [
        {
          id: "sess-1",
          sprint_id: "sp-1",
          class_id: null,
          session_number: 2,
          session_type: "vietnamese_teacher",
          status: "completed",
          completion_rating: 4,
          completedAt: "2026-09-12T10:00:00+07:00",
        },
      ],
    }),
    labels
  );

  const { filename, buffer } = await writeMonthlyReportWorkbook(report, labels);
  assertEqual(filename, "better-minds-monthly-report-2026-09.xlsx", "workbook filename");
  assert(buffer.byteLength > 0, "workbook buffer written");

  const excelMod = await import("exceljs");
  const ExcelJS = (excelMod as { default?: { Workbook: new () => any } }).default ?? excelMod;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assertEqual(
    workbook.worksheets.map((sheet: { name: string }) => sheet.name),
    [
      "Summary",
      "Absence Summary",
      "Teacher Working Hours",
      "Sprints Completed",
      "Average Ratings",
      "Teacher Honor",
    ],
    "six sheets in order"
  );

  const empty = await writeMonthlyReportWorkbook(buildMonthlyAdminReport(emptySources(), labels), labels);
  const emptyBook = new ExcelJS.Workbook();
  await emptyBook.xlsx.load(empty.buffer);
  assertEqual(emptyBook.worksheets.length, 6, "empty month still has 6 sheets");
  emptyBook.worksheets.forEach((sheet: { name: string; rowCount: number }) => {
    assert(sheet.rowCount >= 1, `${sheet.name} keeps header`);
  });
}

console.log("adminMonthlyReport tests passed");
