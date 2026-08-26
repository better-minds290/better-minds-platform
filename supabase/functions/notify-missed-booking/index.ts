/**
 * notify-missed-booking
 *
 * Dedicated scanner: after Sunday booking closes, email learners whose
 * Admin Learners S2 and/or S3 is operationally Late.
 *
 * Service-role / scheduled invocation only. Safe to rerun (idempotent).
 * Does not create a scheduler — invoke later via cron.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isSendEmailAuthExemptMethod,
  resolveReplyTo,
  runMissedBookingEmailScan,
} from "../_shared/email.ts";
import {
  currentSprintIdsForEnrollments,
  guardMissedBookingRequest,
  parseMissedBookingRequestBody,
  type MissedBookingCourse,
  type MissedBookingEnrollment,
  type MissedBookingProfile,
  type MissedBookingScanInput,
} from "../_shared/missedBookingEmail.ts";
import type {
  ClassEnrollmentRef,
  ClassScheduleInfo,
  LiveSessionRow,
  SprintRow,
} from "../_shared/adminLearnerBooking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IN_CHUNK = 150;
const PAGE = 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SupabaseAdmin = ReturnType<typeof createClient>;

async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function fetchInChunks<T>(
  ids: string[],
  query: (chunk: string[]) => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  }
): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const pageRows = await fetchAllPages<T>((from, to) => query(chunk).range(from, to));
    rows.push(...pageRows);
  }
  return rows;
}

/**
 * Batched load matching Admin Learners (profiles → enrollments → current sprints →
 * sessions → schedules → class_enrollments). No per-learner queries.
 */
async function loadMissedBookingScanData(supabase: SupabaseAdmin, now: Date): Promise<MissedBookingScanInput> {
  const profiles = await fetchAllPages<MissedBookingProfile>((from, to) =>
    supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active")
      .eq("role", "learner")
      .range(from, to)
  );

  const enrollments = await fetchAllPages<MissedBookingEnrollment>((from, to) =>
    supabase
      .from("enrollments")
      .select("id, learner_id, course_id, status")
      .in("status", ["active", "paused"])
      .range(from, to)
  );

  const courseIds = [...new Set(enrollments.map((e) => e.course_id).filter((id): id is string => !!id))];
  const courses = await fetchInChunks<MissedBookingCourse>(courseIds, (chunk) =>
    supabase.from("courses").select("id, name").in("id", chunk)
  );

  const enrollmentIds = [...new Set(enrollments.map((e) => e.id))];
  const sprints = await fetchInChunks<SprintRow>(enrollmentIds, (chunk) =>
    supabase.from("learning_sprints").select("id, enrollment_id, sprint_number, status").in("enrollment_id", chunk)
  );

  const sprintIds = currentSprintIdsForEnrollments(enrollments, sprints);
  const sessions = await fetchInChunks<LiveSessionRow>(sprintIds, (chunk) =>
    supabase
      .from("sprint_sessions")
      .select("id, sprint_id, session_number, session_type, status, teacher_id, scheduled_at, class_id, meeting_link")
      .in("sprint_id", chunk)
  );

  const classIds = [...new Set(sessions.map((s) => s.class_id).filter((id): id is string => !!id))];
  const [schedules, classEnrollments] = await Promise.all([
    fetchInChunks<ClassScheduleInfo>(classIds, (chunk) =>
      supabase.from("class_schedules").select("class_id, date, start_time, end_time, status, teacher_id").in("class_id", chunk)
    ),
    fetchInChunks<ClassEnrollmentRef>(classIds, (chunk) =>
      supabase.from("class_enrollments").select("class_id, student_id").in("class_id", chunk)
    ),
  ]);

  return {
    now,
    profiles,
    enrollments,
    sprints,
    sessions,
    schedules,
    classEnrollments,
    courses,
  };
}

serve(async (req: Request) => {
  if (isSendEmailAuthExemptMethod(req.method)) {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const auth = guardMissedBookingRequest({
      method: req.method,
      authorizationHeader: req.headers.get("Authorization"),
      serviceRoleKey,
    });
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    let body: unknown = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { dryRun } = parseMissedBookingRequestBody(body);

    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!dryRun && !resendApiKey) {
      return json({ error: "RESEND_API_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase service configuration missing" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const input = await loadMissedBookingScanData(supabase, new Date());
    const result = await runMissedBookingEmailScan({
      supabase,
      resendApiKey: resendApiKey || "dry-run",
      input,
      dryRun,
      replyTo: resolveReplyTo({ envValue: Deno.env.get("EMAIL_REPLY_TO") }),
    });

    return json({
      dry_run: result.dryRun,
      window_passed: result.windowPassed,
      sunday_ymd: result.sundayYmd,
      total_scanned: result.totalScanned,
      total_late_learners: result.totalLateLearners,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      learners: result.learners,
    });
  } catch (err) {
    console.error("notify-missed-booking error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
