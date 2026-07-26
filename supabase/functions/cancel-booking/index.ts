import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getVnDayOfWeek(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCDay();
}

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
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { sprint_session_id, class_id, is_admin } = body;

    if (!sprint_session_id || !class_id) {
      return new Response(JSON.stringify({ success: false, error: "Thiếu thông tin: sprint_session_id, class_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Saturday-only cancel guard (server-side)
    // Admins bypass this check via is_admin flag
    if (!is_admin) {
      const today = new Date();
      const todayDayOfWeek = getVnDayOfWeek(today);
      if (todayDayOfWeek !== 6) {
        return new Response(
          JSON.stringify({ success: false, error: "Chỉ có thể hủy lịch vào Thứ 7. Vui lòng quay lại vào Thứ 7.", code: "NOT_SATURDAY" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Verify student is enrolled in this class
    const { data: classEnrollment, error: ceErr } = await supabaseAdmin
      .from("class_enrollments")
      .select("id")
      .eq("class_id", class_id)
      .eq("student_id", caller.id)
      .maybeSingle();

    if (ceErr || !classEnrollment) {
      return new Response(JSON.stringify({ success: false, error: "Bạn không có trong lớp học này" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- GATHER INFO BEFORE DELETING ----
    const { data: classData } = await supabaseAdmin
      .from("classes")
      .select("teacher_id, name")
      .eq("id", class_id)
      .maybeSingle();

    const teacherId = classData?.teacher_id;

    const { data: sessionData } = await supabaseAdmin
      .from("sprint_sessions")
      .select("session_number, sprint_id")
      .eq("id", sprint_session_id)
      .maybeSingle();

    const { data: learnerProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", caller.id)
      .single();

    let teacherProfile = null;
    if (teacherId) {
      const { data: tp } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", teacherId)
        .single();
      teacherProfile = tp;
    }

    const learnerName = learnerProfile?.full_name || "Student";
    const teacherName = teacherProfile?.full_name || "Teacher";

    // ---- DELETE ENROLLMENT ----
    const { error: deleteErr } = await supabaseAdmin
      .from("class_enrollments")
      .delete()
      .eq("id", classEnrollment.id);

    if (deleteErr) {
      return new Response(JSON.stringify({ success: false, error: "Không thể hủy đăng ký lớp" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Reset session back to available and clear teacher assignment
    const { error: updateErr } = await supabaseAdmin
      .from("sprint_sessions")
      .update({ status: "available", class_id: null, meeting_link: null, scheduled_at: null, teacher_id: null })
      .eq("id", sprint_session_id);

    if (updateErr) {
      console.error("[cancel-booking] Reset session error:", updateErr);
    }

    // ---- SEND NOTIFICATIONS ----
    // NOTE: related_schedule_id has a FK to class_schedules(id). The schedule may be
    // deleted above, and sprint_session_id is NOT a class_schedules id, so we pass null.

    // Notify teacher about cancellation
    if (teacherId && teacherId !== caller.id) {
      const { error: notifTeacherErr } = await supabaseAdmin.from("notifications").insert({
        user_id: teacherId,
        title: "Học Viên Hủy Lớp",
        message: `${learnerName} đã hủy Buổi ${sessionData?.session_number || ""} với bạn.`,
        type: "class",
        is_read: false,
        action_url: "/teacher/dashboard",
        related_schedule_id: null,
      });
      if (notifTeacherErr) console.error("[cancel-booking] teacher notif error:", JSON.stringify(notifTeacherErr));
    }

    // Notify learner
    const { error: notifLearnerErr } = await supabaseAdmin.from("notifications").insert({
      user_id: caller.id,
      title: "Đã Hủy Buổi Học",
      message: `Bạn đã hủy Buổi ${sessionData?.session_number || ""} với ${teacherName}. Hãy đặt buổi khác nhé!`,
      type: "class",
      is_read: false,
      action_url: "/booking",
      related_schedule_id: null,
    });
    if (notifLearnerErr) console.error("[cancel-booking] learner notif error:", JSON.stringify(notifLearnerErr));

    return new Response(
      JSON.stringify({ success: true, message: "Đã hủy buổi học thành công!" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[cancel-booking] Error:", err);
    return new Response(JSON.stringify({ success: false, error: "Lỗi máy chủ" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
