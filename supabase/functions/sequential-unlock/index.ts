import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { session_id } = body;

    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch the completed session
    const { data: completedSession, error: sessionError } = await supabaseAdmin
      .from("sprint_sessions")
      .select("id, sprint_id, session_number, session_type, status, teacher_id, scheduled_at")
      .eq("id", session_id)
      .maybeSingle();

    if (sessionError || !completedSession) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (completedSession.status !== "completed") {
      return new Response(JSON.stringify({
        error: "Session is not completed yet",
        current_status: completedSession.status,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sprintId = completedSession.sprint_id;

    const { data: sprint } = await supabaseAdmin
      .from("learning_sprints")
      .select("id, sprint_number, enrollment_id, status")
      .eq("id", sprintId)
      .maybeSingle();

    if (!sprint) {
      return new Response(JSON.stringify({ error: "Sprint not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: enrollment } = await supabaseAdmin
      .from("enrollments")
      .select("learner_id, course_id")
      .eq("id", sprint.enrollment_id)
      .maybeSingle();

    let learnerName = "Học viên";
    if (enrollment?.learner_id) {
      const { data: learnerProfile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", enrollment.learner_id)
        .maybeSingle();
      learnerName = learnerProfile?.full_name || "Học viên";
    }

    const result: {
      sprint_completed: boolean;
      course_completed: boolean;
    } = {
      sprint_completed: false,
      course_completed: false,
    };

    // 2. Check if ALL sessions are truly completed (NOT absent) → mark sprint completed
    // Absent sessions mean the learner didn't attend — sprint stays active
    const { data: allSessions } = await supabaseAdmin
      .from("sprint_sessions")
      .select("status")
      .eq("sprint_id", sprintId);

    if (allSessions && allSessions.length === 3 && allSessions.every((s: { status: string }) => s.status === "completed")) {
      const { error: completeError } = await supabaseAdmin
        .from("learning_sprints")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", sprintId);

      if (!completeError) {
        result.sprint_completed = true;

        if (enrollment?.learner_id) {
          await supabaseAdmin.from("notifications").insert({
            user_id: enrollment.learner_id,
            title: `Sprint ${sprint.sprint_number} Hoàn Thành!`,
            message: `Chúc mừng ${learnerName}! Bạn đã hoàn thành cả 3 buổi của Sprint ${sprint.sprint_number}. Sprint ${sprint.sprint_number + 1} sẽ được mở khóa vào Thứ 7 tới.`,
            type: "system",
            is_read: false,
            created_at: new Date().toISOString(),
          });
        }

        // Check if this was the last sprint → course complete
        if (enrollment?.course_id) {
          const { data: courseData } = await supabaseAdmin
            .from("courses")
            .select("total_sprints")
            .eq("id", enrollment.course_id)
            .maybeSingle();

          const totalSprints = courseData?.total_sprints || 24;

          if (sprint.sprint_number >= totalSprints) {
            await supabaseAdmin
              .from("enrollments")
              .update({ status: "completed" })
              .eq("id", sprint.enrollment_id);

            result.course_completed = true;

            if (enrollment?.learner_id) {
              await supabaseAdmin.from("notifications").insert({
                user_id: enrollment.learner_id,
                title: "🎉 Chúc Mừng! Bạn Đã Hoàn Thành Khóa Học!",
                message: `Tuyệt vời ${learnerName}! Bạn đã hoàn thành tất cả ${totalSprints} Sprint. Chúc mừng thành tích xuất sắc!`,
                type: "system",
                is_read: false,
                created_at: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...result,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Sequential unlock error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
