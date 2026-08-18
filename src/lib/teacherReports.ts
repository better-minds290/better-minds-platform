import type { SupabaseClient } from "@supabase/supabase-js";

export interface StudentReport {
  learner_id: string;
  learner_name: string;
  learner_email: string;
  course_name: string;
  current_sprint: number;
  total_sprints: number;
  completed_sprints: number;
  avg_rating: number;
}

export interface TeacherReport {
  teacher_id: string;
  teacher_name: string;
  total_sessions: number;
  completed_sessions: number;
  avg_rating_given: number;
  total_feedbacks: number;
}

export interface EnrollmentRow {
  id: string;
  learner_id: string;
  course_id: string;
  status: string;
}

export interface SprintRow {
  id: string;
  enrollment_id: string;
  sprint_number: number;
  status: string;
}

export interface RatedSessionRow {
  sprint_id: string;
  completion_rating: number;
}

export interface LearnerProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

export interface CourseRow {
  id: string;
  name: string | null;
}

export interface TeacherProfileRow {
  id: string;
  full_name: string | null;
}

export interface TeacherSessionStatRow {
  teacher_id: string;
  completion_rating: number | null;
  teacher_feedback: string | null;
  status: string | null;
}

interface TeacherLinkedSessionRow {
  sprint_id: string;
  sprint: {
    enrollment_id: string;
  } | null;
}

export function extractEnrollmentIdsFromTeacherSessions(
  sessions: { sprint?: { enrollment_id?: string } | null }[]
): Set<string> {
  const ids = new Set<string>();
  sessions.forEach((session) => {
    const enrollmentId = session.sprint?.enrollment_id;
    if (enrollmentId) ids.add(enrollmentId);
  });
  return ids;
}

export function computeSprintProgress(sprints: SprintRow[]): {
  total_sprints: number;
  completed_sprints: number;
  current_sprint: number;
} {
  const total_sprints = sprints.length;
  const completed_sprints = sprints.filter((s) => s.status === "completed").length;
  const pendingSprints = sprints
    .filter((s) => s.status !== "completed")
    .sort((a, b) => a.sprint_number - b.sprint_number);
  const current_sprint = pendingSprints.length > 0 ? pendingSprints[0].sprint_number : 0;
  return { total_sprints, completed_sprints, current_sprint };
}

export function computeAvgRating(ratedSessions: RatedSessionRow[]): number {
  if (ratedSessions.length === 0) return 0;
  const sum = ratedSessions.reduce((acc, session) => acc + session.completion_rating, 0);
  return Math.round((sum / ratedSessions.length) * 10) / 10;
}

export function buildStudentReports(input: {
  relevantEnrollmentIds: Set<string>;
  enrollments: EnrollmentRow[];
  sprintsByEnrollment: Map<string, SprintRow[]>;
  ratedSessionsBySprint: Map<string, RatedSessionRow[]>;
  profilesById: Map<string, LearnerProfileRow>;
  coursesById: Map<string, CourseRow>;
  unknownName: string;
}): StudentReport[] {
  const {
    relevantEnrollmentIds,
    enrollments,
    sprintsByEnrollment,
    ratedSessionsBySprint,
    profilesById,
    coursesById,
    unknownName,
  } = input;

  const reports: StudentReport[] = [];
  const seenEnrollmentIds = new Set<string>();

  enrollments.forEach((enrollment) => {
    if (enrollment.status !== "active") return;
    if (!relevantEnrollmentIds.has(enrollment.id)) return;
    if (seenEnrollmentIds.has(enrollment.id)) return;
    seenEnrollmentIds.add(enrollment.id);

    const sprints = sprintsByEnrollment.get(enrollment.id) || [];
    const progress = computeSprintProgress(sprints);

    const ratedSessions: RatedSessionRow[] = [];
    sprints.forEach((sprint) => {
      ratedSessions.push(...(ratedSessionsBySprint.get(sprint.id) || []));
    });

    const learner = profilesById.get(enrollment.learner_id);
    const course = coursesById.get(enrollment.course_id);

    reports.push({
      learner_id: enrollment.learner_id,
      learner_name: learner?.full_name || unknownName,
      learner_email: learner?.email || "",
      course_name: course?.name || "",
      current_sprint: progress.current_sprint,
      total_sprints: progress.total_sprints,
      completed_sprints: progress.completed_sprints,
      avg_rating: computeAvgRating(ratedSessions),
    });
  });

  return reports.sort((a, b) => a.learner_name.localeCompare(b.learner_name));
}

export function buildTeacherReports(
  teachers: TeacherProfileRow[],
  sessions: TeacherSessionStatRow[],
  unknownName: string
): TeacherReport[] {
  const sessionsByTeacher = new Map<string, TeacherSessionStatRow[]>();
  sessions.forEach((session) => {
    if (!session.teacher_id) return;
    const list = sessionsByTeacher.get(session.teacher_id) || [];
    list.push(session);
    sessionsByTeacher.set(session.teacher_id, list);
  });

  return teachers.map((teacher) => {
    const teacherSessions = sessionsByTeacher.get(teacher.id) || [];
    const completed = teacherSessions.filter((session) => session.status === "completed");
    const withRatings = completed.filter((session) => session.completion_rating);
    const ratingSum = withRatings.reduce((sum, session) => sum + (session.completion_rating || 0), 0);
    const withFeedback = completed.filter((session) => session.teacher_feedback);

    return {
      teacher_id: teacher.id,
      teacher_name: teacher.full_name || unknownName,
      total_sessions: teacherSessions.length,
      completed_sessions: completed.length,
      avg_rating_given:
        withRatings.length > 0 ? Math.round((ratingSum / withRatings.length) * 10) / 10 : 0,
      total_feedbacks: withFeedback.length,
    };
  });
}

function groupSprintsByEnrollment(sprints: SprintRow[]): Map<string, SprintRow[]> {
  const map = new Map<string, SprintRow[]>();
  sprints.forEach((sprint) => {
    const list = map.get(sprint.enrollment_id) || [];
    list.push(sprint);
    map.set(sprint.enrollment_id, list);
  });
  return map;
}

function groupRatedSessionsBySprint(sessions: RatedSessionRow[]): Map<string, RatedSessionRow[]> {
  const map = new Map<string, RatedSessionRow[]>();
  sessions.forEach((session) => {
    const list = map.get(session.sprint_id) || [];
    list.push(session);
    map.set(session.sprint_id, list);
  });
  return map;
}

export async function fetchStudentReportsForTeacher(
  supabase: SupabaseClient,
  teacherId: string,
  unknownName: string
): Promise<StudentReport[]> {
  const { data: teacherSessions, error: teacherSessionsError } = await supabase
    .from("sprint_sessions")
    .select("sprint_id, sprint:learning_sprints!sprint_id(enrollment_id)")
    .eq("teacher_id", teacherId);

  if (teacherSessionsError) throw teacherSessionsError;

  const relevantEnrollmentIds = extractEnrollmentIdsFromTeacherSessions(
    (teacherSessions || []) as TeacherLinkedSessionRow[]
  );
  if (relevantEnrollmentIds.size === 0) return [];

  const enrollmentIdList = [...relevantEnrollmentIds];

  const [enrollmentsRes, sprintsRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, learner_id, course_id, status")
      .in("id", enrollmentIdList)
      .eq("status", "active"),
    supabase
      .from("learning_sprints")
      .select("id, enrollment_id, sprint_number, status")
      .in("enrollment_id", enrollmentIdList),
  ]);

  if (enrollmentsRes.error) throw enrollmentsRes.error;
  if (sprintsRes.error) throw sprintsRes.error;

  const enrollments = (enrollmentsRes.data || []) as EnrollmentRow[];
  const sprints = (sprintsRes.data || []) as SprintRow[];
  const sprintIds = sprints.map((sprint) => sprint.id);
  const learnerIds = [...new Set(enrollments.map((enrollment) => enrollment.learner_id))];
  const courseIds = [...new Set(enrollments.map((enrollment) => enrollment.course_id))];

  const [profilesRes, coursesRes, ratedSessionsRes] = await Promise.all([
    learnerIds.length > 0
      ? supabase.from("profiles").select("id, full_name, email").in("id", learnerIds)
      : Promise.resolve({ data: [], error: null }),
    courseIds.length > 0
      ? supabase.from("courses").select("id, name").in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    sprintIds.length > 0
      ? supabase
          .from("sprint_sessions")
          .select("sprint_id, completion_rating")
          .in("sprint_id", sprintIds)
          .not("completion_rating", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (coursesRes.error) throw coursesRes.error;
  if (ratedSessionsRes.error) throw ratedSessionsRes.error;

  const profilesById = new Map<string, LearnerProfileRow>(
    ((profilesRes.data || []) as LearnerProfileRow[]).map((profile) => [profile.id, profile])
  );
  const coursesById = new Map<string, CourseRow>(
    ((coursesRes.data || []) as CourseRow[]).map((course) => [course.id, course])
  );

  return buildStudentReports({
    relevantEnrollmentIds,
    enrollments,
    sprintsByEnrollment: groupSprintsByEnrollment(sprints),
    ratedSessionsBySprint: groupRatedSessionsBySprint(
      ((ratedSessionsRes.data || []) as { sprint_id: string; completion_rating: number }[]).map((session) => ({
        sprint_id: session.sprint_id,
        completion_rating: session.completion_rating,
      }))
    ),
    profilesById,
    coursesById,
    unknownName,
  });
}

export async function fetchTeacherComparisonReports(
  supabase: SupabaseClient,
  unknownName: string
): Promise<TeacherReport[]> {
  const { data: teachers, error: teachersError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["vietnamese_teacher", "foreign_teacher"]);

  if (teachersError) throw teachersError;

  const teacherProfiles = (teachers || []) as TeacherProfileRow[];
  const teacherIds = teacherProfiles.map((teacher) => teacher.id);
  if (teacherIds.length === 0) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from("sprint_sessions")
    .select("teacher_id, completion_rating, teacher_feedback, status")
    .in("teacher_id", teacherIds);

  if (sessionsError) throw sessionsError;

  return buildTeacherReports(teacherProfiles, (sessions || []) as TeacherSessionStatRow[], unknownName);
}
