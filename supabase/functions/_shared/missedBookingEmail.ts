/**
 * Missed Sunday-booking reminder orchestration.
 * Runtime + tests: supabase/functions/_shared (Phase 1 canonical email system).
 *
 * Dedicated scanner (notify-missed-booking). Does not reuse detect-sprint-late
 * or enforce-deadlines. Late/Booked comes from adminLearnerBooking — same as Admin Learners.
 */
import {
  isSendEmailAuthExemptMethod,
  isTrustedSendEmailCaller,
  isValidRecipientEmail,
  recordSkippedEmail,
  sendTransactionalEmail,
  type EmailProvider,
  type EmailStore,
  type SendTransactionalResult,
} from "./emailLogic.ts";
import { renderEmailTemplate, type MissedBookingData } from "./emailTemplates.ts";
import {
  buildLearnerBookingViews,
  hasLateFilterMatch,
  indexPreferredEnrollmentsByLearner,
  type BookingBadge,
  type ClassEnrollmentRef,
  type ClassScheduleInfo,
  type EnrollmentRef,
  type LiveSessionRow,
  type SprintRow,
} from "./adminLearnerBooking.ts";
import { selectCurrentAdminSprint } from "./adminSprintSelection.ts";
import { hasSundayBookingWindowPassed, vietnamMostRecentSundayYmd } from "./vietnamTime.ts";

export { isSendEmailAuthExemptMethod, isTrustedSendEmailCaller as isTrustedMissedBookingCaller };

const OPERATIONAL_ENROLLMENT_STATUSES = new Set(["active", "paused"]);

export interface MissedBookingProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  role?: string | null;
  is_active?: boolean | null;
}

export interface MissedBookingEnrollment extends EnrollmentRef {
  course_id?: string | null;
}

export interface MissedBookingCourse {
  id: string;
  name: string | null;
}

export interface MissedBookingScanInput {
  now: Date;
  profiles: MissedBookingProfile[];
  enrollments: MissedBookingEnrollment[];
  sprints: SprintRow[];
  sessions: LiveSessionRow[];
  schedules: ClassScheduleInfo[];
  classEnrollments: ClassEnrollmentRef[];
  courses?: MissedBookingCourse[];
}

export interface MissedBookingCandidate {
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  enrollmentId: string;
  sprintId: string;
  sprintNumber: number;
  courseName: string | null;
  session2: BookingBadge | null;
  session3: BookingBadge | null;
  lateSessionsVi: string;
  lateSessionsEn: string;
  idempotencyKey: string;
}

export interface MissedBookingScanSummary {
  dryRun: boolean;
  windowPassed: boolean;
  sundayYmd: string;
  totalScanned: number;
  totalLateLearners: number;
  learners: Array<{
    learner_id: string;
    enrollment_id: string;
    sprint_id: string;
    sprint_number: number;
    email: string | null;
    name: string;
    session2: BookingBadge | null;
    session3: BookingBadge | null;
  }>;
}

export interface MissedBookingScanResult extends MissedBookingScanSummary {
  sent: number;
  skipped: number;
  failed: number;
  deliveries: Array<{ learnerId: string; result: SendTransactionalResult }>;
}

export function missedBookingIdempotencyKey(args: {
  enrollmentId: string;
  sprintId: string;
  sundayYmd: string;
}): string {
  return `missed-booking:${args.enrollmentId}:${args.sprintId}:${args.sundayYmd}`;
}

/** Localized Late-session labels for the bilingual missed-booking template. */
export function formatLateSessionsLabel(
  session2: BookingBadge | null,
  session3: BookingBadge | null
): { vi: string; en: string } | null {
  const late: Array<2 | 3> = [];
  if (session2 === "late") late.push(2);
  if (session3 === "late") late.push(3);
  if (late.length === 0) return null;
  if (late.length === 2) {
    return { vi: "Buổi 2 và Buổi 3", en: "Session 2 and Session 3" };
  }
  const n = late[0];
  return { vi: `Buổi ${n}`, en: `Session ${n}` };
}

export function shouldSendMissedBookingEmail(view: {
  session2: BookingBadge | null;
  session3: BookingBadge | null;
}): boolean {
  return hasLateFilterMatch(view);
}

export function missedBookingTemplateData(candidate: MissedBookingCandidate): MissedBookingData {
  return {
    learner_name: candidate.learnerName || "Learner",
    late_sessions_vi: candidate.lateSessionsVi,
    late_sessions_en: candidate.lateSessionsEn,
    sprint_number: candidate.sprintNumber,
    course_name: candidate.courseName || undefined,
  };
}

export function parseMissedBookingRequestBody(body: unknown): { dryRun: boolean } {
  if (!body || typeof body !== "object") return { dryRun: false };
  const dry = (body as { dry_run?: unknown }).dry_run;
  return { dryRun: dry === true || dry === "true" };
}

export function guardMissedBookingRequest(args: {
  method: string | null | undefined;
  authorizationHeader: string | null | undefined;
  serviceRoleKey: string | null | undefined;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!isTrustedSendEmailCaller({
    authorizationHeader: args.authorizationHeader,
    serviceRoleKey: args.serviceRoleKey,
  })) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const method = (args.method || "").trim().toUpperCase();
  if (method !== "POST") {
    return { ok: false, status: 405, error: "Method not allowed" };
  }
  return { ok: true };
}

export function isOperationalMissedBookingLearner(profile: MissedBookingProfile, enrollmentStatus: string | undefined): boolean {
  if (profile.is_active === false) return false;
  if (profile.role && profile.role !== "learner") return false;
  if (!enrollmentStatus) return false;
  return OPERATIONAL_ENROLLMENT_STATUSES.has(enrollmentStatus);
}

/**
 * Current-sprint ids for operational enrollments — same selectCurrentAdminSprint
 * as Admin Learners. Used by the Edge Function to fetch only relevant sessions.
 */
export function currentSprintIdsForEnrollments(
  enrollments: EnrollmentRef[],
  sprints: SprintRow[]
): string[] {
  const sprintsByEnrollment = new Map<string, SprintRow[]>();
  for (const sprint of sprints) {
    const list = sprintsByEnrollment.get(sprint.enrollment_id) || [];
    list.push(sprint);
    sprintsByEnrollment.set(sprint.enrollment_id, list);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const enrollment of enrollments) {
    const current = selectCurrentAdminSprint(sprintsByEnrollment.get(enrollment.id) || []);
    if (current && !seen.has(current.id)) {
      seen.add(current.id);
      ids.push(current.id);
    }
  }
  return ids;
}

export function collectMissedBookingCandidates(input: MissedBookingScanInput): {
  windowPassed: boolean;
  sundayYmd: string;
  totalScanned: number;
  candidates: MissedBookingCandidate[];
} {
  const now = input.now;
  const sundayYmd = vietnamMostRecentSundayYmd(now);
  const windowPassed = hasSundayBookingWindowPassed(now);
  const courseNameById = new Map<string, string>();
  for (const course of input.courses || []) {
    if (course.name) courseNameById.set(course.id, course.name);
  }

  const enrollmentByLearner = indexPreferredEnrollmentsByLearner(input.enrollments);
  const operationalProfiles = input.profiles.filter((profile) => {
    const enrollment = enrollmentByLearner.get(profile.id);
    return isOperationalMissedBookingLearner(profile, enrollment?.status);
  });
  const operationalIds = operationalProfiles.map((p) => p.id);

  const sprintsByEnrollment = new Map<string, SprintRow[]>();
  for (const sprint of input.sprints) {
    const list = sprintsByEnrollment.get(sprint.enrollment_id) || [];
    list.push(sprint);
    sprintsByEnrollment.set(sprint.enrollment_id, list);
  }

  const views = buildLearnerBookingViews({
    learnerIds: operationalIds,
    enrollments: input.enrollments,
    sprints: input.sprints,
    sessions: input.sessions,
    schedules: input.schedules,
    teachersById: new Map(),
    now,
    classEnrollments: input.classEnrollments,
  });

  const candidates: MissedBookingCandidate[] = [];
  for (const profile of operationalProfiles) {
    const enrollment = enrollmentByLearner.get(profile.id);
    if (!enrollment) continue;
    const view = views.get(profile.id);
    if (!view || !shouldSendMissedBookingEmail(view)) continue;
    const lateSessions = formatLateSessionsLabel(view.session2, view.session3);
    if (!lateSessions) continue;
    const currentSprint = selectCurrentAdminSprint(sprintsByEnrollment.get(enrollment.id) || []);
    if (!currentSprint) continue;

    candidates.push({
      learnerId: profile.id,
      learnerName: (profile.full_name || "").trim() || "Learner",
      learnerEmail: profile.email,
      enrollmentId: enrollment.id,
      sprintId: currentSprint.id,
      sprintNumber: currentSprint.sprint_number,
      courseName: enrollment.course_id ? courseNameById.get(enrollment.course_id) || null : null,
      session2: view.session2,
      session3: view.session3,
      lateSessionsVi: lateSessions.vi,
      lateSessionsEn: lateSessions.en,
      idempotencyKey: missedBookingIdempotencyKey({
        enrollmentId: enrollment.id,
        sprintId: currentSprint.id,
        sundayYmd,
      }),
    });
  }

  return {
    windowPassed,
    sundayYmd,
    totalScanned: operationalProfiles.length,
    candidates,
  };
}

export function summarizeMissedBookingCandidates(
  collected: ReturnType<typeof collectMissedBookingCandidates>,
  dryRun: boolean
): MissedBookingScanSummary {
  return {
    dryRun,
    windowPassed: collected.windowPassed,
    sundayYmd: collected.sundayYmd,
    totalScanned: collected.totalScanned,
    totalLateLearners: collected.candidates.length,
    learners: collected.candidates.map((c) => ({
      learner_id: c.learnerId,
      enrollment_id: c.enrollmentId,
      sprint_id: c.sprintId,
      sprint_number: c.sprintNumber,
      email: c.learnerEmail,
      name: c.learnerName,
      session2: c.session2,
      session3: c.session3,
    })),
  };
}

export async function deliverMissedBookingEmail(
  deps: { store: EmailStore; provider: EmailProvider },
  candidate: MissedBookingCandidate,
  options?: { replyTo?: string | null; from?: string; now?: Date }
): Promise<SendTransactionalResult> {
  const template = "missed_booking";
  const rendered = renderEmailTemplate(template, missedBookingTemplateData(candidate));
  const metadata = {
    enrollment_id: candidate.enrollmentId,
    sprint_id: candidate.sprintId,
    sprint_number: candidate.sprintNumber,
    session2: candidate.session2,
    session3: candidate.session3,
    late_sessions_vi: candidate.lateSessionsVi,
    late_sessions_en: candidate.lateSessionsEn,
  };

  if (!isValidRecipientEmail(candidate.learnerEmail)) {
    return recordSkippedEmail(deps.store, {
      idempotencyKey: candidate.idempotencyKey,
      template,
      to: candidate.learnerEmail,
      userId: candidate.learnerId,
      metadata,
      reason: (candidate.learnerEmail || "").trim() ? "invalid_email" : "missing_email",
      now: options?.now,
    });
  }

  return sendTransactionalEmail(deps, {
    idempotencyKey: candidate.idempotencyKey,
    template,
    to: candidate.learnerEmail!.trim(),
    subject: rendered.subject,
    html: rendered.html,
    userId: candidate.learnerId,
    metadata,
    from: options?.from,
    replyTo: options?.replyTo,
    now: options?.now,
  });
}

/**
 * Scan + optional send. Dry-run never writes email_events and never calls the provider.
 * Non-late learners are not recorded — a later unlock in the same week can still email.
 */
export async function executeMissedBookingScan(
  deps: { store: EmailStore; provider: EmailProvider },
  input: MissedBookingScanInput,
  options?: { dryRun?: boolean; replyTo?: string | null; from?: string }
): Promise<MissedBookingScanResult> {
  const dryRun = !!options?.dryRun;
  const collected = collectMissedBookingCandidates(input);
  const summary = summarizeMissedBookingCandidates(collected, dryRun);

  if (dryRun) {
    return { ...summary, sent: 0, skipped: 0, failed: 0, deliveries: [] };
  }

  const deliveries: Array<{ learnerId: string; result: SendTransactionalResult }> = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of collected.candidates) {
    const result = await deliverMissedBookingEmail(deps, candidate, {
      replyTo: options?.replyTo,
      from: options?.from,
      now: input.now,
    });
    deliveries.push({ learnerId: candidate.learnerId, result });
    if (!result.ok) failed += 1;
    else if (result.already_processed) skipped += 1;
    else if (result.status === "sent") sent += 1;
    else if (result.status === "skipped") skipped += 1;
    else failed += 1;
  }

  return { ...summary, sent, skipped, failed, deliveries };
}
