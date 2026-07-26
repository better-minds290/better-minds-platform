
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify admin role via user token
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ success: false, error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sprint_id } = await req.json();
    if (!sprint_id) {
      return new Response(JSON.stringify({ success: false, error: "sprint_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get sprint info
    const { data: sprint, error: sprintErr } = await supabase
      .from("learning_sprints")
      .select("id, sprint_number, enrollment_id, status")
      .eq("id", sprint_id)
      .maybeSingle();

    if (sprintErr || !sprint) {
      return new Response(JSON.stringify({ success: false, error: "Sprint not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (sprint.status === "completed") {
      return new Response(JSON.stringify({ success: false, error: "Sprint already completed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();

    // 1. Mark all non-absent sessions as completed (skip "absent" to preserve learner absence status)
    const { error: sessionErr } = await supabase
      .from("sprint_sessions")
      .update({
        status: "completed",
        completed_at: now,
      })
      .eq("sprint_id", sprint_id)
      .neq("status", "completed")
      .neq("status", "absent");

    if (sessionErr) {
      console.error("Session update error:", sessionErr);
      return new Response(JSON.stringify({ success: false, error: "Failed to update sessions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Mark sprint as completed
    const { error: updateSprintErr } = await supabase
      .from("learning_sprints")
      .update({ status: "completed", completed_at: now })
      .eq("id", sprint_id);

    if (updateSprintErr) {
      console.error("Sprint update error:", updateSprintErr);
      return new Response(JSON.stringify({ success: false, error: "Failed to update sprint" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Reset missed_deadlines for the enrollment
    const { error: enrollErr } = await supabase
      .from("enrollments")
      .update({ missed_deadlines: 0 })
      .eq("id", sprint.enrollment_id);

    if (enrollErr) {
      console.error("Enrollment reset error:", enrollErr);
    }

    // 4. Get enrollment info
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("learner_id, course_id")
      .eq("id", sprint.enrollment_id)
      .maybeSingle();

    // 5. Check course completion & generate next sprint
    let courseCompleted = false;
    let nextSprintGenerated = false;
    let nextSprintNumber: number | null = null;

    if (enrollment?.course_id) {
      const { data: courseData } = await supabase
        .from("courses")
        .select("total_sprints")
        .eq("id", enrollment.course_id)
        .maybeSingle();

      if (courseData) {
        const totalSprints = courseData.total_sprints || 24;

        if (sprint.sprint_number >= totalSprints) {
          // LAST SPRINT → mark enrollment as completed
          await supabase
            .from("enrollments")
            .update({ status: "completed" })
            .eq("id", sprint.enrollment_id);

          courseCompleted = true;

          if (enrollment.learner_id) {
            await supabase.from("notifications").insert({
              user_id: enrollment.learner_id,
              title: "🎉 Course Completed!",
              message: "Amazing! You've completed all " + totalSprints + " sprints of this course. You are now a course graduate — congratulations on this incredible achievement!",
              type: "system",
              is_read: false,
              created_at: now,
            });
          }
        } else {
          // NOT LAST SPRINT → directly generate the next sprint
          // (we bypass sprint-continuity because it requires ALL sessions "completed",
          //  which fails when the learner has "absent" sessions)
          nextSprintNumber = sprint.sprint_number + 1;
          try {
            const genRes = await fetch(supabaseUrl + "/functions/v1/auto-generate-sprints", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + supabaseKey,
              },
              body: JSON.stringify({
                enrollment_id: sprint.enrollment_id,
                sprint_number: nextSprintNumber,
              }),
            });

            if (genRes.ok) {
              const genData = await genRes.json();
              nextSprintGenerated = genData?.success || genData?.already_exists || false;
              console.log(`[force-complete-sprint] auto-generate-sprints: ${JSON.stringify(genData)}`);
            } else {
              console.error(`[force-complete-sprint] auto-generate-sprints failed: ${genRes.status}`);
            }
          } catch (genErr) {
            console.error(`[force-complete-sprint] auto-generate-sprints error: ${genErr}`);
          }

          // Single notification: sprint completed + next sprint info
          if (enrollment.learner_id) {
            await supabase.from("notifications").insert({
              user_id: enrollment.learner_id,
              title: `Sprint ${sprint.sprint_number} Hoàn Thành! Sprint ${nextSprintNumber} sẽ mở khóa vào Thứ 7`,
              message: `Admin đã đánh dấu Sprint ${sprint.sprint_number} của bạn là hoàn thành. Sprint ${nextSprintNumber} (trạng thái "pending") sẽ tự động mở khóa vào Thứ 7 tới — hãy kiểm tra dashboard nhé!`,
              type: "system",
              is_read: false,
              created_at: now,
              action_url: "/dashboard",
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Sprint " + sprint.sprint_number + " force-completed successfully",
      course_completed: courseCompleted,
      next_sprint_generated: nextSprintGenerated,
      next_sprint_number: nextSprintNumber,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Force complete error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
