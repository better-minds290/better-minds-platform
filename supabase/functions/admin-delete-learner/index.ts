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
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only administrators can delete learner accounts" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const learnerId = body?.user_id as string | undefined;

    if (!learnerId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (learnerId === caller.id) {
      return new Response(
        JSON.stringify({ error: "Cannot delete your own account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role, full_name, email")
      .eq("id", learnerId)
      .maybeSingle();

    if (targetErr) {
      return new Response(
        JSON.stringify({ error: `Failed to load learner: ${targetErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "Learner not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (targetProfile.role !== "learner") {
      return new Response(
        JSON.stringify({ error: "Only learner accounts can be deleted with this action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const steps: string[] = [];

    // 1. Attendance records for this learner
    const { error: laErr } = await supabaseAdmin
      .from("learner_attendance")
      .delete()
      .eq("learner_id", learnerId);
    if (laErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete learner attendance: ${laErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("learner_attendance");

    const { error: saErr } = await supabaseAdmin
      .from("session_attendance")
      .delete()
      .eq("student_id", learnerId);
    if (saErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete session attendance: ${saErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("session_attendance");

    // 2. Class enrollments + empty class cleanup
    const { data: classEnrolls, error: ceFetchErr } = await supabaseAdmin
      .from("class_enrollments")
      .select("id, class_id")
      .eq("student_id", learnerId);

    if (ceFetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch class enrollments: ${ceFetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const affectedClassIds = [...new Set((classEnrolls || []).map((c) => c.class_id).filter(Boolean))];

    const { error: ceDelErr } = await supabaseAdmin
      .from("class_enrollments")
      .delete()
      .eq("student_id", learnerId);
    if (ceDelErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete class enrollments: ${ceDelErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("class_enrollments");

    for (const classId of affectedClassIds) {
      const { count: remaining } = await supabaseAdmin
        .from("class_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("class_id", classId);

      if ((remaining ?? 0) === 0) {
        // Unlink any sprint sessions still pointing at this empty class
        await supabaseAdmin
          .from("sprint_sessions")
          .update({
            status: "available",
            class_id: null,
            meeting_link: null,
            scheduled_at: null,
            teacher_id: null,
          })
          .eq("class_id", classId);

        await supabaseAdmin.from("class_schedules").delete().eq("class_id", classId);
        await supabaseAdmin.from("class_materials").delete().eq("class_id", classId);
        await supabaseAdmin.from("classes").delete().eq("id", classId);
      }
    }
    steps.push("empty_classes_cleanup");

    // 3. Course enrollments → sprints → sessions
    const { data: enrollments, error: enFetchErr } = await supabaseAdmin
      .from("enrollments")
      .select("id")
      .eq("learner_id", learnerId);

    if (enFetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch enrollments: ${enFetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const enrollmentIds = (enrollments || []).map((e) => e.id);

    if (enrollmentIds.length > 0) {
      const { data: sprints, error: sprintFetchErr } = await supabaseAdmin
        .from("learning_sprints")
        .select("id")
        .in("enrollment_id", enrollmentIds);

      if (sprintFetchErr) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch sprints: ${sprintFetchErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sprintIds = (sprints || []).map((s) => s.id);

      if (sprintIds.length > 0) {
        const { error: sessDelErr } = await supabaseAdmin
          .from("sprint_sessions")
          .delete()
          .in("sprint_id", sprintIds);
        if (sessDelErr) {
          return new Response(
            JSON.stringify({ error: `Failed to delete sprint sessions: ${sessDelErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        steps.push("sprint_sessions");

        const { error: sprintDelErr } = await supabaseAdmin
          .from("learning_sprints")
          .delete()
          .in("id", sprintIds);
        if (sprintDelErr) {
          return new Response(
            JSON.stringify({ error: `Failed to delete learning sprints: ${sprintDelErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        steps.push("learning_sprints");
      }

      const { error: enDelErr } = await supabaseAdmin
        .from("enrollments")
        .delete()
        .in("id", enrollmentIds);
      if (enDelErr) {
        return new Response(
          JSON.stringify({ error: `Failed to delete enrollments: ${enDelErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      steps.push("enrollments");
    }

    // 4. Notifications
    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("user_id", learnerId);
    if (notifErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete notifications: ${notifErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("notifications");

    // 5. Profile row
    const { error: profileDelErr } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", learnerId);
    if (profileDelErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete profile: ${profileDelErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("profiles");

    // 6. Auth user (requires service role)
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(learnerId);
    if (authDelErr) {
      return new Response(
        JSON.stringify({
          error: `Profile removed but failed to delete auth user: ${authDelErr.message}`,
          partial: true,
          steps,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("auth.users");

    return new Response(
      JSON.stringify({
        success: true,
        deleted: {
          id: learnerId,
          email: targetProfile.email,
          full_name: targetProfile.full_name,
        },
        steps,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[admin-delete-learner] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
