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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Only admins can extend deadlines
    const { data: profile } = await supabaseAdmin.from("profiles")
      .select("role").eq("id", caller.id).maybeSingle();

    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const { sprint_id, extend_days } = body;

    if (!sprint_id || !extend_days) {
      return new Response(JSON.stringify({ error: "Missing sprint_id or extend_days" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const days = Math.max(1, Math.min(30, Number(extend_days)));

    // Fetch current sprint
    const { data: sprint, error: sprintError } = await supabaseAdmin
      .from("learning_sprints")
      .select("id, deadline_session1, deadline_session2, deadline_session3, enrollment_id, sprint_number")
      .eq("id", sprint_id)
      .maybeSingle();

    if (sprintError || !sprint) {
      return new Response(JSON.stringify({ error: "Sprint not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const msToAdd = days * 24 * 60 * 60 * 1000;

    const newDeadline1 = sprint.deadline_session1
      ? new Date(new Date(sprint.deadline_session1).getTime() + msToAdd).toISOString()
      : null;
    const newDeadline2 = sprint.deadline_session2
      ? new Date(new Date(sprint.deadline_session2).getTime() + msToAdd).toISOString()
      : null;
    const newDeadline3 = sprint.deadline_session3
      ? new Date(new Date(sprint.deadline_session3).getTime() + msToAdd).toISOString()
      : null;

    const { error: updateError } = await supabaseAdmin
      .from("learning_sprints")
      .update({
        deadline_session1: newDeadline1,
        deadline_session2: newDeadline2,
        deadline_session3: newDeadline3,
      })
      .eq("id", sprint_id);

    if (updateError) {
      console.error("Failed to update sprint deadlines:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update deadlines" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get learner info for notification
    const { data: enrollment } = await supabaseAdmin
      .from("enrollments")
      .select("learner_id")
      .eq("id", sprint.enrollment_id)
      .maybeSingle();

    if (enrollment) {
      await supabaseAdmin.from("notifications").insert({
        user_id: enrollment.learner_id,
        title: "Deadline Extended — Sprint " + sprint.sprint_number,
        message: "Your admin has extended the deadline for Sprint " + sprint.sprint_number + " by " + days + " day(s). Your new final deadline is " + new Date(newDeadline3 || "").toLocaleDateString("en-US", { timeZone: "Asia/Ho_Chi_Minh", month: "short", day: "numeric", year: "numeric" }) + ".",
        type: "system",
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sprint_id,
      extended_by_days: days,
      new_deadlines: {
        session1: newDeadline1,
        session2: newDeadline2,
        session3: newDeadline3,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
