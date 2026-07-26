
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

    // Verify admin
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const { action, class_id, student_id, new_class_id } = body;

    if (!action || !class_id || !student_id) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields: action, class_id, student_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "reassign" && !new_class_id) {
      return new Response(JSON.stringify({ success: false, error: "new_class_id required for reassign" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── GATHER INFO ──
    const { data: classData } = await supabaseAdmin
      .from("classes")
      .select("id, teacher_id, name, max_students")
      .eq("id", class_id)
      .maybeSingle();

    if (!classData) {
      return new Response(JSON.stringify({ success: false, error: "Class not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: enrollment } = await supabaseAdmin
      .from("class_enrollments")
      .select("id")
      .eq("class_id", class_id)
      .eq("student_id", student_id)
      .maybeSingle();

    if (!enrollment) {
      return new Response(JSON.stringify({ success: false, error: "Learner is not enrolled in this class" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get learner name
    const { data: learnerProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", student_id)
      .maybeSingle();
    const learnerName = learnerProfile?.full_name || "Learner";

    // Get old teacher name
    let oldTeacherName = "Teacher";
    if (classData.teacher_id) {
      const { data: ot } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", classData.teacher_id)
        .maybeSingle();
      if (ot?.full_name) oldTeacherName = ot.full_name;
    }

    // Get sprint_sessions tied to this class that belong to this learner
    // sprint_sessions have class_id, but no direct student_id.
    // We go: sprint_sessions → sprint_id → learning_sprints → enrollment_id → enrollments → learner_id
    const { data: sprintSessions } = await supabaseAdmin
      .from("sprint_sessions")
      .select("id, sprint_id, session_number")
      .eq("class_id", class_id);

    let learnerSessionIds: string[] = [];
    let sessionNumbers: number[] = [];

    if (sprintSessions && sprintSessions.length > 0) {
      const sprintIds = [...new Set(sprintSessions.map((s) => s.sprint_id))];

      const { data: sprints } = await supabaseAdmin
        .from("learning_sprints")
        .select("id, enrollment_id")
        .in("id", sprintIds);

      if (sprints) {
        const enrollmentIds = [...new Set(sprints.map((s) => s.enrollment_id))];

        const { data: enrollments } = await supabaseAdmin
          .from("enrollments")
          .select("id, learner_id")
          .in("id", enrollmentIds)
          .eq("learner_id", student_id);

        if (enrollments && enrollments.length > 0) {
          const learnerEnrollmentIds = new Set(enrollments.map((e) => e.id));
          const learnerSprintIds = new Set(
            sprints.filter((s) => learnerEnrollmentIds.has(s.enrollment_id)).map((s) => s.id)
          );
          learnerSessionIds = sprintSessions
            .filter((ss) => learnerSprintIds.has(ss.sprint_id))
            .map((ss) => ss.id);
          sessionNumbers = sprintSessions
            .filter((ss) => learnerSprintIds.has(ss.sprint_id))
            .map((ss) => ss.session_number);
        }
      }
    }

    const sessionLabel = sessionNumbers.length > 0
      ? sessionNumbers.map((n) => `Buổi ${n}`).join(", ")
      : "";

    // ── CANCEL ACTION ──
    if (action === "cancel") {
      // Delete enrollment first
      await supabaseAdmin
        .from("class_enrollments")
        .delete()
        .eq("id", enrollment.id);

      // Reset sprint_sessions — WITH class_id guard to prevent race condition
      // Only reset sessions whose class_id is STILL the old class.
      // If admin_assign already changed class_id in another request,
      // this update won't match and won't overwrite the new assignment.
      if (learnerSessionIds.length > 0) {
        const { data: resetResult, error: resetErr } = await supabaseAdmin
          .from("sprint_sessions")
          .update({
            status: "available",
            class_id: null,
            teacher_id: null,
            meeting_link: null,
            scheduled_at: null,
          })
          .in("id", learnerSessionIds)
          .eq("class_id", class_id)
          .select("id");

        if (resetErr) {
          console.error("[admin-manage-enrollment] cancel reset error:", resetErr.message);
        } else {
          const resetCount = resetResult?.length ?? 0;
          if (resetCount < learnerSessionIds.length) {
            console.log(`[admin-manage-enrollment] cancel: only reset ${resetCount}/${learnerSessionIds.length} sessions — some were already reassigned (race condition avoided)`);
          }
        }
      }

      // Check remaining students
      const { count: remainingCount } = await supabaseAdmin
        .from("class_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("class_id", class_id);

      if (remainingCount === 0) {
        await supabaseAdmin.from("class_schedules").delete().eq("class_id", class_id);
        await supabaseAdmin.from("class_materials").delete().eq("class_id", class_id);
        await supabaseAdmin.from("classes").delete().eq("id", class_id);
      }

      // ── NOTIFICATIONS ──
      // Notify teacher
      if (classData.teacher_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: classData.teacher_id,
          title: "Admin Đã Hủy Đăng Ký Học Viên",
          message: `Admin đã hủy đăng ký của ${learnerName} khỏi lớp "${classData.name}"${sessionLabel ? ` (${sessionLabel})` : ""}.`,
          type: "class",
          is_read: false,
          action_url: "/teacher/dashboard",
        }).maybeSingle();
      }

      // Notify learner
      await supabaseAdmin.from("notifications").insert({
        user_id: student_id,
        title: "Admin Đã Hủy Buổi Học Của Bạn",
        message: `Admin đã hủy đăng ký của bạn khỏi lớp "${classData.name}" với ${oldTeacherName}${sessionLabel ? ` (${sessionLabel})` : ""}. Vui lòng đặt lịch lại.`,
        type: "class",
        is_read: false,
        action_url: "/booking",
      }).maybeSingle();

      return new Response(JSON.stringify({
        success: true,
        message: `Đã hủy ${learnerName} khỏi lớp "${classData.name}"`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REASSIGN ACTION ──
    if (action === "reassign") {
      // Validate new class
      const { data: newClass } = await supabaseAdmin
        .from("classes")
        .select("id, teacher_id, name, max_students")
        .eq("id", new_class_id)
        .maybeSingle();

      if (!newClass) {
        return new Response(JSON.stringify({ success: false, error: "Target class not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check new class capacity
      const { count: newClassCount } = await supabaseAdmin
        .from("class_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("class_id", new_class_id);

      if ((newClassCount || 0) >= (newClass.max_students || 2)) {
        return new Response(JSON.stringify({ success: false, error: "Target class is full" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check not already enrolled
      const { data: alreadyEnrolled } = await supabaseAdmin
        .from("class_enrollments")
        .select("id")
        .eq("class_id", new_class_id)
        .eq("student_id", student_id)
        .maybeSingle();

      if (alreadyEnrolled) {
        return new Response(JSON.stringify({ success: false, error: "Learner already enrolled in target class" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let newTeacherName = "Teacher";
      if (newClass.teacher_id) {
        const { data: nt } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", newClass.teacher_id)
          .maybeSingle();
        if (nt?.full_name) newTeacherName = nt.full_name;
      }

      // Get new class schedule info
      const { data: newSchedule } = await supabaseAdmin
        .from("class_schedules")
        .select("date, start_time, end_time")
        .eq("class_id", new_class_id)
        .maybeSingle();

      // 1. Remove from old class
      await supabaseAdmin
        .from("class_enrollments")
        .delete()
        .eq("id", enrollment.id);

      // 2. Add to new class
      await supabaseAdmin
        .from("class_enrollments")
        .insert({
          class_id: new_class_id,
          student_id,
        });

      // 3. Update sprint_sessions to point to new class
      if (learnerSessionIds.length > 0) {
        const scheduledAt = newSchedule?.date && newSchedule?.start_time
          ? `${newSchedule.date}T${newSchedule.start_time}+07:00`
          : null;

        const updatePayload: Record<string, unknown> = {
          class_id: new_class_id,
          teacher_id: newClass.teacher_id,
        };
        if (scheduledAt) {
          updatePayload.scheduled_at = scheduledAt;
        }

        await supabaseAdmin
          .from("sprint_sessions")
          .update(updatePayload)
          .in("id", learnerSessionIds);
      }

      // 4. Clean up old class if empty
      const { count: oldRemaining } = await supabaseAdmin
        .from("class_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("class_id", class_id);

      if (oldRemaining === 0) {
        await supabaseAdmin.from("class_schedules").delete().eq("class_id", class_id);
        await supabaseAdmin.from("class_materials").delete().eq("class_id", class_id);
        await supabaseAdmin.from("classes").delete().eq("id", class_id);
      }

      // ── NOTIFICATIONS ──
      const dateDisplay = newSchedule?.date
        ? new Date(newSchedule.date + "T00:00:00").toLocaleDateString("vi-VN", { month: "short", day: "numeric" })
        : "";

      // Notify old teacher
      if (classData.teacher_id && classData.teacher_id !== newClass.teacher_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: classData.teacher_id,
          title: "Học Viên Được Chuyển Lớp",
          message: `${learnerName} đã được admin chuyển khỏi lớp "${classData.name}" sang lớp "${newClass.name}"${sessionLabel ? ` (${sessionLabel})` : ""}.`,
          type: "class",
          is_read: false,
          action_url: "/teacher/dashboard",
        }).maybeSingle();
      }

      // Notify learner
      await supabaseAdmin.from("notifications").insert({
        user_id: student_id,
        title: "Admin Đã Chuyển Lớp Của Bạn",
        message: `Admin đã chuyển bạn từ lớp "${classData.name}" (${oldTeacherName}) sang lớp "${newClass.name}" (${newTeacherName})${dateDisplay ? ` vào ${dateDisplay}` : ""}${sessionLabel ? ` (${sessionLabel})` : ""}.`,
        type: "class",
        is_read: false,
        action_url: "/dashboard",
      }).maybeSingle();

      // Notify new teacher
      if (newClass.teacher_id && newClass.teacher_id !== classData.teacher_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: newClass.teacher_id,
          title: "Học Viên Mới Được Chuyển Vào",
          message: `${learnerName} đã được admin chuyển vào lớp "${newClass.name}" của bạn${dateDisplay ? ` vào ${dateDisplay}` : ""}${sessionLabel ? ` (${sessionLabel})` : ""}.`,
          type: "class",
          is_read: false,
          action_url: "/teacher/dashboard",
        }).maybeSingle();
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Đã chuyển ${learnerName} từ "${classData.name}" sang "${newClass.name}"`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: false, error: "Invalid action. Use 'cancel' or 'reassign'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("[admin-manage-enrollment]", err);
    return new Response(JSON.stringify({ success: false, error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
