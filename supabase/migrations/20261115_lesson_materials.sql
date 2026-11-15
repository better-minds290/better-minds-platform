-- Teacher additional materials for one class schedule.
-- DO NOT apply automatically - review before running in Supabase.
-- Do not run this against production until the verification queries in the
-- header have been reviewed. The preflight block below repeats those checks
-- and aborts before creating objects when a required column is missing.
--
-- Adds only:
--   public.lesson_materials
--   lesson_auth helper functions
--   RLS policies on public.lesson_materials
--   private storage bucket lesson-materials
--   storage policies whose names start with lesson_materials_
--
-- Does not alter existing tables, existing RLS policies, class_materials,
-- course_sprint_templates, or the sprint-materials bucket.
-- Existing booking and cancellation functions are unchanged. Schedule deletes
-- already performed by those functions may cascade lesson_materials rows.
-- Storage objects are not deleted by that cascade. Download, list, and
-- signed URLs still require a lesson_materials row. storage.remove() also
-- requires SELECT. That SELECT is granted only while the Storage API
-- operation is object delete, and only to the uploading teacher or an
-- admin, so a failed metadata insert can be removed without making the
-- orphan readable.
--
-- Run this script as one transaction. A failure then leaves no partial objects.
--
-- Authorization model (caller is always auth.uid()):
--   upload:  class_schedules.teacher_id = auth.uid(), teacher role, active account
--   read:    that teacher, a class_enrollments learner for the schedule's class, or admin
--   delete:  the teacher who created the row, or admin
--   other roles and anon: no policy, no grant
--
-- Store storage_path only. Do not store signed URLs. Clients must call
-- createSignedUrl with the signed-in user session (never the service role)
-- and must upload with upsert = false. There is no UPDATE policy on the
-- table or on storage.objects for this bucket.
--
-- Object key, lowercase UUIDs:
--   {schedule_id}/{created_by}/{object_uuid}/{file_name}
--
-- Read-only verification (run before this script):
--
--   SELECT c.table_name, c.column_name, c.data_type, c.udt_name
--   FROM information_schema.columns AS c
--   WHERE c.table_schema = 'public'
--     AND (
--       (c.table_name = 'class_schedules' AND c.column_name IN ('id', 'class_id', 'teacher_id'))
--       OR (c.table_name = 'class_enrollments' AND c.column_name IN ('class_id', 'student_id'))
--       OR (c.table_name = 'profiles' AND c.column_name IN ('id', 'role', 'is_active'))
--     )
--   ORDER BY c.table_name, c.column_name;
--
--   SELECT nsp.nspname, rel.relname, con.conname, con.contype, a.attname
--   FROM pg_constraint AS con
--   JOIN pg_class AS rel ON rel.oid = con.conrelid
--   JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
--   JOIN pg_attribute AS a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
--   WHERE nsp.nspname = 'public'
--     AND rel.relname IN ('class_schedules', 'profiles')
--     AND con.contype IN ('p', 'u')
--     AND a.attname = 'id';
--
--   SELECT r.rolname, r.rolsuper, r.rolbypassrls
--   FROM pg_roles AS r
--   WHERE r.rolname = current_user;
--
--   SELECT b.id, b."public"
--   FROM storage.buckets AS b
--   WHERE b.id = 'lesson-materials';
--
--   SELECT pol.polname, pol.polcmd, pol.polroles::text,
--          pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
--          pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
--   FROM pg_policy AS pol
--   JOIN pg_class AS rel ON rel.oid = pol.polrelid
--   JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
--   WHERE nsp.nspname = 'storage'
--     AND rel.relname = 'objects'
--   ORDER BY pol.polname;
--
-- Confirm every policy for anon, authenticated, or PUBLIC is limited to a
-- specific bucket_id. A permissive policy with USING (true), or no expression,
-- would expose lesson-materials because permissive policies are OR-ed.
--
-- Deployment blockers (the preflight raises these and creates nothing):
--   class_schedules.id / class_id / teacher_id are not uuid, or id is not unique
--   class_enrollments.class_id / student_id are not uuid
--   profiles.id is not a uuid unique key, role is missing, or is_active is not boolean
--   storage.buckets or storage.objects is missing
--   bucket lesson-materials already exists and is public
--   the migration role does not bypass RLS (helpers would then be wrong)
--   storage.objects has an unrestricted policy for anon, authenticated, or PUBLIC
--
-- Not verified, and intentionally not assumed:
--   ON DELETE behavior of existing class, schedule, enrollment, and profile FKs
--   existing RLS on profiles, class_schedules, and class_enrollments
--   whether classes.teacher_id always equals class_schedules.teacher_id
--   a complete class_schedules.status value list
--   storage.buckets.file_size_limit / allowed_mime_types on this project
--   that this project's Storage API sets storage.operation to
--   storage.object.delete or storage.object.delete_many for remove()
--   (hosted Storage has done this since operation-scoped RLS; confirm
--   before relying on orphan remove())
--
-- Orphan cleanup later (review the SELECT, then delete only those names):
--
--   SELECT o.id, o.name, o.created_at
--   FROM storage.objects AS o
--   WHERE o.bucket_id = 'lesson-materials'
--     AND lesson_auth.lesson_materials_path_is_safe(o.name)
--     AND NOT EXISTS (
--       SELECT 1
--       FROM public.lesson_materials AS lm
--       WHERE lm.storage_path = o.name
--     )
--   ORDER BY o.created_at;
--
-- That result cannot include sprint-materials or any other bucket.
-- Objects whose names fail the path check are omitted so a later delete
-- of this result set cannot remove an unexpected key. Remove those
-- non-conforming objects manually after a separate review.
-- Run this SELECT as a role that bypasses RLS. Then call Storage remove()
-- on those exact names. remove() is scoped to this bucket and to safe
-- paths: the uploading teacher, while they still teach that schedule, or
-- an admin. It does not grant list, download, or signed-URL access to
-- orphans, and it does not grant access to any other bucket.

-- ---------------------------------------------------------------------------
-- Preflight. Read-only. Raises before any new object is created.
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_migration_role text := current_user;
  v_bypass boolean;
BEGIN
  SELECT r.rolsuper OR r.rolbypassrls
    INTO v_bypass
  FROM pg_roles AS r
  WHERE r.rolname = v_migration_role;

  IF v_bypass IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'BLOCKER: migration role "%" must own the helper functions and bypass RLS. Found superuser/bypassrls = %.',
      v_migration_role, COALESCE(v_bypass, false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'class_schedules'
      AND con.contype IN ('p', 'u')
      AND array_length(con.conkey, 1) = 1
      AND a.attname = 'id'
  ) THEN
    RAISE EXCEPTION
      'BLOCKER: public.class_schedules.id must be a single-column primary or unique key before lesson_materials can reference it.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'class_schedules'
      AND c.column_name = 'id'
      AND c.data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.class_schedules.id must be uuid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'class_schedules'
      AND c.column_name = 'class_id'
      AND c.data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.class_schedules.class_id must be uuid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'class_schedules'
      AND c.column_name = 'teacher_id'
      AND c.data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.class_schedules.teacher_id must be uuid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'class_enrollments'
      AND c.column_name = 'class_id'
      AND c.data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.class_enrollments.class_id must be uuid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'class_enrollments'
      AND c.column_name = 'student_id'
      AND c.data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.class_enrollments.student_id must be uuid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'profiles'
      AND con.contype IN ('p', 'u')
      AND array_length(con.conkey, 1) = 1
      AND a.attname = 'id'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.profiles.id must be a single-column primary or unique key.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'id'
      AND c.data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.profiles.id must be uuid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'role'
      AND c.data_type IN ('text', 'character varying', 'USER-DEFINED')
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.profiles.role must exist as text, varchar, or an enum.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'is_active'
      AND c.data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION 'BLOCKER: public.profiles.is_active must exist as boolean.';
  END IF;

  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'BLOCKER: storage.buckets and storage.objects must exist.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'BLOCKER: roles anon, authenticated, and service_role must exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.buckets AS b
    WHERE b.id = 'lesson-materials'
      AND b."public" IS TRUE
  ) THEN
    RAISE EXCEPTION
      'BLOCKER: storage bucket lesson-materials already exists and is public. This script will not change it.';
  END IF;

  -- Permissive storage policies are OR-ed. An unrestricted policy for
  -- anon, authenticated, or PUBLIC would expose this bucket.
  IF EXISTS (
    SELECT 1
    FROM pg_policy AS pol
    JOIN pg_class AS rel ON rel.oid = pol.polrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'storage'
      AND rel.relname = 'objects'
      AND (
        cardinality(pol.polroles) = 0
        OR 0::oid = ANY (pol.polroles)
        OR EXISTS (
          SELECT 1
          FROM pg_roles AS role_row
          WHERE role_row.oid = ANY (pol.polroles)
            AND role_row.rolname IN ('anon', 'authenticated')
        )
      )
      AND (
        (pol.polcmd IN ('r', 'w', 'd', '*') AND pol.polqual IS NULL)
        OR (pol.polcmd IN ('a', '*') AND pol.polwithcheck IS NULL)
        OR pg_get_expr(pol.polqual, pol.polrelid) = 'true'
        OR pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true'
      )
  ) THEN
    RAISE EXCEPTION
      'BLOCKER: storage.objects has an unrestricted policy for anon, authenticated, or PUBLIC. List storage policies and remove that grant before creating a private bucket.';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Helpers. Not in the Data API: lesson_auth is a new schema.
-- Keep lesson_auth out of the exposed API schemas.
-- SECURITY DEFINER so the boolean check does not depend on unknown RLS
-- on profiles, class_schedules, or class_enrollments.
-- search_path is locked to public. Every reference is schema-qualified.
-- Each helper returns only the caller's own authorization.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS lesson_auth;

REVOKE ALL ON SCHEMA lesson_auth FROM PUBLIC;
GRANT USAGE ON SCHEMA lesson_auth TO authenticated, service_role;

CREATE OR REPLACE FUNCTION lesson_auth.lesson_materials_path_is_safe(p_object_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_object_name IS NOT NULL
    AND char_length(p_object_name) <= 700
    AND p_object_name !~ '\.\.'
    AND p_object_name !~ '[[:cntrl:]\\]'
    AND p_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]{1,200}$';
$$;

CREATE OR REPLACE FUNCTION lesson_auth.lesson_materials_schedule_id_from_path(p_object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lesson_auth.lesson_materials_path_is_safe(p_object_name)
    THEN split_part(p_object_name, '/', 1)::uuid
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION lesson_auth.lesson_materials_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS admin_profile
      WHERE admin_profile.id = auth.uid()
        AND admin_profile.role::text = 'admin'
        AND admin_profile.is_active IS DISTINCT FROM false
    );
$$;

CREATE OR REPLACE FUNCTION lesson_auth.lesson_materials_is_schedule_teacher(p_schedule_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_schedule_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.class_schedules AS cs
      JOIN public.profiles AS teacher_profile
        ON teacher_profile.id = auth.uid()
      WHERE cs.id = p_schedule_id
        AND cs.teacher_id = auth.uid()
        AND teacher_profile.role::text IN ('vietnamese_teacher', 'foreign_teacher')
        AND teacher_profile.is_active IS DISTINCT FROM false
    );
$$;

CREATE OR REPLACE FUNCTION lesson_auth.lesson_materials_is_enrolled_in_schedule(p_schedule_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_schedule_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.class_schedules AS cs
      JOIN public.class_enrollments AS ce
        ON ce.class_id = cs.class_id
      JOIN public.profiles AS learner_profile
        ON learner_profile.id = auth.uid()
      WHERE cs.id = p_schedule_id
        AND ce.student_id = auth.uid()
        AND learner_profile.role::text = 'learner'
        AND learner_profile.is_active IS DISTINCT FROM false
    );
$$;

REVOKE ALL ON FUNCTION lesson_auth.lesson_materials_path_is_safe(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lesson_auth.lesson_materials_schedule_id_from_path(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lesson_auth.lesson_materials_is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lesson_auth.lesson_materials_is_schedule_teacher(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION lesson_auth.lesson_materials_is_enrolled_in_schedule(uuid) FROM PUBLIC, anon;

-- authenticated: required so RLS and storage policies can evaluate the helpers.
-- service_role: required so existing service-role profile deletes can SET NULL
-- created_by and re-check the file-path constraint. service_role already
-- bypasses RLS; do not use it to mint signed URLs.
GRANT EXECUTE ON FUNCTION lesson_auth.lesson_materials_path_is_safe(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lesson_auth.lesson_materials_schedule_id_from_path(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lesson_auth.lesson_materials_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lesson_auth.lesson_materials_is_schedule_teacher(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lesson_auth.lesson_materials_is_enrolled_in_schedule(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION lesson_auth.lesson_materials_is_admin() IS
  'True when auth.uid() is an active admin. Returns no row data.';

COMMENT ON FUNCTION lesson_auth.lesson_materials_is_schedule_teacher(uuid) IS
  'True when auth.uid() is the active teacher on class_schedules.teacher_id for this schedule.';

COMMENT ON FUNCTION lesson_auth.lesson_materials_is_enrolled_in_schedule(uuid) IS
  'True when auth.uid() is an active learner with class_enrollments for the schedule''s class.';

-- ---------------------------------------------------------------------------
-- Table. Metadata only. File bytes live in the private bucket.
-- schedule delete cascades rows so current service-role schedule deletes
-- keep succeeding. Profile delete nulls created_by so teacher-account
-- deletion is not blocked when a schedule row still exists.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lesson_materials
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.class_schedules(id) ON DELETE CASCADE,
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NULL,
  storage_path TEXT NULL,
  file_name TEXT NULL,
  mime_type TEXT NULL,
  byte_size BIGINT NULL,
  link_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_materials_kind_check CHECK (kind IN ('file', 'link')),
  CONSTRAINT lesson_materials_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT lesson_materials_notes_check CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT lesson_materials_byte_size_check CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT lesson_materials_link_check CHECK (
    link_url IS NULL
    OR (
      char_length(link_url) <= 2000
      AND link_url ~ '^https://[^[:space:]]+$'
    )
  ),
  CONSTRAINT lesson_materials_payload_check CHECK (
    (
      kind = 'file'
      AND storage_path IS NOT NULL
      AND link_url IS NULL
      AND file_name IS NOT NULL
      AND char_length(file_name) BETWEEN 1 AND 200
      AND file_name !~ '[/\\]'
      AND position(file_name in storage_path) > 0
      AND lesson_auth.lesson_materials_path_is_safe(storage_path)
      AND split_part(storage_path, '/', 1) = schedule_id::text
      AND (
        created_by IS NULL
        OR split_part(storage_path, '/', 2) = created_by::text
      )
      AND split_part(storage_path, '/', 4) = file_name
    )
    OR
    (
      kind = 'link'
      AND link_url IS NOT NULL
      AND storage_path IS NULL
      AND file_name IS NULL
      AND mime_type IS NULL
      AND byte_size IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS lesson_materials_schedule_id_idx
  ON public.lesson_materials (schedule_id);

CREATE INDEX IF NOT EXISTS lesson_materials_created_by_idx
  ON public.lesson_materials (created_by);

CREATE UNIQUE INDEX IF NOT EXISTS lesson_materials_storage_path_key
  ON public.lesson_materials (storage_path)
  WHERE storage_path IS NOT NULL;

COMMENT ON TABLE public.lesson_materials IS
  'Teacher files and links for one class_schedules row. storage_path is a private object key, never a signed URL. Sprint content and class_materials are separate.';

COMMENT ON COLUMN public.lesson_materials.schedule_id IS
  'Lesson the material belongs to. ON DELETE CASCADE removes this row when that schedule is deleted.';

COMMENT ON COLUMN public.lesson_materials.created_by IS
  'Teacher who uploaded the row. ON DELETE SET NULL so deleting a profile does not block existing account-deletion flows.';

COMMENT ON COLUMN public.lesson_materials.storage_path IS
  'Private bucket key: {schedule_id}/{created_by}/{object_uuid}/{file_name}. Null for links.';

-- ---------------------------------------------------------------------------
-- RLS. authenticated may select, insert, and delete. No update grant.
-- anon and PUBLIC have no grant and no policy.
-- ---------------------------------------------------------------------------

ALTER TABLE public.lesson_materials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lesson_materials FROM PUBLIC;
REVOKE ALL ON TABLE public.lesson_materials FROM anon;
REVOKE ALL ON TABLE public.lesson_materials FROM authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.lesson_materials TO authenticated;

DROP POLICY IF EXISTS lesson_materials_select ON public.lesson_materials;
CREATE POLICY lesson_materials_select
  ON public.lesson_materials
  FOR SELECT
  TO authenticated
  USING (
    lesson_auth.lesson_materials_is_admin()
    OR lesson_auth.lesson_materials_is_schedule_teacher(schedule_id)
    OR lesson_auth.lesson_materials_is_enrolled_in_schedule(schedule_id)
  );

DROP POLICY IF EXISTS lesson_materials_teacher_insert ON public.lesson_materials;
CREATE POLICY lesson_materials_teacher_insert
  ON public.lesson_materials
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lesson_auth.lesson_materials_is_schedule_teacher(schedule_id)
    AND created_by = auth.uid()
    AND (
      (
        kind = 'link'
        AND storage_path IS NULL
      )
      OR (
        kind = 'file'
        AND lesson_auth.lesson_materials_path_is_safe(storage_path)
        AND split_part(storage_path, '/', 1) = schedule_id::text
        AND split_part(storage_path, '/', 2) = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS lesson_materials_owner_delete ON public.lesson_materials;
CREATE POLICY lesson_materials_owner_delete
  ON public.lesson_materials
  FOR DELETE
  TO authenticated
  USING (
    lesson_auth.lesson_materials_is_admin()
    OR (
      lesson_auth.lesson_materials_is_schedule_teacher(schedule_id)
      AND created_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Private bucket. Insert only when absent.
-- A private bucket that already exists is left unchanged.
-- A public bucket with this id aborts in preflight.
-- file_size_limit is set only on the insert, and only when that column exists.
-- ---------------------------------------------------------------------------

DO $bucket$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets AS b
    WHERE b.id = 'lesson-materials'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'storage'
      AND c.table_name = 'buckets'
      AND c.column_name = 'file_size_limit'
  ) THEN
    EXECUTE
      'INSERT INTO storage.buckets (id, name, "public", file_size_limit) VALUES ($1, $2, false, $3)'
      USING 'lesson-materials', 'lesson-materials', 10485760;
  ELSE
    INSERT INTO storage.buckets (id, name, "public")
    VALUES ('lesson-materials', 'lesson-materials', false);
  END IF;
END
$bucket$;

-- Storage policies are additive and filtered to bucket_id = lesson-materials.
-- DROP/CREATE uses only the names below. No UPDATE policy: overwrite is denied.
-- Download and list require a lesson_materials row. storage.remove() also
-- checks SELECT, so a delete operation may see a safe orphan path. That
-- extra SELECT does not apply to get, list, or sign.
-- DELETE requires the safe path shape, so this cannot target another bucket
-- or an unexpected object name.

DROP POLICY IF EXISTS lesson_materials_storage_insert ON storage.objects;
CREATE POLICY lesson_materials_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-materials'
    AND lesson_auth.lesson_materials_path_is_safe(name)
    AND split_part(name, '/', 2) = auth.uid()::text
    AND lesson_auth.lesson_materials_is_schedule_teacher(
      lesson_auth.lesson_materials_schedule_id_from_path(name)
    )
  );

DROP POLICY IF EXISTS lesson_materials_storage_select ON storage.objects;
CREATE POLICY lesson_materials_storage_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lesson-materials'
    AND lesson_auth.lesson_materials_path_is_safe(name)
    AND (
      EXISTS (
        SELECT 1
        FROM public.lesson_materials AS lm
        WHERE lm.storage_path = name
          AND split_part(lm.storage_path, '/', 1) = lm.schedule_id::text
          AND (
            lesson_auth.lesson_materials_is_admin()
            OR lesson_auth.lesson_materials_is_schedule_teacher(lm.schedule_id)
            OR lesson_auth.lesson_materials_is_enrolled_in_schedule(lm.schedule_id)
          )
      )
      OR (
        -- storage.remove() requires SELECT as well as DELETE. The Storage
        -- API sets storage.operation for that request. Limit this branch
        -- to delete so an orphan cannot be listed, downloaded, or signed.
        COALESCE(current_setting('storage.operation', true), '') IN (
          'storage.object.delete',
          'object.delete',
          'storage.object.delete_many',
          'object.delete_many'
        )
        AND (
          lesson_auth.lesson_materials_is_admin()
          OR (
            split_part(name, '/', 2) = auth.uid()::text
            AND lesson_auth.lesson_materials_is_schedule_teacher(
              lesson_auth.lesson_materials_schedule_id_from_path(name)
            )
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS lesson_materials_storage_delete ON storage.objects;
CREATE POLICY lesson_materials_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'lesson-materials'
    AND lesson_auth.lesson_materials_path_is_safe(name)
    AND (
      lesson_auth.lesson_materials_is_admin()
      OR (
        split_part(name, '/', 2) = auth.uid()::text
        AND lesson_auth.lesson_materials_is_schedule_teacher(
          lesson_auth.lesson_materials_schedule_id_from_path(name)
        )
      )
    )
  );
