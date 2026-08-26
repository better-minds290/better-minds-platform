/**
 * Deno I/O adapter around canonical emailLogic.
 * Imports only _shared modules so `supabase functions deploy` can bundle this.
 */
import {
  buildResendEmailPayload,
  sendTransactionalEmail as sendTransactionalWithPorts,
  type EmailClaimSpec,
  type EmailEventRow,
  type EmailEventStatus,
  type EmailStore,
  type SendTransactionalInput,
  type SendTransactionalResult,
} from "./emailLogic.ts";
import {
  afterSuccessfulAdminAssignment,
  deliverAdminClassAssignmentEmails,
  type AdminClassAssignmentEmailResult,
  type ClassAssignmentSnapshot,
} from "./classAssignmentEmail.ts";
import {
  afterSuccessfulAbsence,
  deliverAbsenceRecordedEmail,
  type AbsenceEmailSnapshot,
} from "./absenceEmail.ts";
import {
  afterSuccessfulCancellation,
  deliverTeacherUnavailableCancellationEmail,
  type CancellationEmailSnapshot,
} from "./cancellationEmail.ts";
import {
  executeMissedBookingScan,
  type MissedBookingScanInput,
  type MissedBookingScanResult,
} from "./missedBookingEmail.ts";

export {
  buildResendEmailPayload,
  claimSpecForReason,
  decideEmailSendAction,
  DEFAULT_EMAIL_FROM,
  isSendEmailAuthExemptMethod,
  isTrustedSendEmailCaller,
  isValidRecipientEmail,
  normalizeOptionalEmail,
  recordSkippedEmail,
  resolveReplyTo,
  STALE_QUEUED_MS,
  type EmailClaimSpec,
  type EmailEventStatus,
  type SendTransactionalResult,
} from "./emailLogic.ts";

export {
  afterSuccessfulAdminAssignment,
  classAssignmentIdempotencyKey,
  deliverAdminClassAssignmentEmails,
  shouldSendAdminClassAssignmentEmail,
  type ClassAssignmentSnapshot,
} from "./classAssignmentEmail.ts";

export {
  ABSENCE_LIMIT,
  afterSuccessfulAbsence,
  absenceIdempotencyKey,
  buildAbsenceInAppNotification,
  countAuthoritativeAbsences,
  deliverAbsenceRecordedEmail,
  shouldSendAbsenceRecordedEmail,
  type AbsenceEmailSnapshot,
} from "./absenceEmail.ts";

export {
  afterSuccessfulCancellation,
  buildLearnerCancelInAppNotification,
  classRemovalIdempotencyKey,
  deliverTeacherUnavailableCancellationEmail,
  parseCancelReason,
  shouldSendTeacherUnavailableCancellationEmail,
  type CancelReason,
  type CancellationEmailSnapshot,
} from "./cancellationEmail.ts";

export {
  collectMissedBookingCandidates,
  currentSprintIdsForEnrollments,
  executeMissedBookingScan,
  guardMissedBookingRequest,
  missedBookingIdempotencyKey,
  parseMissedBookingRequestBody,
  isTrustedMissedBookingCaller,
  type MissedBookingScanInput,
  type MissedBookingScanResult,
} from "./missedBookingEmail.ts";

export async function sendRawViaResend(args: {
  resendApiKey: string;
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const payload = buildResendEmailPayload({
    to: args.to,
    subject: args.subject,
    html: args.html,
    from: args.from,
    replyTo: args.replyTo,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + args.resendApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: errBody || "Failed to send email", status: res.status };
    }

    const data = await res.json();
    return { ok: true, id: data.id || "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  }
}

function asStatus(value: unknown): EmailEventStatus | null {
  if (value === "queued" || value === "sent" || value === "failed" || value === "skipped") return value;
  return null;
}

function mapRow(row: Record<string, unknown>): EmailEventRow | null {
  const status = asStatus(row.status);
  if (!status || !row.id) return null;
  return {
    id: String(row.id),
    idempotency_key: String(row.idempotency_key || ""),
    template: String(row.template || ""),
    user_id: row.user_id == null ? null : String(row.user_id),
    to_email: String(row.to_email || ""),
    status,
    provider_id: row.provider_id == null ? null : String(row.provider_id),
    error: row.error == null ? null : String(row.error),
    metadata: (row.metadata as Record<string, unknown> | null) || null,
    created_at: String(row.created_at || ""),
    sent_at: row.sent_at == null ? null : String(row.sent_at),
    updated_at: String(row.updated_at || ""),
  };
}

function createSupabaseEmailStore(supabase: { from: (table: string) => any }): EmailStore {
  const cols =
    "id, idempotency_key, template, user_id, to_email, status, provider_id, error, metadata, created_at, sent_at, updated_at";

  return {
    async findByIdempotencyKey(key: string) {
      const { data, error } = await supabase
        .from("email_events")
        .select(cols)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapRow(data) : null;
    },

    async insertQueued(input) {
      const nowIso = input.now.toISOString();
      const { data, error } = await supabase
        .from("email_events")
        .insert({
          idempotency_key: input.idempotency_key,
          template: input.template,
          user_id: input.user_id,
          to_email: input.to_email,
          status: "queued",
          metadata: input.metadata,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select(cols)
        .single();

      if (error?.code === "23505") {
        const { data: existing, error: findErr } = await supabase
          .from("email_events")
          .select(cols)
          .eq("idempotency_key", input.idempotency_key)
          .maybeSingle();
        if (findErr) throw new Error(findErr.message);
        const row = existing ? mapRow(existing) : null;
        if (!row) throw new Error("Unique conflict but row not found");
        return { row, conflict: true };
      }
      if (error || !data) throw new Error(error?.message || "Failed to insert email_events");
      const row = mapRow(data);
      if (!row) throw new Error("Inserted email_events row was unreadable");
      return { row, conflict: false };
    },

    async insertSkipped(input) {
      const nowIso = input.now.toISOString();
      const { data, error } = await supabase
        .from("email_events")
        .insert({
          idempotency_key: input.idempotency_key,
          template: input.template,
          user_id: input.user_id,
          to_email: input.to_email,
          status: "skipped",
          metadata: input.metadata,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select(cols)
        .single();

      if (error?.code === "23505") {
        const { data: existing, error: findErr } = await supabase
          .from("email_events")
          .select(cols)
          .eq("idempotency_key", input.idempotency_key)
          .maybeSingle();
        if (findErr) throw new Error(findErr.message);
        const row = existing ? mapRow(existing) : null;
        if (!row) throw new Error("Unique conflict but row not found");
        return { row, conflict: true };
      }
      if (error || !data) throw new Error(error?.message || "Failed to insert skipped email_events");
      const row = mapRow(data);
      if (!row) throw new Error("Inserted email_events row was unreadable");
      return { row, conflict: false };
    },

    async claimForSend(id: string, spec: EmailClaimSpec, now: Date) {
      const nowIso = now.toISOString();
      let query = supabase
        .from("email_events")
        .update({ status: "queued", error: null, updated_at: nowIso })
        .eq("id", id);

      if (spec.mode === "failed") {
        query = query.eq("status", "failed");
      } else {
        query = query.eq("status", "queued").lte("updated_at", spec.staleBefore.toISOString());
      }

      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },

    async markSent(id: string, providerId: string, now: Date) {
      const { error } = await supabase
        .from("email_events")
        .update({
          status: "sent",
          provider_id: providerId,
          error: null,
          sent_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async markFailed(id: string, errorText: string, now: Date) {
      const { error } = await supabase
        .from("email_events")
        .update({
          status: "failed",
          error: errorText.slice(0, 2000),
          updated_at: now.toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Idempotent send used by future business Edge Functions.
 * Never throws. Uses the same claim rules as unit-tested emailLogic.
 */
export async function sendTransactionalEmail(args: {
  supabase: { from: (table: string) => any };
  resendApiKey: string;
  idempotencyKey: string;
  template: string;
  to: string;
  subject: string;
  html: string;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  from?: string;
  replyTo?: string | null;
}): Promise<SendTransactionalResult> {
  const store = createSupabaseEmailStore(args.supabase);
  const input: SendTransactionalInput = {
    idempotencyKey: args.idempotencyKey,
    template: args.template,
    to: args.to,
    subject: args.subject,
    html: args.html,
    userId: args.userId,
    metadata: args.metadata,
    from: args.from,
    replyTo: args.replyTo,
  };
  return sendTransactionalWithPorts(
    {
      store,
      provider: {
        async send(payload) {
          const sent = await sendRawViaResend({
            resendApiKey: args.resendApiKey,
            to: payload.to[0],
            subject: payload.subject,
            html: payload.html,
            from: payload.from,
            replyTo: payload.reply_to,
          });
          if (sent.ok) return { ok: true, providerId: sent.id };
          return { ok: false, error: sent.error };
        },
      },
    },
    input
  );
}

function resendProvider(resendApiKey: string): {
  send: (payload: {
    to: string[];
    subject: string;
    html: string;
    from: string;
    reply_to?: string;
  }) => Promise<{ ok: true; providerId: string } | { ok: false; error: string }>;
} {
  return {
    async send(payload) {
      const sent = await sendRawViaResend({
        resendApiKey,
        to: payload.to[0],
        subject: payload.subject,
        html: payload.html,
        from: payload.from,
        replyTo: payload.reply_to,
      });
      if (sent.ok) return { ok: true, providerId: sent.id };
      return { ok: false, error: sent.error };
    },
  };
}

/**
 * Send Admin class-assignment emails. Assignment is already committed;
 * failures are stored on email_events and do not throw past this function.
 */
export async function sendAdminClassAssignmentEmails(args: {
  supabase: { from: (table: string) => any };
  resendApiKey: string;
  snapshot: ClassAssignmentSnapshot;
  replyTo?: string | null;
}): Promise<AdminClassAssignmentEmailResult> {
  const store = createSupabaseEmailStore(args.supabase);
  return deliverAdminClassAssignmentEmails(
    { store, provider: resendProvider(args.resendApiKey) },
    args.snapshot,
    { replyTo: args.replyTo }
  );
}

export interface AdminAssignmentNotifyInput {
  supabase: { from: (table: string) => any };
  resendApiKey: string;
  replyTo?: string | null;
  learnerId: string;
  teacherId: string;
  sprintSessionId: string;
  classId: string;
  scheduleId: string | null;
  fallbackDate: string;
  fallbackStart: string;
  fallbackEnd: string;
  durationMinutes?: number | null;
  addedToExistingClass: boolean;
}

/**
 * Load authoritative rows AFTER Admin assignment succeeded, then email learner + teacher.
 * Swallows all errors so assignment is never rolled back or reported as failed.
 */
export async function notifyAdminClassAssignmentAfterSuccess(args: AdminAssignmentNotifyInput): Promise<{
  assignmentSuccess: true;
}> {
  return afterSuccessfulAdminAssignment(async () => {
    const supabase = args.supabase;

    let schedule: {
      id: string;
      date: string | null;
      start_time: string | null;
      end_time: string | null;
      status: string | null;
      class_id: string | null;
    } | null = null;

    if (args.scheduleId) {
      const { data } = await supabase
        .from("class_schedules")
        .select("id, date, start_time, end_time, status, class_id")
        .eq("id", args.scheduleId)
        .maybeSingle();
      schedule = data;
    }
    if (!schedule && args.classId) {
      const { data } = await supabase
        .from("class_schedules")
        .select("id, date, start_time, end_time, status, class_id")
        .eq("class_id", args.classId)
        .maybeSingle();
      schedule = data;
    }

    const { data: enrollmentRow } = await supabase
      .from("class_enrollments")
      .select("id")
      .eq("class_id", args.classId)
      .eq("student_id", args.learnerId)
      .maybeSingle();

    const { count: classSize } = await supabase
      .from("class_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("class_id", args.classId);

    const { data: learnerProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", args.learnerId)
      .maybeSingle();

    const { data: teacherProfile } = await supabase
      .from("profiles")
      .select("full_name, email, default_meeting_link")
      .eq("id", args.teacherId)
      .maybeSingle();

    const { data: sessionRow } = await supabase
      .from("sprint_sessions")
      .select("id, session_number, meeting_link, sprint_id, class_id, teacher_id")
      .eq("id", args.sprintSessionId)
      .maybeSingle();

    let sprintNumber = 0;
    let courseName: string | null = null;
    const sprintId = sessionRow?.sprint_id;
    if (sprintId) {
      const { data: sprintRow } = await supabase
        .from("learning_sprints")
        .select("sprint_number, enrollment_id")
        .eq("id", sprintId)
        .maybeSingle();
      sprintNumber = sprintRow?.sprint_number || 0;
      if (sprintRow?.enrollment_id) {
        const { data: enrollment } = await supabase
          .from("enrollments")
          .select("course_id")
          .eq("id", sprintRow.enrollment_id)
          .maybeSingle();
        if (enrollment?.course_id) {
          const { data: course } = await supabase
            .from("courses")
            .select("name")
            .eq("id", enrollment.course_id)
            .maybeSingle();
          courseName = course?.name || null;
        }
      }
    }

    const snapshot: ClassAssignmentSnapshot = {
      sprintSessionId: args.sprintSessionId,
      learnerId: args.learnerId,
      teacherId: args.teacherId,
      classId: args.classId,
      classScheduleId: schedule?.id || "",
      sessionNumber: sessionRow?.session_number || 0,
      sprintNumber,
      classDate: schedule?.date || args.fallbackDate,
      startTime: schedule?.start_time || args.fallbackStart,
      endTime: schedule?.end_time || args.fallbackEnd,
      courseName,
      meetingLink: sessionRow?.meeting_link || teacherProfile?.default_meeting_link || null,
      learnerName: learnerProfile?.full_name || "Learner",
      teacherName: teacherProfile?.full_name || "Teacher",
      learnerEmail: learnerProfile?.email || null,
      teacherEmail: teacherProfile?.email || null,
      enrolled: !!enrollmentRow,
      scheduleStatus: schedule?.status || null,
      addedToExistingClass: (classSize || 0) > 1 || args.addedToExistingClass,
      durationMinutes: args.durationMinutes ?? null,
    };

    await sendAdminClassAssignmentEmails({
      supabase,
      resendApiKey: args.resendApiKey,
      snapshot,
      replyTo: args.replyTo,
    });
  });
}

export interface AbsenceNotifyInput {
  supabase: { from: (table: string) => any };
  resendApiKey: string;
  replyTo?: string | null;
  learnerAttendanceId: string;
  learnerId: string;
  scheduleId?: string | null;
  sessionNumber?: string | number | null;
  sprintNumber?: string | number | null;
  courseName?: string | null;
  absenceCount: number;
  absenceLimit?: number;
  learnerNameHint?: string | null;
}

/**
 * Load learner profile + this learner's class schedule AFTER mark_absent succeeded.
 * Never loads other students. Email failure cannot fail the absence.
 */
export async function notifyAbsenceRecordedAfterSuccess(args: AbsenceNotifyInput): Promise<{
  absenceSuccess: true;
}> {
  return afterSuccessfulAbsence(async () => {
    const supabase = args.supabase;

    const { data: learnerProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", args.learnerId)
      .maybeSingle();

    let classDate: string | null = null;
    let classTime: string | null = null;
    if (args.scheduleId) {
      const { data: schedule } = await supabase
        .from("class_schedules")
        .select("date, start_time, end_time")
        .eq("id", args.scheduleId)
        .maybeSingle();
      classDate = schedule?.date || null;
      const start = schedule?.start_time ? String(schedule.start_time).slice(0, 5) : "";
      const end = schedule?.end_time ? String(schedule.end_time).slice(0, 5) : "";
      classTime = [start, end].filter(Boolean).join("–") || null;
    }

    const snapshot: AbsenceEmailSnapshot = {
      learnerAttendanceId: args.learnerAttendanceId,
      learnerId: args.learnerId,
      learnerName: learnerProfile?.full_name || args.learnerNameHint || "Learner",
      learnerEmail: learnerProfile?.email || null,
      sessionNumber: args.sessionNumber ?? "",
      sprintNumber: args.sprintNumber ?? "",
      courseName: args.courseName || null,
      classDate,
      classTime,
      absenceCount: args.absenceCount,
      absenceLimit: args.absenceLimit,
    };

    const store = createSupabaseEmailStore(args.supabase);
    await deliverAbsenceRecordedEmail(
      { store, provider: resendProvider(args.resendApiKey) },
      snapshot,
      { replyTo: args.replyTo }
    );
  });
}

/**
 * Send teacher-unavailable cancellation email using a snapshot captured BEFORE unlink/delete.
 * Never re-fetches class/schedule rows (they may already be gone).
 */
export async function notifyTeacherUnavailableCancellationAfterSuccess(args: {
  supabase: { from: (table: string) => any };
  resendApiKey: string;
  replyTo?: string | null;
  snapshot: CancellationEmailSnapshot;
}): Promise<{ cancelSuccess: true }> {
  return afterSuccessfulCancellation(async () => {
    const store = createSupabaseEmailStore(args.supabase);
    await deliverTeacherUnavailableCancellationEmail(
      { store, provider: resendProvider(args.resendApiKey) },
      args.snapshot,
      { replyTo: args.replyTo }
    );
  });
}

function throwingDryRunProvider(): ReturnType<typeof resendProvider> {
  return {
    async send() {
      return { ok: false, error: "dry_run must not call the email provider" };
    },
  };
}

/**
 * Run the missed-Sunday-booking scanner against already-loaded rows.
 * Dry-run never writes email_events and never calls Resend.
 */
export async function runMissedBookingEmailScan(args: {
  supabase: { from: (table: string) => any };
  resendApiKey: string;
  input: MissedBookingScanInput;
  dryRun?: boolean;
  replyTo?: string | null;
}): Promise<MissedBookingScanResult> {
  const store = createSupabaseEmailStore(args.supabase);
  const provider = args.dryRun ? throwingDryRunProvider() : resendProvider(args.resendApiKey);
  return executeMissedBookingScan(
    { store, provider },
    args.input,
    { dryRun: args.dryRun, replyTo: args.replyTo }
  );
}
