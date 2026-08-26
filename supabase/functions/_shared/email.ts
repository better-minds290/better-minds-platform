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

export {
  buildResendEmailPayload,
  claimSpecForReason,
  decideEmailSendAction,
  DEFAULT_EMAIL_FROM,
  isSendEmailAuthExemptMethod,
  isTrustedSendEmailCaller,
  normalizeOptionalEmail,
  resolveReplyTo,
  STALE_QUEUED_MS,
  type EmailClaimSpec,
  type EmailEventStatus,
  type SendTransactionalResult,
} from "./emailLogic.ts";

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
