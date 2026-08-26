/**
 * Phase 3: absence-recorded emails.
 * Tests canonical modules in supabase/functions/_shared — no duplicate runtime.
 */
import {
  ABSENCE_LIMIT,
  absenceIdempotencyKey,
  afterSuccessfulAbsence,
  buildAbsenceInAppNotification,
  countAuthoritativeAbsences,
  deliverAbsenceRecordedEmail,
  shouldSendAbsenceRecordedEmail,
  type AbsenceCountRow,
  type AbsenceEmailSnapshot,
} from "../../../supabase/functions/_shared/absenceEmail.ts";
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

function snapshot(overrides: Partial<AbsenceEmailSnapshot> = {}): AbsenceEmailSnapshot {
  return {
    learnerAttendanceId: "att-1",
    learnerId: "learner-a",
    learnerName: "An Nguyen",
    learnerEmail: "an@example.com",
    sessionNumber: 2,
    sprintNumber: 1,
    courseName: "English B1",
    classDate: "2026-08-31",
    classTime: "18:00–19:00",
    absenceCount: 1,
    absenceLimit: ABSENCE_LIMIT,
    ...overrides,
  };
}

function attRow(overrides: Partial<AbsenceCountRow> = {}): AbsenceCountRow {
  return {
    id: "att-1",
    learner_id: "learner-a",
    enrollment_id: "enr-1",
    course_name: "English B1",
    type: "absent_session",
    resolved: false,
    ...overrides,
  };
}

const NOW = new Date("2026-08-26T08:00:00.000Z");
const KEY = absenceIdempotencyKey("att-1");

async function run() {
  assertEqual(ABSENCE_LIMIT, 5, "limit: product uses 5");
  assertEqual(KEY, "absence:att-1", "idempotency key shape");

  assertEqual(
    shouldSendAbsenceRecordedEmail({ action: "mark_absent", alreadyAbsent: false, learnerAttendanceId: "att-1" }),
    true,
    "gate: first mark_absent with row sends"
  );
  assertEqual(
    shouldSendAbsenceRecordedEmail({ action: "mark_absent", alreadyAbsent: true, learnerAttendanceId: "att-1" }),
    false,
    "6: already_absent does not send"
  );
  assertEqual(
    shouldSendAbsenceRecordedEmail({ action: "mark_absent", alreadyAbsent: false, learnerAttendanceId: null }),
    false,
    "gate: no learner_attendance row → no email (session_attendance-only)"
  );
  assertEqual(
    shouldSendAbsenceRecordedEmail({ action: "reopen_absent", alreadyAbsent: false, learnerAttendanceId: "att-1" }),
    false,
    "10: reopen does not send"
  );
  assertEqual(
    shouldSendAbsenceRecordedEmail({ action: "detect_sprint_late", learnerAttendanceId: "att-1" }),
    false,
    "gate: unrelated action does not send"
  );

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverAbsenceRecordedEmail({ store, provider }, snapshot(), { now: NOW });
    assertEqual(result.absenceUnaffected, true, "1: absence unaffected");
    assert(result.result.ok === true && result.result.status === "sent", "1: one email sent");
    assertEqual(payloads.length, 1, "1: provider once");
    assertEqual(payloads[0].to, ["an@example.com"], "1: learner only");
    assertEqual((await store.findByIdempotencyKey(KEY))?.status, "sent", "1: event sent");
    assertIncludes(payloads[0].html, "1/5", "2: count 1/5 in email");
    assertNotIncludes(payloads[0].html, "learner-b", "11: no other learner id");
  }

  {
    const one = renderEmailTemplate("absence_recorded", {
      learner_name: "An",
      session_number: 2,
      sprint_number: 1,
      absence_count: 1,
      absence_limit: 5,
      course_name: "English B1",
    });
    assertIncludes(one.subject, "1/5", "2: subject 1/5");
    assertIncludes(one.html, "1/5", "2: body 1/5");
    assertIncludes(one.html, "upcoming classes", "2: below-limit reminder EN");
    assertNotIncludes(one.html, "reached the absence limit", "2: not at-limit wording");

    const four = renderEmailTemplate("absence_recorded", {
      learner_name: "An",
      session_number: 3,
      sprint_number: 2,
      absence_count: 4,
      absence_limit: 5,
    });
    assertIncludes(four.html, "4/5", "3: body 4/5");
    assertIncludes(four.html, "theo dõi lịch học", "3: below-limit reminder VI");

    const five = renderEmailTemplate("absence_recorded", {
      learner_name: "An",
      session_number: 2,
      sprint_number: 4,
      absence_count: 5,
      absence_limit: 5,
      course_name: "English B1",
    });
    assertIncludes(five.html, "5/5", "4: body 5/5");
    assertIncludes(five.html, "reached the absence limit", "4: critical EN");
    assertIncludes(five.html, "contact Admin", "4: contact Admin EN");
    assertIncludes(five.html, "đạt giới hạn", "4: critical VI");
    assertIncludes(five.html, "liên hệ Admin", "4: contact Admin VI");
    assertNotIncludes(five.html, "att-1", "security: no attendance uuid");
    assertNotIncludes(five.html, "learner-a", "security: no learner uuid");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverAbsenceRecordedEmail({ store, provider }, snapshot(), { now: NOW });
    const retry = await deliverAbsenceRecordedEmail({ store, provider }, snapshot(), { now: NOW });
    assertEqual(payloads.length, 1, "5: retry does not resend");
    assert(retry.result.ok === true && retry.result.already_processed === true, "5: already processed");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    assertEqual(
      shouldSendAbsenceRecordedEmail({ action: "mark_absent", alreadyAbsent: true, learnerAttendanceId: "att-1" }),
      false,
      "6: already_absent gate"
    );
    assertEqual(payloads.length, 0, "6: no send attempted when gated");
    assertEqual(store.rows.size, 0, "6: no email event created");
  }

  {
    const store = new MemoryEmailStore();
    const { provider } = mockProvider({ failAlways: true });
    const emailResult = await deliverAbsenceRecordedEmail({ store, provider }, snapshot(), { now: NOW });
    const absence = await afterSuccessfulAbsence(async () => {
      if (!emailResult.result.ok) throw new Error("provider failed");
    });
    assertEqual(absence.absenceSuccess, true, "7: absence still succeeds");
    assertEqual(emailResult.absenceUnaffected, true, "7: email layer does not roll back");
    assert(emailResult.result.ok === false && emailResult.result.status === "failed", "7: failed logged");
    assertEqual((await store.findByIdempotencyKey(KEY))?.status, "failed", "7: failed row retained");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverAbsenceRecordedEmail(
      { store, provider },
      snapshot({ learnerEmail: null }),
      { now: NOW }
    );
    const absence = await afterSuccessfulAbsence(async () => result);
    assertEqual(absence.absenceSuccess, true, "8: absence succeeds without email");
    assert(result.result.ok === true && result.result.status === "skipped", "8: skipped");
    assertEqual(payloads.length, 0, "8: provider not called");
    assertEqual((await store.findByIdempotencyKey(KEY))?.status, "skipped", "8: skipped event recorded");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverAbsenceRecordedEmail(
      { store, provider },
      snapshot({ learnerEmail: "not-an-email" }),
      { now: NOW }
    );
    const absence = await afterSuccessfulAbsence(async () => result);
    assertEqual(absence.absenceSuccess, true, "9: absence succeeds with invalid email");
    assert(result.result.ok === true && result.result.status === "skipped", "9: skipped invalid");
    assertEqual(payloads.length, 0, "9: provider not called");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverAbsenceRecordedEmail({ store, provider }, snapshot(), { now: NOW });
    assertEqual(
      shouldSendAbsenceRecordedEmail({ action: "reopen_absent", learnerAttendanceId: "att-1" }),
      false,
      "10: reopen does not trigger"
    );
    assertEqual(payloads.length, 1, "10: no additional send on reopen");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverAbsenceRecordedEmail({ store, provider }, snapshot(), { now: NOW });
    await deliverAbsenceRecordedEmail(
      { store, provider },
      snapshot({
        learnerAttendanceId: "att-b",
        learnerId: "learner-b",
        learnerName: "Binh",
        learnerEmail: "binh@example.com",
      }),
      { now: NOW }
    );
    assertEqual(payloads.length, 2, "11: two learners → two emails");
    assertEqual(payloads[0].to, ["an@example.com"], "11: A only in first");
    assertEqual(payloads[1].to, ["binh@example.com"], "11: B only in second");
    assertNotIncludes(payloads[0].html, "Binh", "11: A email does not mention B");
    assertNotIncludes(payloads[0].html, "binh@example.com", "11: A email has no B address");
  }

  {
    const rendered = renderEmailTemplate("absence_recorded", {
      learner_name: `An <img src=x onerror="alert(1)">`,
      session_number: `2</p><script>alert(1)</script>`,
      sprint_number: 1,
      absence_count: 1,
      absence_limit: 5,
      course_name: `English <script>alert('xss')</script>`,
      class_date: `<b>Mon</b>`,
    });
    assertNotIncludes(rendered.html, "<script>", "12: script escaped");
    assertNotIncludes(rendered.html, "<img src=x", "12: img escaped");
    assertIncludes(rendered.html, "&lt;img", "12: name escaped");
    assertIncludes(rendered.html, "&lt;script&gt;", "12: course escaped");
    assertIncludes(rendered.html, "&lt;b&gt;", "12: date escaped");
  }

  {
    const notice = buildAbsenceInAppNotification({
      sprintNumber: 1,
      sessionNumber: 2,
      courseName: "English B1",
      absenceCount: 3,
      absenceLimit: ABSENCE_LIMIT,
    });
    assertIncludes(notice.title, "Buổi 2", "13: in-app title keeps session");
    assertIncludes(notice.message, "3/5", "13: in-app still says N/5");
    assertIncludes(notice.message, "Bạn hiện đã vắng 3/5 buổi", "13: original semantics");

    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const email = await deliverAbsenceRecordedEmail({ store, provider }, snapshot({ absenceCount: 3 }), { now: NOW });
    assert(email.result.ok === true, "13: email additional");
    assertEqual(payloads.length, 1, "13: email sent");
    assertIncludes(notice.message, "3/5", "13: notification still produced");
  }

  {
    const rows: AbsenceCountRow[] = [
      attRow({ id: "a1", resolved: false }),
      attRow({ id: "a2", resolved: true }),
      attRow({ id: "a3", type: "late_sprint" }),
      attRow({ id: "a4", learner_id: "learner-b" }),
      attRow({ id: "a5", enrollment_id: "enr-other" }),
    ];
    assertEqual(
      countAuthoritativeAbsences(rows, { learnerId: "learner-a", enrollmentId: "enr-1" }),
      2,
      "14: counts resolved + unresolved absent_session for enrollment"
    );
    assertEqual(
      countAuthoritativeAbsences(rows, { learnerId: "learner-a", courseName: "English B1" }),
      3,
      "14: without enrollment_id, course_name includes other enrollment same course"
    );
    assertEqual(
      countAuthoritativeAbsences(
        [...rows, attRow({ id: "a6", type: "missed_deadline" as string })],
        { learnerId: "learner-a", enrollmentId: "enr-1" }
      ),
      2,
      "14: missed_deadlines / other types ignored"
    );
  }

  {
    const withWhen = renderEmailTemplate("absence_recorded", {
      learner_name: "An",
      session_number: 2,
      sprint_number: 1,
      absence_count: 1,
      absence_limit: 5,
      class_date: "Mon 31 Aug 2026",
      class_time: "18:00–19:00",
    });
    assertIncludes(withWhen.html, "Mon 31 Aug 2026", "content: class date");
    assertIncludes(withWhen.html, "18:00–19:00", "content: class time");
    assertIncludes(withWhen.html, "Buổi 2", "content: session");
    assertIncludes(withWhen.html, "Sprint 1", "content: sprint");
  }

  {
    const store = new MemoryEmailStore();
    const failing = mockProvider({ failAlways: true });
    await deliverAbsenceRecordedEmail({ store, provider: failing.provider }, snapshot(), { now: NOW });
    const retrying = mockProvider();
    const retry = await deliverAbsenceRecordedEmail({ store, provider: retrying.provider }, snapshot(), { now: NOW });
    assert(retry.result.ok === true && retry.result.status === "sent", "failed absence email retries in place");
    assertEqual(retrying.payloads.length, 1, "failed retry sends once");
  }

  console.log("absenceEmail.test.ts: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  throw err;
});
