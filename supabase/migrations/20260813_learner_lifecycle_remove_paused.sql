-- Learner lifecycle: enforce enrollments.status = active | completed only
-- DO NOT apply automatically — review before running in Supabase.
--
-- Allowed values on enrollments.status:
--   active    = enrolled and in program
--   completed = finished program (history retained)
--
-- pending is NOT stored on enrollments — it is UI-derived when a learner
-- has no enrollment row.
--
-- profiles.is_active is unchanged (account soft-deactivate, not lifecycle).

-- 1) Defensive remap: legacy paused → active
--    Safe even when the table is empty; useful for other environments.
UPDATE public.enrollments
SET status = 'active'
WHERE status = 'paused';

-- 2) Enforce allowed lifecycle values (text column + CHECK)
ALTER TABLE public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_status_check;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('active', 'completed'));
