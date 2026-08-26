/**
 * Canonical email logic for Edge Functions and tests.
 *
 * Runtime source: supabase/functions/_shared (this file + htmlEscape + emailTemplates).
 * Tests import these modules — do not duplicate them under src/lib.
 *
 * Deno cannot deploy files outside supabase/functions/, so this directory is
 * the single source that both `supabase functions deploy` and unit tests use.
 */

export const DEFAULT_EMAIL_FROM = "Better Minds <noreply@betterminds.edu>";
export const STALE_QUEUED_MS = 2 * 60 * 1000;
export const EMAIL_EVENT_STATUSES = ["queued", "sent", "failed", "skipped"] as const;
export type EmailEventStatus = (typeof EMAIL_EVENT_STATUSES)[number];

export type EmailSendDecision =
  | { action: "send"; reason: "new" }
  | { action: "send"; reason: "retry_failed" }
  | { action: "send"; reason: "retry_stale_queued" }
  | { action: "skip"; reason: "already_sent" }
  | { action: "skip"; reason: "already_skipped" }
  | { action: "skip"; reason: "in_flight" };

export type EmailClaimSpec =
  | { mode: "failed" }
  | { mode: "stale_queued"; staleBefore: Date };

export interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    const av = i < aa.length ? aa[i] : 0;
    const bv = i < bb.length ? bb[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

/**
 * CORS preflight only. POST/GET/PUT/PATCH/DELETE always require service-role auth.
 * OPTIONS must never send mail.
 */
export function isSendEmailAuthExemptMethod(method: string | null | undefined): boolean {
  return (method || "").trim().toUpperCase() === "OPTIONS";
}

function extractServiceRoleToken(authorizationHeader: string | null | undefined): string {
  if (!authorizationHeader) return "";
  if (/[\r\n\0]/.test(authorizationHeader)) return "";
  const trimmed = authorizationHeader.trim();
  if (!trimmed) return "";
  const bearer = /^bearer[ \t]+(\S+)$/i.exec(trimmed);
  if (bearer) return bearer[1];
  if (/\s/.test(trimmed)) return "";
  return trimmed;
}

/**
 * send-email may only be invoked with the service-role key.
 * User JWTs, anon key, extra header junk, and empty secrets are rejected.
 */
export function isTrustedSendEmailCaller(args: {
  authorizationHeader: string | null | undefined;
  serviceRoleKey: string | null | undefined;
}): boolean {
  const serviceRoleKey = args.serviceRoleKey?.trim() || "";
  if (!serviceRoleKey) return false;
  const token = extractServiceRoleToken(args.authorizationHeader);
  if (!token) return false;
  return timingSafeEqual(token, serviceRoleKey);
}

export function normalizeOptionalEmail(value: string | null | undefined): string | undefined {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : undefined;
}

/** Lightweight recipient check. Empty, whitespace-only, and obviously malformed addresses are rejected. */
export function isValidRecipientEmail(value: string | null | undefined): boolean {
  const email = normalizeOptionalEmail(value);
  if (!email) return false;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function resolveReplyTo(args: {
  override?: string | null;
  envValue?: string | null;
}): string | undefined {
  return normalizeOptionalEmail(args.override) || normalizeOptionalEmail(args.envValue);
}

export function buildResendEmailPayload(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string | null;
}): ResendEmailPayload {
  const payload: ResendEmailPayload = {
    from: args.from?.trim() || DEFAULT_EMAIL_FROM,
    to: [args.to.trim()],
    subject: args.subject,
    html: args.html,
  };
  const replyTo = normalizeOptionalEmail(args.replyTo);
  if (replyTo) payload.reply_to = replyTo;
  return payload;
}

export function decideEmailSendAction(args: {
  existing: { status: EmailEventStatus; updatedAt: Date } | null;
  now?: Date;
  staleQueuedMs?: number;
}): EmailSendDecision {
  const existing = args.existing;
  if (!existing) return { action: "send", reason: "new" };
  if (existing.status === "sent") return { action: "skip", reason: "already_sent" };
  if (existing.status === "skipped") return { action: "skip", reason: "already_skipped" };
  if (existing.status === "failed") return { action: "send", reason: "retry_failed" };
  const now = args.now ?? new Date();
  const staleMs = args.staleQueuedMs ?? STALE_QUEUED_MS;
  const age = now.getTime() - existing.updatedAt.getTime();
  if (age >= staleMs) return { action: "send", reason: "retry_stale_queued" };
  return { action: "skip", reason: "in_flight" };
}

export function claimSpecForReason(
  reason: string,
  now: Date,
  staleQueuedMs: number = STALE_QUEUED_MS
): EmailClaimSpec | null {
  if (reason === "retry_failed") return { mode: "failed" };
  if (reason === "retry_stale_queued") {
    return { mode: "stale_queued", staleBefore: new Date(now.getTime() - staleQueuedMs) };
  }
  return null;
}

export interface EmailEventRow {
  id: string;
  idempotency_key: string;
  template: string;
  user_id: string | null;
  to_email: string;
  status: EmailEventStatus;
  provider_id: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface EmailStore {
  findByIdempotencyKey(key: string): Promise<EmailEventRow | null>;
  insertQueued(input: {
    idempotency_key: string;
    template: string;
    user_id: string | null;
    to_email: string;
    metadata: Record<string, unknown> | null;
    now: Date;
  }): Promise<{ row: EmailEventRow; conflict: boolean }>;
  insertSkipped(input: {
    idempotency_key: string;
    template: string;
    user_id: string | null;
    to_email: string;
    metadata: Record<string, unknown> | null;
    now: Date;
  }): Promise<{ row: EmailEventRow; conflict: boolean }>;
  /**
   * Atomic compare-and-set. Must not succeed for two callers on the same row.
   * failed → only status=failed; stale_queued → status=queued AND updated_at <= staleBefore.
   */
  claimForSend(id: string, spec: EmailClaimSpec, now: Date): Promise<boolean>;
  markSent(id: string, providerId: string, now: Date): Promise<void>;
  markFailed(id: string, error: string, now: Date): Promise<void>;
}

export interface EmailProvider {
  send(
    payload: ResendEmailPayload
  ): Promise<{ ok: true; providerId: string } | { ok: false; error: string }>;
}

export interface SendTransactionalInput {
  idempotencyKey: string;
  template: string;
  to: string;
  subject: string;
  html: string;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  from?: string;
  replyTo?: string | null;
  now?: Date;
}

export type SendTransactionalResult =
  | {
      ok: true;
      already_processed: true;
      status: EmailEventStatus;
      reason: string;
      eventId: string | null;
    }
  | {
      ok: true;
      already_processed: false;
      status: "sent";
      providerId: string;
      eventId: string;
    }
  | {
      ok: true;
      already_processed: false;
      status: "skipped";
      reason: string;
      eventId: string;
    }
  | {
      ok: false;
      already_processed: false;
      status: "failed" | "error";
      error: string;
      eventId: string | null;
    };

/**
 * Persist an intentional skip (missing/invalid recipient). Never throws.
 * Existing rows are left unchanged so a prior send/fail is not overwritten.
 */
export async function recordSkippedEmail(
  store: EmailStore,
  input: {
    idempotencyKey: string;
    template: string;
    to?: string | null;
    userId?: string | null;
    metadata?: Record<string, unknown> | null;
    reason: string;
    now?: Date;
  }
): Promise<SendTransactionalResult> {
  try {
    const now = input.now ?? new Date();
    const existing = await store.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        ok: true,
        already_processed: true,
        status: existing.status,
        reason: existing.status === "skipped" ? "already_skipped" : "already_exists",
        eventId: existing.id,
      };
    }

    const inserted = await store.insertSkipped({
      idempotency_key: input.idempotencyKey,
      template: input.template,
      user_id: input.userId ?? null,
      to_email: (input.to || "").trim(),
      metadata: { ...(input.metadata || {}), skip_reason: input.reason },
      now,
    });

    if (inserted.conflict) {
      return {
        ok: true,
        already_processed: true,
        status: inserted.row.status,
        reason: "already_exists",
        eventId: inserted.row.id,
      };
    }

    return {
      ok: true,
      already_processed: false,
      status: "skipped",
      reason: input.reason,
      eventId: inserted.row.id,
    };
  } catch (err) {
    return {
      ok: false,
      already_processed: false,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      eventId: null,
    };
  }
}

function toExisting(row: EmailEventRow): { status: EmailEventStatus; updatedAt: Date } {
  return { status: row.status, updatedAt: new Date(row.updated_at) };
}

/**
 * Idempotent transactional send. Never throws.
 * Failed rows are retried in place with the same idempotency_key.
 */
export async function sendTransactionalEmail(
  deps: { store: EmailStore; provider: EmailProvider },
  input: SendTransactionalInput
): Promise<SendTransactionalResult> {
  try {
    const now = input.now ?? new Date();
    const existing = await deps.store.findByIdempotencyKey(input.idempotencyKey);
    const decision = decideEmailSendAction({
      existing: existing ? toExisting(existing) : null,
      now,
    });

    if (decision.action === "skip") {
      return {
        ok: true,
        already_processed: true,
        status: existing?.status || "sent",
        reason: decision.reason,
        eventId: existing?.id || null,
      };
    }

    let event = existing;
    let claimReason = decision.reason;

    if (decision.reason === "new") {
      const inserted = await deps.store.insertQueued({
        idempotency_key: input.idempotencyKey,
        template: input.template,
        user_id: input.userId ?? null,
        to_email: input.to,
        metadata: input.metadata ?? null,
        now,
      });
      if (inserted.conflict) {
        const raced = decideEmailSendAction({
          existing: toExisting(inserted.row),
          now,
        });
        if (raced.action === "skip") {
          return {
            ok: true,
            already_processed: true,
            status: inserted.row.status,
            reason: raced.reason,
            eventId: inserted.row.id,
          };
        }
        event = inserted.row;
        claimReason = raced.reason;
      } else {
        event = inserted.row;
        claimReason = "new";
      }
    }

    if (!event) {
      return { ok: false, already_processed: false, status: "error", error: "Missing email event", eventId: null };
    }

    const spec = claimSpecForReason(claimReason, now);
    if (spec) {
      const claimed = await deps.store.claimForSend(event.id, spec, now);
      if (!claimed) {
        const latest = await deps.store.findByIdempotencyKey(input.idempotencyKey);
        return {
          ok: true,
          already_processed: true,
          status: latest?.status || "sent",
          reason: "claim_lost",
          eventId: latest?.id || event.id,
        };
      }
    }

    const payload = buildResendEmailPayload({
      to: input.to,
      subject: input.subject,
      html: input.html,
      from: input.from,
      replyTo: input.replyTo,
    });

    let sent: { ok: true; providerId: string } | { ok: false; error: string };
    try {
      sent = await deps.provider.send(payload);
    } catch (err) {
      sent = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const sendError = "error" in sent ? sent.error : null;
    if (sendError) {
      await deps.store.markFailed(event.id, sendError, now);
      return {
        ok: false,
        already_processed: false,
        status: "failed",
        error: sendError,
        eventId: event.id,
      };
    }

    const providerId = "providerId" in sent ? sent.providerId : "";
    await deps.store.markSent(event.id, providerId, now);
    return {
      ok: true,
      already_processed: false,
      status: "sent",
      providerId,
      eventId: event.id,
    };
  } catch (err) {
    return {
      ok: false,
      already_processed: false,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      eventId: null,
    };
  }
}
