/**
 * Canonical Booked / Late / neutral semantics for Admin Learners and the
 * missed-Sunday-booking scanner. src/lib/adminLearnerBooking.ts re-exports this.
 *
 * Booked requires a real class relationship — scheduled_at alone is not Booked.
 */
import { selectCurrentAdminSprint, type AdminSprintRow } from "./adminSprintSelection.ts";
import { hasSundayBookingWindowPassed } from "./vietnamTime.ts";

/** Live sessions shown in Admin Learners → Current Sessions. Session 1 is self-study. */
export const LIVE_SESSION_NUMBERS = [2, 3] as const;
export type LiveSessionNumber = (typeof LIVE_SESSION_NUMBERS)[number];

export type BookingBadge = "booked" | "late" | "neutral";

const HISTORICAL_SESSION_STATUSES = new Set(["completed", "absent", "awaiting_feedback"]);
const BOOKABLE_SPRINT_STATUSES = new Set(["active", "expired"]);
const CANCELLED_SCHEDULE_STATUSES = new Set(["cancelled", "canceled", "deleted"]);
const OPERATIONAL_ENROLLMENT_STATUSES = new Set(["active", "paused"]);

export interface SprintRow extends AdminSprintRow {
  enrollment_id: string;
}

export interface LiveSessionRow {
  id: string;
  sprint_id: string;
  session_number: number;
  session_type: string | null;
  status: string;
  teacher_id: string | null;
  scheduled_at: string | null;
  class_id: string | null;
  meeting_link: string | null;
}

export interface ClassScheduleInfo {
  class_id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  teacher_id: string | null;
}

export interface EnrollmentRef {
  id: string;
  learner_id: string;
  status: string;
}

export interface SessionDetailView {
  sessionId: string;
  sessionNumber: number;
  sprintNumber: number;
  sprintStatus: string;
  sessionStatus: string;
  teacherName: string | null;
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  meetingLink: string | null;
  classStatus: string | null;
  classId: string | null;
  booked: boolean;
  bookingBadge: BookingBadge;
}

export interface LearnerBookingView {
  liveSessionNumbers: LiveSessionNumber[];
  session2: BookingBadge | null;
  session3: BookingBadge | null;
  detailsByNumber: Partial<Record<LiveSessionNumber, SessionDetailView>>;
}

export function isLiveSessionNumber(n: number): n is LiveSessionNumber {
  return n === 2 || n === 3;
}

export function isLiveTeacherSession(session: {
  session_number: number;
  session_type?: string | null;
}): boolean {
  if (!isLiveSessionNumber(session.session_number)) return false;
  if (session.session_type === "self_study") return false;
  return true;
}

function durationMinutesFromTimes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return null;
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function clockHm(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

function dateFromScheduledAt(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null;
  const match = scheduledAt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export interface ClassEnrollmentRef {
  class_id: string;
  student_id: string;
}

/**
 * A session is Booked only when the learner is in a real teaching class.
 *
 * Required:
 * - sprint_sessions.class_id
 * - a linked class_schedules row that is not cancelled/deleted
 * - when enrolledClassIds is provided, the learner must have a class_enrollments row
 *
 * scheduled_at alone is NOT evidence: auto-schedulers write it as a suggestion
 * without creating classes, enrollments, or schedules.
 */
export function hasValidBooking(
  session: LiveSessionRow,
  schedule?: ClassScheduleInfo | null,
  enrolledClassIds?: Set<string> | null
): boolean {
  if (!session.class_id) return false;
  if (!schedule) return false;
  if (CANCELLED_SCHEDULE_STATUSES.has(schedule.status || "")) return false;
  if (enrolledClassIds && !enrolledClassIds.has(session.class_id)) return false;
  return true;
}

export function isSessionExpectedToBeBooked(
  sprint: AdminSprintRow,
  session: LiveSessionRow,
  enrollmentStatus: string
): boolean {
  if (!OPERATIONAL_ENROLLMENT_STATUSES.has(enrollmentStatus)) return false;
  if (!BOOKABLE_SPRINT_STATUSES.has(sprint.status)) return false;
  if (!isLiveTeacherSession(session)) return false;
  if (session.status === "locked") return false;
  if (HISTORICAL_SESSION_STATUSES.has(session.status)) return false;
  return true;
}

export function deriveSessionBookingBadge(args: {
  session: LiveSessionRow | null | undefined;
  sprint: AdminSprintRow | null | undefined;
  schedule?: ClassScheduleInfo | null;
  enrollmentStatus: string;
  windowPassed: boolean;
  enrolledClassIds?: Set<string> | null;
}): BookingBadge {
  const { session, sprint, schedule, enrollmentStatus, windowPassed, enrolledClassIds } = args;
  if (!session || !sprint) return "neutral";
  if (!isLiveTeacherSession(session)) return "neutral";
  if (hasValidBooking(session, schedule, enrolledClassIds)) return "booked";
  if (HISTORICAL_SESSION_STATUSES.has(session.status)) return "neutral";
  if (!isSessionExpectedToBeBooked(sprint, session, enrollmentStatus)) return "neutral";
  if (!windowPassed) return "neutral";
  return "late";
}

export function hasLateFilterMatch(view: LearnerBookingView): boolean {
  return view.session2 === "late" || view.session3 === "late";
}

export function applyAdminAssignBooking(
  session: LiveSessionRow,
  assignment: { class_id: string; teacher_id: string; scheduled_at: string }
): LiveSessionRow {
  return {
    ...session,
    class_id: assignment.class_id,
    teacher_id: assignment.teacher_id,
    scheduled_at: assignment.scheduled_at,
    status: "in_progress",
  };
}

function buildSessionDetail(
  session: LiveSessionRow,
  sprint: AdminSprintRow,
  schedule: ClassScheduleInfo | null | undefined,
  teacherName: string | null,
  badge: BookingBadge,
  enrolledClassIds?: Set<string> | null
): SessionDetailView {
  const scheduledDate = schedule?.date || dateFromScheduledAt(session.scheduled_at);
  const startTime = clockHm(schedule?.start_time) || clockHm(session.scheduled_at?.split("T")[1] || null);
  const endTime = clockHm(schedule?.end_time);

  return {
    sessionId: session.id,
    sessionNumber: session.session_number,
    sprintNumber: sprint.sprint_number,
    sprintStatus: sprint.status,
    sessionStatus: session.status,
    teacherName,
    scheduledDate,
    startTime,
    endTime,
    durationMinutes: durationMinutesFromTimes(schedule?.start_time || null, schedule?.end_time || null),
    meetingLink: session.meeting_link,
    classStatus: schedule?.status || null,
    classId: session.class_id,
    booked: hasValidBooking(session, schedule, enrolledClassIds),
    bookingBadge: badge,
  };
}

function emptyView(): LearnerBookingView {
  return {
    liveSessionNumbers: [],
    session2: null,
    session3: null,
    detailsByNumber: {},
  };
}

/**
 * Prefer operational (active/paused) enrollment when a learner has several rows.
 * Same rule Admin Learners uses when merging enrollment lists.
 */
export function indexPreferredEnrollmentsByLearner(enrollments: EnrollmentRef[]): Map<string, EnrollmentRef> {
  const enrollmentByLearner = new Map<string, EnrollmentRef>();
  for (const en of enrollments) {
    const existing = enrollmentByLearner.get(en.learner_id);
    const preferNext =
      !existing ||
      OPERATIONAL_ENROLLMENT_STATUSES.has(en.status) ||
      (existing.status === "completed" && en.status !== "completed");
    if (preferNext) enrollmentByLearner.set(en.learner_id, en);
  }
  return enrollmentByLearner;
}

export function buildLearnerBookingView(args: {
  sprint: AdminSprintRow | null;
  sessions: LiveSessionRow[];
  enrollmentStatus: string;
  schedulesByClassId: Map<string, ClassScheduleInfo>;
  teachersById: Map<string, string>;
  now?: Date;
  enrolledClassIds?: Set<string> | null;
}): LearnerBookingView {
  const {
    sprint,
    sessions,
    enrollmentStatus,
    schedulesByClassId,
    teachersById,
    now = new Date(),
    enrolledClassIds,
  } = args;
  if (!sprint) return emptyView();

  const windowPassed = hasSundayBookingWindowPassed(now);
  const live = sessions.filter(isLiveTeacherSession);
  const numbers = LIVE_SESSION_NUMBERS.filter((n) => live.some((s) => s.session_number === n));
  const detailsByNumber: Partial<Record<LiveSessionNumber, SessionDetailView>> = {};

  const view: LearnerBookingView = {
    liveSessionNumbers: numbers,
    session2: null,
    session3: null,
    detailsByNumber,
  };

  for (const n of LIVE_SESSION_NUMBERS) {
    const session = live.find((s) => s.session_number === n);
    if (!session) continue;
    const schedule = session.class_id ? schedulesByClassId.get(session.class_id) || null : null;
    const badge = deriveSessionBookingBadge({
      session,
      sprint,
      schedule,
      enrollmentStatus,
      windowPassed,
      enrolledClassIds,
    });
    const teacherId = session.teacher_id || schedule?.teacher_id || null;
    const teacherName = teacherId ? teachersById.get(teacherId) || null : null;
    const detail = buildSessionDetail(session, sprint, schedule, teacherName, badge, enrolledClassIds);
    if (teacherName) detail.teacherName = teacherName;
    detailsByNumber[n] = detail;
    if (n === 2) view.session2 = badge;
    if (n === 3) view.session3 = badge;
  }

  return view;
}

export function buildLearnerBookingViews(args: {
  learnerIds: string[];
  enrollments: EnrollmentRef[];
  sprints: SprintRow[];
  sessions: LiveSessionRow[];
  schedules: ClassScheduleInfo[];
  teachersById: Map<string, string>;
  now?: Date;
  classEnrollments?: ClassEnrollmentRef[];
}): Map<string, LearnerBookingView> {
  const { learnerIds, enrollments, sprints, sessions, schedules, teachersById, now, classEnrollments } = args;

  const enrollmentByLearner = indexPreferredEnrollmentsByLearner(enrollments);

  const sprintsByEnrollment = new Map<string, SprintRow[]>();
  for (const sprint of sprints) {
    const list = sprintsByEnrollment.get(sprint.enrollment_id) || [];
    list.push(sprint);
    sprintsByEnrollment.set(sprint.enrollment_id, list);
  }

  const sessionsBySprint = new Map<string, LiveSessionRow[]>();
  for (const session of sessions) {
    const list = sessionsBySprint.get(session.sprint_id) || [];
    list.push(session);
    sessionsBySprint.set(session.sprint_id, list);
  }

  const schedulesByClassId = new Map<string, ClassScheduleInfo>();
  for (const schedule of schedules) {
    if (!schedulesByClassId.has(schedule.class_id)) {
      schedulesByClassId.set(schedule.class_id, schedule);
    }
  }

  const classIdsByLearner = new Map<string, Set<string>>();
  for (const row of classEnrollments || []) {
    const set = classIdsByLearner.get(row.student_id) || new Set<string>();
    set.add(row.class_id);
    classIdsByLearner.set(row.student_id, set);
  }
  const requireEnrollment = classEnrollments !== undefined;

  const views = new Map<string, LearnerBookingView>();
  for (const learnerId of learnerIds) {
    const enrollment = enrollmentByLearner.get(learnerId);
    if (!enrollment) {
      views.set(learnerId, emptyView());
      continue;
    }
    const learnerSprints = sprintsByEnrollment.get(enrollment.id) || [];
    const currentSprint = selectCurrentAdminSprint(learnerSprints);
    const currentSessions = currentSprint ? sessionsBySprint.get(currentSprint.id) || [] : [];
    views.set(
      learnerId,
      buildLearnerBookingView({
        sprint: currentSprint,
        sessions: currentSessions,
        enrollmentStatus: enrollment.status,
        schedulesByClassId,
        teachersById,
        now,
        enrolledClassIds: requireEnrollment ? classIdsByLearner.get(learnerId) || new Set() : undefined,
      })
    );
  }

  return views;
}
