/**
 * Phase 5: missed Sunday-booking reminder emails.
 * Tests canonical modules in supabase/functions/_shared — no duplicate runtime.
 */
import {
  applyAdminAssignBooking,
  type ClassScheduleInfo,
  type LiveSessionRow,
  type SprintRow,
} from "../../../supabase/functions/_shared/adminLearnerBooking.ts";
import {
  collectMissedBookingCandidates,
  executeMissedBookingScan,
  formatLateSessionsLabel,
  guardMissedBookingRequest,
  isTrustedMissedBookingCaller,
  missedBookingIdempotencyKey,
  parseMissedBookingRequestBody,
  shouldSendMissedBookingEmail,
  type MissedBookingEnrollment,
  type MissedBookingProfile,
  type MissedBookingScanInput,
} from "../../../supabase/functions/_shared/missedBookingEmail.ts";
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

function mockProvider(options?: { failAlways?: boolean; failOnce?: boolean }) {
  const payloads: ReturnType<typeof buildResendEmailPayload>[] = [];
  let failOnce = options?.failOnce ?? false;
  const provider: EmailProvider = {
    async send(payload) {
      if (failOnce) {
        failOnce = false;
        return { ok: false, error: "Resend 502" };
      }
      payloads.push(payload);
      if (options?.failAlways) return { ok: false, error: "Resend 502" };
      return { ok: true, providerId: `re_${payloads.length}` };
    },
  };
  return { provider, payloads };
}

const SUN_AUG_30 = new Date("2026-08-30T12:00:00+07:00");
const SUN_AUG_30_LATE = new Date("2026-08-30T23:59:00+07:00");
const MON_AUG_31_EARLY = new Date("2026-08-31T00:00:00+07:00");
const MON_AUG_31 = new Date("2026-08-31T07:00:00+07:00");
const TUE_SEP_01 = new Date("2026-09-01T10:00:00+07:00");
const SAT_SEP_05 = new Date("2026-09-05T18:00:00+07:00");
const SUN_SEP_06 = new Date("2026-09-06T12:00:00+07:00");
const MON_SEP_07 = new Date("2026-09-07T07:00:00+07:00");

const CRON_SECRET = "test-missed-booking-cron-secret";

function profile(overrides: Partial<MissedBookingProfile> = {}): MissedBookingProfile {
  return {
    id: "learner-a",
    full_name: "An Nguyen",
    email: "an@example.com",
    role: "learner",
    is_active: true,
    ...overrides,
  };
}

function enrollment(overrides: Partial<MissedBookingEnrollment> = {}): MissedBookingEnrollment {
  return {
    id: "enr-1",
    learner_id: "learner-a",
    status: "active",
    course_id: "course-1",
    ...overrides,
  };
}

function sprint(overrides: Partial<SprintRow> = {}): SprintRow {
  return {
    id: "sp-2",
    enrollment_id: "enr-1",
    sprint_number: 2,
    status: "active",
    ...overrides,
  };
}

function session(overrides: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return {
    id: "sess-2",
    sprint_id: "sp-2",
    session_number: 2,
    session_type: "vietnamese_teacher",
    status: "available",
    teacher_id: null,
    scheduled_at: null,
    class_id: null,
    meeting_link: null,
    ...overrides,
  };
}

function session3(overrides: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return session({
    id: "sess-3",
    session_number: 3,
    session_type: "foreign_teacher",
    ...overrides,
  });
}

function schedule(overrides: Partial<ClassScheduleInfo> = {}): ClassScheduleInfo {
  return {
    class_id: "class-a",
    date: "2026-08-31",
    start_time: "09:00:00",
    end_time: "10:00:00",
    status: "scheduled",
    teacher_id: "teacher-a",
    ...overrides,
  };
}

function bookedSession(n: 2 | 3, classId: string): LiveSessionRow {
  const base = n === 2 ? session({ class_id: classId, status: "in_progress", teacher_id: "teacher-a" }) : session3({ class_id: classId, status: "in_progress", teacher_id: "teacher-b" });
  return base;
}

function scanInput(overrides: Partial<MissedBookingScanInput> = {}): MissedBookingScanInput {
  return {
    now: MON_AUG_31,
    profiles: [profile()],
    enrollments: [enrollment()],
    sprints: [sprint()],
    sessions: [session(), session3()],
    schedules: [],
    classEnrollments: [],
    courses: [{ id: "course-1", name: "English B1" }],
    ...overrides,
  };
}

async function run() {
  assertEqual(formatLateSessionsLabel("late", "booked"), { vi: "Buổi 2", en: "Session 2" }, "label: S2 only");
  assertEqual(formatLateSessionsLabel("booked", "late"), { vi: "Buổi 3", en: "Session 3" }, "label: S3 only");
  assertEqual(
    formatLateSessionsLabel("late", "late"),
    { vi: "Buổi 2 và Buổi 3", en: "Session 2 and Session 3" },
    "label: both"
  );
  assertEqual(formatLateSessionsLabel("booked", "booked"), null, "label: neither");
  assertEqual(shouldSendMissedBookingEmail({ session2: "late", session3: "booked" }), true, "should send S2 late");
  assertEqual(shouldSendMissedBookingEmail({ session2: "booked", session3: "booked" }), false, "should not send both booked");

  assertEqual(
    missedBookingIdempotencyKey({ enrollmentId: "enr-1", sprintId: "sp-2", sundayYmd: "2026-08-30" }),
    "missed-booking:enr-1:sp-2:2026-08-30",
    "stable key format"
  );
  assert(
    missedBookingIdempotencyKey({ enrollmentId: "enr-1", sprintId: "sp-2", sundayYmd: "2026-08-30" }) !==
      missedBookingIdempotencyKey({ enrollmentId: "enr-1", sprintId: "sp-3", sundayYmd: "2026-08-30" }),
    "key changes with sprint"
  );

  const rendered = renderEmailTemplate("missed_booking", {
    learner_name: "An Nguyen",
    late_sessions_vi: "Buổi 2",
    late_sessions_en: "Session 2",
    sprint_number: 2,
    course_name: "English B1",
  });
  assertIncludes(rendered.subject, "Nhắc lịch đăng ký — Admin sẽ hỗ trợ xếp lớp", "template: vi subject");
  assertIncludes(rendered.subject, "Booking reminder — Admin will help arrange your class", "template: en subject");
  assertNotIncludes(rendered.subject.toLowerCase(), "bỏ lỡ", "template: subject not blame vi");
  assertNotIncludes(rendered.subject.toLowerCase(), "you missed", "template: subject not blame en");
  assertIncludes(rendered.html, "An Nguyen", "template: name");
  assertIncludes(rendered.html, "Buổi 2", "template: sessions vi");
  assertIncludes(rendered.html, "Session 2", "template: sessions en");
  assertIncludes(rendered.html, "Sprint 2", "template: sprint");
  assertIncludes(rendered.html, "English B1", "template: course");
  assertIncludes(rendered.html, "Cửa sổ đăng ký Chủ nhật đã kết thúc", "template: sunday closed vi");
  assertIncludes(rendered.html, "Sunday booking has closed", "template: sunday closed en");
  assertIncludes(rendered.html, "Admin sẽ xếp lớp", "template: admin arranges vi");
  assertIncludes(rendered.html, "Admin will arrange", "template: admin arranges en");
  assertIncludes(rendered.html, "theo dõi email", "template: watch email vi");
  assertIncludes(rendered.html, "watch your email", "template: watch email en");
  assertNotIncludes(rendered.html.toLowerCase(), "forgot", "template: no shame");
  assertNotIncludes(rendered.html.toLowerCase(), "failed to book", "template: no blame");

  // 1. S2 Late only → one email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sessions: [session(), session3({ class_id: "c3", status: "in_progress" })],
        schedules: [schedule({ class_id: "c3", date: "2026-09-03" })],
        classEnrollments: [{ class_id: "c3", student_id: "learner-a" }],
      })
    );
    assertEqual(result.totalLateLearners, 1, "1: one late learner");
    assertEqual(result.learners[0].session2, "late", "1: S2 late");
    assertEqual(result.learners[0].session3, "booked", "1: S3 booked");
    assertEqual(payloads.length, 1, "1: one email");
    assertIncludes(payloads[0].html, "Buổi 2", "1: lists Buổi 2");
    assertIncludes(payloads[0].html, "Session 2", "1: lists Session 2");
    assertNotIncludes(payloads[0].html, "Buổi 2 và Buổi 3", "1: not combined vi");
    assertNotIncludes(payloads[0].html, "Session 2 and Session 3", "1: not combined en");
    assertEqual(store.rows.size, 1, "1: one event");
  }

  // 2. S3 Late only → one email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sessions: [session({ class_id: "c2", status: "in_progress" }), session3()],
        schedules: [schedule({ class_id: "c2" })],
        classEnrollments: [{ class_id: "c2", student_id: "learner-a" }],
      })
    );
    assertEqual(result.learners[0].session2, "booked", "2: S2 booked");
    assertEqual(result.learners[0].session3, "late", "2: S3 late");
    assertEqual(payloads.length, 1, "2: one email");
    assertIncludes(payloads[0].html, "Buổi 3", "2: lists Buổi 3");
    assertIncludes(payloads[0].html, "Session 3", "2: lists Session 3");
    assertNotIncludes(payloads[0].html, "Buổi 2 và Buổi 3", "2: not combined vi");
    assertNotIncludes(payloads[0].html, "Session 2 and Session 3", "2: not combined en");
  }

  // 3. S2 + S3 Late → one combined email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan({ store, provider }, scanInput());
    assertEqual(result.totalLateLearners, 1, "3: one learner");
    assertEqual(result.learners[0].session2, "late", "3: S2 late");
    assertEqual(result.learners[0].session3, "late", "3: S3 late");
    assertEqual(payloads.length, 1, "3: one combined email");
    assertIncludes(payloads[0].html, "Buổi 2 và Buổi 3", "3: combined sessions vi");
    assertIncludes(payloads[0].html, "Session 2 and Session 3", "3: combined sessions en");
  }

  // 4. both Booked → no email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sessions: [bookedSession(2, "c2"), bookedSession(3, "c3")],
        schedules: [schedule({ class_id: "c2" }), schedule({ class_id: "c3", date: "2026-09-03" })],
        classEnrollments: [
          { class_id: "c2", student_id: "learner-a" },
          { class_id: "c3", student_id: "learner-a" },
        ],
      })
    );
    assertEqual(result.totalLateLearners, 0, "4: no late");
    assertEqual(payloads.length, 0, "4: no email");
    assertEqual(store.rows.size, 0, "4: no events");
  }

  // 5. scheduled_at only → still Late
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sessions: [
          session({ scheduled_at: "2026-08-31T09:00:00+07:00", teacher_id: "teacher-auto" }),
          session3({ class_id: "c3", status: "in_progress" }),
        ],
        schedules: [schedule({ class_id: "c3", date: "2026-09-03" })],
        classEnrollments: [{ class_id: "c3", student_id: "learner-a" }],
      })
    );
    assertEqual(result.learners[0].session2, "late", "5: suggestion is Late");
    assertEqual(payloads.length, 1, "5: email sent");
  }

  // 6. real class relationship → Booked
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sessions: [bookedSession(2, "c2"), bookedSession(3, "c3")],
        schedules: [schedule({ class_id: "c2" }), schedule({ class_id: "c3", date: "2026-09-03" })],
        classEnrollments: [
          { class_id: "c2", student_id: "learner-a" },
          { class_id: "c3", student_id: "learner-a" },
        ],
      })
    );
    assertEqual(result.totalLateLearners, 0, "6: real booking is not Late");
    assertEqual(payloads.length, 0, "6: no email");
  }

  // 7. pending/locked sprint → no email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const pending = await executeMissedBookingScan(
      { store, provider },
      scanInput({ sprints: [sprint({ status: "pending" })] })
    );
    assertEqual(pending.totalScanned, 1, "7: pending still scanned");
    assertEqual(pending.totalLateLearners, 0, "7: pending not Late");
    assertEqual(payloads.length, 0, "7: pending no email");
    assertEqual(store.rows.size, 0, "7: pending writes no event (unlock can still email)");

    const locked = await executeMissedBookingScan(
      { store, provider },
      scanInput({ sprints: [sprint({ status: "locked" })] })
    );
    assertEqual(locked.totalLateLearners, 0, "7: locked not Late");
    assertEqual(payloads.length, 0, "7: locked no email");
  }

  // 8. completed/absent/awaiting-feedback sessions → no email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    for (const status of ["completed", "absent", "awaiting_feedback"] as const) {
      const result = await executeMissedBookingScan(
        { store, provider },
        scanInput({
          sessions: [session({ status }), session3({ status, id: `sess-3-${status}` })],
        })
      );
      assertEqual(result.totalLateLearners, 0, `8: ${status} not Late`);
    }
    assertEqual(payloads.length, 0, "8: historical no email");
  }

  // 9. inactive learner → no email
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({ profiles: [profile({ is_active: false })] })
    );
    assertEqual(result.totalScanned, 0, "9: inactive not scanned");
    assertEqual(result.totalLateLearners, 0, "9: inactive not late");
    assertEqual(payloads.length, 0, "9: no email");

    const completed = await executeMissedBookingScan(
      { store, provider },
      scanInput({ enrollments: [enrollment({ status: "completed" })] })
    );
    assertEqual(completed.totalScanned, 0, "9b: completed enrollment not scanned");
    assertEqual(payloads.length, 0, "9b: completed no email");

    const paused = await executeMissedBookingScan(
      { store, provider },
      scanInput({ enrollments: [enrollment({ status: "paused" })] })
    );
    assertEqual(paused.totalScanned, 1, "9c: paused is operational");
    assertEqual(paused.totalLateLearners, 1, "9c: paused can be Late");
    assertEqual(payloads.length, 1, "9c: paused receives email");
  }

  // 10. repeated scanner call → no duplicate
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const first = await executeMissedBookingScan({ store, provider }, scanInput());
    const second = await executeMissedBookingScan({ store, provider }, scanInput({ now: TUE_SEP_01 }));
    assertEqual(first.sent, 1, "10: first send");
    assertEqual(second.sent, 0, "10: second does not send");
    assertEqual(second.skipped, 1, "10: second skipped already_sent");
    assertEqual(payloads.length, 1, "10: provider once");
    assertEqual(store.rows.size, 1, "10: one event");
  }

  // 11. failed send → later scanner retries
  {
    const store = new MemoryEmailStore();
    const fail = mockProvider({ failAlways: true });
    const first = await executeMissedBookingScan({ store, provider: fail.provider }, scanInput());
    assertEqual(first.failed, 1, "11: first failed");
    assertEqual(fail.payloads.length, 1, "11: provider attempted once");
    const event = [...store.rows.values()][0];
    assertEqual(event.status, "failed", "11: event failed");
    const key = event.idempotency_key;

    const retry = mockProvider();
    const second = await executeMissedBookingScan({ store, provider: retry.provider }, scanInput({ now: TUE_SEP_01 }));
    assertEqual(second.sent, 1, "11: retry sent");
    assertEqual(retry.payloads.length, 1, "11: retry provider once");
    assertEqual(store.rows.get(key)!.status, "sent", "11: same key now sent");
    assertEqual(store.rows.size, 1, "11: no second row");
  }

  // 12. Admin assigns before scanner → skip
  {
    const late = session();
    const assigned = applyAdminAssignBooking(late, {
      class_id: "class-assigned",
      teacher_id: "teacher-a",
      scheduled_at: "2026-09-01T09:00:00+07:00",
    });
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sessions: [assigned, session3({ class_id: "c3", status: "in_progress" })],
        schedules: [schedule({ class_id: "class-assigned" }), schedule({ class_id: "c3", date: "2026-09-03" })],
        classEnrollments: [
          { class_id: "class-assigned", student_id: "learner-a" },
          { class_id: "c3", student_id: "learner-a" },
        ],
      })
    );
    assertEqual(result.totalLateLearners, 0, "12: assigned is Booked");
    assertEqual(payloads.length, 0, "12: no missed-booking email");
  }

  // 13. Admin assigns after reminder → no second missed reminder
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await executeMissedBookingScan({ store, provider }, scanInput());
    assertEqual(payloads.length, 1, "13: reminder sent");

    const assigned = applyAdminAssignBooking(session(), {
      class_id: "class-after",
      teacher_id: "teacher-a",
      scheduled_at: "2026-09-01T09:00:00+07:00",
    });
    const after = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        now: TUE_SEP_01,
        sessions: [assigned, session3({ class_id: "c3", status: "in_progress" })],
        schedules: [schedule({ class_id: "class-after" }), schedule({ class_id: "c3", date: "2026-09-03" })],
        classEnrollments: [
          { class_id: "class-after", student_id: "learner-a" },
          { class_id: "c3", student_id: "learner-a" },
        ],
      })
    );
    assertEqual(after.totalLateLearners, 0, "13: no longer Late");
    assertEqual(payloads.length, 1, "13: no second missed reminder");
  }

  // 14. next sprint/week → new reminder possible
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await executeMissedBookingScan({ store, provider }, scanInput());
    const nextSprint = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        sprints: [sprint({ id: "sp-3", sprint_number: 3 })],
        sessions: [session({ sprint_id: "sp-3" }), session3({ sprint_id: "sp-3" })],
      })
    );
    assertEqual(nextSprint.sent, 1, "14: new sprint sends");
    assertEqual(payloads.length, 2, "14: two emails across sprints");
    assert(
      missedBookingIdempotencyKey({ enrollmentId: "enr-1", sprintId: "sp-2", sundayYmd: "2026-08-30" }) !==
        missedBookingIdempotencyKey({ enrollmentId: "enr-1", sprintId: "sp-3", sundayYmd: "2026-08-30" }),
      "14: sprint id in key"
    );

    const nextWeek = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        now: MON_SEP_07,
        sprints: [sprint({ id: "sp-3", sprint_number: 3 })],
        sessions: [session({ sprint_id: "sp-3" }), session3({ sprint_id: "sp-3" })],
      })
    );
    assertEqual(nextWeek.sundayYmd, "2026-09-06", "14: next Sunday");
    assertEqual(nextWeek.sent, 1, "14: new week sends");
    assertEqual(payloads.length, 3, "14: third email for next week");
  }

  // 15. late unlock after first scan → later scan catches learner
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const first = await executeMissedBookingScan(
      { store, provider },
      scanInput({ sprints: [sprint({ status: "pending" })] })
    );
    assertEqual(first.totalLateLearners, 0, "15: locked/pending skipped");
    assertEqual(payloads.length, 0, "15: no email before unlock");
    assertEqual(store.rows.size, 0, "15: no skipped event blocking retry");

    const second = await executeMissedBookingScan({ store, provider }, scanInput({ now: TUE_SEP_01 }));
    assertEqual(second.totalLateLearners, 1, "15: unlocked is Late");
    assertEqual(second.sent, 1, "15: later scan sends");
    assertEqual(payloads.length, 1, "15: one email after unlock");
    assertEqual(second.sundayYmd, first.sundayYmd, "15: same booking Sunday");
  }

  // 16. Vietnam Sunday/Monday boundary
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const sundayNoon = collectMissedBookingCandidates(scanInput({ now: SUN_AUG_30 }));
    assertEqual(sundayNoon.windowPassed, false, "16: Sunday noon window open");
    assertEqual(sundayNoon.candidates.length, 0, "16: Sunday noon no Late");

    const sundayLate = collectMissedBookingCandidates(scanInput({ now: SUN_AUG_30_LATE }));
    assertEqual(sundayLate.windowPassed, false, "16: Sunday 23:59 VN still open");
    assertEqual(sundayLate.candidates.length, 0, "16: Sunday 23:59 no Late");

    const mondayEarly = collectMissedBookingCandidates(scanInput({ now: MON_AUG_31_EARLY }));
    assertEqual(mondayEarly.windowPassed, true, "16: Monday 00:00 VN window passed");
    assertEqual(mondayEarly.candidates.length, 1, "16: Monday 00:00 Late");
    assertEqual(mondayEarly.sundayYmd, "2026-08-30", "16: Monday maps to Sunday 30");

    const utcSunday = collectMissedBookingCandidates(
      scanInput({ now: new Date("2026-08-30T16:59:00.000Z") })
    );
    assertEqual(utcSunday.windowPassed, false, "16: 16:59 UTC is still Sunday 23:59 VN");

    const utcMonday = collectMissedBookingCandidates(
      scanInput({ now: new Date("2026-08-30T17:00:00.000Z") })
    );
    assertEqual(utcMonday.windowPassed, true, "16: 17:00 UTC is Monday 00:00 VN");

    const saturday = collectMissedBookingCandidates(scanInput({ now: SAT_SEP_05 }));
    assertEqual(saturday.sundayYmd, "2026-08-30", "16: Saturday still this week's Sunday");
    assertEqual(saturday.candidates.length, 1, "16: Saturday still Late");

    const nextSunday = collectMissedBookingCandidates(scanInput({ now: SUN_SEP_06 }));
    assertEqual(nextSunday.windowPassed, false, "16: next Sunday window open");
    assertEqual(nextSunday.sundayYmd, "2026-09-06", "16: next Sunday ymd");

    await executeMissedBookingScan({ store, provider }, scanInput({ now: SUN_AUG_30 }));
    assertEqual(payloads.length, 0, "16: Sunday scan does not send");
  }

  // 17. group class booking validation
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        profiles: [profile(), profile({ id: "learner-b", full_name: "Binh", email: "binh@example.com" })],
        enrollments: [enrollment(), enrollment({ id: "enr-b", learner_id: "learner-b" })],
        sprints: [sprint(), sprint({ id: "sp-b", enrollment_id: "enr-b" })],
        sessions: [
          session({ class_id: "group-1", status: "in_progress" }),
          session3({ class_id: "group-1", status: "in_progress" }),
          session({ id: "sess-b2", sprint_id: "sp-b", class_id: "group-1", status: "in_progress" }),
          session3({ id: "sess-b3", sprint_id: "sp-b", class_id: "group-1", status: "in_progress" }),
        ],
        schedules: [schedule({ class_id: "group-1" })],
        classEnrollments: [{ class_id: "group-1", student_id: "learner-a" }],
      })
    );
    const ids = result.learners.map((l) => l.learner_id).sort();
    assertEqual(ids, ["learner-b"], "17: only unenrolled group member is Late");
    assertEqual(payloads.length, 1, "17: one email");
    assertIncludes(payloads[0].html, "Binh", "17: stale learner named");
    assertNotIncludes(payloads[0].html, "An Nguyen", "17: enrolled learner not emailed");
  }

  // 18. multiple learners do not mix data
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan(
      { store, provider },
      scanInput({
        profiles: [
          profile(),
          profile({ id: "learner-b", full_name: "Binh Tran", email: "binh@example.com" }),
        ],
        enrollments: [
          enrollment(),
          enrollment({ id: "enr-b", learner_id: "learner-b", course_id: "course-2" }),
        ],
        sprints: [sprint(), sprint({ id: "sp-b", enrollment_id: "enr-b", sprint_number: 4 })],
        sessions: [
          session(),
          session3({ class_id: "c3", status: "in_progress" }),
          session({ id: "b2", sprint_id: "sp-b", class_id: "c2b", status: "in_progress" }),
          session3({ id: "b3", sprint_id: "sp-b" }),
        ],
        schedules: [schedule({ class_id: "c3", date: "2026-09-03" }), schedule({ class_id: "c2b" })],
        classEnrollments: [
          { class_id: "c3", student_id: "learner-a" },
          { class_id: "c2b", student_id: "learner-b" },
        ],
        courses: [
          { id: "course-1", name: "English B1" },
          { id: "course-2", name: "English B2" },
        ],
      })
    );
    assertEqual(result.totalLateLearners, 2, "18: two late learners");
    assertEqual(payloads.length, 2, "18: two emails");
    const an = payloads.find((p) => p.html.includes("An Nguyen"));
    const binh = payloads.find((p) => p.html.includes("Binh Tran"));
    assert(!!an && !!binh, "18: both names present");
    assertIncludes(an!.html, "Buổi 2", "18: An is S2 late vi");
    assertIncludes(an!.html, "Session 2", "18: An is S2 late en");
    assertNotIncludes(an!.html, "Buổi 2 và Buổi 3", "18: An not combined vi");
    assertNotIncludes(an!.html, "Session 2 and Session 3", "18: An not combined en");
    assertNotIncludes(an!.html, "Binh Tran", "18: An email has no Binh");
    assertIncludes(binh!.html, "Session 3", "18: Binh is S3 late");
    assertNotIncludes(binh!.html, "An Nguyen", "18: Binh email has no An");
    assertIncludes(an!.html, "English B1", "18: An course");
    assertIncludes(binh!.html, "English B2", "18: Binh course");
    assertIncludes(binh!.html, "Sprint 4", "18: Binh sprint");
  }

  // 19. dry_run → no send / no email_events mutation
  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await executeMissedBookingScan({ store, provider }, scanInput(), { dryRun: true });
    assertEqual(result.dryRun, true, "19: dry run flag");
    assertEqual(result.totalLateLearners, 1, "19: still calculates");
    assertEqual(result.learners[0].learner_id, "learner-a", "19: identifier");
    assertEqual(result.learners[0].session2, "late", "19: S2 status");
    assertEqual(result.learners[0].session3, "late", "19: S3 status");
    assertEqual(payloads.length, 0, "19: no Resend");
    assertEqual(store.rows.size, 0, "19: no email_events");
    assertEqual(result.sent, 0, "19: sent 0");

    const live = await executeMissedBookingScan({ store, provider }, scanInput());
    assertEqual(live.sent, 1, "19b: real run after dry-run still sends");
    assertEqual(payloads.length, 1, "19b: one real send");
  }

  assertEqual(parseMissedBookingRequestBody({ dry_run: true }).dryRun, true, "19c: body true");
  assertEqual(parseMissedBookingRequestBody({ dry_run: "true" }).dryRun, true, "19c: body string");
  assertEqual(parseMissedBookingRequestBody({}).dryRun, false, "19c: empty");
  assertEqual(parseMissedBookingRequestBody(null).dryRun, false, "19c: null");

  // 20. cron secret required; JWT / missing / wrong secret rejected
  assertEqual(
    isTrustedMissedBookingCaller({
      cronSecretHeader: null,
      expectedCronSecret: CRON_SECRET,
    }),
    false,
    "20: missing cron secret rejected"
  );
  assertEqual(
    guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: null,
      expectedCronSecret: CRON_SECRET,
    }),
    { ok: false, status: 403, error: "Forbidden" },
    "20: missing cron secret 403"
  );
  assertEqual(
    guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: "",
      expectedCronSecret: CRON_SECRET,
    }),
    { ok: false, status: 403, error: "Forbidden" },
    "20: empty cron header 403"
  );
  assertEqual(
    guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: "wrong-cron-secret",
      expectedCronSecret: CRON_SECRET,
    }),
    { ok: false, status: 403, error: "Forbidden" },
    "20: incorrect cron secret 403"
  );
  {
    const incorrect = guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: "wrong-cron-secret",
      expectedCronSecret: CRON_SECRET,
    });
    assert(!JSON.stringify(incorrect).includes(CRON_SECRET), "20: response must not leak expected secret");
    assert(!JSON.stringify(incorrect).includes("wrong-cron-secret"), "20: response must not leak provided secret");
  }
  assertEqual(
    guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: CRON_SECRET,
      expectedCronSecret: "",
    }),
    { ok: false, status: 403, error: "Forbidden" },
    "20: empty expected secret fail-closed"
  );
  assertEqual(
    guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: `Bearer ${CRON_SECRET}`,
      expectedCronSecret: CRON_SECRET,
    }),
    { ok: false, status: 403, error: "Forbidden" },
    "20: bearer-wrapped cron secret rejected"
  );
  assertEqual(
    isTrustedMissedBookingCaller({
      cronSecretHeader: CRON_SECRET,
      expectedCronSecret: CRON_SECRET,
    }),
    true,
    "20: correct cron secret trusted"
  );
  assertEqual(
    guardMissedBookingRequest({
      method: "POST",
      cronSecretHeader: CRON_SECRET,
      expectedCronSecret: CRON_SECRET,
    }),
    { ok: true },
    "20: correct cron secret allowed"
  );
  assertEqual(
    guardMissedBookingRequest({
      method: "GET",
      cronSecretHeader: CRON_SECRET,
      expectedCronSecret: CRON_SECRET,
    }),
    { ok: false, status: 405, error: "Method not allowed" },
    "20: GET rejected"
  );

  // Missing session does not exist → not Late for that number
  {
    const collected = collectMissedBookingCandidates(scanInput({ sessions: [session3()] }));
    assertEqual(collected.candidates[0].session2, null, "missing S2: null not late");
    assertEqual(collected.candidates[0].session3, "late", "missing S2: S3 late");
  }

  // Locked live session (confirm-sprint-teachers) is not Late
  {
    const collected = collectMissedBookingCandidates(
      scanInput({
        sessions: [session({ status: "locked", scheduled_at: "2026-08-31T09:00:00+07:00" }), session3()],
      })
    );
    assertEqual(collected.candidates.length, 1, "locked S2: still candidate via S3");
    assertEqual(collected.candidates[0].session2, "neutral", "locked S2: neutral");
    assertEqual(collected.candidates[0].session3, "late", "locked S2: S3 late");
  }

  console.log("missedBookingEmail.test.ts: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  throw err;
});
