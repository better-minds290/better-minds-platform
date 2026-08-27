/**
 * Phase 2: Admin class-assignment emails.
 * Tests canonical modules in supabase/functions/_shared — no duplicate runtime.
 */
import {
  afterSuccessfulAdminAssignment,
  classAssignmentIdempotencyKey,
  deliverAdminClassAssignmentEmails,
  isRealClassAssignment,
  shouldSendAdminClassAssignmentEmail,
  type ClassAssignmentSnapshot,
} from "../../../supabase/functions/_shared/classAssignmentEmail.ts";
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

function snapshot(overrides: Partial<ClassAssignmentSnapshot> = {}): ClassAssignmentSnapshot {
  return {
    sprintSessionId: "sess-2",
    learnerId: "learner-a",
    teacherId: "teacher-1",
    classId: "class-1",
    classScheduleId: "sched-mon-1800",
    sessionNumber: 2,
    sprintNumber: 1,
    classDate: "2026-08-31",
    startTime: "18:00:00",
    endTime: "19:00:00",
    courseName: "English B1",
    meetingLink: "https://meet.example/abc",
    learnerName: "An Nguyen",
    teacherName: "Mai Teacher",
    learnerEmail: "an@example.com",
    teacherEmail: "mai@example.com",
    enrolled: true,
    scheduleStatus: "scheduled",
    addedToExistingClass: false,
    durationMinutes: 60,
    ...overrides,
  };
}

const NOW = new Date("2026-08-26T08:00:00.000Z");

async function run() {
  assert(isRealClassAssignment(snapshot()), "real assignment: valid");
  assertEqual(isRealClassAssignment(snapshot({ enrolled: false })), false, "real assignment: needs enrollment");
  assertEqual(isRealClassAssignment(snapshot({ classScheduleId: "" })), false, "real assignment: needs schedule");
  assertEqual(isRealClassAssignment(snapshot({ classId: "" })), false, "real assignment: needs class");
  assertEqual(
    isRealClassAssignment(snapshot({ scheduleStatus: "cancelled" })),
    false,
    "real assignment: cancelled schedule is not a booking"
  );
  assertEqual(
    isRealClassAssignment(snapshot({ classId: null as unknown as string, classScheduleId: "sched-x" })),
    false,
    "real assignment: scheduled_at-only is not enough without class_id"
  );

  const learnerKey = classAssignmentIdempotencyKey({
    role: "learner",
    sprintSessionId: "sess-2",
    learnerId: "learner-a",
    teacherId: "teacher-1",
    classScheduleId: "sched-mon-1800",
  });
  const teacherKey = classAssignmentIdempotencyKey({
    role: "teacher",
    sprintSessionId: "sess-2",
    learnerId: "learner-a",
    teacherId: "teacher-1",
    classScheduleId: "sched-mon-1800",
  });
  assertEqual(learnerKey, "class_assignment:sess-2:learner:learner-a:sched-mon-1800", "5: learner key shape");
  assertEqual(
    teacherKey,
    "class_assignment:sess-2:teacher:teacher-1:sched-mon-1800:learner-a",
    "5: teacher key includes learner"
  );
  assert(learnerKey !== teacherKey, "5: learner and teacher keys differ");

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverAdminClassAssignmentEmails({ store, provider }, snapshot(), { now: NOW });
    assertEqual(result.assignmentUnaffected, true, "1+2: assignment unaffected");
    assert(result.learner.ok === true && result.learner.status === "sent", "1: learner sent");
    assert(result.teacher.ok === true && result.teacher.status === "sent", "2: teacher sent");
    assertEqual(payloads.length, 2, "1+2: two provider sends");
    assertEqual(payloads[0].to, ["an@example.com"], "1: learner recipient");
    assertEqual(payloads[1].to, ["mai@example.com"], "2: teacher recipient");
    assertEqual((await store.findByIdempotencyKey(learnerKey))?.status, "sent", "1: learner event sent");
    assertEqual((await store.findByIdempotencyKey(teacherKey))?.status, "sent", "2: teacher event sent");
    assertIncludes(payloads[0].html, "Session: 2", "1: session 2 in learner html");
    assertIncludes(payloads[1].html, "An Nguyen", "2: learner name in teacher html");
    assertEqual("reply_to" in payloads[0], false, "reply-to omitted when unset");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverAdminClassAssignmentEmails({ store, provider }, snapshot(), { now: NOW });
    const retry = await deliverAdminClassAssignmentEmails({ store, provider }, snapshot(), { now: NOW });
    assertEqual(payloads.length, 2, "3+4: retry does not resend");
    assert(retry.learner.ok === true && retry.learner.already_processed === true, "3: learner already processed");
    assert(retry.teacher.ok === true && retry.teacher.already_processed === true, "4: teacher already processed");
    assertEqual((await store.findByIdempotencyKey(learnerKey))?.status, "sent", "3: learner still sent once");
    assertEqual((await store.findByIdempotencyKey(teacherKey))?.status, "sent", "4: teacher still sent once");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const first = snapshot({
      sprintSessionId: "sess-a",
      learnerId: "learner-a",
      learnerEmail: "a@example.com",
      learnerName: "Learner A",
      classScheduleId: "sched-group",
    });
    const second = snapshot({
      sprintSessionId: "sess-b",
      learnerId: "learner-b",
      learnerEmail: "b@example.com",
      learnerName: "Learner B",
      classScheduleId: "sched-group",
      addedToExistingClass: true,
    });
    await deliverAdminClassAssignmentEmails({ store, provider }, first, { now: NOW });
    await deliverAdminClassAssignmentEmails({ store, provider }, second, { now: NOW });
    assertEqual(payloads.length, 4, "6+7: four sends for two learners");
    const keys = [...store.rows.keys()].sort();
    assertEqual(keys.length, 4, "6+7: four distinct events");
    const firstTeacherKey = classAssignmentIdempotencyKey({
      role: "teacher",
      sprintSessionId: "sess-a",
      learnerId: "learner-a",
      teacherId: "teacher-1",
      classScheduleId: "sched-group",
    });
    const secondTeacherKey = classAssignmentIdempotencyKey({
      role: "teacher",
      sprintSessionId: "sess-b",
      learnerId: "learner-b",
      teacherId: "teacher-1",
      classScheduleId: "sched-group",
    });
    assert(firstTeacherKey !== secondTeacherKey, "7: teacher events uniquely tied to each learner");
    assertEqual((await store.findByIdempotencyKey(firstTeacherKey))?.status, "sent", "7: first teacher event kept");
    assertEqual((await store.findByIdempotencyKey(secondTeacherKey))?.status, "sent", "7: second teacher event sent");
    assertIncludes(payloads[2].html, "existing class", "6: second learner group wording");
    assertIncludes(payloads[3].html, "Learner B", "7: teacher told about second learner");
    assertNotIncludes(payloads[2].html, "a new class was created", "6: no misleading new-class copy");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const first = snapshot({ classScheduleId: "sched-mon-1800" });
    const reassigned = snapshot({
      classScheduleId: "sched-tue-1900",
      classId: "class-2",
      classDate: "2026-09-01",
      startTime: "19:00:00",
      endTime: "20:00:00",
    });
    await deliverAdminClassAssignmentEmails({ store, provider }, first, { now: NOW });
    await deliverAdminClassAssignmentEmails({ store, provider }, reassigned, { now: NOW });
    assertEqual(payloads.length, 4, "8: reassignment sends new learner+teacher emails");
    const newLearnerKey = classAssignmentIdempotencyKey({
      role: "learner",
      sprintSessionId: "sess-2",
      learnerId: "learner-a",
      teacherId: "teacher-1",
      classScheduleId: "sched-tue-1900",
    });
    assertEqual((await store.findByIdempotencyKey(learnerKey))?.status, "sent", "8: original learner event kept");
    assertEqual((await store.findByIdempotencyKey(newLearnerKey))?.status, "sent", "8: new schedule eligible");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider({ failAlways: true });
    const emailResult = await deliverAdminClassAssignmentEmails({ store, provider }, snapshot(), { now: NOW });
    const assignment = await afterSuccessfulAdminAssignment(async () => {
      if (!emailResult.learner.ok) throw new Error("provider failed");
    });
    assertEqual(assignment.assignmentSuccess, true, "9: assignment still succeeds");
    assertEqual(emailResult.assignmentUnaffected, true, "9: email layer does not affect assignment");
    assert(emailResult.learner.ok === false && emailResult.learner.status === "failed", "9: learner failed logged");
    assertEqual((await store.findByIdempotencyKey(learnerKey))?.status, "failed", "9: failed row retained for retry");
    assertEqual(payloads.length, 2, "9: provider was attempted");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverAdminClassAssignmentEmails(
      { store, provider },
      snapshot({ learnerEmail: null }),
      { now: NOW }
    );
    const assignment = await afterSuccessfulAdminAssignment(async () => result);
    assertEqual(assignment.assignmentSuccess, true, "10: assignment succeeds without learner email");
    assert(result.learner.ok === true && result.learner.status === "skipped", "10: learner skipped");
    assert(result.teacher.ok === true && result.teacher.status === "sent", "10: teacher still sent");
    assertEqual(payloads.length, 1, "10: only teacher provider send");
    assertEqual((await store.findByIdempotencyKey(learnerKey))?.status, "skipped", "10: skipped event recorded");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await deliverAdminClassAssignmentEmails(
      { store, provider },
      snapshot({ teacherEmail: "not-an-email" }),
      { now: NOW }
    );
    const assignment = await afterSuccessfulAdminAssignment(async () => result);
    assertEqual(assignment.assignmentSuccess, true, "11: assignment succeeds without valid teacher email");
    assert(result.teacher.ok === true && result.teacher.status === "skipped", "11: teacher skipped");
    assert(result.learner.ok === true && result.learner.status === "sent", "11: learner still sent");
    assertEqual(payloads.length, 1, "11: only learner provider send");
    assertEqual((await store.findByIdempotencyKey(teacherKey))?.status, "skipped", "11: skipped event recorded");
  }

  assertEqual(shouldSendAdminClassAssignmentEmail("admin_assign"), true, "12: admin_assign triggers");
  assertEqual(shouldSendAdminClassAssignmentEmail("book_class"), false, "12: self-book does not trigger");
  assertEqual(shouldSendAdminClassAssignmentEmail("reschedule"), false, "12: learner reschedule does not trigger");
  assertEqual(shouldSendAdminClassAssignmentEmail("enrollment_cancel"), false, "12: cancel does not trigger");
  assertEqual(
    shouldSendAdminClassAssignmentEmail("enrollment_reassign"),
    false,
    "12: unused enrollment_reassign does not trigger this template pair from that action"
  );

  {
    const session2 = renderEmailTemplate("class_assignment_learner", {
      learner_name: "An",
      teacher_name: "Mai",
      session_number: 2,
      sprint_number: 3,
      class_date: "Mon 31 Aug 2026",
      start_time: "18:00",
      end_time: "19:00",
      duration_minutes: 60,
      course_name: "English B1",
      meeting_link: "https://meet.example/s2",
    });
    assertEqual(session2.subject, "Your class is scheduled — Session 2", "13: new-class subject");
    assertIncludes(session2.html, "Your class has been scheduled with Mai", "13: new-class intro");
    assertNotIncludes(session2.html, "You are booked with", "13: no self-book wording");
    assertNotIncludes(session2.html, "Buổi", "13: english only");
    assertIncludes(session2.html, "Session: 2", "13: session 2 body");
    assertIncludes(session2.html, "Sprint: 3", "13: sprint");
    assertIncludes(session2.html, "Course: English B1", "13: course");
    assertIncludes(session2.html, "Date: Mon 31 Aug 2026", "13: date");
    assertIncludes(session2.html, "18:00–19:00", "13: start and end");
    assertIncludes(session2.html, "Duration: 60 min", "13: duration EN");
    assertNotIncludes(session2.html, "phút", "13: no vietnamese duration");
    assertIncludes(session2.html, "Mai", "13: teacher name");
    assertIncludes(session2.html, "prepare for the lesson", "13: prepare reminder");
    assertIncludes(session2.html, "join on time", "13: on-time reminder");
    assertIncludes(session2.html, "https://meet.example/s2", "13: meeting link");
  }

  {
    const grouped = renderEmailTemplate("class_assignment_learner", {
      learner_name: "An",
      teacher_name: "Mai",
      session_number: 2,
      sprint_number: 1,
      class_date: "Mon 31 Aug 2026",
      start_time: "18:00",
      end_time: "19:00",
      added_to_existing_class: true,
    });
    assertEqual(grouped.subject, "You've been added to a class — Session 2", "13b: group learner subject");
    assertIncludes(grouped.html, "You've been added to an existing class with Mai", "13b: group learner intro");
    assertNotIncludes(grouped.html, "Your class has been scheduled with", "13b: not new-class intro");

    const groupedTeacher = renderEmailTemplate("class_assignment_teacher", {
      learner_name: "An",
      teacher_name: "Mai",
      session_number: 2,
      sprint_number: 1,
      class_date: "Mon 31 Aug 2026",
      start_time: "18:00",
      end_time: "19:00",
      added_to_existing_class: true,
    });
    assertEqual(groupedTeacher.subject, "New learner assigned — An", "13b: teacher subject unchanged");
    assertIncludes(groupedTeacher.html, "An has been added to your existing class", "13b: group teacher intro");
    assertNotIncludes(groupedTeacher.html, "has been assigned to your class", "13b: not new-class teacher intro");
  }

  {
    const session3 = renderEmailTemplate("class_assignment_teacher", {
      learner_name: "Binh",
      teacher_name: "Chris",
      session_number: 3,
      sprint_number: 1,
      class_date: "Thu 3 Sep 2026",
      start_time: "19:00",
      end_time: "20:00",
      duration_minutes: 60,
    });
    assertEqual(session3.subject, "New learner assigned — Binh", "14: learner in teacher subject");
    assertIncludes(session3.html, "Binh has been assigned to your class", "14: new assignment wording");
    assertNotIncludes(session3.html, "is in your Session", "14: no vague roster wording");
    assertNotIncludes(session3.html, "Buổi", "14: english only");
    assertIncludes(session3.html, "Session: 3", "14: session 3");
    assertIncludes(session3.html, "Chris", "14: teacher name");
    assertIncludes(session3.html, "Binh", "14: learner name");
    assertIncludes(session3.html, "19:00–20:00", "14: times");
    assertIncludes(session3.html, "prepare for the session", "14: prepare reminder");
    assertIncludes(session3.html, "not available yet", "14: missing meeting link fallback");
    assertNotIncludes(session3.html, "if provided", "14: no promised future link");
  }

  {
    const rendered = renderEmailTemplate("class_assignment_learner", {
      learner_name: `An <img src=x onerror="alert(1)">`,
      teacher_name: `Mai & Co <script>alert('xss')</script>`,
      session_number: 2,
      sprint_number: 1,
      class_date: "Mon 31 Aug",
      start_time: "18:00",
      end_time: "19:00",
    });
    assertNotIncludes(rendered.html, "<script>", "15: script escaped");
    assertNotIncludes(rendered.html, "<img src=x", "15: img escaped");
    assertIncludes(rendered.html, "&lt;img", "15: learner name escaped");
    assertIncludes(rendered.html, "&amp;", "15: teacher ampersand escaped");
    assertIncludes(rendered.html, "&lt;script&gt;", "15: teacher name escaped");
  }

  {
    const safe = renderEmailTemplate("class_assignment_teacher", {
      learner_name: "An",
      teacher_name: "Mai",
      session_number: 2,
      sprint_number: 1,
      class_date: "Mon 31 Aug",
      start_time: "18:00",
      end_time: "19:00",
      meeting_link: `javascript:alert(1)`,
    });
    assertIncludes(safe.html, "javascript:alert(1)", "16: non-http link shown as text");
    assertNotIncludes(safe.html, `href="javascript:`, "16: javascript href not used");

    const http = renderEmailTemplate("class_assignment_learner", {
      learner_name: "An",
      teacher_name: "Mai",
      session_number: 2,
      sprint_number: 1,
      class_date: "Mon 31 Aug",
      start_time: "18:00",
      end_time: "19:00",
      meeting_link: `https://meet.example/" onclick="alert(1)`,
    });
    assertIncludes(http.html, "href=", "16: http link may be anchored");
    assertNotIncludes(http.html, `onclick="alert(1)`, "16: quote in url escaped out of attribute");
    assertIncludes(http.html, "&quot;", "16: quote escaped");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await deliverAdminClassAssignmentEmails(
      { store, provider },
      snapshot(),
      { now: NOW, replyTo: "hello@betterminds.org" }
    );
    assertEqual(payloads[0].reply_to, "hello@betterminds.org", "reply-to from resolveReplyTo path");
  }

  {
    const store = new MemoryEmailStore();
    const { provider } = mockProvider({ failAlways: true });
    await deliverAdminClassAssignmentEmails({ store, provider }, snapshot(), { now: NOW });
    const retryStoreProvider = mockProvider();
    const retry = await deliverAdminClassAssignmentEmails(
      { store, provider: retryStoreProvider.provider },
      snapshot(),
      { now: NOW }
    );
    assert(retry.learner.ok === true && retry.learner.status === "sent", "failed send retries in place");
    assertEqual(retryStoreProvider.payloads.length, 2, "failed retry sends both recipients");
  }

  console.log("classAssignmentEmail.test.ts: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  throw err;
});
