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

    // Only admins can reset learners
    const { data: profile } = await supabaseAdmin.from("profiles")
      .select("role").eq("id", caller.id).maybeSingle();

    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const { enrollment_id } = body;

    if (!enrollment_id) {
      return new Response(JSON.stringify({ error: "Missing enrollment_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Fetch enrollment
    const { data: enrollment, error: enrollError } = await supabaseAdmin
      .from("enrollments")
      .select("id, learner_id, status, missed_deadlines")
      .eq("id", enrollment_id)
      .maybeSingle();

    if (enrollError || !enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const wasPaused = enrollment.status === "paused";

    // Reset: status → active, missed_deadlines → 0
    const { error: updateError } = await supabaseAdmin
      .from("enrollments")
      .update({
        status: "active",
        missed_deadlines: 0,
      })
      .eq("id", enrollment_id);

    if (updateError) {
      console.error("Failed to reset enrollment:", updateError);
      return new Response(JSON.stringify({ error: "Failed to reset enrollment" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // If paused → find current active sprint and reactivate it (if expired, mark as active again)
    if (wasPaused) {
      const { data: expiredSprints } = await supabaseAdmin
        .from("learning_sprints")
        .select("id")
        .eq("enrollment_id", enrollment_id)
        .eq("status", "expired");

      if (expiredSprints && expiredSprints.length > 0) {
        // Reactivate the most recently expired sprint
        await supabaseAdmin
          .from("learning_sprints")
          .update({ status: "active" })
          .eq("id", expiredSprints[expiredSprints.length - 1].id);
      }
    }

    // Notify learner
    const message = wasPaused
      ? "Your enrollment has been reactivated by the admin. Your missed deadline counter has been reset to 0. You can continue your learning journey — stay on track!"
      : "Your missed deadline counter has been reset to 0 by the admin. Keep up the great work and complete your sprints on time!";

    await supabaseAdmin.from("notifications").insert({
      user_id: enrollment.learner_id,
      title: "Enrollment Reset",
      message,
      type: "system",
      is_read: false,
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      enrollment_id,
      previous_status: enrollment.status,
      previous_missed: enrollment.missed_deadlines,
      new_status: "active",
      new_missed: 0,
      was_paused: wasPaused,
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
