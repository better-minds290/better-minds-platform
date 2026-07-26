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
    const { action, student_id, session_id, schedule_id, class_id, session_number, sprint_id, sprint_number, enrollment_id, course_name, learner_name, attendance_id } = body;

    if (action === "reopen_absent") {
      if (!attendance_id) {
        return new Response(
          JSON.stringify({ error: "Missing attendance_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: attRecord, error: attErr } = await supabaseClient
        .from("learner_attendance")
        .select("*")
        .eq("id", attendance_id)
        .maybeSingle();

      if (attErr || !attRecord) {
        return new Response(
          JSON.stringify({ error: "Attendance record not found", detail: attErr?.message }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (attRecord.type !== "absent_session") {
        return new Response(
          JSON.stringify({ error: "Chỉ có thể mở lại bản ghi vắng học (absent_session)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (attRecord.resolved) {
        return new Response(
          JSON.stringify({ error: "Bản ghi này đã được xử lý rồi" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sessionId = attRecord.related_session_id;
      const scheduleId = attRecord.related_class_schedule_id;
      const learnerId = attRecord.learner_id;
      const oldClassId = attRecord.class_id;
      const attSprintId = attRecord.related_sprint_id;

      const results: Record<string, any> = {};

      // Reactivate sprint if expired (learner was late, sprint got marked expired by enforce-deadlines)
      if (attSprintId) {
        const { data: sprint } = await supabaseClient
          .from("learning_sprints")
          .select("id, status")
          .eq("id", attSprintId)
          .maybeSingle();

        if (sprint && sprint.status === "expired") {
          const { error: sprintUpdErr } = await supabaseClient
            .from("learning_sprints")
            .update({ status: "active" })
            .eq("id", attSprintId);

          if (sprintUpdErr) {
            results.sprint_reactivate = "failed: " + sprintUpdErr.message;
          } else {
            results.sprint_reactivate = "ok";
          }
        }
      }

      if (sessionId) {
        // Set to "available" AND wipe old booking data so enforce-deadlines cron
        // doesn't auto-transition it to "awaiting_feedback" based on stale scheduled_at
        const { error: sessionUpdErr } = await supabaseClient
          .from("sprint_sessions")
          .update({
            status: "available",
            completed_at: null,
            completion_rating: null,
            feedback: null,
            scheduled_at: null,
            class_id: null,
            teacher_id: null,
          })
          .eq("id", sessionId);

        if (sessionUpdErr) {
          results.session_reset = "failed: " + sessionUpdErr.message;
        } else {
          results.session_reset = "ok";
        }
      }

      if (scheduleId && learnerId) {
        const { error: delAttErr } = await supabaseClient
          .from("session_attendance")
          .delete()
          .eq("schedule_id", scheduleId)
          .eq("student_id", learnerId);

        if (delAttErr) {
          results.attendance_cleanup = "failed: " + delAttErr.message;
        } else {
          results.attendance_cleanup = "ok";
        }
      }

      if (oldClassId && learnerId) {
        const { error: delEnrollErr } = await supabaseClient
          .from("class_enrollments")
          .delete()
          .eq("class_id", oldClassId)
          .eq("student_id", learnerId);

        if (delEnrollErr) {
          results.enrollment_cleanup = "failed: " + delEnrollErr.message;
        } else {
          results.enrollment_cleanup = "ok";
        }
      }

      const { error: resolveErr } = await supabaseClient
        .from("learner_attendance")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: "admin",
          note: (attRecord.note || "") + " | Admin đã mở lại để xếp lịch mới",
        })
        .eq("id", attendance_id);

      if (resolveErr) {
        results.resolve = "failed: " + resolveErr.message;
      } else {
        results.resolve = "ok";
      }

      if (learnerId) {
        const sprintLabel = attRecord.sprint_number ? ` Sprint ${attRecord.sprint_number}` : "";
        const sessionLabel = attRecord.session_number ? ` Buổi ${attRecord.session_number}` : "";

        await supabaseClient.from("notifications").insert({
          user_id: learnerId,
          title: `Buổi Học Đã Được Mở Lại${sprintLabel}${sessionLabel}`,
          message: `Admin đã mở lại buổi học${sprintLabel}${sessionLabel} của bạn. Admin sẽ sắp xếp lịch học mới cho bạn trong thời gian tới.`,
          type: "system",
          is_read: false,
          created_at: new Date().toISOString(),
          action_url: "/dashboard",
        });
        results.notification = "sent";
      }

      return new Response(
        JSON.stringify({ success: true, reopened: true, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "mark_absent") {
      if (!student_id || !schedule_id) {
        return new Response(
          JSON.stringify({ error: "Missing student_id or schedule_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existingAttendance } = await supabaseClient
        .from("session_attendance")
        .select("id")
        .eq("schedule_id", schedule_id)
        .eq("student_id", student_id)
        .maybeSingle();

      if (existingAttendance) {
        await supabaseClient
          .from("session_attendance")
          .update({
            status: "absent",
            grade: null,
            teacher_feedback: null,
            note: "Giáo viên đánh dấu vắng học",
            marked_at: new Date().toISOString(),
          })
          .eq("id", existingAttendance.id);
      } else {
        await supabaseClient
          .from("session_attendance")
          .insert({
            schedule_id: schedule_id,
            student_id: student_id,
            class_id: class_id || null,
            status: "absent",
            grade: null,
            teacher_feedback: null,
            note: "Giáo viên đánh dấu vắng học",
            marked_at: new Date().toISOString(),
          });
      }

      if (session_id) {
        await supabaseClient
          .from("sprint_sessions")
          .update({
            status: "absent",
            completion_rating: null,
            feedback: "Học viên vắng học",
          })
          .eq("id", session_id);
      }

      const { error: attErr } = await supabaseClient
        .from("learner_attendance")
        .insert({
          learner_id: student_id,
          enrollment_id: enrollment_id || null,
          related_session_id: session_id || null,
          related_sprint_id: sprint_id || null,
          related_class_schedule_id: schedule_id,
          class_id: class_id || null,
          session_number: session_number || null,
          sprint_number: sprint_number || null,
          type: "absent_session",
          date: new Date().toISOString().split("T")[0],
          learner_name: learner_name || "",
          course_name: course_name || "",
          note: "Giáo viên đánh dấu vắng học",
          resolved: false,
          created_at: new Date().toISOString(),
        });

      if (attErr) {
        console.error("Failed to insert learner_attendance:", attErr);
      }

      const sprintLabel = sprint_number ? ` Sprint ${sprint_number}` : "";
      const sessionLabel = session_number ? ` Buổi ${session_number}` : "";

      await supabaseClient.from("notifications").insert({
        user_id: student_id,
        title: `Bạn Đã Vắng Buổi Học${sprintLabel}${sessionLabel}`,
        message: `Giáo viên đã ghi nhận bạn vắng mặt trong buổi học${sprintLabel}${sessionLabel}. Hãy cố gắng tham gia đầy đủ các buổi học tiếp theo!`,
        type: "system",
        is_read: false,
        created_at: new Date().toISOString(),
        action_url: "/dashboard",
      });

      return new Response(
        JSON.stringify({ success: true, marked_absent: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "detect_sprint_late") {
      const { data: detectResult, error: detectErr } = await supabaseClient.functions.invoke("detect-sprint-late", {
        body: {},
      });

      if (detectErr) {
        return new Response(
          JSON.stringify({ error: "Detection failed", detail: detectErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify(detectResult),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use 'mark_absent', 'reopen_absent' or 'detect_sprint_late'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("record-learner-attendance error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
