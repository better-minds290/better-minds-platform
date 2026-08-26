/**
 * Absence-recorded email orchestration.
 * Runtime + tests: supabase/functions/_shared (Phase 1 canonical email system).
 * Trigger only after mark_absent successfully inserts learner_attendance.
 */
import {
  isValidRecipientEmail,
  recordSkippedEmail,
  sendTransactionalEmail,
  type EmailProvider,
  type EmailStore,
  type SendTransactionalResult,
} from "./emailLogic.ts";
import { formatClassAssignmentDate } from "./classAssignmentEmail.ts";
import { renderEmailTemplate, type AbsenceRecordedData } from "./emailTemplates.ts";

/** Same limit as Admin Reports and record-learner-attendance mark_absent. */
export const ABSENCE_LIMIT = 5;

export type AttendanceAction = "mark_absent" | "reopen_absent" | "detect_sprint_late" | string;

export interface AbsenceCountRow {
  id: string;
  learner_id: string;
  enrollment_id?: string | null;
  course_name?: string | null;
  type: string;
  resolved?: boolean;
}

export interface AbsenceEmailSnapshot {
  learnerAttendanceId: string;
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  sessionNumber: string | number | null;
  sprintNumber: string | number | null;
  courseName?: string | null;
  classDate?: string | null;
  classTime?: string | null;
  absenceCount: number;
  absenceLimit?: number;
}

/**
 * Send only after a new authoritative absent_session row is created.
 * already_absent, reopen, and session_attendance-only edits do not send.
 */
export function shouldSendAbsenceRecordedEmail(args: {
  action: AttendanceAction;
  alreadyAbsent?: boolean;
  learnerAttendanceId?: string | null;
}): boolean {
  if (args.action !== "mark_absent") return false;
  if (args.alreadyAbsent) return false;
  return !!(args.learnerAttendanceId && String(args.learnerAttendanceId).trim());
}

export function absenceIdempotencyKey(learnerAttendanceId: string): string {
  return `absence:${learnerAttendanceId}`;
}

/**
 * Same scope as mark_absent / Admin Reports:
 * learner_attendance.type = absent_session, including resolved rows.
 * Prefer enrollment_id; else course_name; else learner-wide.
 */
export function countAuthoritativeAbsences(
  rows: AbsenceCountRow[],
  scope: { learnerId: string; enrollmentId?: string | null; courseName?: string | null }
): number {
  return rows.filter((row) => {
    if (row.type !== "absent_session") return false;
    if (row.learner_id !== scope.learnerId) return false;
    if (scope.enrollmentId) return (row.enrollment_id || null) === scope.enrollmentId;
    if (scope.courseName) return (row.course_name || "") === scope.courseName;
    return true;
  }).length;
}

export function buildAbsenceInAppNotification(args: {
  sprintNumber?: string | number | null;
  sessionNumber?: string | number | null;
  courseName?: string | null;
  absenceCount: number;
  absenceLimit?: number;
}): { title: string; message: string } {
  const limit = args.absenceLimit ?? ABSENCE_LIMIT;
  const sprintLabel = args.sprintNumber ? ` Sprint ${args.sprintNumber}` : "";
  const sessionLabel = args.sessionNumber ? ` Buổi ${args.sessionNumber}` : "";
  const courseLabel = args.courseName ? ` (${args.courseName})` : "";
  return {
    title: `Bạn Đã Vắng Buổi Học${sprintLabel}${sessionLabel}`,
    message: `Bạn đã được ghi nhận vắng buổi học này${courseLabel}. Bạn hiện đã vắng ${args.absenceCount}/${limit} buổi.`,
  };
}

export function absenceTemplateData(snapshot: AbsenceEmailSnapshot): AbsenceRecordedData {
  const rawDate = (snapshot.classDate || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? formatClassAssignmentDate(rawDate) : rawDate;
  const time = (snapshot.classTime || "").trim();
  return {
    learner_name: snapshot.learnerName || "Learner",
    session_number: snapshot.sessionNumber ?? "",
    sprint_number: snapshot.sprintNumber ?? "",
    absence_count: snapshot.absenceCount,
    absence_limit: snapshot.absenceLimit ?? ABSENCE_LIMIT,
    course_name: snapshot.courseName || undefined,
    class_date: date || undefined,
    class_time: time || undefined,
  };
}

export async function afterSuccessfulAbsence(
  sendEmails: () => Promise<unknown>
): Promise<{ absenceSuccess: true }> {
  try {
    await sendEmails();
  } catch {
    /* email must never roll back the absence */
  }
  return { absenceSuccess: true };
}

export async function deliverAbsenceRecordedEmail(
  deps: { store: EmailStore; provider: EmailProvider },
  snapshot: AbsenceEmailSnapshot,
  options?: { replyTo?: string | null; from?: string; now?: Date }
): Promise<{ absenceUnaffected: true; result: SendTransactionalResult }> {
  try {
    const id = String(snapshot.learnerAttendanceId || "").trim();
    if (!id) {
      return {
        absenceUnaffected: true,
        result: {
          ok: true,
          already_processed: true,
          status: "skipped",
          reason: "missing_attendance_id",
          eventId: null,
        },
      };
    }

    const idempotencyKey = absenceIdempotencyKey(id);
    const template = "absence_recorded";
    const rendered = renderEmailTemplate(template, absenceTemplateData(snapshot));
    const metadata = {
      learner_attendance_id: id,
      learner_id: snapshot.learnerId,
      absence_count: snapshot.absenceCount,
      absence_limit: snapshot.absenceLimit ?? ABSENCE_LIMIT,
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
      return { absenceUnaffected: true, result };
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
    return { absenceUnaffected: true, result };
  } catch (err) {
    return {
      absenceUnaffected: true,
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
