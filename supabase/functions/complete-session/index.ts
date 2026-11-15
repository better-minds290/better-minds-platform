import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  areAllEnrolledLearnersAbsent,
  canCallerCompleteTaughtSession,
  canCallerSubmitSessionOne,
  isFullyGradedPresent,
  isVerifiedAbsent,
  shouldCompleteClassSchedule,
  shouldPreserveStoredFeedback,
  type EnrolledLearnerState,
} from "../_shared/classAttendancePolicy.ts";

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

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized", debug: debugLog }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized", debug: debugLog }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: callerProfile } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    const { data: callerSprint } = await supabaseClient
      .from("learning_sprints")
      .select("enrollment_id")
      .eq("id", session.sprint_id)
      .maybeSingle();
    let callerSessionLearnerId: string | null = null;
    if (callerSprint?.enrollment_id) {
      const { data: callerEnroll } = await supabaseClient
        .from("enrollments")
        .select("learner_id")
        .eq("id", callerSprint.enrollment_id)
        .maybeSingle();
      callerSessionLearnerId = callerEnroll?.learner_id || null;
    }

    if (session.session_number === 1) {
      if (
        !canCallerSubmitSessionOne({
          callerId: caller.id,
          callerRole: callerProfile?.role || null,
          learnerId: callerSessionLearnerId,
          sessionTeacherId: session.teacher_id,
        })
      ) {
        return new Response(JSON.stringify({ error: "Forbidden", debug: debugLog }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (
      !canCallerCompleteTaughtSession({
        callerId: caller.id,
        callerRole: callerProfile?.role || null,
        sessionTeacherId: session.teacher_id,
      })
    ) {
      return new Response(JSON.stringify({ error: "Forbidden", debug: debugLog }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    if (session.class_id && Array.isArray(grades)) {
      const { data: classEnrollments, error: enrollErr } = await supabaseClient
        .from("class_enrollments")
        .select("student_id")
        .eq("class_id", session.class_id);

      if (enrollErr) {
        return new Response(
          JSON.stringify({ error: "Failed to load class roster", detail: enrollErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const enrolledIds = [...new Set((classEnrollments || []).map((row: { student_id: string }) => row.student_id).filter(Boolean))];
      if (enrolledIds.length === 0) {
        return new Response(
          JSON.stringify({ error: "No learners enrolled in this class", debug: debugLog }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: classSchedules, error: schedListErr } = await supabaseClient
        .from("class_schedules")
        .select("id, class_id, status")
        .eq("class_id", session.class_id);

      if (schedListErr) {
        return new Response(
          JSON.stringify({ error: "Failed to load class schedules", detail: schedListErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!classSchedules || classSchedules.length === 0) {
        return new Response(
          JSON.stringify({ error: "No class_schedule found for this class", debug: debugLog }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (classSchedules.length > 1) {
        return new Response(
          JSON.stringify({ error: "Ambiguous class schedule", debug: debugLog }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const scheduleId = classSchedules[0].id;
      debugLog.push(`[3a] schedule_id=${scheduleId} roster=${enrolledIds.length}`);

      const { data: classSessions, error: classSessErr } = await supabaseClient
        .from("sprint_sessions")
        .select("id, sprint_id, status")
        .eq("class_id", session.class_id);

      if (classSessErr) {
        return new Response(
          JSON.stringify({ error: "Failed to load class sessions", detail: classSessErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const uniqueSprintIds = [...new Set((classSessions || []).map((s: { sprint_id: string }) => s.sprint_id))];
      const { data: sprintRows } = uniqueSprintIds.length
        ? await supabaseClient.from("learning_sprints").select("id, enrollment_id").in("id", uniqueSprintIds)
        : { data: [] as { id: string; enrollment_id: string }[] };

      const sprintEnrollMap = new Map<string, string>();
      (sprintRows || []).forEach((sp: { id: string; enrollment_id: string }) => sprintEnrollMap.set(sp.id, sp.enrollment_id));
      const enrollmentIds = [...new Set((sprintRows || []).map((sp: { enrollment_id: string }) => sp.enrollment_id).filter(Boolean))];
      const { data: enrollRows } = enrollmentIds.length
        ? await supabaseClient.from("enrollments").select("id, learner_id").in("id", enrollmentIds)
        : { data: [] as { id: string; learner_id: string }[] };
      const enrollLearnerMap = new Map<string, string>();
      (enrollRows || []).forEach((e: { id: string; learner_id: string }) => enrollLearnerMap.set(e.id, e.learner_id));

      const sessionByLearner = new Map<string, { id: string; sprint_id: string; status: string }>();
      for (const cs of classSessions || []) {
        const enrollmentId = sprintEnrollMap.get(cs.sprint_id);
        const learnerId = enrollmentId ? enrollLearnerMap.get(enrollmentId) : null;
        if (learnerId) sessionByLearner.set(learnerId, cs);
      }

      const { data: existingAttendance, error: attLoadErr } = await supabaseClient
        .from("session_attendance")
        .select("id, student_id, status, grade, teacher_feedback")
        .eq("schedule_id", scheduleId);

      if (attLoadErr) {
        return new Response(
          JSON.stringify({ error: "Failed to load attendance", detail: attLoadErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const existingMap = new Map<string, { id: string; status: string; grade: number | null; teacher_feedback: string | null }>();
      (existingAttendance || []).forEach((a: { id: string; student_id: string; status: string; grade: number | null; teacher_feedback: string | null }) => {
        existingMap.set(a.student_id, {
          id: a.id,
          status: a.status,
          grade: a.grade,
          teacher_feedback: a.teacher_feedback,
        });
      });

      const enrolledSet = new Set(enrolledIds);
      const validGrades = grades.filter(
        (g: StudentGrade) =>
          g.student_id &&
          enrolledSet.has(g.student_id) &&
          g.grade >= 1 && g.grade <= 5 &&
          g.feedback && g.feedback.trim().length > 0
      );

      debugLog.push(`[3] Received ${grades.length} grade(s), ${validGrades.length} valid for enrolled learners.`);

      let writeFailed = false;
      let gradedCount = 0;
      for (const g of validGrades) {
        const existing = existingMap.get(g.student_id);
        if (existing && shouldPreserveStoredFeedback(existing)) {
          debugLog.push(`[3] Preserving stored feedback for ${g.student_id}`);
          continue;
        }
        if (existing?.status === "absent") {
          debugLog.push(`[3] Skip grade for absent ${g.student_id}`);
          continue;
        }

        if (existing) {
          const { error: updErr } = await supabaseClient
            .from("session_attendance")
            .update({
              grade: g.grade,
              teacher_feedback: g.feedback,
              status: "present",
              marked_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
            .eq("student_id", g.student_id);
          if (updErr) {
            debugLog.push(`[ERR] Update failed for student ${g.student_id}: ${updErr.message}`);
            writeFailed = true;
          } else {
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
            writeFailed = true;
          } else {
            gradedCount++;
          }
        }
      }

      if (writeFailed) {
        return new Response(
          JSON.stringify({ error: "Failed to save one or more grades", session_completed: false, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: allAttendance, error: attReloadErr } = await supabaseClient
        .from("session_attendance")
        .select("id, student_id, grade, teacher_feedback, status")
        .eq("schedule_id", scheduleId);

      if (attReloadErr) {
        return new Response(
          JSON.stringify({ error: "Failed to reload attendance", detail: attReloadErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const learnerStates: EnrolledLearnerState[] = enrolledIds.map((studentId) => {
        const att = (allAttendance || []).find((a: { student_id: string }) => a.student_id === studentId);
        const sess = sessionByLearner.get(studentId);
        return {
          studentId,
          sessionId: sess?.id || null,
          attendanceStatus: att?.status || null,
          sessionStatus: sess?.status || null,
          grade: att?.grade ?? null,
          feedback: att?.teacher_feedback ?? null,
        };
      });

      const allAbsent = areAllEnrolledLearnersAbsent(learnerStates);
      if (validGrades.length === 0 && !allAbsent) {
        return new Response(
          JSON.stringify({
            success: true,
            session_completed: false,
            graded_count: 0,
            total_students: enrolledIds.length,
            message: "No valid grades with feedback provided. Each student needs both a grade and feedback.",
            debug: debugLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const absentSprintIds = new Set<string>();
      const completedSprintIds = new Set<string>();

      for (const learner of learnerStates) {
        const sess = sessionByLearner.get(learner.studentId);
        if (!sess) {
          debugLog.push(`[5] Learner ${learner.studentId}: no matching sprint session, skipped`);
          continue;
        }

        if (isVerifiedAbsent(learner)) {
          if (sess.status !== "absent") {
            const { error: absErr } = await supabaseClient
              .from("sprint_sessions")
              .update({
                status: "absent",
                completed_at: new Date().toISOString(),
                completion_rating: null,
                feedback: "Học viên vắng học",
              })
              .eq("id", sess.id);
            if (absErr) {
              debugLog.push(`[ERR] Absent session update failed ${sess.id}: ${absErr.message}`);
              writeFailed = true;
            }
          }
          absentSprintIds.add(sess.sprint_id);
        } else if (isFullyGradedPresent(learner)) {
          const { error: cmpErr } = await supabaseClient
            .from("sprint_sessions")
            .update({
              completion_rating: learner.grade,
              feedback: learner.feedback,
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", sess.id);
          if (cmpErr) {
            debugLog.push(`[ERR] Complete session update failed ${sess.id}: ${cmpErr.message}`);
            writeFailed = true;
          } else {
            completedSprintIds.add(sess.sprint_id);
          }
        } else {
          debugLog.push(`[5] Learner ${learner.studentId}: not yet handled`);
        }
      }

      if (writeFailed) {
        return new Response(
          JSON.stringify({ error: "Failed to update one or more sprint sessions", session_completed: false, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const classDone = shouldCompleteClassSchedule(learnerStates);
      for (const sid of completedSprintIds) {
        await checkSprintCompletion(supabaseClient, sid, session.session_number, debugLog);
      }
      if (!classDone) {
        const handled = learnerStates.filter((l) => isFullyGradedPresent(l) || isVerifiedAbsent(l)).length;
        debugLog.push(`[4] Partial: ${handled}/${learnerStates.length} enrolled learners handled. Class NOT completed.`);
        return new Response(
          JSON.stringify({
            success: true,
            session_completed: false,
            graded_count: gradedCount,
            total_students: enrolledIds.length,
            absent_count: learnerStates.filter(isVerifiedAbsent).length,
            message: `${handled}/${enrolledIds.length} học viên đã được xử lý. Cần xử lý hết học viên trong lớp để hoàn thành buổi học.`,
            debug: debugLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: schedUpdErr } = await supabaseClient
        .from("class_schedules")
        .update({ status: "completed" })
        .eq("id", scheduleId);
      if (schedUpdErr) {
        return new Response(
          JSON.stringify({ error: "Failed to complete class schedule", detail: schedUpdErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: classEnrollUpdErr } = await supabaseClient
        .from("class_enrollments")
        .update({ status: "completed" })
        .eq("class_id", session.class_id);
      if (classEnrollUpdErr) {
        return new Response(
          JSON.stringify({ error: "Failed to complete class enrollments", detail: classEnrollUpdErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      for (const a of allAttendance || []) {
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

      for (const sid of absentSprintIds) {
        debugLog.push(`[SC] Sprint ${sid}: has absent learner — sprint stays active (not completed)`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          session_completed: true,
          all_absent: allAbsent,
          graded_count: learnerStates.filter(isFullyGradedPresent).length,
          total_students: enrolledIds.length,
          absent_count: learnerStates.filter(isVerifiedAbsent).length,
          per_student_grades: true,
          debug: debugLog,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
