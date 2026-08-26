/**
 * Phase 4: teacher-unavailable class cancellation emails.
 * Tests canonical modules in supabase/functions/_shared — no duplicate runtime.
 */
import {
  afterSuccessfulCancellation,
  buildLearnerCancelInAppNotification,
  cancellationTemplateData,
  classRemovalIdempotencyKey,
  deliverTeacherUnavailableCancellationEmail,
  parseCancelReason,
  shouldSendTeacherUnavailableCancellationEmail,
  type CancellationEmailSnapshot,
} from "../../../supabase/functions/_shared/cancellationEmail.ts";
import { shouldSendAdminClassAssignmentEmail } from "../../../supabase/functions/_shared/classAssignmentEmail.ts";
import {
  buildResendEmailPayload,
  type EmailClaimSpec,
  type EmailEventRow,
  type EmailProvider,
  type EmailStore,
} from "../../../supabase/functions/_shared/emailLogic.ts";
import { renderEmailTemplate } from "../../../supabase/functions/_shared/emailTemplates.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

function assertIncludes(haystack: string, needle: string, label: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected to include ${JSON.stringify(needle)}`);
  }
}

function assertNotIncludes(haystack: string, needle: string, label: string) {
  if (haystack.includes(needle)) {
    throw new Error(`${label}: expected not to include ${JSON.stringify(needle)}`);
  }
}

let idSeq = 0;

class MemoryEmailStore implements EmailStore {
  rows = new Map<string, EmailEventRow>();

  async findByIdempotencyKey(key: string): Promise<EmailEventRow | null> {
    return this.rows.get(key) || null;
  }

  async insertQueued(input: {
    idempotency_key: string;
    template: string;
    user_id: string | null;
    to_email: string;
    metadata: Record<string, unknown> | null;
    now: Date;
  }): Promise<{ row: EmailEventRow; conflict: boolean }> {
    const existing = this.rows.get(input.idempotency_key);
    if (existing) return { row: existing, conflict: true };
    const iso = input.now.toISOString();
    const row: EmailEventRow = {
      id: `evt-${++idSeq}`,
      idempotency_key: input.idempotency_key,
      template: input.template,
      user_id: input.user_id,
      to_email: input.to_email,
      status: "queued",
      provider_id: null,
      error: null,
      metadata: input.metadata,
      created_at: iso,
      sent_at: null,
      updated_at: iso,
    };
    this.rows.set(input.idempotency_key, row);
    return { row, conflict: false };
  }

  async insertSkipped(input: {
    idempotency_key: string;
    template: string;
    user_id: string | null;
    to_email: string;
    metadata: Record<string, unknown> | null;
    now: Date;
  }): Promise<{ row: EmailEventRow; conflict: boolean }> {
    const existing = this.rows.get(input.idempotency_key);
    if (existing) return { row: existing, conflict: true };
    const iso = input.now.toISOString();
    const row: EmailEventRow = {
      id: `evt-${++idSeq}`,
      idempotency_key: input.idempotency_key,
      template: input.template,
      user_id: input.user_id,
      to_email: input.to_email,
      status: "skipped",
      provider_id: null,
      error: null,
      metadata: input.metadata,
      created_at: iso,
      sent_at: null,
      updated_at: iso,
    };
    this.rows.set(input.idempotency_key, row);
    return { row, conflict: false };
  }

  async claimForSend(id: string, spec: EmailClaimSpec, now: Date): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (row.id !== id) continue;
      if (spec.mode === "failed") {
        if (row.status !== "failed") return false;
      } else {
        if (row.status !== "queued") return false;
        if (new Date(row.updated_at).getTime() > spec.staleBefore.getTime()) return false;
      }
      row.status = "queued";
      row.updated_at = now.toISOString();
      return true;
    }
    return false;
  }

  async markSent(id: string, providerId: string, now: Date): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.id !== id) continue;
      row.status = "sent";
      row.provider_id = providerId;
      row.error = null;
      row.sent_at = now.toISOString();
      row.updated_at = now.toISOString();
    }
  }

  async markFailed(id: string, error: string, now: Date): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.id !== id) continue;
      row.status = "failed";
      row.error = error;
      row.updated_at = now.toISOString();
    }
  }
}

function mockProvider(options?: { failAlways?: boolean }) {
  const payloads: ReturnType<typeof buildResendEmailPayload>[] = [];
  const provider: EmailProvider = {
    async send(payload) {
      payloads.push(payload);
      if (options?.failAlways) return { ok: false, error: "Resend 502" };
      return { ok: true, providerId: `re_${payloads.length}` };
    },
  };
  return { provider, payloads };
}

function snapshot(overrides: Partial<CancellationEmailSnapshot> = {}): CancellationEmailSnapshot {
  return {
    learnerId: "learner-b",
    learnerName: "Binh",
    learnerEmail: "binh@example.com",
    teacherName: "Mai Teacher",
    sprintSessionId: "sess-b",
    classScheduleId: "sched-1",
    sessionNumber: 2,
    sprintNumber: 3,
    courseName: "English B1",
    classDate: "2026-08-31",
    startTime: "18:00:00",
    endTime: "19:00:00",
    ...overrides,
  };
}

const NOW = new Date("2026-08-26T08:00:00.000Z");
const KEY = classRemovalIdempotencyKey({
  learnerId: "learner-b",
  sprintSessionId: "sess-b",
  classScheduleId: "sched-1",
});

async function run() {
  assertEqual(parseCancelReason(undefined).ok && parseCancelReason(undefined).ok && (parseCancelReason(undefined) as { reason: string }).reason, "other", "3: omitted → other");
  assertEqual(parseCancelReason(null), { ok: true, reason: "other" }, "3: null → other");
  assertEqual(parseCancelReason(""), { ok: true, reason: "other" }, "3: blank → other");
  assertEqual(parseCancelReason("other"), { ok: true, reason: "other" }, "reason: other");
  assertEqual(parseCancelReason("teacher_unavailable"), { ok: true, reason: "teacher_unavailable" }, "reason: teacher_unavailable");
  assertEqual(parseCancelReason("please_refund").ok, false, "reason: arbitrary text rejected");
  assertEqual(parseCancelReason(12).ok, false, "reason: non-string rejected");

  assertEqual(
    shouldSendTeacherUnavailableCancellationEmail({ source: "admin_cancel", reason: "teacher_unavailable" }),
    true,
    "1: teacher_unavailable cancel sends"
  );
  assertEqual(
    shouldSendTeacherUnavailableCancellationEmail({ source: "admin_cancel", reason: "other" }),
    false,
    "2: other cancel does not send"
  );
  assertEqual(
    shouldSendTeacherUnavailableCancellationEmail({
      source: "admin_cancel",
      reason: parseCancelReason(undefined).ok ? parseCancelReason(undefined).reason : "other",
    }),
    false,
    "3: missing reason treated as other → no emergency email"
  );
  assertEqual(
    shouldSendTeacherUnavailableCancellationEmail({ source: "admin_assign", reason: "teacher_unavailable" }),
    false,
    "13: reassign/admin_assign does not send cancellation template"
  );
  assertEqual(shouldSendAdminClassAssignmentEmail("admin_assign"), true, "14: Phase 2 assignment trigger unchanged");
  assertEqual(shouldSendAdminClassAssignmentEmail("enrollment_cancel"), false, "14: cancel is not an assignment email");
  assertEqual(
    shouldSendTeacherUnavailableCancellationEmail({ source: "learner_cancel", reason: "teacher_unavailable" }),
    false,
    "15: learner self-cancel does not send Admin template"
  );

  assertEqual(
    KEY,
    "class_removal:learner-b:sess-b:sched-1:teacher_unavailable",
    "idempotency key shape"
  );

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverTeacherUnavailableCancellationEmail(
      { store, provider },
      snapshot(),
      { now: NOW, replyTo: "hello@betterminds.org" }
    );
    assertEqual(result.cancelUnaffected, true, "1: cancel unaffected");
    assert(result.result.ok === true && result.result.status === "sent", "1: one learner email");
    assertEqual(payloads.length, 1, "1: provider once");
    assertEqual(payloads[0].to, ["binh@example.com"], "1: learner only");
    assertEqual((await store.findByIdempotencyKey(KEY))?.template, "class_cancelled_teacher_unavailable", "1: stored template");
    assertIncludes(payloads[0].html, "unexpected schedule conflict", "1: teacher unavailable meaning");
    assertIncludes(payloads[0].html, "Binh", "1: learner name");
    assertIncludes(payloads[0].html, "Mai Teacher", "1: teacher name");
    assertNotIncludes(payloads[0].html, "learner-a", "11: no other learner id");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    assertEqual(
      shouldSendTeacherUnavailableCancellationEmail({ source: "admin_cancel", reason: "other" }),
      false,
      "2: gate closed"
    );
    assertEqual(payloads.length, 0, "2: no send");
    assertEqual(store.rows.size, 0, "2: no event");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverTeacherUnavailableCancellationEmail({ store, provider }, snapshot(), { now: NOW });
    const retry = await deliverTeacherUnavailableCancellationEmail({ store, provider }, snapshot(), { now: NOW });
    assertEqual(payloads.length, 1, "4: retry does not resend");
    assert(retry.result.ok === true && retry.result.already_processed === true, "4: already processed");
  }

  {
    const store = new MemoryEmailStore();
    const { provider } = mockProvider({ failAlways: true });
    const emailResult = await deliverTeacherUnavailableCancellationEmail({ store, provider }, snapshot(), { now: NOW });
    const cancel = await afterSuccessfulCancellation(async () => {
      if (!emailResult.result.ok) throw new Error("provider failed");
    });
    assertEqual(cancel.cancelSuccess, true, "5: cancellation still succeeds");
    assertEqual(emailResult.cancelUnaffected, true, "5: email non-fatal");
    assert(emailResult.result.ok === false && emailResult.result.status === "failed", "5: failed logged");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverTeacherUnavailableCancellationEmail(
      { store, provider },
      snapshot({ learnerEmail: null }),
      { now: NOW }
    );
    const cancel = await afterSuccessfulCancellation(async () => result);
    assertEqual(cancel.cancelSuccess, true, "6: cancel succeeds without email");
    assert(result.result.status === "skipped", "6: skipped");
    assertEqual(payloads.length, 0, "6: provider not called");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverTeacherUnavailableCancellationEmail(
      { store, provider },
      snapshot({ learnerEmail: "not-an-email" }),
      { now: NOW }
    );
    assertEqual((await afterSuccessfulCancellation(async () => result)).cancelSuccess, true, "7: cancel succeeds");
    assert(result.result.status === "skipped", "7: invalid skipped");
    assertEqual(payloads.length, 0, "7: no send");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverTeacherUnavailableCancellationEmail(
      { store, provider },
      snapshot(),
      { now: NOW, replyTo: "hello@betterminds.org" }
    );
    assertEqual(payloads[0].reply_to, "hello@betterminds.org", "8: Reply-To on payload");
    assertIncludes(payloads[0].html, "Reply to this email", "8: reply copy when configured");
    assertNotIncludes(payloads[0].html, "Contact Better Minds Admin", "8: not the fallback copy");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverTeacherUnavailableCancellationEmail({ store, provider }, snapshot(), { now: NOW });
    assertEqual("reply_to" in payloads[0], false, "9: Reply-To omitted when missing");
    assertIncludes(payloads[0].html, "Contact Better Minds Admin", "9: fallback copy");
    assertNotIncludes(payloads[0].html, "Reply to this email", "9: does not claim replies are monitored");
  }

  {
    const captured = snapshot({
      classDate: "2026-08-31",
      startTime: "18:00:00",
      endTime: "19:00:00",
      teacherName: "Mai Teacher",
      sessionNumber: 2,
    });
    const data = cancellationTemplateData(captured, true);
    assertIncludes(data.class_date, "31", "10: date captured");
    assertEqual(data.start_time, "18:00", "10: start captured");
    assertEqual(data.end_time, "19:00", "10: end captured");
    assertEqual(data.teacher_name, "Mai Teacher", "10: teacher captured");
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverTeacherUnavailableCancellationEmail({ store, provider }, captured, {
      now: NOW,
      replyTo: "hello@betterminds.org",
    });
    assertIncludes(payloads[0].html, "18:00–19:00", "10: times in email after unlink");
    assertIncludes(payloads[0].html, "Mai Teacher", "12: last-learner details still present");
    assertIncludes(payloads[0].html, "Mon 31 Aug 2026", "12: original date still present");
    assertNotIncludes(payloads[0].html, "sched-1", "security: no schedule uuid");
    assertNotIncludes(payloads[0].html, "sess-b", "security: no session uuid");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverTeacherUnavailableCancellationEmail({ store, provider }, snapshot(), { now: NOW });
    const later = snapshot({
      sprintSessionId: "sess-b-later",
      classScheduleId: "sched-2",
      classDate: "2026-09-01",
    });
    await deliverTeacherUnavailableCancellationEmail({ store, provider }, later, { now: NOW });
    assertEqual(payloads.length, 2, "later genuine cancellation → new email");
  }

  {
    const groupA = snapshot({
      learnerId: "learner-a",
      learnerName: "An",
      learnerEmail: "an@example.com",
      sprintSessionId: "sess-a",
    });
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverTeacherUnavailableCancellationEmail({ store, provider }, snapshot(), { now: NOW });
    assertEqual(payloads[0].to, ["binh@example.com"], "11: only B emailed");
    assertNotIncludes(payloads[0].html, "An", "11: A not in B's email");
    assertEqual(store.rows.size, 1, "11: one event for B");
    const aKey = classRemovalIdempotencyKey({
      learnerId: "learner-a",
      sprintSessionId: "sess-a",
      classScheduleId: "sched-1",
    });
    assertEqual(await store.findByIdempotencyKey(aKey), null, "11: A has no email event");
    void groupA;
  }

  {
    const rendered = renderEmailTemplate("class_cancelled_teacher_unavailable", {
      learner_name: `Binh <img src=x onerror="alert(1)">`,
      teacher_name: `Mai & Co <script>alert(1)</script>`,
      session_number: `2</p><script>`,
      class_date: `<b>Mon</b>`,
      course_name: `English <script>xss</script>`,
      reply_to_configured: true,
    });
    assertNotIncludes(rendered.html, "<script>", "16: script escaped");
    assertNotIncludes(rendered.html, "<img src=x", "16: img escaped");
    assertIncludes(rendered.html, "&lt;img", "16: name escaped");
    assertIncludes(rendered.html, "&amp;", "16: teacher escaped");
    assertIncludes(rendered.html, "&lt;b&gt;", "16: date escaped");
    assertIncludes(rendered.html, "makeup", "content: makeup offer");
  }

  {
    const withSprint = renderEmailTemplate("class_cancelled_teacher_unavailable", {
      learner_name: "Binh",
      teacher_name: "Mai",
      session_number: 3,
      sprint_number: 2,
      class_date: "Thu 3 Sep 2026",
      start_time: "19:00",
      end_time: "20:00",
      course_name: "English B1",
      reply_to_configured: false,
    });
    assertIncludes(withSprint.html, "Session 3", "content: session 3");
    assertIncludes(withSprint.html, "Sprint 2", "content: sprint");
    assertIncludes(withSprint.html, "English B1", "content: course");
    assertIncludes(withSprint.html, "19:00–20:00", "content: times");
    assertIncludes(withSprint.html, "Contact Better Minds Admin", "9b: missing reply-to copy");
  }

  {
    const unavailable = buildLearnerCancelInAppNotification({
      reason: "teacher_unavailable",
      className: "Evening B1",
      teacherName: "Mai Teacher",
      sessionLabel: "Buổi 2",
    });
    assertIncludes(unavailable.title, "Lớp đã hủy — giáo viên bận đột xuất", "in-app tu: vi title");
    assertIncludes(unavailable.title, "Class cancelled — teacher unavailable", "in-app tu: en title");
    assertIncludes(unavailable.message, "giáo viên đột xuất bận lịch", "in-app tu: vi reason");
    assertIncludes(unavailable.message, "unexpected schedule conflict", "in-app tu: en reason");
    assertIncludes(unavailable.message, "xếp buổi học bù", "in-app tu: makeup vi");
    assertIncludes(unavailable.message, "makeup class", "in-app tu: makeup en");
    assertIncludes(unavailable.message, "theo dõi email", "in-app tu: watch email vi");
    assertIncludes(unavailable.message, "watch your email", "in-app tu: watch email en");
    assertIncludes(unavailable.message, "Evening B1", "in-app tu: class");
    assertNotIncludes(unavailable.message, "đặt lịch lại", "in-app tu: no self-book");
    assertEqual(unavailable.actionUrl, "/dashboard", "in-app tu: dashboard not booking");

    const other = buildLearnerCancelInAppNotification({
      reason: "other",
      className: "Evening B1",
      teacherName: "Mai Teacher",
    });
    assertEqual(other.title, "Admin Đã Hủy Buổi Học Của Bạn", "in-app other: existing title");
    assertIncludes(other.message, "Vui lòng đặt lịch lại.", "in-app other: self-book kept");
    assertEqual(other.actionUrl, "/booking", "in-app other: booking url");
  }

  console.log("cancellationEmail.test.ts: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  throw err;
});
