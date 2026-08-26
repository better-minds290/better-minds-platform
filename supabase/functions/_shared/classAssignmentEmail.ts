/**
 * Admin class-assignment email orchestration.
 * Runtime + tests: supabase/functions/_shared (Phase 1 canonical email system).
 * Trigger only after a successful Admin assignment — never from the frontend.
 */
import {
  isValidRecipientEmail,
  recordSkippedEmail,
  sendTransactionalEmail,
  type EmailProvider,
  type EmailStore,
  type SendTransactionalResult,
} from "./emailLogic.ts";
import {
  renderEmailTemplate,
  type ClassAssignmentData,
} from "./emailTemplates.ts";

const CANCELLED_SCHEDULE_STATUSES = new Set(["cancelled", "canceled", "deleted"]);

/** Actions that can create or move a class relationship. */
export type ClassBookingAction =
  | "admin_assign"
  | "reschedule"
  | "book_class"
  | "enrollment_cancel"
  | "enrollment_reassign";

/**
 * Only Admin-created class assignment sends this template pair.
 * Learner self-book (`book_class`) and learner self-reschedule (`reschedule`) do not.
 * `enrollment_reassign` is an unused UI path; emails stay on `admin_assign` only.
 */
export function shouldSendAdminClassAssignmentEmail(action: ClassBookingAction): boolean {
  return action === "admin_assign";
}

export interface ClassAssignmentSnapshot {
  sprintSessionId: string;
  learnerId: string;
  teacherId: string;
  classId: string;
  classScheduleId: string;
  sessionNumber: number;
  sprintNumber: number;
  classDate: string;
  startTime: string;
  endTime: string;
  courseName?: string | null;
  meetingLink?: string | null;
  learnerName: string;
  teacherName: string;
  learnerEmail: string | null;
  teacherEmail: string | null;
  enrolled: boolean;
  scheduleStatus: string | null;
  addedToExistingClass?: boolean;
  durationMinutes?: number | null;
}

export function classAssignmentIdempotencyKey(args: {
  role: "learner" | "teacher";
  sprintSessionId: string;
  learnerId: string;
  teacherId: string;
  classScheduleId: string;
}): string {
  if (args.role === "learner") {
    return `class_assignment:${args.sprintSessionId}:learner:${args.learnerId}:${args.classScheduleId}`;
  }
  return `class_assignment:${args.sprintSessionId}:teacher:${args.teacherId}:${args.classScheduleId}:${args.learnerId}`;
}

export function formatClassAssignmentDate(ymd: string): string {
  const raw = (ymd || "").trim();
  const d = new Date(`${raw}T12:00:00+07:00`);
  if (!raw || Number.isNaN(d.getTime())) return raw;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatClassAssignmentTime(time: string): string {
  const t = (time || "").trim();
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export function durationMinutesFromTimes(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return null;
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes > 0 ? minutes : null;
}

/**
 * Same real-booking rule as Admin Learners: class + non-cancelled schedule + enrollment.
 * `scheduled_at` alone is not a booking.
 */
export function isRealClassAssignment(snapshot: ClassAssignmentSnapshot): boolean {
  if (!snapshot.sprintSessionId || !snapshot.learnerId || !snapshot.teacherId) return false;
  if (!snapshot.classId || !snapshot.classScheduleId) return false;
  if (!snapshot.enrolled) return false;
  if (CANCELLED_SCHEDULE_STATUSES.has((snapshot.scheduleStatus || "").toLowerCase())) return false;
  return true;
}

export function classAssignmentTemplateData(snapshot: ClassAssignmentSnapshot): ClassAssignmentData {
  const duration =
    snapshot.durationMinutes && snapshot.durationMinutes > 0
      ? snapshot.durationMinutes
      : durationMinutesFromTimes(snapshot.startTime, snapshot.endTime);
  return {
    learner_name: snapshot.learnerName || "Learner",
    teacher_name: snapshot.teacherName || "Teacher",
    session_number: snapshot.sessionNumber,
    sprint_number: snapshot.sprintNumber,
    class_date: formatClassAssignmentDate(snapshot.classDate),
    start_time: formatClassAssignmentTime(snapshot.startTime),
    end_time: formatClassAssignmentTime(snapshot.endTime),
    course_name: snapshot.courseName || undefined,
    meeting_link: snapshot.meetingLink || undefined,
    added_to_existing_class: snapshot.addedToExistingClass,
    duration_minutes: duration ?? undefined,
  };
}

export type AssignmentRecipientResult =
  | SendTransactionalResult
  | { ok: true; already_processed: false; status: "not_a_real_booking"; reason: string; eventId: null };

export interface AdminClassAssignmentEmailResult {
  assignmentUnaffected: true;
  learner: AssignmentRecipientResult;
  teacher: AssignmentRecipientResult;
}

function keyArgs(snapshot: ClassAssignmentSnapshot) {
  return {
    sprintSessionId: snapshot.sprintSessionId,
    learnerId: snapshot.learnerId,
    teacherId: snapshot.teacherId,
    classScheduleId: snapshot.classScheduleId,
  };
}

async function deliverRecipient(
  deps: { store: EmailStore; provider: EmailProvider },
  args: {
    snapshot: ClassAssignmentSnapshot;
    role: "learner" | "teacher";
    template: "class_assignment_learner" | "class_assignment_teacher";
    email: string | null;
    userId: string;
    subject: string;
    html: string;
    replyTo?: string | null;
    from?: string;
    now?: Date;
  }
): Promise<SendTransactionalResult> {
  const idempotencyKey = classAssignmentIdempotencyKey({ role: args.role, ...keyArgs(args.snapshot) });
  const metadata = {
    role: args.role,
    sprint_session_id: args.snapshot.sprintSessionId,
    learner_id: args.snapshot.learnerId,
    teacher_id: args.snapshot.teacherId,
    class_schedule_id: args.snapshot.classScheduleId,
    class_id: args.snapshot.classId,
    added_to_existing_class: !!args.snapshot.addedToExistingClass,
  };

  if (!isValidRecipientEmail(args.email)) {
    return recordSkippedEmail(deps.store, {
      idempotencyKey,
      template: args.template,
      to: args.email,
      userId: args.userId,
      metadata,
      reason: (args.email || "").trim() ? "invalid_email" : "missing_email",
      now: args.now,
    });
  }

  return sendTransactionalEmail(deps, {
    idempotencyKey,
    template: args.template,
    to: args.email!.trim(),
    subject: args.subject,
    html: args.html,
    userId: args.userId,
    metadata,
    from: args.from,
    replyTo: args.replyTo,
    now: args.now,
  });
}

/**
 * Send learner + teacher assignment emails after Admin assignment has already committed.
 * Never throws. Email failure is recorded on email_events and does not affect assignment.
 */
export async function deliverAdminClassAssignmentEmails(
  deps: { store: EmailStore; provider: EmailProvider },
  snapshot: ClassAssignmentSnapshot,
  options?: { replyTo?: string | null; from?: string; now?: Date }
): Promise<AdminClassAssignmentEmailResult> {
  try {
    if (!isRealClassAssignment(snapshot)) {
      return {
        assignmentUnaffected: true,
        learner: {
          ok: true,
          already_processed: false,
          status: "not_a_real_booking",
          reason: "not_a_real_booking",
          eventId: null,
        },
        teacher: {
          ok: true,
          already_processed: false,
          status: "not_a_real_booking",
          reason: "not_a_real_booking",
          eventId: null,
        },
      };
    }

    const data = classAssignmentTemplateData(snapshot);
    const learnerMail = renderEmailTemplate("class_assignment_learner", data);
    const teacherMail = renderEmailTemplate("class_assignment_teacher", data);

    const learner = await deliverRecipient(deps, {
      snapshot,
      role: "learner",
      template: "class_assignment_learner",
      email: snapshot.learnerEmail,
      userId: snapshot.learnerId,
      subject: learnerMail.subject,
      html: learnerMail.html,
      replyTo: options?.replyTo,
      from: options?.from,
      now: options?.now,
    });

    const teacher = await deliverRecipient(deps, {
      snapshot,
      role: "teacher",
      template: "class_assignment_teacher",
      email: snapshot.teacherEmail,
      userId: snapshot.teacherId,
      subject: teacherMail.subject,
      html: teacherMail.html,
      replyTo: options?.replyTo,
      from: options?.from,
      now: options?.now,
    });

    return { assignmentUnaffected: true, learner, teacher };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      assignmentUnaffected: true,
      learner: { ok: false, already_processed: false, status: "error", error, eventId: null },
      teacher: { ok: false, already_processed: false, status: "error", error, eventId: null },
    };
  }
}

/** Assignment success is independent of email. */
export async function afterSuccessfulAdminAssignment(
  sendEmails: () => Promise<unknown>
): Promise<{ assignmentSuccess: true }> {
  try {
    await sendEmails();
  } catch {
    /* email must never roll back assignment */
  }
  return { assignmentSuccess: true };
}
