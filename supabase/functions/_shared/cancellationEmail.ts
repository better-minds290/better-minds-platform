/**
 * Admin teacher-unavailable cancellation email.
 * Runtime + tests: supabase/functions/_shared (Phase 1 canonical email system).
 * Trigger only after admin-manage-enrollment cancel with reason teacher_unavailable.
 */
import {
  isValidRecipientEmail,
  recordSkippedEmail,
  sendTransactionalEmail,
  type EmailProvider,
  type EmailStore,
  type SendTransactionalResult,
} from "./emailLogic.ts";
import { formatClassAssignmentDate, formatClassAssignmentTime } from "./classAssignmentEmail.ts";
import { renderEmailTemplate, type ClassCancelledTeacherUnavailableData } from "./emailTemplates.ts";

export const CANCEL_REASONS = ["teacher_unavailable", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export type CancellationEmailSource =
  | "admin_cancel"
  | "admin_assign"
  | "learner_cancel"
  | "enrollment_reassign";

export type ParseCancelReasonResult =
  | { ok: true; reason: CancelReason }
  | { ok: false; error: string };

/** Omitted/blank → other (backward compatible). Unknown strings are rejected. */
export function parseCancelReason(value: unknown): ParseCancelReasonResult {
  if (value == null) return { ok: true, reason: "other" };
  if (typeof value !== "string") return { ok: false, error: "Invalid cancel reason" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, reason: "other" };
  if (trimmed === "teacher_unavailable" || trimmed === "other") {
    return { ok: true, reason: trimmed };
  }
  return { ok: false, error: "Invalid cancel reason" };
}

export function shouldSendTeacherUnavailableCancellationEmail(args: {
  source: CancellationEmailSource;
  reason: CancelReason;
}): boolean {
  return args.source === "admin_cancel" && args.reason === "teacher_unavailable";
}

export function classRemovalIdempotencyKey(args: {
  learnerId: string;
  sprintSessionId: string;
  classScheduleId: string;
}): string {
  return `class_removal:${args.learnerId}:${args.sprintSessionId}:${args.classScheduleId}:teacher_unavailable`;
}

export interface CancellationEmailSnapshot {
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  teacherName: string;
  sprintSessionId: string;
  classScheduleId: string;
  sessionNumber: string | number;
  sprintNumber?: string | number | null;
  courseName?: string | null;
  classDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

/** Learner in-app copy after Admin cancel. teacher_unavailable matches the email; other keeps self-book. */
export function buildLearnerCancelInAppNotification(args: {
  reason: CancelReason;
  className: string;
  teacherName: string;
  sessionLabel?: string;
}): { title: string; message: string; actionUrl: string } {
  const sessionBit = args.sessionLabel ? ` (${args.sessionLabel})` : "";
  if (args.reason === "teacher_unavailable") {
    return {
      title: "Lớp đã hủy — giáo viên bận đột xuất / Class cancelled — teacher unavailable",
      message:
        `Lớp "${args.className}" với ${args.teacherName}${sessionBit} đã bị hủy vì giáo viên đột xuất bận lịch. Admin có thể hỗ trợ xếp buổi học bù. Vui lòng theo dõi email hoặc liên hệ Admin.` +
        "\n\n" +
        `Class "${args.className}" with ${args.teacherName}${sessionBit} was cancelled because the teacher has an unexpected schedule conflict. Admin can help arrange a makeup class. Please watch your email or contact Admin.`,
      actionUrl: "/dashboard",
    };
  }
  return {
    title: "Admin Đã Hủy Buổi Học Của Bạn",
    message: `Admin đã hủy đăng ký của bạn khỏi lớp "${args.className}" với ${args.teacherName}${sessionBit}. Vui lòng đặt lịch lại.`,
    actionUrl: "/booking",
  };
}

export function cancellationTemplateData(
  snapshot: CancellationEmailSnapshot,
  replyToConfigured: boolean
): ClassCancelledTeacherUnavailableData {
  const rawDate = (snapshot.classDate || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? formatClassAssignmentDate(rawDate) : rawDate;
  return {
    learner_name: snapshot.learnerName || "Learner",
    teacher_name: snapshot.teacherName || "Teacher",
    session_number: snapshot.sessionNumber ?? "",
    sprint_number: snapshot.sprintNumber ?? undefined,
    course_name: snapshot.courseName || undefined,
    class_date: date || "",
    start_time: snapshot.startTime ? formatClassAssignmentTime(String(snapshot.startTime)) : undefined,
    end_time: snapshot.endTime ? formatClassAssignmentTime(String(snapshot.endTime)) : undefined,
    reply_to_configured: replyToConfigured,
  };
}

export async function afterSuccessfulCancellation(
  sendEmails: () => Promise<unknown>
): Promise<{ cancelSuccess: true }> {
  try {
    await sendEmails();
  } catch {
    /* email must never roll back cancellation */
  }
  return { cancelSuccess: true };
}

export async function deliverTeacherUnavailableCancellationEmail(
  deps: { store: EmailStore; provider: EmailProvider },
  snapshot: CancellationEmailSnapshot,
  options?: { replyTo?: string | null; from?: string; now?: Date }
): Promise<{ cancelUnaffected: true; result: SendTransactionalResult }> {
  try {
    const sprintSessionId = String(snapshot.sprintSessionId || "").trim() || "none";
    const classScheduleId = String(snapshot.classScheduleId || "").trim() || "none";
    const idempotencyKey = classRemovalIdempotencyKey({
      learnerId: snapshot.learnerId,
      sprintSessionId,
      classScheduleId,
    });
    const template = "class_cancelled_teacher_unavailable";
    const replyToConfigured = !!(options?.replyTo && String(options.replyTo).trim());
    const rendered = renderEmailTemplate(template, cancellationTemplateData(snapshot, replyToConfigured));
    const metadata = {
      reason: "teacher_unavailable",
      learner_id: snapshot.learnerId,
      sprint_session_id: sprintSessionId,
      class_schedule_id: classScheduleId,
    };

    if (!isValidRecipientEmail(snapshot.learnerEmail)) {
      const result = await recordSkippedEmail(deps.store, {
        idempotencyKey,
        template,
        to: snapshot.learnerEmail,
        userId: snapshot.learnerId,
        metadata,
        reason: (snapshot.learnerEmail || "").trim() ? "invalid_email" : "missing_email",
        now: options?.now,
      });
      return { cancelUnaffected: true, result };
    }

    const result = await sendTransactionalEmail(deps, {
      idempotencyKey,
      template,
      to: snapshot.learnerEmail!.trim(),
      subject: rendered.subject,
      html: rendered.html,
      userId: snapshot.learnerId,
      metadata,
      from: options?.from,
      replyTo: options?.replyTo,
      now: options?.now,
    });
    return { cancelUnaffected: true, result };
  } catch (err) {
    return {
      cancelUnaffected: true,
      result: {
        ok: false,
        already_processed: false,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        eventId: null,
      },
    };
  }
}
