-- Transactional email delivery log and idempotency store.
-- DO NOT apply automatically - review before running in Supabase.
--
-- Used by Edge Functions with the service role only.
-- In-app notifications remain in public.notifications.
-- profiles.id is UUID (= auth.users.id). SET NULL keeps the log if the account is deleted.

CREATE TABLE IF NOT EXISTS public.email_events
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  template TEXT NOT NULL,
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_id TEXT NULL,
  error TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_events_status_check CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  CONSTRAINT email_events_idempotency_key_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS email_events_status_created_at_idx ON public.email_events (status, created_at);

CREATE INDEX IF NOT EXISTS email_events_user_id_idx ON public.email_events (user_id);

COMMENT ON TABLE public.email_events IS
  'Transactional email idempotency and delivery history. Unique idempotency_key prevents duplicate sends; failed rows may be retried.';

COMMENT ON COLUMN public.email_events.idempotency_key IS
  'Stable dedup key, e.g. missed-booking:{enrollment_id}:{sprint_id}:{sunday_ymd}. Unique. Failed rows are retried in place - do not mint a new key.';

COMMENT ON COLUMN public.email_events.status IS
  'queued = claimed/in-flight; sent = delivered; failed = retryable; skipped = intentionally not sent.';

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: PostgREST cannot read or write rows.
-- service_role (Edge Functions) bypasses RLS.
REVOKE ALL ON TABLE public.email_events FROM anon, authenticated;
GRANT ALL ON TABLE public.email_events TO service_role;
