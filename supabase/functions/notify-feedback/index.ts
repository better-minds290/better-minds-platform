import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(
  supabaseUrl: string,
  supabaseKey: string,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  try {
    const res = await fetch(supabaseUrl + "/functions/v1/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + supabaseKey,
      },
      body: JSON.stringify({ to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
    const { sprint_id, session_number, teacher_name } = body;

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

    const teacherDisplay = teacher_name || "Your Teacher";
    const sessionLabel = session_number === 2 ? "Vietnamese Teacher" : "Foreign Teacher";

    const emailHtml = '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
      '<div style="background:#eff6ff;border-radius:12px;padding:24px;text-align:center">' +
      '<h1 style="color:#1e40af;margin:0 0 8px;font-size:22px">📝 New Feedback Received</h1>' +
      '<p style="color:#1e40af;font-size:15px;margin:0">Sprint ' + sprint.sprint_number + ' — Session ' + session_number + '</p>' +
      '</div>' +
      '<div style="padding:24px 0">' +
      '<p style="font-size:15px;color:#333;margin:0 0 8px">Hi ' + (learner.full_name || "Learner") + ',</p>' +
      '<p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 16px"><strong>' + teacherDisplay + '</strong> has submitted feedback for your <strong>' + sessionLabel + ' session</strong> in Sprint ' + sprint.sprint_number + '. Log in to your dashboard to read it!</p>' +
      '<a href="' + supabaseUrl.replace('https://', 'https://app.betterminds.edu') + '/dashboard" style="display:inline-block;background:#166534;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">View Feedback</a>' +
      '<p style="font-size:13px;color:#888;margin:16px 0 0">— The Better Minds Team</p>' +
      '</div></div>';

    await sendEmail(supabaseUrl, supabaseKey, learner.email,
      "New Feedback — Sprint " + sprint.sprint_number + ", Session " + session_number,
      emailHtml
    );

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
