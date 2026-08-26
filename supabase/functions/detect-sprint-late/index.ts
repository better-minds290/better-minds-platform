import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Must match learner_attendance.type CHECK (`late_sprint`, `absent_session`). */
const ATTENDANCE_TYPE_LATE_SPRINT = "late_sprint";

const WAITING_NEXT_SPRINT_STATUSES = new Set(["pending", "locked"]);
const ALREADY_UNLOCKED_STATUSES = new Set(["active", "completed", "expired"]);

function vnShift(date: Date): Date {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000);
}

function vnYmd(date: Date): string {
  return vnShift(date).toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00+07:00`);
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  return vnYmd(d);
}

/**
 * First Saturday on or after completed_at in Asia/Ho_Chi_Minh (UTC+7, no DST).
 * Sunday completion rolls to the following Saturday.
 * Keep in sync with src/lib/sprintUnlockLate.ts getExpectedSprintUnlockSaturday.
 */
function getExpectedSprintUnlockSaturday(completedAt: Date): string {
  const weekday = vnShift(completedAt).getUTCDay();
  const daysUntilSaturday = (6 - weekday + 7) % 7;
  return addDaysYmd(vnYmd(completedAt), daysUntilSaturday);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();
    const todayYmd = vnYmd(now);

    // ── Fetch operational enrollments (active; legacy paused until migrated) ──
    // Completed enrollments are intentionally excluded.
    const { data: enrollments, error: enrollErr } = await supabaseClient
      .from("enrollments")
      .select("id, learner_id, course_id")
      .in("status", ["active", "paused"]);

    if (enrollErr || !enrollments) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch enrollments", detail: enrollErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip soft-inactive learner accounts (legacy deactivate) if any remain
    const learnerIds = [...new Set(enrollments.map((e) => e.learner_id).filter(Boolean))];
    let inactiveLearnerIds = new Set<string>();
    if (learnerIds.length > 0) {
      const { data: inactiveProfiles } = await supabaseClient
        .from("profiles")
        .select("id")
        .in("id", learnerIds)
        .eq("is_active", false);
      inactiveLearnerIds = new Set((inactiveProfiles || []).map((p) => p.id));
    }

    const activeEnrollments = enrollments.filter((e) => !inactiveLearnerIds.has(e.learner_id));

    const results: Array<{ learner_id: string; sprint_number: number; enrollment_id: string; recorded: boolean; skipped: string | null }> = [];

    for (const enrollment of activeEnrollments) {
      const { data: completedSprints } = await supabaseClient
        .from("learning_sprints")
        .select("id, sprint_number, completed_at")
        .eq("enrollment_id", enrollment.id)
        .eq("status", "completed")
        .order("sprint_number", { ascending: false })
        .limit(1);

      const lastCompleted = completedSprints?.[0];

      if (!lastCompleted) {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: 0,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "no_completed_sprint",
        });
        continue;
      }

      if (!lastCompleted.completed_at) {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: lastCompleted.sprint_number,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "missing_completed_at",
        });
        continue;
      }

      const nextSprintNumber = lastCompleted.sprint_number + 1;

      const { data: nextSprint } = await supabaseClient
        .from("learning_sprints")
        .select("id, sprint_number, status")
        .eq("enrollment_id", enrollment.id)
        .eq("sprint_number", nextSprintNumber)
        .maybeSingle();

      if (!nextSprint) {
        const { data: course } = await supabaseClient
          .from("courses")
          .select("total_sprints")
          .eq("id", enrollment.course_id)
          .maybeSingle();

        const totalSprints = course?.total_sprints || 24;
        if (nextSprintNumber > totalSprints) {
          results.push({
            learner_id: enrollment.learner_id,
            sprint_number: nextSprintNumber - 1,
            enrollment_id: enrollment.id,
            recorded: false,
            skipped: "course_completed",
          });
          continue;
        }

        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "sprint_not_generated",
        });
        continue;
      }

      if (ALREADY_UNLOCKED_STATUSES.has(nextSprint.status)) {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "already_active_or_completed",
        });
        continue;
      }

      if (!WAITING_NEXT_SPRINT_STATUSES.has(nextSprint.status)) {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "not_waiting",
        });
        continue;
      }

      const expectedSaturday = getExpectedSprintUnlockSaturday(new Date(lastCompleted.completed_at));
      const expectedSunday = addDaysYmd(expectedSaturday, 1);
      const lateFromYmd = addDaysYmd(expectedSaturday, 2);

      if (todayYmd < lateFromYmd) {
        const skipped =
          todayYmd === expectedSaturday || todayYmd === expectedSunday
            ? "unlock_weekend"
            : "before_unlock_weekend";
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped,
        });
        continue;
      }

      const { data: learnerProfile } = await supabaseClient
        .from("profiles")
        .select("full_name")
        .eq("id", enrollment.learner_id)
        .maybeSingle();

      const { data: courseData } = await supabaseClient
        .from("courses")
        .select("name")
        .eq("id", enrollment.course_id)
        .maybeSingle();

      const learnerName = learnerProfile?.full_name || "Học viên";
      const courseName = courseData?.name || "Khóa học";

      // Dedup: only an existing UNRESOLVED late_sprint for this learner + sprint blocks a new row.
      const { data: existingUnresolved } = await supabaseClient
        .from("learner_attendance")
        .select("id")
        .eq("learner_id", enrollment.learner_id)
        .eq("related_sprint_id", nextSprint.id)
        .eq("type", ATTENDANCE_TYPE_LATE_SPRINT)
        .eq("resolved", false)
        .limit(1);

      if (existingUnresolved && existingUnresolved.length > 0) {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "already_recorded",
        });
        continue;
      }

      const { error: insertErr } = await supabaseClient
        .from("learner_attendance")
        .insert({
          learner_id: enrollment.learner_id,
          enrollment_id: enrollment.id,
          related_sprint_id: nextSprint.id,
          sprint_number: nextSprintNumber,
          type: ATTENDANCE_TYPE_LATE_SPRINT,
          date: todayYmd,
          learner_name: learnerName,
          course_name: courseName,
          resolved: false,
          created_at: now.toISOString(),
        });

      if (!insertErr) {
        await supabaseClient.from("notifications").insert({
          user_id: enrollment.learner_id,
          title: `Bạn Đã Trễ Mở Khóa Sprint ${nextSprintNumber}!`,
          message: `Sprint ${nextSprintNumber} đáng lẽ được mở khóa vào Thứ 7. Hãy vào kiểm tra và mở khóa ngay để tiếp tục học!`,
          type: "system",
          is_read: false,
          created_at: now.toISOString(),
          action_url: `/dashboard`,
        });

        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: true,
          skipped: null,
        });
      } else {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: `insert_error: ${insertErr.message}`,
        });
      }
    }

    const totalRecorded = results.filter((r) => r.recorded).length;
    const totalSkipped = results.filter((r) => !r.recorded).length;

    return new Response(
      JSON.stringify({
        success: true,
        total_checked: results.length,
        total_recorded: totalRecorded,
        total_skipped: totalSkipped,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("detect-sprint-late error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
