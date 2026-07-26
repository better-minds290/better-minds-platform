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

function isWeekend(date: Date): boolean {
  const vnDay = getVnDayOfWeek(date);
  return vnDay === 6 || vnDay === 0;
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

    const { action, sprint_id } = await req.json();

    if (!action || !sprint_id) {
      return new Response(
        JSON.stringify({ error: "Missing action or sprint_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: check_saturday_unlock ---
    if (action === "check_saturday_unlock") {
      const today = new Date();
      
      const { data: sprint, error: sprintErr } = await supabaseClient
        .from("learning_sprints")
        .select("id, enrollment_id, sprint_number, status")
        .eq("id", sprint_id)
        .single();

      if (sprintErr || !sprint) {
        return new Response(
          JSON.stringify({ error: "Sprint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (sprint.status === "active" || sprint.status === "completed") {
        return new Response(
          JSON.stringify({ success: true, already_active: true, sprint_status: sprint.status }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!isWeekend(today)) {
        const vnDay = getVnDayOfWeek(today);
        const daysUntilSaturday = (6 - vnDay + 7) % 7;
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + (daysUntilSaturday === 0 ? 0 : daysUntilSaturday));
        nextSaturday.setHours(0, 0, 0, 0);
        
        return new Response(
          JSON.stringify({
            success: false,
            locked: true,
            message: "Sprint sẽ được mở khóa vào Thứ 7",
            next_unlock_date: nextSaturday.toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabaseClient
        .from("learning_sprints")
        .update({ status: "active" })
        .eq("id", sprint_id)
        .in("status", ["pending", "locked"]);

      await supabaseClient
        .from("sprint_sessions")
        .update({ status: "in_progress" })
        .eq("sprint_id", sprint_id)
        .eq("session_number", 1)
        .eq("status", "locked");

      await supabaseClient
        .from("sprint_sessions")
        .update({ status: "available" })
        .eq("sprint_id", sprint_id)
        .eq("session_number", 2)
        .eq("status", "locked");

      await supabaseClient
        .from("sprint_sessions")
        .update({ status: "available" })
        .eq("sprint_id", sprint_id)
        .eq("session_number", 3)
        .eq("status", "locked");

      const { data: enrollment } = await supabaseClient
        .from("enrollments")
        .select("learner_id")
        .eq("id", sprint.enrollment_id)
        .maybeSingle();

      if (enrollment?.learner_id) {
        await supabaseClient.from("notifications").insert({
          user_id: enrollment.learner_id,
          title: `Sprint ${sprint.sprint_number} Đã Mở Khóa!`,
          message: `Sprint ${sprint.sprint_number} đã được mở khóa. Cả 3 buổi học đã sẵn sàng — hãy bắt đầu học ngay!`,
          type: "system",
          is_read: false,
          created_at: new Date().toISOString(),
          action_url: `/dashboard/sprint/${sprint_id}`,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          unlocked: true,
          sprint_status: "active",
          message: `Sprint ${sprint.sprint_number} unlocked! All 3 sessions are now available.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: unlock_now (admin bypass weekend) ---
    if (action === "unlock_now") {
      const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(authHeader);
      if (authError || !caller) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify admin role
      const { data: callerProfile } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();

      if (!callerProfile || callerProfile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin only" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: sprint, error: sprintErr } = await supabaseClient
        .from("learning_sprints")
        .select("id, enrollment_id, sprint_number, status")
        .eq("id", sprint_id)
        .single();

      if (sprintErr || !sprint) {
        return new Response(
          JSON.stringify({ error: "Sprint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (sprint.status === "active" || sprint.status === "completed") {
        return new Response(
          JSON.stringify({ success: true, already_active: true, sprint_status: sprint.status }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Unlock sprint immediately (bypass weekend check)
      await supabaseClient
        .from("learning_sprints")
        .update({ status: "active" })
        .eq("id", sprint_id)
        .in("status", ["pending", "locked"]);

      await supabaseClient
        .from("sprint_sessions")
        .update({ status: "in_progress" })
        .eq("sprint_id", sprint_id)
        .eq("session_number", 1)
        .eq("status", "locked");

      await supabaseClient
        .from("sprint_sessions")
        .update({ status: "available" })
        .eq("sprint_id", sprint_id)
        .eq("session_number", 2)
        .eq("status", "locked");

      await supabaseClient
        .from("sprint_sessions")
        .update({ status: "available" })
        .eq("sprint_id", sprint_id)
        .eq("session_number", 3)
        .eq("status", "locked");

      const { data: enrollment } = await supabaseClient
        .from("enrollments")
        .select("learner_id")
        .eq("id", sprint.enrollment_id)
        .maybeSingle();

      if (enrollment?.learner_id) {
        await supabaseClient.from("notifications").insert({
          user_id: enrollment.learner_id,
          title: `Sprint ${sprint.sprint_number} Đã Được Mở Khóa!`,
          message: `Admin đã mở khóa Sprint ${sprint.sprint_number} cho bạn. Cả 3 buổi học đã sẵn sàng — hãy bắt đầu học ngay!`,
          type: "system",
          is_read: false,
          created_at: new Date().toISOString(),
          action_url: `/dashboard/sprint/${sprint_id}`,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          unlocked: true,
          sprint_status: "active",
          message: `Sprint ${sprint.sprint_number} unlocked by admin. All 3 sessions are now available.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: check_complete ---
    if (action === "check_complete") {
      console.log(`[sprint-continuity] check_complete called for sprint_id=${sprint_id}`);

      const { data: sprint, error: sprintErr } = await supabaseClient
        .from("learning_sprints")
        .select("id, enrollment_id, sprint_number, status")
        .eq("id", sprint_id)
        .single();

      if (sprintErr || !sprint) {
        console.error(`[sprint-continuity] Sprint not found: ${sprintErr?.message}`);
        return new Response(
          JSON.stringify({ error: "Sprint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[sprint-continuity] Sprint: number=${sprint.sprint_number}, status=${sprint.status}`);

      const { data: sessions, error: sessionsErr } = await supabaseClient
        .from("sprint_sessions")
        .select("session_number, status, session_type, lesson_summary")
        .eq("sprint_id", sprint_id);

      if (sessionsErr) {
        console.error(`[sprint-continuity] Session fetch error: ${sessionsErr.message}`);
      }

      console.log(`[sprint-continuity] Sessions: count=${sessions?.length || 0}, data=${JSON.stringify(sessions?.map(s => ({ n: s.session_number, status: s.status, type: s.session_type, hasSummary: !!s.lesson_summary })))}`);

      // ONLY complete sprint when ALL sessions are truly "completed" (NOT "absent")
      const allCompleted = sessions && sessions.length === 3 && sessions.every((s: any) => {
        if (s.session_number === 1 && s.session_type === "self_study") {
          return s.status === "completed" && s.lesson_summary !== null;
        }
        return s.status === "completed";
      });

      console.log(`[sprint-continuity] allCompleted=${allCompleted}, sprint.currentStatus=${sprint.status}`);

      if (allCompleted && sprint.status !== "completed") {
        console.log(`[sprint-continuity] Marking sprint ${sprint.sprint_number} as completed...`);

        const { error: updateErr } = await supabaseClient
          .from("learning_sprints")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", sprint_id);

        if (updateErr) {
          console.error(`[sprint-continuity] Failed to update sprint: ${updateErr.message}`);
        } else {
          console.log(`[sprint-continuity] Sprint ${sprint.sprint_number} marked as completed`);
        }

        const { data: enrollment } = await supabaseClient
          .from("enrollments")
          .select("id, learner_id, course_id")
          .eq("id", sprint.enrollment_id)
          .maybeSingle();

        if (enrollment) {
          const { data: course } = await supabaseClient
            .from("courses")
            .select("total_sprints")
            .eq("id", enrollment.course_id)
            .maybeSingle();

          const totalSprints = course?.totalSprints || 24;

          if (sprint.sprint_number >= totalSprints) {
            await supabaseClient
              .from("enrollments")
              .update({ status: "completed" })
              .eq("id", sprint.enrollment_id);

            if (enrollment.learner_id) {
              await supabaseClient.from("notifications").insert({
                user_id: enrollment.learner_id,
                title: "🎉 Chúc Mừng! Bạn Đã Hoàn Thành Khóa Học!",
                message: `Tuyệt vời! Bạn đã hoàn thành tất cả ${totalSprints} Sprint. Chúc mừng thành tích xuất sắc!`,
                type: "system",
                is_read: false,
                created_at: new Date().toISOString(),
                action_url: "/dashboard/history",
              });
            }

            return new Response(
              JSON.stringify({ success: true, sprint_completed: true, course_completed: true }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          try {
            await supabaseClient.functions.invoke("auto-generate-sprints", {
              body: {
                enrollment_id: sprint.enrollment_id,
                sprint_number: sprint.sprint_number + 1,
              },
            });
            console.log(`[sprint-continuity] auto-generate-sprints called for sprint ${sprint.sprint_number + 1}`);
          } catch (genErr) {
            console.error(`[sprint-continuity] auto-generate-sprints failed: ${genErr}`);
          }

          if (enrollment.learner_id) {
            await supabaseClient.from("notifications").insert({
              user_id: enrollment.learner_id,
              title: `Sprint ${sprint.sprint_number} Hoàn Thành! Sprint ${sprint.sprint_number + 1} sẽ được mở khóa vào Thứ 7 tới`,
              message: `Bạn đã hoàn thành Sprint ${sprint.sprint_number} xuất sắc! Sprint ${sprint.sprint_number + 1} sẽ tự động mở khóa vào Thứ 7 tới. Xem tổng kết ngay!`,
              type: "system",
              is_read: false,
              created_at: new Date().toISOString(),
              action_url: `/dashboard/sprint/${sprint_id}/complete`,
            });
            console.log(`[sprint-continuity] Notification created for learner ${enrollment.learner_id}`);
          }
        }

        return new Response(
          JSON.stringify({ success: true, sprint_completed: true, course_completed: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, sprint_completed: false, allCompleted, sessions_status: sessions }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use 'check_saturday_unlock', 'check_complete', or 'unlock_now'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
