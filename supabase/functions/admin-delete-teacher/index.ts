import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEACHER_ROLES = new Set(["vietnamese_teacher", "foreign_teacher"]);

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
        JSON.stringify({ error: "Only administrators can delete teacher accounts" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const teacherId = body?.user_id as string | undefined;

    if (!teacherId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (teacherId === caller.id) {
      return new Response(
        JSON.stringify({ error: "Cannot delete your own account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role, full_name, email")
      .eq("id", teacherId)
      .maybeSingle();

    if (targetErr) {
      return new Response(
        JSON.stringify({ error: `Failed to load teacher: ${targetErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "Teacher not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!TEACHER_ROLES.has(targetProfile.role)) {
      return new Response(
        JSON.stringify({ error: "Only teacher accounts can be deleted with this action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const steps: string[] = [];

    // 1. Availability / blocked dates — remove from scheduling
    const { error: availErr } = await supabaseAdmin
      .from("teacher_availability")
      .delete()
      .eq("teacher_id", teacherId);
    if (availErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete teacher availability: ${availErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("teacher_availability");

    const { error: unavailErr } = await supabaseAdmin
      .from("teacher_unavailable_dates")
      .delete()
      .eq("teacher_id", teacherId);
    if (unavailErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete unavailable dates: ${unavailErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("teacher_unavailable_dates");

    // 2. Teacher notifications (before schedule deletes that may FK to related_schedule_id)
    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("user_id", teacherId);
    if (notifErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete notifications: ${notifErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("notifications");

    // 3. Sprint sessions — preserve learner history on completed/absent; release upcoming
    const { data: teacherSessions, error: sessFetchErr } = await supabaseAdmin
      .from("sprint_sessions")
      .select("id, status, class_id")
      .eq("teacher_id", teacherId);

    if (sessFetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch sprint sessions: ${sessFetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const historicalIds: string[] = [];
    const upcomingIds: string[] = [];
    const upcomingClassIds = new Set<string>();

    for (const s of teacherSessions || []) {
      if (s.status === "completed" || s.status === "absent") {
        historicalIds.push(s.id);
      } else {
        upcomingIds.push(s.id);
        if (s.class_id) upcomingClassIds.add(s.class_id);
      }
    }

    if (historicalIds.length > 0) {
      // Keep session grades/feedback; only unlink teacher identity
      const { error: histNullErr } = await supabaseAdmin
        .from("sprint_sessions")
        .update({ teacher_id: null })
        .in("id", historicalIds);
      if (histNullErr) {
        return new Response(
          JSON.stringify({ error: `Failed to unlink historical sessions: ${histNullErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    steps.push("historical_sessions_unlinked");

    if (upcomingIds.length > 0) {
      const { error: upResetErr } = await supabaseAdmin
        .from("sprint_sessions")
        .update({
          status: "available",
          class_id: null,
          meeting_link: null,
          scheduled_at: null,
          teacher_id: null,
          completed_at: null,
          completion_rating: null,
          feedback: null,
        })
        .in("id", upcomingIds);
      if (upResetErr) {
        return new Response(
          JSON.stringify({ error: `Failed to release upcoming sessions: ${upResetErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    steps.push("upcoming_sessions_released");

    // 4. Classes owned by this teacher
    const { data: ownedClasses, error: classFetchErr } = await supabaseAdmin
      .from("classes")
      .select("id")
      .eq("teacher_id", teacherId);

    if (classFetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch classes: ${classFetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ownedClassIds = (ownedClasses || []).map((c) => c.id);
    const allClassIds = [...new Set([...ownedClassIds, ...upcomingClassIds])];

    for (const classId of allClassIds) {
      // Null related_schedule_id on notifications before deleting schedules
      const { data: schedules } = await supabaseAdmin
        .from("class_schedules")
        .select("id")
        .eq("class_id", classId);

      const scheduleIds = (schedules || []).map((s) => s.id);
      if (scheduleIds.length > 0) {
        await supabaseAdmin
          .from("notifications")
          .update({ related_schedule_id: null })
          .in("related_schedule_id", scheduleIds);
      }

      // Only remove enrollments for classes this teacher owned (upcoming release already
      // unlinked sessions; learners on shared classes of other teachers are untouched).
      if (ownedClassIds.includes(classId)) {
        await supabaseAdmin.from("session_attendance").delete().eq("class_id", classId);
        await supabaseAdmin.from("class_enrollments").delete().eq("class_id", classId);
        await supabaseAdmin.from("class_schedules").delete().eq("class_id", classId);
        await supabaseAdmin.from("class_materials").delete().eq("class_id", classId);

        // Any leftover sessions still pointing at this class
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

        const { error: classDelErr } = await supabaseAdmin
          .from("classes")
          .delete()
          .eq("id", classId);
        if (classDelErr) {
          return new Response(
            JSON.stringify({ error: `Failed to delete class ${classId}: ${classDelErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // Class owned by someone else but this teacher was on upcoming sessions —
        // only clear schedules that belong to this teacher if any remain.
        await supabaseAdmin
          .from("class_schedules")
          .delete()
          .eq("class_id", classId)
          .eq("teacher_id", teacherId);
      }
    }
    steps.push("classes_cleanup");

    // 5. Leftover materials / schedules referencing teacher
    await supabaseAdmin.from("class_materials").delete().eq("teacher_id", teacherId);
    await supabaseAdmin.from("class_schedules").delete().eq("teacher_id", teacherId);
    steps.push("teacher_materials_schedules");

    // 6. Courses optional teacher_id
    await supabaseAdmin
      .from("courses")
      .update({ teacher_id: null })
      .eq("teacher_id", teacherId);
    steps.push("courses_unlinked");

    // 7. Profile
    const { error: profileDelErr } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", teacherId);
    if (profileDelErr) {
      return new Response(
        JSON.stringify({ error: `Failed to delete profile: ${profileDelErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    steps.push("profiles");

    // 8. Auth user last
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(teacherId);
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
          id: teacherId,
          email: targetProfile.email,
          full_name: targetProfile.full_name,
        },
        steps,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[admin-delete-teacher] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
