
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const { course_id, enrollment_id, sprint_number, password } = body;

    // --- CASE 1: Initial enrollment (course_id provided) ---
    if (course_id && !enrollment_id) {
      const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ success: false, error: "Vui lòng đăng nhập để đăng ký khóa học." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(authHeader);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get course info
      const { data: course, error: courseError } = await supabaseClient
        .from("courses")
        .select("id, total_sprints, enrollment_password, is_active")
        .eq("id", course_id)
        .single();

      if (courseError || !course) {
        return new Response(
          JSON.stringify({ success: false, error: "Khóa học không tồn tại." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!course.is_active) {
        return new Response(
          JSON.stringify({ success: false, error: "Khóa học này hiện không mở đăng ký." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Server-side password verification
      if (course.enrollment_password) {
        if (!password || password.trim() !== course.enrollment_password) {
          return new Response(
            JSON.stringify({ success: false, error: "Mật khẩu đăng ký không đúng. Vui lòng kiểm tra lại." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Check if already enrolled
      const { data: existingEnrollment } = await supabaseClient
        .from("enrollments")
        .select("id, status")
        .eq("learner_id", user.id)
        .eq("course_id", course_id)
        .eq("status", "active")
        .maybeSingle();

      if (existingEnrollment) {
        return new Response(
          JSON.stringify({ success: false, error: "Bạn đã đăng ký khóa học này rồi.", already_enrolled: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalSprints = course.total_sprints || 24;

      // Create enrollment
      const { data: enrollment, error: enrollError } = await supabaseClient
        .from("enrollments")
        .insert({
          learner_id: user.id,
          course_id: course_id,
          study_commitment: 3,
          status: "active",
          enrolled_at: new Date().toISOString(),
          missed_deadlines: 0,
          auto_sprint_mode: true,
        })
        .select("id")
        .single();

      if (enrollError) {
        console.error("Enrollment insert error:", enrollError);
        return new Response(
          JSON.stringify({ success: false, error: "Không thể tạo đăng ký. Vui lòng thử lại sau." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create all sprints from 1 to total_sprints (all locked)
      const createdSprints = [];
      for (let num = 1; num <= totalSprints; num++) {
        const { data: sprint, error: sprintError } = await supabaseClient
          .from("learning_sprints")
          .insert({
            enrollment_id: enrollment.id,
            sprint_number: num,
            status: "pending",
          })
          .select()
          .single();

        if (sprintError) {
          console.error(`Failed to create sprint ${num}:`, sprintError);
          // Clean up: delete enrollment since sprints failed
          await supabaseClient.from("enrollments").delete().eq("id", enrollment.id);
          return new Response(
            JSON.stringify({ success: false, error: "Lỗi khi tạo lộ trình học. Vui lòng thử lại." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Create 3 sessions for each sprint (all locked initially)
        const sessionTypes = ["self_study", "live_session", "live_session"];
        for (let sNum = 1; sNum <= 3; sNum++) {
          await supabaseClient
            .from("sprint_sessions")
            .insert({
              sprint_id: sprint.id,
              session_number: sNum,
              session_type: sessionTypes[sNum - 1],
              status: "locked",
            });
        }

        createdSprints.push({ sprint_number: num, id: sprint.id });
      }

      return new Response(
        JSON.stringify({
          success: true,
          enrollment_id: enrollment.id,
          sprints_count: createdSprints.length,
          sprints: createdSprints,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- CASE 2: Single sprint creation (enrollment_id + sprint_number provided) ---
    if (!enrollment_id || !sprint_number) {
      return new Response(
        JSON.stringify({ success: false, error: "Thiếu enrollment_id hoặc sprint_number" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: enrollment, error: enrollmentError } = await supabaseClient
      .from("enrollments")
      .select("id, course_id, learner_id")
      .eq("id", enrollment_id)
      .single();

    if (enrollmentError || !enrollment) {
      return new Response(
        JSON.stringify({ success: false, error: "Không tìm thấy đăng ký." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Guard: check if sprint_number exceeds total_sprints (course is done!)
    if (enrollment.course_id) {
      const { data: course } = await supabaseClient
        .from("courses")
        .select("total_sprints")
        .eq("id", enrollment.course_id)
        .maybeSingle();

      const totalSprints = course?.total_sprints || 24;

      if (sprint_number > totalSprints) {
        // Course is fully completed — mark enrollment as completed
        await supabaseClient
          .from("enrollments")
          .update({ status: "completed" })
          .eq("id", enrollment_id);

        // Notify learner
        if (enrollment.learner_id) {
          await supabaseClient.from("notifications").insert({
            user_id: enrollment.learner_id,
            title: "🎉 Chúc Mừng! Bạn Đã Hoàn Thành Khóa Học!",
            message: `Tuyệt vời! Bạn đã hoàn thành tất cả ${totalSprints} Sprint. Chúc mừng thành tích xuất sắc!`,
            type: "system",
            is_read: false,
            created_at: new Date().toISOString(),
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            course_completed: true,
            message: `All ${totalSprints} sprints completed. Course finished!`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: existingSprint } = await supabaseClient
      .from("learning_sprints")
      .select("id")
      .eq("enrollment_id", enrollment_id)
      .eq("sprint_number", sprint_number)
      .maybeSingle();

    if (existingSprint) {
      return new Response(
        JSON.stringify({ success: true, sprint_id: existingSprint.id, already_exists: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: sprint, error: sprintError } = await supabaseClient
      .from("learning_sprints")
      .insert({ enrollment_id, sprint_number, status: "pending" })
      .select()
      .single();

    if (sprintError) {
      return new Response(
        JSON.stringify({ success: false, error: "Không thể tạo sprint." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sessionTypes = ["self_study", "live_session", "live_session"];
    for (let sNum = 1; sNum <= 3; sNum++) {
      await supabaseClient.from("sprint_sessions").insert({
        sprint_id: sprint.id,
        session_number: sNum,
        session_type: sessionTypes[sNum - 1],
        status: "locked",
      });
    }

    return new Response(
      JSON.stringify({ success: true, sprint_id: sprint.id, message: "Sprint created with 3 sessions" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Lỗi hệ thống. Vui lòng thử lại sau." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
