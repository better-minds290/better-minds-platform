/**
 * Tests the canonical Edge email modules in supabase/functions/_shared.
 * There is no parallel implementation under src/lib — this file only tests.
 */
import {
  buildResendEmailPayload,
  decideEmailSendAction,
  isSendEmailAuthExemptMethod,
  isTrustedSendEmailCaller,
  sendTransactionalEmail,
  type EmailClaimSpec,
  type EmailEventRow,
  type EmailProvider,
  type EmailStore,
} from "../../../supabase/functions/_shared/emailLogic.ts";
import { escapeHtml } from "../../../supabase/functions/_shared/htmlEscape.ts";
import {
  EMAIL_TEMPLATE_IDS,
  renderEmailTemplate,
} from "../../../supabase/functions/_shared/emailTemplates.ts";

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

async function run() {
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

  function mockProvider(options?: { failOnce?: boolean; failAlways?: boolean }) {
    let failOnce = options?.failOnce ?? false;
    const payloads: ReturnType<typeof buildResendEmailPayload>[] = [];
    const provider: EmailProvider = {
      async send(payload) {
        payloads.push(payload);
        if (options?.failAlways || failOnce) {
          failOnce = false;
          return { ok: false, error: "Resend 502" };
        }
        return { ok: true, providerId: `re_${payloads.length}` };
      },
    };
    return { provider, payloads };
  }

  const SERVICE_KEY = "service-role-secret-key";

  function baseInput(overrides: Partial<Parameters<typeof sendTransactionalEmail>[1]> = {}) {
    return {
      idempotencyKey: "class-assigned:sess-1:class-1:learner",
      template: "class_assignment_learner",
      to: "learner@example.com",
      subject: "Class scheduled",
      html: "<p>Hello</p>",
      now: new Date("2026-08-26T08:00:00.000Z"),
      ...overrides,
    };
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const result = await sendTransactionalEmail({ store, provider }, baseInput());
    assert(result.ok === true && result.already_processed === false, "1: first send ok");
    assertEqual(result.status, "sent", "1: status sent");
    assertEqual(payloads.length, 1, "1: provider called once");
    const row = await store.findByIdempotencyKey(baseInput().idempotencyKey);
    assertEqual(row?.status, "sent", "1: row sent");
    assertEqual(row?.provider_id, "re_1", "1: provider id stored");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await sendTransactionalEmail({ store, provider }, baseInput());
    const second = await sendTransactionalEmail({ store, provider }, baseInput());
    assert(second.ok === true && second.already_processed === true, "2: already processed");
    assertEqual(second.status, "sent", "2: still sent");
    assertEqual(payloads.length, 1, "2: provider not called again");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const learnerKey = "class-assigned:sess-1:class-1:learner";
    const teacherKey = "class-assigned:sess-1:class-1:teacher";
    await sendTransactionalEmail({ store, provider }, baseInput({ idempotencyKey: learnerKey, to: "a@x.com" }));
    await sendTransactionalEmail(
      { store, provider },
      baseInput({ idempotencyKey: teacherKey, to: "t@x.com", template: "class_assignment_teacher" })
    );
    assertEqual(payloads.length, 2, "3: two provider sends");
    assertEqual((await store.findByIdempotencyKey(learnerKey))?.status, "sent", "3: learner sent");
    assertEqual((await store.findByIdempotencyKey(teacherKey))?.status, "sent", "3: teacher sent");
  }

  {
    const store = new MemoryEmailStore();
    const { provider } = mockProvider({ failAlways: true });
    const result = await sendTransactionalEmail({ store, provider }, baseInput());
    assert(result.ok === false, "4: not ok");
    assertEqual(result.status, "failed", "4: failed status");
    const row = await store.findByIdempotencyKey(baseInput().idempotencyKey);
    assertEqual(row?.status, "failed", "4: row failed");
    assertEqual(row?.error, "Resend 502", "4: error stored");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider({ failOnce: true });
    const first = await sendTransactionalEmail({ store, provider }, baseInput());
    assert(first.ok === false, "5: first attempt fails");
    assertEqual((await store.findByIdempotencyKey(baseInput().idempotencyKey))?.status, "failed", "5: marked failed");
    const retry = await sendTransactionalEmail({ store, provider }, baseInput());
    assert(retry.ok === true && retry.already_processed === false, "5: retry sends");
    assertEqual(retry.status, "sent", "6: retry becomes sent");
    assertEqual(payloads.length, 2, "5: provider called twice");
    assertEqual((await store.findByIdempotencyKey(baseInput().idempotencyKey))?.status, "sent", "6: row sent");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await sendTransactionalEmail({ store, provider }, baseInput());
    assertEqual("reply_to" in payloads[0], false, "7: reply_to omitted");
    assertEqual(payloads[0].to, ["learner@example.com"], "7: to set");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    await sendTransactionalEmail(
      { store, provider },
      baseInput({ idempotencyKey: "with-reply", replyTo: "hello@betterminds.org" })
    );
    assertEqual(payloads[0].reply_to, "hello@betterminds.org", "8: reply_to passed");
  }

  {
    const payload = buildResendEmailPayload({
      to: "a@b.com",
      subject: "Hi",
      html: "<p>x</p>",
      replyTo: "  ",
    });
    assertEqual("reply_to" in payload, false, "8b: blank reply_to omitted");
  }

  {
    const rendered = renderEmailTemplate("missed_booking", {
      learner_name: `<img src=x onerror="alert(1)">`,
      late_sessions_vi: "Buổi 2 & Buổi 3",
      late_sessions_en: "Session 2 & Session 3",
      sprint_number: 2,
      course_name: `English <script>alert('xss')</script>`,
    });
    assertNotIncludes(rendered.html, "<script>", "9: script tag escaped");
    assertNotIncludes(rendered.html, "<img src=x", "9: img tag escaped");
    assertIncludes(rendered.html, "&lt;img", "9: name escaped");
    assertIncludes(rendered.html, "&amp;", "9: ampersand escaped");
    assertIncludes(rendered.html, "&lt;script&gt;", "9: course name escaped");
    assertNotIncludes(rendered.html, "enrollment_id", "9: no internal id field");
    assertNotIncludes(rendered.subject, "sess-", "9: subject has no session uuid");
  }

  {
    const assignment = renderEmailTemplate("class_assignment_learner", {
      learner_name: "A <b>B</b>",
      teacher_name: "C",
      session_number: 2,
      sprint_number: 1,
      class_date: "Mon 1 Sep",
      start_time: "09:00",
      end_time: "10:00",
      meeting_link: `javascript:alert(1)`,
    });
    assertIncludes(assignment.html, "&lt;b&gt;", "9b: learner name escaped");
    assertIncludes(assignment.html, "javascript:alert(1)", "9b: link still escaped as text");
    assertNotIncludes(assignment.html, "<b>B</b>", "9b: raw html not injected");
    assertNotIncludes(assignment.html, `href="javascript:`, "9b: javascript href not used");
  }

  assertEqual(EMAIL_TEMPLATE_IDS.length, 5, "templates: five ids");
  assertEqual(
    [...EMAIL_TEMPLATE_IDS].sort().join(","),
    [
      "absence_recorded",
      "class_assignment_learner",
      "class_assignment_teacher",
      "class_cancelled_teacher_unavailable",
      "missed_booking",
    ].join(","),
    "templates: expected names"
  );

  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: "Bearer user-jwt-token",
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: user jwt rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: "Bearer anon-public-key",
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: anon key rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: null,
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: missing header rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `Bearer ${SERVICE_KEY}`,
      serviceRoleKey: "",
    }),
    false,
    "10: empty service role fail-closed"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `Bearer ${SERVICE_KEY} extra`,
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: trailing junk rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `Bearer ${SERVICE_KEY}\nX-Injected: 1`,
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: CRLF injection rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `Basic ${SERVICE_KEY}`,
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: wrong scheme rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `Bearer`,
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: bearer without token rejected"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `prefix${SERVICE_KEY}`,
      serviceRoleKey: SERVICE_KEY,
    }),
    false,
    "10: key as substring rejected"
  );

  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `Bearer ${SERVICE_KEY}`,
      serviceRoleKey: SERVICE_KEY,
    }),
    true,
    "11: service role accepted"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: SERVICE_KEY,
      serviceRoleKey: SERVICE_KEY,
    }),
    true,
    "11: raw service role token accepted"
  );
  assertEqual(
    isTrustedSendEmailCaller({
      authorizationHeader: `bearer\t${SERVICE_KEY}`,
      serviceRoleKey: SERVICE_KEY,
    }),
    true,
    "11: tab after bearer accepted"
  );

  assertEqual(isSendEmailAuthExemptMethod("OPTIONS"), true, "cors: OPTIONS exempt");
  assertEqual(isSendEmailAuthExemptMethod("options"), true, "cors: options case-insensitive");
  assertEqual(isSendEmailAuthExemptMethod("POST"), false, "cors: POST requires auth");
  assertEqual(isSendEmailAuthExemptMethod("GET"), false, "cors: GET requires auth");
  assertEqual(isSendEmailAuthExemptMethod("PUT"), false, "cors: PUT requires auth");

  assertEqual(decideEmailSendAction({ existing: null }).action, "send", "decision: new");
  assertEqual(
    decideEmailSendAction({
      existing: { status: "sent", updatedAt: new Date("2026-08-26T00:00:00Z") },
    }).reason,
    "already_sent",
    "decision: sent"
  );
  assertEqual(
    decideEmailSendAction({
      existing: { status: "failed", updatedAt: new Date("2026-08-26T00:00:00Z") },
    }).reason,
    "retry_failed",
    "decision: failed retries"
  );
  assertEqual(
    decideEmailSendAction({
      existing: { status: "queued", updatedAt: new Date("2026-08-26T07:59:00Z") },
      now: new Date("2026-08-26T08:00:00Z"),
    }).reason,
    "in_flight",
    "decision: recent queued is in-flight"
  );
  assertEqual(
    decideEmailSendAction({
      existing: { status: "queued", updatedAt: new Date("2026-08-26T07:00:00Z") },
      now: new Date("2026-08-26T08:00:00Z"),
    }).reason,
    "retry_stale_queued",
    "decision: stale queued retries"
  );

  {
    const store: EmailStore = {
      async findByIdempotencyKey() {
        throw new Error("db down");
      },
      async insertQueued() {
        throw new Error("db down");
      },
      async insertSkipped() {
        throw new Error("db down");
      },
      async claimForSend() {
        throw new Error("db down");
      },
      async markSent() {
        throw new Error("db down");
      },
      async markFailed() {
        throw new Error("db down");
      },
    };
    const { provider } = mockProvider();
    const result = await sendTransactionalEmail({ store, provider }, baseInput());
    assert(result.ok === false, "never-throw: ok false");
    assertEqual(result.status, "error", "never-throw: error status");
  }

  {
    const store = new MemoryEmailStore();
    const { provider, payloads } = mockProvider();
    const [a, b] = await Promise.all([
      sendTransactionalEmail({ store, provider }, baseInput({ idempotencyKey: "concurrent-new" })),
      sendTransactionalEmail({ store, provider }, baseInput({ idempotencyKey: "concurrent-new" })),
    ]);
    const sends = [a, b];
    const delivered = sends.filter((r) => r.ok && r.already_processed === false);
    const skipped = sends.filter((r) => r.ok && r.already_processed === true);
    assertEqual(delivered.length, 1, "concurrent new: one send");
    assertEqual(skipped.length, 1, "concurrent new: one skip");
    assertEqual(payloads.length, 1, "concurrent new: provider once");
  }

  {
    const store = new MemoryEmailStore();
    const failing = mockProvider({ failAlways: true });
    await sendTransactionalEmail({ store, provider: failing.provider }, baseInput({ idempotencyKey: "concurrent-retry" }));
    assertEqual((await store.findByIdempotencyKey("concurrent-retry"))?.status, "failed", "concurrent retry setup");
    const { provider, payloads } = mockProvider();
    const [a, b] = await Promise.all([
      sendTransactionalEmail({ store, provider }, baseInput({ idempotencyKey: "concurrent-retry" })),
      sendTransactionalEmail({ store, provider }, baseInput({ idempotencyKey: "concurrent-retry" })),
    ]);
    const delivered = [a, b].filter((r) => r.ok && r.already_processed === false);
    const skipped = [a, b].filter((r) => r.ok && r.already_processed === true);
    assertEqual(payloads.length, 1, "concurrent retry: provider once");
    assertEqual(delivered.length, 1, "concurrent retry: one winner");
    assertEqual(skipped.length, 1, "concurrent retry: one skip");
  }

  assertEqual(escapeHtml("<x>"), "&lt;x&gt;", "escapeHtml basic");

  console.log("email.test.ts: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  throw err;
});
