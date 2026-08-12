import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getVnDayOfWeek(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCDay();
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

    const today = new Date();
    const vnDay = getVnDayOfWeek(today);

    // ── Fetch all active enrollments ──
    const { data: enrollments, error: enrollErr } = await supabaseClient
      .from("enrollments")
      .select("id, learner_id, course_id")
      .eq("status", "active");

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
      // Get the latest completed sprint
      const { data: completedSprints } = await supabaseClient
        .from("learning_sprints")
        .select("id, sprint_number, completed_at")
        .eq("enrollment_id", enrollment.id)
        .eq("status", "completed")
        .order("sprint_number", { ascending: false })
        .limit(1);

      const lastCompleted = completedSprints?.[0];

      // Check if there's a next sprint that is locked/pending
      const nextSprintNumber = lastCompleted ? lastCompleted.sprint_number + 1 : 1;

      const { data: nextSprint } = await supabaseClient
        .from("learning_sprints")
        .select("id, sprint_number, status")
        .eq("enrollment_id", enrollment.id)
        .eq("sprint_number", nextSprintNumber)
        .maybeSingle();

      if (!nextSprint) {
        // No next sprint generated yet — check if course is complete
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

        // Sprint not generated yet — this is unusual but skip
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "sprint_not_generated",
        });
        continue;
      }

      if (nextSprint.status === "active" || nextSprint.status === "completed") {
        // Already active or completed — no issue
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "already_active_or_completed",
        });
        continue;
      }

      // Sprint is locked/pending — check if it's past the unlock window
      // Sprint unlocks on Saturday. If it's Sunday or later, they're late.
      // Only skip on Saturday (vnDay=6) when they still have the day to unlock.

      if (vnDay === 6) {
        // Saturday — they still have today to unlock
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "still_saturday",
        });
        continue;
      }

      // It's Sunday or later — learner is late!

      // Get learner and course names
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

      // Check if already recorded (deduplication)
      const { data: existing } = await supabaseClient
        .from("learner_attendance")
        .select("id")
        .eq("learner_id", enrollment.learner_id)
        .eq("related_sprint_id", nextSprint.id)
        .eq("type", "sprint_unlock_late")
        .maybeSingle();

      if (existing) {
        results.push({
          learner_id: enrollment.learner_id,
          sprint_number: nextSprintNumber,
          enrollment_id: enrollment.id,
          recorded: false,
          skipped: "already_recorded",
        });
        continue;
      }

      // Record the late attendance
      const { error: insertErr } = await supabaseClient
        .from("learner_attendance")
        .insert({
          learner_id: enrollment.learner_id,
          enrollment_id: enrollment.id,
          related_sprint_id: nextSprint.id,
          sprint_number: nextSprintNumber,
          type: "sprint_unlock_late",
          date: new Date().toISOString().split("T")[0],
          learner_name: learnerName,
          course_name: courseName,
          resolved: false,
          created_at: new Date().toISOString(),
        });

      if (!insertErr) {
        // Notify learner
        await supabaseClient.from("notifications").insert({
          user_id: enrollment.learner_id,
          title: `Bạn Đã Trễ Mở Khóa Sprint ${nextSprintNumber}!`,
          message: `Sprint ${nextSprintNumber} đáng lẽ được mở khóa vào Thứ 7. Hãy vào kiểm tra và mở khóa ngay để tiếp tục học!`,
          type: "system",
          is_read: false,
          created_at: new Date().toISOString(),
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
