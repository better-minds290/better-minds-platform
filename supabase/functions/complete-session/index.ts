import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StudentGrade {
  student_id: string;
  grade: number;
  feedback: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const debugLog: string[] = [];

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const { session_id, teacher_id, grades, lesson_summary, questions } = body;

    debugLog.push(`[1] Received: session=${session_id}, teacher=${teacher_id}`);

    if (!session_id || !teacher_id) {
      return new Response(
        JSON.stringify({ error: "Missing session_id or teacher_id", debug: debugLog }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the session
    const { data: session, error: sessionErr } = await supabaseClient
      .from("sprint_sessions")
      .select("id, session_number, sprint_id, teacher_id, class_id, status")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      debugLog.push(`[ERR] Session not found: ${sessionErr?.message}`);
      return new Response(
        JSON.stringify({ error: "Session not found", detail: sessionErr?.message, debug: debugLog }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push(`[2] Session: sprint=${session.sprint_id}, class=${session.class_id}, status=${session.status}, num=${session.session_number}`);

    // ── CASE S1: Session 1 (self-study) — learner submits lesson summary ──
    if (session.session_number === 1) {
      debugLog.push("[S1] Session 1 — processing lesson summary submission");

      const summaryText = lesson_summary || "";
      const questionsText = questions || "";

      await supabaseClient
        .from("sprint_sessions")
        .update({
          lesson_summary: summaryText,
          teacher_feedback: questionsText ? `Câu hỏi: ${questionsText}` : null,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", session_id);

      debugLog.push("[S1] Session 1 marked as completed");

      const { data: sprintData } = await supabaseClient
        .from("learning_sprints")
        .select("sprint_number, enrollment_id")
        .eq("id", session.sprint_id)
        .maybeSingle();

      if (sprintData?.enrollment_id) {
        const { data: enrollData } = await supabaseClient
          .from("enrollments")
          .select("learner_id")
          .eq("id", sprintData.enrollment_id)
          .maybeSingle();

        if (enrollData?.learner_id) {
          await supabaseClient.from("notifications").insert({
            user_id: enrollData.learner_id,
            title: "Buổi tự học đã hoàn thành",
            message: `Bạn đã hoàn thành buổi tự học Sprint ${sprintData.sprint_number}. Giáo viên có thể xem tóm tắt bài học của bạn.`,
            type: "session_complete",
            is_read: false,
            created_at: new Date().toISOString(),
          });
        }
      }

      await checkSprintCompletion(supabaseClient, session.sprint_id, session.session_number, debugLog);

      return new Response(
        JSON.stringify({
          success: true,
          session_completed: true,
          session_number: 1,
          debug: debugLog,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── CASE A: Session has class_id → grade via session_attendance (Sessions 2 & 3) ──
    if (session.class_id && grades && Array.isArray(grades) && grades.length > 0) {
      // ⛔ FILTER: only save students who have REAL feedback (non-empty)
      const validGrades = grades.filter(
        (g: StudentGrade) =>
          g.student_id &&
          g.grade >= 1 && g.grade <= 5 &&
          g.feedback && g.feedback.trim().length > 0
      );

      debugLog.push(`[3] Received ${grades.length} grade(s), ${validGrades.length} valid (with feedback). Skipped ${grades.length - validGrades.length} entries without feedback.`);

      if (validGrades.length === 0) {
        // Check if all students are absent — if so, complete the CLASS SCHEDULE but NOT the sprint
        const { data: scheduleAbsent } = await supabaseClient
          .from("class_schedules")
          .select("id")
          .eq("class_id", session.class_id)
          .maybeSingle();

        if (scheduleAbsent) {
          const { data: attCheck } = await supabaseClient
            .from("session_attendance")
            .select("id, status")
            .eq("schedule_id", scheduleAbsent.id);

          const allAbsent = attCheck && attCheck.length > 0 && attCheck.every((a: any) => a.status === "absent");

          if (allAbsent) {
            debugLog.push("[3-absent] All students absent — completing class schedule (sprint stays active)");

            // Complete class schedule (for calendar display — teacher fulfilled duty)
            await supabaseClient
              .from("class_schedules")
              .update({ status: "completed" })
              .eq("id", scheduleAbsent.id);

            // Complete class_enrollments
            await supabaseClient
              .from("class_enrollments")
              .update({ status: "completed" })
              .eq("class_id", session.class_id);

            // Get all sprint_sessions for this class and mark them as absent
            const { data: classSessions } = await supabaseClient
              .from("sprint_sessions")
              .select("id, sprint_id")
              .eq("class_id", session.class_id);

            for (const cs of (classSessions || [])) {
              await supabaseClient
                .from("sprint_sessions")
                .update({
                  status: "absent",
                  completed_at: new Date().toISOString(),
                  completion_rating: null,
                  feedback: "Học viên vắng học",
                })
                .eq("id", cs.id);
            }

            // ⛔ DO NOT check sprint completion — absent sessions don't complete sprints
            // Sprint stays active; admin can force-complete if needed

            return new Response(
              JSON.stringify({
                success: true,
                session_completed: true,
                all_absent: true,
                graded_count: 0,
                total_students: attCheck.length,
                message: "Tất cả học viên vắng. Lớp đã được đánh dấu hoàn thành trên lịch, nhưng Sprint của học viên chưa được hoàn thành.",
                debug: debugLog,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            session_completed: false,
            graded_count: 0,
            total_students: 0,
            message: "No valid grades with feedback provided. Each student needs both a grade and feedback.",
            debug: debugLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: schedule } = await supabaseClient
        .from("class_schedules")
        .select("id")
        .eq("class_id", session.class_id)
        .maybeSingle();

      const scheduleId = schedule?.id || null;
      debugLog.push(`[3a] schedule_id=${scheduleId}`);

      if (!scheduleId) {
        return new Response(
          JSON.stringify({ error: "No class_schedule found for this class", debug: debugLog }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build existing attendance map
      const { data: existingAttendance } = await supabaseClient
        .from("session_attendance")
        .select("id, student_id, status")
        .eq("schedule_id", scheduleId);

      const existingMap = new Map<string, { id: string; status: string }>();
      (existingAttendance || []).forEach((a: any) => existingMap.set(a.student_id, { id: a.id, status: a.status }));

      // Upsert ONLY valid grades (those with real feedback)
      let gradedCount = 0;
      for (const g of validGrades) {
        const existing = existingMap.get(g.student_id);

        if (existing) {
          const { error: updErr } = await supabaseClient
            .from("session_attendance")
            .update({
              grade: g.grade,
              teacher_feedback: g.feedback,
              status: "present",
              marked_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

          if (updErr) {
            debugLog.push(`[ERR] Update failed for student ${g.student_id}: ${updErr.message}`);
          } else {
            debugLog.push(`[OK] Updated student ${g.student_id}: ${g.grade}/5, feedback=${g.feedback.substring(0, 30)}...`);
            gradedCount++;
          }
        } else {
          const { error: insErr } = await supabaseClient
            .from("session_attendance")
            .insert({
              schedule_id: scheduleId,
              student_id: g.student_id,
              class_id: session.class_id,
              grade: g.grade,
              teacher_feedback: g.feedback,
              status: "present",
              marked_at: new Date().toISOString(),
            });

          if (insErr) {
            debugLog.push(`[ERR] Insert failed for student ${g.student_id}: ${insErr.message}`);
          } else {
            debugLog.push(`[OK] Inserted student ${g.student_id}: ${g.grade}/5, feedback=${g.feedback.substring(0, 30)}...`);
            gradedCount++;
          }
        }
      }

      // ⛔ CRITICAL: Re-check attendance — only count PRESENT students for grading
      const { data: allAttendance } = await supabaseClient
        .from("session_attendance")
        .select("id, student_id, grade, teacher_feedback, status")
        .eq("schedule_id", scheduleId);

      const totalStudents = allAttendance?.length || 0;
      const absentCount = allAttendance?.filter((a: any) => a.status === "absent").length || 0;
      const presentStudents = totalStudents - absentCount;
      const fullyGradedStudents = allAttendance?.filter(
        (a: any) => a.status !== "absent" && a.grade !== null && a.teacher_feedback && a.teacher_feedback.trim().length > 0
      ).length || 0;

      debugLog.push(`[4] Attendance check: ${fullyGradedStudents}/${presentStudents} present fully graded, ${absentCount} absent, ${totalStudents} total`);

      // ⛔ ONLY complete when ALL PRESENT students have BOTH grade AND real feedback
      if (fullyGradedStudents >= presentStudents && totalStudents > 0) {
        debugLog.push(`[4] ALL ${presentStudents} present students fully graded — completing class schedule!`);

        // Build student_id → { grade, feedback } map (only present students)
        const studentGradeMap = new Map<string, { grade: number; feedback: string }>();
        (allAttendance || []).forEach((a: any) => {
          if (a.student_id && a.status !== "absent" && a.grade && a.teacher_feedback) {
            studentGradeMap.set(a.student_id, {
              grade: a.grade,
              feedback: a.teacher_feedback,
            });
          }
        });

        // Get all sprint_sessions for this class
        const { data: classSessions } = await supabaseClient
          .from("sprint_sessions")
          .select("id, sprint_id")
          .eq("class_id", session.class_id);

        // Resolve sprint_id → learner_id for each sprint_session
        const uniqueSprintIds = [...new Set((classSessions || []).map((s: any) => s.sprint_id))];

        const { data: sprintRows } = await supabaseClient
          .from("learning_sprints")
          .select("id, enrollment_id")
          .in("id", uniqueSprintIds);

        const sprintEnrollMap = new Map<string, string>();
        (sprintRows || []).forEach((sp: any) => sprintEnrollMap.set(sp.id, sp.enrollment_id));

        const enrollmentIds = [...new Set((sprintRows || []).map((sp: any) => sp.enrollment_id))];
        const { data: enrollRows } = await supabaseClient
          .from("enrollments")
          .select("id, learner_id")
          .in("id", enrollmentIds);

        const enrollLearnerMap = new Map<string, string>();
        (enrollRows || []).forEach((e: any) => enrollLearnerMap.set(e.id, e.learner_id));

        // Update each sprint_session with ITS OWN student's grade + feedback
        let updatedCount = 0;
        let absentSprintIds = new Set<string>();
        for (const cs of (classSessions || [])) {
          const enrollmentId = sprintEnrollMap.get(cs.sprint_id);
          const learnerId = enrollmentId ? enrollLearnerMap.get(enrollmentId) : null;
          const studentGrade = learnerId ? studentGradeMap.get(learnerId) : null;

          // Also check if this student is absent in the attendance
          const isAbsent = (allAttendance || []).some(
            (a: any) => a.student_id === learnerId && a.status === "absent"
          );

          if (isAbsent) {
            // ⛔ Set status to "absent" — sprint will NOT complete for this learner
            await supabaseClient
              .from("sprint_sessions")
              .update({
                status: "absent",
                completed_at: new Date().toISOString(),
                completion_rating: null,
                feedback: "Học viên vắng học",
              })
              .eq("id", cs.id);
            absentSprintIds.add(cs.sprint_id);
            updatedCount++;
            debugLog.push(`[5] Sprint session ${cs.id}: learner absent, marked as 'absent'`);
          } else if (studentGrade) {
            await supabaseClient
              .from("sprint_sessions")
              .update({
                completion_rating: studentGrade.grade,
                feedback: studentGrade.feedback,
                status: "completed",
                completed_at: new Date().toISOString(),
              })
              .eq("id", cs.id);
            updatedCount++;
            debugLog.push(`[5] Sprint session ${cs.id}: grade=${studentGrade.grade}, feedback=${studentGrade.feedback ? "yes" : "no"}`);
          } else {
            debugLog.push(`[5] Sprint session ${cs.id}: no grade mapping found (learner not matched), skipping`);
          }
        }

        debugLog.push(`[5] Updated ${updatedCount}/${classSessions?.length || 0} sprint_sessions`);

        // ⛔ ALWAYS mark class_schedule as completed (for calendar — teacher fulfilled duty)
        await supabaseClient
          .from("class_schedules")
          .update({ status: "completed" })
          .eq("id", scheduleId);

        // Mark class_enrollments as completed
        await supabaseClient
          .from("class_enrollments")
          .update({ status: "completed" })
          .eq("class_id", session.class_id);

        debugLog.push(`[5b] Class schedule + enrollments marked completed`);

        // Send notifications to each PRESENT student
        for (const a of (allAttendance || [])) {
          if (a.student_id && a.status !== "absent" && a.grade !== null && a.teacher_feedback) {
            await supabaseClient.from("notifications").insert({
              user_id: a.student_id,
              title: "Buổi học đã được đánh giá",
              message: `Giáo viên đã đánh giá buổi ${session.session_number} của bạn: ${a.grade}/5 sao. Xem nhận xét trong Lịch Sử Học Tập!`,
              type: "feedback",
              is_read: false,
              created_at: new Date().toISOString(),
            });
          }
        }

        // Check sprint completion ONLY for sprints WITHOUT absent learners
        // Sprints with absent sessions stay active (admin can force-complete)
        for (const sid of uniqueSprintIds) {
          if (!absentSprintIds.has(sid)) {
            await checkSprintCompletion(supabaseClient, sid, session.session_number, debugLog);
          } else {
            debugLog.push(`[SC] Sprint ${sid}: has absent learner — sprint stays active (not completed)`);
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            session_completed: true,
            graded_count: fullyGradedStudents,
            total_students: totalStudents,
            absent_count: absentCount,
            per_student_grades: true,
            debug: debugLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // ⛔ Partial grading — grades ARE saved, but session stays open
        debugLog.push(`[4] Partial grading: ${fullyGradedStudents}/${presentStudents} present students fully graded (${absentCount} absent). Session NOT completed.`);

        return new Response(
          JSON.stringify({
            success: true,
            session_completed: false,
            graded_count: fullyGradedStudents,
            present_students: presentStudents,
            absent_count: absentCount,
            total_students: totalStudents,
            message: `${fullyGradedStudents}/${presentStudents} học viên có mặt đã được chấm đầy đủ. Cần chấm hết ${presentStudents} học viên có mặt để hoàn thành buổi học.`,
            debug: debugLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── CASE B: No class_id → grade directly on sprint_session (1:1 session, Sessions 2 & 3) ──
    if (grades && Array.isArray(grades) && grades.length === 1) {
      const g = grades[0];

      // ⛔ Only grade if feedback is non-empty
      if (!g.feedback || g.feedback.trim().length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            session_completed: false,
            message: "Cần nhập nhận xét trước khi gửi đánh giá.",
            debug: debugLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      debugLog.push(`[3b] Direct grading: grade=${g.grade}, feedback=${g.feedback.substring(0, 30)}...`);

      await supabaseClient
        .from("sprint_sessions")
        .update({
          completion_rating: g.grade,
          feedback: g.feedback,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", session_id);

      debugLog.push(`[4b] Session COMPLETED directly`);

      const { data: sprintData } = await supabaseClient
        .from("learning_sprints")
        .select("sprint_number, enrollment_id")
        .eq("id", session.sprint_id)
        .maybeSingle();

      if (sprintData?.enrollment_id) {
        const { data: enrollData } = await supabaseClient
          .from("enrollments")
          .select("learner_id")
          .eq("id", sprintData.enrollment_id)
          .maybeSingle();

        if (enrollData?.learner_id) {
          await supabaseClient.from("notifications").insert({
            user_id: enrollData.learner_id,
            title: "Buổi học đã được đánh giá",
            message: `Giáo viên đã đánh giá buổi ${session.session_number} (Sprint ${sprintData.sprint_number}): ${g.grade}/5 sao!`,
            type: "feedback",
            is_read: false,
            created_at: new Date().toISOString(),
          });
        }
      }

      await supabaseClient.from("notifications").insert({
        user_id: teacher_id,
        title: "Đã hoàn thành đánh giá",
        message: `Bạn đã đánh giá buổi ${session.session_number} — ${g.grade}/5 sao`,
        type: "session_complete",
        is_read: false,
        created_at: new Date().toISOString(),
      });

      await checkSprintCompletion(supabaseClient, session.sprint_id, session.session_number, debugLog);

      return new Response(
        JSON.stringify({
          success: true,
          session_completed: true,
          graded_count: 1,
          total_students: 1,
          debug: debugLog,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "No valid grades or lesson_summary provided", debug: debugLog }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    debugLog.push(`[FATAL] ${err instanceof Error ? err.message : String(err)}`);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: err instanceof Error ? err.message : String(err), debug: debugLog }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function checkSprintCompletion(
  supabaseClient: ReturnType<typeof createClient>,
  sprintId: string,
  sessionNumber: number,
  debugLog: string[]
) {
  const { data: sprintRow } = await supabaseClient
    .from("learning_sprints")
    .select("status")
    .eq("id", sprintId)
    .maybeSingle();

  if (sprintRow?.status === "completed") {
    debugLog.push("[SC] Sprint already completed — late feedback only, skip progression");
    return;
  }

  const { data: allSessions } = await supabaseClient
    .from("sprint_sessions")
    .select("session_number, status, session_type")
    .eq("sprint_id", sprintId);

  debugLog.push(`[SC] Sprint ${sprintId} sessions: ${allSessions?.length || 0}, statuses: ${JSON.stringify(allSessions?.map((s: any) => `${s.session_number}:${s.status}`))}`);

  // ⛔ ONLY complete sprint when ALL 3 sessions are truly "completed" (NOT "absent")
  // Absent sessions mean the learner missed class — sprint stays active until admin force-completes
  if (allSessions && allSessions.length === 3 && allSessions.every((s: any) => s.status === "completed")) {
    debugLog.push("[SC] All 3 sessions completed — completing sprint!");

    await supabaseClient
      .from("learning_sprints")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", sprintId);

    const { data: sprintData } = await supabaseClient
      .from("learning_sprints")
      .select("sprint_number, enrollment_id")
      .eq("id", sprintId)
      .maybeSingle();

    if (sprintData) {
      const { data: enrollData } = await supabaseClient
        .from("enrollments")
        .select("course_id, learner_id")
        .eq("id", sprintData.enrollment_id)
        .maybeSingle();

      if (enrollData?.course_id) {
        const { data: courseData } = await supabaseClient
          .from("courses")
          .select("total_sprints")
          .eq("id", enrollData.course_id)
          .maybeSingle();

        const totalSprints = courseData?.total_sprints || 24;

        if (sprintData.sprint_number >= totalSprints) {
          await supabaseClient
            .from("enrollments")
            .update({ status: "completed" })
            .eq("id", sprintData.enrollment_id);

          if (enrollData.learner_id) {
            await supabaseClient.from("notifications").insert({
              user_id: enrollData.learner_id,
              title: "🎉 Chúc Mừng! Bạn Đã Hoàn Thành Khóa Học!",
              message: `Tuyệt vời! Bạn đã hoàn thành tất cả ${totalSprints} Sprint!`,
              type: "system",
              is_read: false,
              created_at: new Date().toISOString(),
            });
          }
        } else {
          const { data: genResult, error: genErr } = await supabaseClient.functions.invoke("auto-generate-sprints", {
            body: { enrollment_id: sprintData.enrollment_id, sprint_number: sprintData.sprint_number + 1 },
          });
          if (genErr) {
            debugLog.push(`[SC-ERR] Next sprint generation failed: ${genErr.message}`);
          } else {
            debugLog.push(`[SC] Next sprint generated: ${JSON.stringify(genResult)}`);
          }
        }
      }
    }
  } else {
    const hasAbsent = allSessions?.some((s: any) => s.status === "absent");
    if (hasAbsent) {
      debugLog.push("[SC] Sprint has absent session(s) — sprint NOT completed (requires admin force-complete)");
    }
  }
}
