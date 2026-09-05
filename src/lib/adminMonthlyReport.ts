import type { SupabaseClient } from "@supabase/supabase-js";
import { addCalendarDays, getVietnamDateParts, toVietnamDateStr, VN_TIMEZONE } from "./datetime";
import { sanitizeExcelText } from "./excelSanitize";
import {
  buildLearnerRatingAggregates,
  type SessionAttendanceRatingRow,
  type SprintSessionRatingRow,
} from "./learnerReports";
import {
  buildTeachingSessionUnits,
  fetchPaginated,
  fetchTeacherWeeklyWorkloadSource,
  honorDateRangeYmd,
  isDateInRangeYmd,
  summarizeTeacherHours,
  taughtUnitsInHonorPeriod,
  type DateRangeYmd,
  type TeachingSessionUnit,
} from "./teacherHours";

export const MONTHLY_ABSENCE_LIMIT = 5;
export const MONTHLY_REPORT_TIMEZONE = VN_TIMEZONE;

const IN_CHUNK = 200;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}/;

export interface MonthlyProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export interface MonthlyAbsenceEvent {
  learnerId: string;
  enrollmentId: string | null;
  courseName: string | null;
  learnerName: string | null;
  date: string | null;
  createdAt: string | null;
  resolved: boolean;
}

export interface MonthlySprintRow {
  id: string;
  enrollmentId: string;
  sprintNumber: number | null;
  status: string | null;
  completedAt: string | null;
}

export interface MonthlyEnrollmentRow {
  id: string;
  learnerId: string;
  courseId: string | null;
}

export interface MonthlyCourseRow {
  id: string;
  name: string | null;
}

export interface MonthlyRatingSessionRow extends SprintSessionRatingRow {
  completedAt: string | null;
}

export interface MonthlyAttendanceRatingRow extends SessionAttendanceRatingRow {
  markedAt: string | null;
}

export interface MonthlyAbsenceExportRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  courseName: string;
  absenceCount: number;
  unresolvedCount: number;
  status: "critical" | "unresolved" | "normal";
  latestDate: string | null;
}

export interface MonthlyTeacherHoursExportRow {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  teacherRole: string;
  taughtSessions: number;
  teachingHours: number;
  bookedSessions: number;
}

export interface MonthlyHonorExportRow {
  rank: number;
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  teacherRole: string;
  teachingHours: number;
}

export interface MonthlySprintExportRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  courseName: string;
  completedThisMonth: number;
  sprintNumbers: string;
}

export interface MonthlyRatingExportRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  avgRating: number;
  totalRated: number;
}

export interface MonthlyReportSummary {
  month: string;
  timezone: string;
  sessionsTaught: number;
  teachingHours: number;
  sprintsCompleted: number;
  averageRating: number;
  absenceEvents: number;
  criticalAbsenceRows: number;
  teachersCounted: number;
  learnersCounted: number;
  notes: string;
}

export interface MonthlyAdminReport {
  year: number;
  month: number;
  range: DateRangeYmd;
  summary: MonthlyReportSummary;
  absences: MonthlyAbsenceExportRow[];
  teacherHours: MonthlyTeacherHoursExportRow[];
  sprints: MonthlySprintExportRow[];
  ratings: MonthlyRatingExportRow[];
  honor: MonthlyHonorExportRow[];
}

export interface MonthlyReportLabels {
  sheets: {
    summary: string;
    absence: string;
    hours: string;
    sprints: string;
    ratings: string;
    honor: string;
  };
  summary: {
    metric: string;
    value: string;
    month: string;
    timezone: string;
    sessionsTaught: string;
    teachingHours: string;
    sprintsCompleted: string;
    averageRating: string;
    absenceEvents: string;
    criticalAbsenceRows: string;
    teachersCounted: string;
    learnersCounted: string;
    notes: string;
    notesText: string;
  };
  columns: {
    learner: string;
    email: string;
    course: string;
    absenceCountMonth: string;
    unresolvedMonth: string;
    status: string;
    latestDate: string;
    teacher: string;
    role: string;
    sessionsTaught: string;
    teachingHours: string;
    bookedSessions: string;
    completedThisMonth: string;
    sprintNumbers: string;
    avgRating: string;
    ratingCount: string;
    rank: string;
  };
  status: {
    critical: string;
    unresolved: string;
    normal: string;
  };
  roles: {
    vietnameseTeacher: string;
    foreignTeacher: string;
  };
  unknownCourse: string;
  unknownName: string;
}

export interface MonthlyReportSources {
  year: number;
  month: number;
  units: TeachingSessionUnit[];
  teachers: MonthlyProfile[];
  learners: MonthlyProfile[];
  absences: MonthlyAbsenceEvent[];
  sprints: MonthlySprintRow[];
  enrollments: MonthlyEnrollmentRow[];
  courses: MonthlyCourseRow[];
  ratingSessions: MonthlyRatingSessionRow[];
  ratingAttendance: MonthlyAttendanceRatingRow[];
}

export function currentVietnamMonthYear(now: Date = new Date()): { year: number; month: number } {
  const parts = getVietnamDateParts(now);
  if (!parts) {
    const ymd = toVietnamDateStr(now);
    const match = ymd.match(/^(\d{4})-(\d{2})/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }
  return { year: parts.year, month: parts.month };
}

export function monthlyReportFilename(year: number, month: number): string {
  return `better-minds-monthly-report-${year}-${String(month).padStart(2, "0")}.xlsx`;
}

export function vietnamMonthBounds(year: number, month: number): {
  range: DateRangeYmd;
  startIso: string;
  endExclusiveIso: string;
} {
  const range = honorDateRangeYmd("monthly", year, month, 1);
  const nextStart = addCalendarDays(range.end, 1);
  return {
    range,
    startIso: `${range.start}T00:00:00+07:00`,
    endExclusiveIso: `${nextStart}T00:00:00+07:00`,
  };
}

export function isTimestampInVietnamMonth(
  iso: string | null | undefined,
  range: DateRangeYmd
): boolean {
  if (!iso) return false;
  return isDateInRangeYmd(toVietnamDateStr(iso), range);
}

/**
 * Absence month key. Prefer stored `date` (YYYY-MM-DD, including the known UTC-split
 * writer). Fall back to created_at in Vietnam time only when date is missing.
 */
export function absenceEventYmd(row: {
  date?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}): string | null {
  const rawDate = (row.date || "").trim();
  if (rawDate) {
    if (DATE_ONLY_RE.test(rawDate)) return rawDate.slice(0, 10);
    return toVietnamDateStr(rawDate) || null;
  }
  const created = row.createdAt ?? row.created_at;
  if (!created) return null;
  return toVietnamDateStr(created) || null;
}

export function monthlyAbsenceStatus(
  absenceCount: number,
  unresolvedCount: number,
  limit = MONTHLY_ABSENCE_LIMIT
): "critical" | "unresolved" | "normal" {
  if (absenceCount >= limit) return "critical";
  if (unresolvedCount > 0) return "unresolved";
  return "normal";
}

export function systemAverageOfLearnerAverages(ratings: { avgRating: number }[]): number {
  const values = ratings.filter((row) => row.avgRating > 0).map((row) => row.avgRating);
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function roleLabel(role: string, labels: MonthlyReportLabels): string {
  if (role === "vietnamese_teacher") return labels.roles.vietnameseTeacher;
  if (role === "foreign_teacher") return labels.roles.foreignTeacher;
  return role;
}

function statusLabel(status: MonthlyAbsenceExportRow["status"], labels: MonthlyReportLabels): string {
  if (status === "critical") return labels.status.critical;
  if (status === "unresolved") return labels.status.unresolved;
  return labels.status.normal;
}

export function aggregateMonthlyAbsences(
  events: MonthlyAbsenceEvent[],
  range: DateRangeYmd,
  learnersById: Map<string, MonthlyProfile>,
  unknownCourse: string,
  unknownName: string
): MonthlyAbsenceExportRow[] {
  const agg = new Map<
    string,
    {
      learnerId: string;
      learnerName: string;
      learnerEmail: string;
      courseName: string;
      absenceCount: number;
      unresolvedCount: number;
      latestDate: string | null;
    }
  >();

  events.forEach((row) => {
    if (!row.learnerId) return;
    const learner = learnersById.get(row.learnerId);
    if (!learner || learner.isActive === false) return;

    const eventYmd = absenceEventYmd(row);
    if (!isDateInRangeYmd(eventYmd, range)) return;

    const courseName = row.courseName || unknownCourse;
    const key = `${row.learnerId}|${row.enrollmentId || courseName}`;
    const existing = agg.get(key);
    if (!existing) {
      agg.set(key, {
        learnerId: row.learnerId,
        learnerName: learner.name || row.learnerName || unknownName,
        learnerEmail: learner.email,
        courseName,
        absenceCount: 1,
        unresolvedCount: row.resolved ? 0 : 1,
        latestDate: eventYmd,
      });
      return;
    }
    existing.absenceCount += 1;
    if (!row.resolved) existing.unresolvedCount += 1;
    if (eventYmd && (!existing.latestDate || eventYmd > existing.latestDate)) {
      existing.latestDate = eventYmd;
    }
  });

  return Array.from(agg.values())
    .map((row) => ({
      ...row,
      status: monthlyAbsenceStatus(row.absenceCount, row.unresolvedCount),
    }))
    .sort((a, b) => b.absenceCount - a.absenceCount || a.learnerName.localeCompare(b.learnerName));
}

export function buildMonthlyTeacherHours(
  units: TeachingSessionUnit[],
  range: DateRangeYmd,
  teachersById: Map<string, MonthlyProfile>,
  unknownName: string
): MonthlyTeacherHoursExportRow[] {
  const monthUnits = units.filter((unit) => isDateInRangeYmd(unit.date, range));
  const stats = summarizeTeacherHours(monthUnits);
  return Array.from(stats.entries())
    .filter(([, value]) => value.taughtSessions > 0 || value.bookedSessions > 0)
    .map(([teacherId, value]) => {
      const profile = teachersById.get(teacherId);
      return {
        teacherId,
        teacherName: profile?.name || unknownName,
        teacherEmail: profile?.email || "",
        teacherRole: profile?.role || "",
        taughtSessions: value.taughtSessions,
        teachingHours: value.teachingHours,
        bookedSessions: value.bookedSessions,
      };
    })
    .sort((a, b) => b.teachingHours - a.teachingHours || a.teacherName.localeCompare(b.teacherName));
}

export function buildMonthlyHonor(
  units: TeachingSessionUnit[],
  range: DateRangeYmd,
  teachersById: Map<string, MonthlyProfile>,
  unknownName: string
): MonthlyHonorExportRow[] {
  const periodUnits = taughtUnitsInHonorPeriod(units, range);
  const stats = summarizeTeacherHours(periodUnits);
  return Array.from(stats.entries())
    .filter(([, value]) => value.teachingHours > 0 || value.taughtSessions > 0)
    .map(([teacherId, value]) => {
      const profile = teachersById.get(teacherId);
      return {
        rank: 0,
        teacherId,
        teacherName: profile?.name || unknownName,
        teacherEmail: profile?.email || "",
        teacherRole: profile?.role || "",
        teachingHours: value.teachingHours,
      };
    })
    .sort((a, b) => b.teachingHours - a.teachingHours || a.teacherName.localeCompare(b.teacherName))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function aggregateMonthlySprints(
  sprints: MonthlySprintRow[],
  range: DateRangeYmd,
  enrollmentsById: Map<string, MonthlyEnrollmentRow>,
  coursesById: Map<string, MonthlyCourseRow>,
  learnersById: Map<string, MonthlyProfile>,
  unknownCourse: string,
  unknownName: string
): MonthlySprintExportRow[] {
  const seen = new Set<string>();
  const agg = new Map<
    string,
    {
      learnerId: string;
      learnerName: string;
      learnerEmail: string;
      courseName: string;
      completedThisMonth: number;
      sprintNumbers: number[];
    }
  >();

  sprints.forEach((sprint) => {
    if (seen.has(sprint.id)) return;
    if (sprint.status !== "completed") return;
    if (!isTimestampInVietnamMonth(sprint.completedAt, range)) return;
    seen.add(sprint.id);

    const enrollment = enrollmentsById.get(sprint.enrollmentId);
    if (!enrollment) return;
    const learner = learnersById.get(enrollment.learnerId);
    if (!learner || learner.isActive === false) return;

    const courseName = (enrollment.courseId && coursesById.get(enrollment.courseId)?.name) || unknownCourse;
    const key = `${learner.id}|${enrollment.courseId || courseName}`;
    const existing = agg.get(key);
    const sprintNumber = sprint.sprintNumber;
    if (!existing) {
      agg.set(key, {
        learnerId: learner.id,
        learnerName: learner.name || unknownName,
        learnerEmail: learner.email,
        courseName,
        completedThisMonth: 1,
        sprintNumbers: sprintNumber != null ? [sprintNumber] : [],
      });
      return;
    }
    existing.completedThisMonth += 1;
    if (sprintNumber != null) existing.sprintNumbers.push(sprintNumber);
  });

  return Array.from(agg.values())
    .map((row) => ({
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      learnerEmail: row.learnerEmail,
      courseName: row.courseName,
      completedThisMonth: row.completedThisMonth,
      sprintNumbers: [...row.sprintNumbers].sort((a, b) => a - b).join(", "),
    }))
    .sort(
      (a, b) =>
        b.completedThisMonth - a.completedThisMonth || a.learnerName.localeCompare(b.learnerName)
    );
}

export function aggregateMonthlyRatings(
  sessions: MonthlyRatingSessionRow[],
  attendance: MonthlyAttendanceRatingRow[],
  range: DateRangeYmd,
  sprintIdToEnrollmentId: Map<string, string>,
  enrollmentIdToLearnerId: Map<string, string>,
  learnersById: Map<string, MonthlyProfile>,
  unknownName: string
): MonthlyRatingExportRow[] {
  const monthSessions = sessions.filter((session) =>
    isTimestampInVietnamMonth(session.completedAt, range)
  );
  const monthAttendance = attendance.filter((row) =>
    isTimestampInVietnamMonth(row.markedAt, range)
  );
  const activeLearnerIds = new Set(
    [...learnersById.values()].filter((learner) => learner.isActive !== false).map((learner) => learner.id)
  );

  return buildLearnerRatingAggregates({
    sessions: monthSessions,
    attendance: monthAttendance,
    sprintIdToEnrollmentId,
    enrollmentIdToLearnerId,
    activeLearnerIds,
  })
    .filter((row) => row.totalRated > 0)
    .map((row) => {
      const learner = learnersById.get(row.learnerId);
      return {
        learnerId: row.learnerId,
        learnerName: learner?.name || unknownName,
        learnerEmail: learner?.email || "",
        avgRating: row.avgRating,
        totalRated: row.totalRated,
      };
    })
    .sort((a, b) => b.avgRating - a.avgRating || a.learnerName.localeCompare(b.learnerName));
}

export function buildMonthlySummary(
  report: Omit<MonthlyAdminReport, "summary">,
  notes: string
): MonthlyReportSummary {
  const learnerIds = new Set<string>();
  report.absences.forEach((row) => learnerIds.add(row.learnerId));
  report.sprints.forEach((row) => learnerIds.add(row.learnerId));
  report.ratings.forEach((row) => learnerIds.add(row.learnerId));

  const sessionsTaught = report.teacherHours.reduce((sum, row) => sum + row.taughtSessions, 0);
  const teachingHours = Math.round(
    report.teacherHours.reduce((sum, row) => sum + row.teachingHours, 0) * 10
  ) / 10;
  const sprintsCompleted = report.sprints.reduce((sum, row) => sum + row.completedThisMonth, 0);
  const absenceEvents = report.absences.reduce((sum, row) => sum + row.absenceCount, 0);

  return {
    month: `${report.year}-${String(report.month).padStart(2, "0")}`,
    timezone: MONTHLY_REPORT_TIMEZONE,
    sessionsTaught,
    teachingHours,
    sprintsCompleted,
    averageRating: systemAverageOfLearnerAverages(report.ratings),
    absenceEvents,
    criticalAbsenceRows: report.absences.filter((row) => row.status === "critical").length,
    teachersCounted: report.teacherHours.length,
    learnersCounted: learnerIds.size,
    notes,
  };
}

export function buildMonthlyAdminReport(
  sources: MonthlyReportSources,
  labels: Pick<MonthlyReportLabels, "unknownCourse" | "unknownName" | "summary">
): MonthlyAdminReport {
  const { range } = vietnamMonthBounds(sources.year, sources.month);
  const teachersById = new Map(sources.teachers.map((teacher) => [teacher.id, teacher]));
  const learnersById = new Map(sources.learners.map((learner) => [learner.id, learner]));
  const enrollmentsById = new Map(sources.enrollments.map((enrollment) => [enrollment.id, enrollment]));
  const coursesById = new Map(sources.courses.map((course) => [course.id, course]));
  const sprintIdToEnrollmentId = new Map(
    sources.sprints.map((sprint) => [sprint.id, sprint.enrollmentId])
  );
  const enrollmentIdToLearnerId = new Map(
    sources.enrollments.map((enrollment) => [enrollment.id, enrollment.learnerId])
  );

  const absences = aggregateMonthlyAbsences(
    sources.absences,
    range,
    learnersById,
    labels.unknownCourse,
    labels.unknownName
  );
  const teacherHours = buildMonthlyTeacherHours(
    sources.units,
    range,
    teachersById,
    labels.unknownName
  );
  const honor = buildMonthlyHonor(sources.units, range, teachersById, labels.unknownName);
  const sprints = aggregateMonthlySprints(
    sources.sprints,
    range,
    enrollmentsById,
    coursesById,
    learnersById,
    labels.unknownCourse,
    labels.unknownName
  );
  const ratings = aggregateMonthlyRatings(
    sources.ratingSessions,
    sources.ratingAttendance,
    range,
    sprintIdToEnrollmentId,
    enrollmentIdToLearnerId,
    learnersById,
    labels.unknownName
  );

  const draft: Omit<MonthlyAdminReport, "summary"> = {
    year: sources.year,
    month: sources.month,
    range,
    absences,
    teacherHours,
    sprints,
    ratings,
    honor,
  };

  return {
    ...draft,
    summary: buildMonthlySummary(draft, labels.summary.notesText),
  };
}

export function monthlyReportHasActivity(report: MonthlyAdminReport): boolean {
  return (
    report.absences.length > 0 ||
    report.teacherHours.length > 0 ||
    report.sprints.length > 0 ||
    report.ratings.length > 0 ||
    report.honor.length > 0
  );
}

async function fetchByIds<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  ids: string[]
): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const batch = await fetchPaginated<T>(supabase, table, columns, (query) =>
      query.in(idColumn, chunk)
    );
    rows.push(...batch);
  }
  return rows;
}

function mapProfile(row: {
  id: string;
  full_name: string | null;
  email: string | null;
  role?: string | null;
  is_active?: boolean | null;
}): MonthlyProfile {
  return {
    id: row.id,
    name: row.full_name || "Unknown",
    email: row.email || "",
    role: row.role || "",
    isActive: row.is_active !== false,
  };
}

export async function fetchMonthlyReportSources(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<MonthlyReportSources> {
  const { range, startIso, endExclusiveIso } = vietnamMonthBounds(year, month);

  const [workload, teacherRows, learnerRows, datedAbsences, undatedAbsences, completedSprints] =
    await Promise.all([
      fetchTeacherWeeklyWorkloadSource(supabase, range),
      fetchPaginated<{
        id: string;
        full_name: string | null;
        email: string | null;
        role: string | null;
        is_active: boolean | null;
      }>(supabase, "profiles", "id, full_name, email, role, is_active", (query) =>
        query.in("role", ["vietnamese_teacher", "foreign_teacher"])
      ),
      fetchPaginated<{
        id: string;
        full_name: string | null;
        email: string | null;
        role: string | null;
        is_active: boolean | null;
      }>(supabase, "profiles", "id, full_name, email, role, is_active", (query) =>
        query.eq("role", "learner")
      ),
      fetchPaginated<{
        learner_id: string | null;
        enrollment_id: string | null;
        course_name: string | null;
        learner_name: string | null;
        date: string | null;
        created_at: string | null;
        resolved: boolean | null;
      }>(
        supabase,
        "learner_attendance",
        "learner_id, enrollment_id, course_name, learner_name, date, created_at, resolved",
        (query) =>
          query
            .eq("type", "absent_session")
            .gte("date", range.start)
            .lte("date", range.end)
      ),
      fetchPaginated<{
        learner_id: string | null;
        enrollment_id: string | null;
        course_name: string | null;
        learner_name: string | null;
        date: string | null;
        created_at: string | null;
        resolved: boolean | null;
      }>(
        supabase,
        "learner_attendance",
        "learner_id, enrollment_id, course_name, learner_name, date, created_at, resolved",
        (query) =>
          query
            .eq("type", "absent_session")
            .is("date", null)
            .gte("created_at", startIso)
            .lt("created_at", endExclusiveIso)
      ),
      fetchPaginated<{
        id: string;
        enrollment_id: string;
        sprint_number: number | null;
        status: string | null;
        completed_at: string | null;
      }>(
        supabase,
        "learning_sprints",
        "id, enrollment_id, sprint_number, status, completed_at",
        (query) =>
          query
            .eq("status", "completed")
            .not("completed_at", "is", null)
            .gte("completed_at", startIso)
            .lt("completed_at", endExclusiveIso)
      ),
    ]);

  const ratingSessions = await fetchPaginated<{
    id: string;
    sprint_id: string;
    class_id: string | null;
    session_number: number;
    session_type: string | null;
    status: string | null;
    completion_rating: number | string | null;
    completed_at: string | null;
  }>(
    supabase,
    "sprint_sessions",
    "id, sprint_id, class_id, session_number, session_type, status, completion_rating, completed_at",
    (query) => query.gte("completed_at", startIso).lt("completed_at", endExclusiveIso)
  );

  const ratingAttendance = await fetchPaginated<{
    student_id: string;
    class_id: string | null;
    grade: number | string | null;
    status: string | null;
    teacher_feedback: string | null;
    marked_at: string | null;
  }>(
    supabase,
    "session_attendance",
    "student_id, class_id, grade, status, teacher_feedback, marked_at",
    (query) => query.gte("marked_at", startIso).lt("marked_at", endExclusiveIso)
  );

  const ratingSprintIds = [...new Set(ratingSessions.map((session) => session.sprint_id))];
  const extraSprints =
    ratingSprintIds.length > 0
      ? await fetchByIds<{
          id: string;
          enrollment_id: string;
          sprint_number: number | null;
          status: string | null;
          completed_at: string | null;
        }>(supabase, "learning_sprints", "id, enrollment_id, sprint_number, status, completed_at", "id", ratingSprintIds)
      : [];

  const sprintById = new Map<string, MonthlySprintRow>();
  completedSprints.forEach((sprint) => {
    sprintById.set(sprint.id, {
      id: sprint.id,
      enrollmentId: sprint.enrollment_id,
      sprintNumber: sprint.sprint_number,
      status: sprint.status,
      completedAt: sprint.completed_at,
    });
  });
  extraSprints.forEach((sprint) => {
    if (!sprintById.has(sprint.id)) {
      sprintById.set(sprint.id, {
        id: sprint.id,
        enrollmentId: sprint.enrollment_id,
        sprintNumber: sprint.sprint_number,
        status: sprint.status,
        completedAt: sprint.completed_at,
      });
    }
  });

  const enrollmentIds = [
    ...completedSprints.map((sprint) => sprint.enrollment_id),
    ...extraSprints.map((sprint) => sprint.enrollment_id),
  ];
  const enrollments = await fetchByIds<{
    id: string;
    learner_id: string;
    course_id: string | null;
  }>(supabase, "enrollments", "id, learner_id, course_id", "id", enrollmentIds);

  const courses = await fetchByIds<{ id: string; name: string | null }>(
    supabase,
    "courses",
    "id, name",
    "id",
    enrollments.map((enrollment) => enrollment.course_id || "")
  );

  const absences: MonthlyAbsenceEvent[] = [...datedAbsences, ...undatedAbsences].map((row) => ({
    learnerId: row.learner_id || "",
    enrollmentId: row.enrollment_id,
    courseName: row.course_name,
    learnerName: row.learner_name,
    date: row.date,
    createdAt: row.created_at,
    resolved: !!row.resolved,
  }));

  return {
    year,
    month,
    units: buildTeachingSessionUnits(workload),
    teachers: teacherRows.map(mapProfile),
    learners: learnerRows.map(mapProfile),
    absences,
    sprints: [...sprintById.values()],
    enrollments: enrollments.map((enrollment) => ({
      id: enrollment.id,
      learnerId: enrollment.learner_id,
      courseId: enrollment.course_id,
    })),
    courses: courses.map((course) => ({ id: course.id, name: course.name })),
    ratingSessions: ratingSessions.map((session) => ({
      id: session.id,
      sprint_id: session.sprint_id,
      class_id: session.class_id,
      session_number: session.session_number,
      session_type: session.session_type,
      status: session.status,
      completion_rating: session.completion_rating,
      completedAt: session.completed_at,
    })),
    ratingAttendance: ratingAttendance.map((row) => ({
      student_id: row.student_id,
      class_id: row.class_id,
      grade: row.grade,
      status: row.status,
      teacher_feedback: row.teacher_feedback,
      markedAt: row.marked_at,
    })),
  };
}

export async function fetchMonthlyAdminReport(
  supabase: SupabaseClient,
  year: number,
  month: number,
  labels: Pick<MonthlyReportLabels, "unknownCourse" | "unknownName" | "summary">
): Promise<MonthlyAdminReport> {
  const sources = await fetchMonthlyReportSources(supabase, year, month);
  return buildMonthlyAdminReport(sources, labels);
}

type ExcelCell = string | number | null;

function addDetailSheet(
  workbook: { addWorksheet: (name: string) => any },
  name: string,
  headers: string[],
  rows: ExcelCell[][]
) {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  const headerRow = sheet.addRow(headers.map((header) => sanitizeExcelText(header)));
  headerRow.font = { bold: true };
  rows.forEach((row) => {
    sheet.addRow(
      row.map((cell) => (typeof cell === "number" ? cell : sanitizeExcelText(cell)))
    );
  });
  headers.forEach((header, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.min(42, Math.max(14, header.length + 6));
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

async function loadExcelJS(): Promise<{ Workbook: new () => any }> {
  const mod = await import("exceljs");
  const resolved = (mod as { default?: { Workbook: new () => any } } & { Workbook?: new () => any })
    .default ?? mod;
  if (!resolved?.Workbook) {
    throw new Error("ExcelJS Workbook export is unavailable");
  }
  return resolved as { Workbook: new () => any };
}

export async function writeMonthlyReportWorkbook(
  report: MonthlyAdminReport,
  labels: MonthlyReportLabels
): Promise<{ filename: string; buffer: ArrayBuffer }> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Better Minds";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet(labels.sheets.summary.slice(0, 31));
  const summaryHeader = summarySheet.addRow([
    sanitizeExcelText(labels.summary.metric),
    sanitizeExcelText(labels.summary.value),
  ]);
  summaryHeader.font = { bold: true };
  const summaryRows: Array<[string, string | number]> = [
    [labels.summary.month, report.summary.month],
    [labels.summary.timezone, report.summary.timezone],
    [labels.summary.sessionsTaught, report.summary.sessionsTaught],
    [labels.summary.teachingHours, report.summary.teachingHours],
    [labels.summary.sprintsCompleted, report.summary.sprintsCompleted],
    [labels.summary.averageRating, report.summary.averageRating],
    [labels.summary.absenceEvents, report.summary.absenceEvents],
    [labels.summary.criticalAbsenceRows, report.summary.criticalAbsenceRows],
    [labels.summary.teachersCounted, report.summary.teachersCounted],
    [labels.summary.learnersCounted, report.summary.learnersCounted],
    [labels.summary.notes, report.summary.notes],
  ];
  summaryRows.forEach(([metric, value]) => {
    summarySheet.addRow([
      sanitizeExcelText(metric),
      typeof value === "number" ? value : sanitizeExcelText(value),
    ]);
  });
  summarySheet.getColumn(1).width = 28;
  summarySheet.getColumn(2).width = 80;
  summarySheet.views = [{ state: "frozen", ySplit: 1 }];

  addDetailSheet(workbook, labels.sheets.absence, [
    labels.columns.learner,
    labels.columns.email,
    labels.columns.course,
    labels.columns.absenceCountMonth,
    labels.columns.unresolvedMonth,
    labels.columns.status,
    labels.columns.latestDate,
  ], report.absences.map((row) => [
    row.learnerName,
    row.learnerEmail,
    row.courseName,
    row.absenceCount,
    row.unresolvedCount,
    statusLabel(row.status, labels),
    row.latestDate,
  ]));

  addDetailSheet(workbook, labels.sheets.hours, [
    labels.columns.teacher,
    labels.columns.email,
    labels.columns.role,
    labels.columns.sessionsTaught,
    labels.columns.teachingHours,
    labels.columns.bookedSessions,
  ], report.teacherHours.map((row) => [
    row.teacherName,
    row.teacherEmail,
    roleLabel(row.teacherRole, labels),
    row.taughtSessions,
    row.teachingHours,
    row.bookedSessions,
  ]));

  addDetailSheet(workbook, labels.sheets.sprints, [
    labels.columns.learner,
    labels.columns.email,
    labels.columns.course,
    labels.columns.completedThisMonth,
    labels.columns.sprintNumbers,
  ], report.sprints.map((row) => [
    row.learnerName,
    row.learnerEmail,
    row.courseName,
    row.completedThisMonth,
    row.sprintNumbers,
  ]));

  addDetailSheet(workbook, labels.sheets.ratings, [
    labels.columns.learner,
    labels.columns.email,
    labels.columns.avgRating,
    labels.columns.ratingCount,
  ], report.ratings.map((row) => [
    row.learnerName,
    row.learnerEmail,
    row.avgRating,
    row.totalRated,
  ]));

  addDetailSheet(workbook, labels.sheets.honor, [
    labels.columns.rank,
    labels.columns.teacher,
    labels.columns.email,
    labels.columns.role,
    labels.columns.teachingHours,
  ], report.honor.map((row) => [
    row.rank,
    row.teacherName,
    row.teacherEmail,
    roleLabel(row.teacherRole, labels),
    row.teachingHours,
  ]));

  const raw = await workbook.xlsx.writeBuffer();
  const buffer =
    raw instanceof ArrayBuffer
      ? raw
      : (raw as Uint8Array).buffer.slice(
          (raw as Uint8Array).byteOffset,
          (raw as Uint8Array).byteOffset + (raw as Uint8Array).byteLength
        );

  return {
    filename: monthlyReportFilename(report.year, report.month),
    buffer: buffer as ArrayBuffer,
  };
}

export function triggerWorkbookDownload(filename: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
