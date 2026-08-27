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

    const body = await req.json();
    const { sprint_id, session_number } = body;

    if (!sprint_id || !session_number) {
      return new Response(JSON.stringify({ error: "Missing sprint_id or session_number" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get sprint + enrollment + learner info
    const { data: sprint } = await supabaseAdmin
      .from("learning_sprints")
      .select("id, sprint_number, enrollment_id")
      .eq("id", sprint_id)
      .maybeSingle();

    if (!sprint) {
      return new Response(JSON.stringify({ error: "Sprint not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: enrollment } = await supabaseAdmin
      .from("enrollments")
      .select("learner_id")
      .eq("id", sprint.enrollment_id)
      .maybeSingle();

    if (!enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: learner } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", enrollment.learner_id)
      .maybeSingle();

    if (!learner || !learner.email) {
      return new Response(JSON.stringify({ success: false, reason: "No learner email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Transactional email for teacher feedback is intentionally not sent.
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
