
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getVnDayOfWeek(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCDay();
}

function getVnMonth(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCMonth();
}

function getVnDate(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCDate();
}

function normalizeTimeHHMM(time: string): string {
  if (!time) return "00:00";
  const parts = String(time).trim().split(":");
  const h = String(parseInt(parts[0] || "0", 10)).padStart(2, "0");
  const m = String(parseInt(parts[1] || "0", 10)).padStart(2, "0");
  return `${h}:${m}`;
}

function buildScheduledAt(dateStr: string, timeStr: string): string {
  const hhmm = normalizeTimeHHMM(timeStr);
  return `${dateStr}T${hhmm}:00+07:00`;
}

function createSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function logDiagnostic(
  supabaseClient: ReturnType<typeof createClient>,
  entry: { action: string; learner_id: string; sprint_session_id: string; step: string; status: "ok" | "error" | "info" | "warn"; detail: string; data?: Record<string, unknown>; }
) {
  console.log(`[DIAG][${entry.action}][${entry.step}] ${entry.status}: ${entry.detail}`, entry.data || "");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let supabaseClient: ReturnType<typeof createClient>;
  try {
    supabaseClient = createSupabaseClient();
  } catch (envErr: any) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const { action, learner_id, sprint_session_id, new_teacher_id, new_date, new_start_time, new_end_time, new_duration_minutes, bypass_saturday_check, teacher_id, date, start_time, end_time, duration_minutes } = body;

    if (!action || !learner_id || !sprint_session_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: action, learner_id, sprint_session_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Block completed learners from operational booking/assign/reschedule actions
    if (action === "reschedule" || action === "admin_assign") {
      const { data: lifecycleEnrollment } = await supabaseClient
        .from("enrollments")
        .select("id, status")
        .eq("learner_id", learner_id)
        .order("enrolled_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lifecycleEnrollment?.status === "completed") {
        return new Response(
          JSON.stringify({ error: "Learner course is completed. Scheduling/booking is no longer available.", code: "ENROLLMENT_COMPLETED" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============================
    // ACTION: reschedule
    // ============================
    if (action === "reschedule") {
      if (!new_teacher_id || !new_date || !new_start_time || !new_end_time) {
        return new Response(JSON.stringify({ error: "Missing new teacher/date/time" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!bypass_saturday_check) {
        if (getVnDayOfWeek(new Date()) !== 6) {
          return new Response(JSON.stringify({ error: "Reschedule is only open on Saturday.", code: "NOT_SATURDAY" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      const { data: sessionData, error: sessionErr } = await supabaseClient.from("sprint_sessions").select("id, status, session_number, sprint_id, teacher_id, class_id").eq("id", sprint_session_id).maybeSingle();
      if (sessionErr || !sessionData) return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (sessionData.status !== "in_progress" && sessionData.status !== "active") return new Response(JSON.stringify({ error: "Only booked sessions can be rescheduled" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const normStart = normalizeTimeHHMM(new_start_time);
      const normEnd = normalizeTimeHHMM(new_end_time);

      if (sessionData.class_id) {
        await supabaseClient.from("class_enrollments").delete().eq("class_id", sessionData.class_id).eq("student_id", learner_id);
      }

      const { data: existingSchedule } = await supabaseClient.from("class_schedules").select("id, class_id").eq("teacher_id", new_teacher_id).eq("date", new_date).eq("start_time", normStart + ":00").maybeSingle();

      let newClassId: string;
      const maxStudents = 2;

      if (existingSchedule) {
        newClassId = existingSchedule.class_id;
        const { count: enrollmentCount } = await supabaseClient.from("class_enrollments").select("*", { count: "exact", head: true }).eq("class_id", newClassId);
        if ((enrollmentCount || 0) >= maxStudents) return new Response(JSON.stringify({ error: "Target class is now full" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        let teacherName = "Teacher";
        try { const { data: tp } = await supabaseClient.from("profiles").select("full_name").eq("id", new_teacher_id).maybeSingle(); if (tp?.full_name) teacherName = tp.full_name; } catch { /* ignore */ }

        const { data: newClass, error: createErr } = await supabaseClient.from("classes").insert({ teacher_id: new_teacher_id, name: `Session with ${teacherName}`, subject: "English", level: "B1", status: "active", max_students: maxStudents, duration_minutes: new_duration_minutes || 60 }).select().single();
        if (createErr) return new Response(JSON.stringify({ error: "Failed to create class", detail: createErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        newClassId = newClass.id;
        const { error: scheduleErr } = await supabaseClient.from("class_schedules").insert({ class_id: newClassId, teacher_id: new_teacher_id, date: new_date, start_time: normStart + ":00", end_time: normEnd + ":00", type: "regular", status: "scheduled" }).select("id").single();
        if (scheduleErr) { await supabaseClient.from("classes").delete().eq("id", newClassId); return new Response(JSON.stringify({ error: "Failed to create schedule" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
      }

      const { error: enrollErr } = await supabaseClient.from("class_enrollments").insert({ class_id: newClassId, student_id: learner_id }).select("id").single();
      if (enrollErr) return new Response(JSON.stringify({ error: "Failed to enroll" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const scheduledAt = buildScheduledAt(new_date, normStart);
      await supabaseClient.from("sprint_sessions").update({ class_id: newClassId, teacher_id: new_teacher_id, scheduled_at: scheduledAt }).eq("id", sprint_session_id);

      let newTeacherName = "Teacher";
      try { const { data: ntp } = await supabaseClient.from("profiles").select("full_name").eq("id", new_teacher_id).maybeSingle(); if (ntp?.full_name) newTeacherName = ntp.full_name; } catch { /* ignore */ }

      try {
        let learnerName = "Student";
        try { const { data: lp } = await supabaseClient.from("profiles").select("full_name").eq("id", learner_id).maybeSingle(); if (lp?.full_name) learnerName = lp.full_name; } catch { /* ignore */ }
        const dateObj = new Date(new_date + "T00:00:00");
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const dateDisplay = `${monthNames[getVnMonth(dateObj)]} ${getVnDate(dateObj)}`;
        const sessionUrl = `/dashboard/sprint/${sessionData.sprint_id}/session/${sprint_session_id}`;

        await supabaseClient.from("notifications").insert({ user_id: new_teacher_id, title: "Học Viên Đổi Sang Lớp Bạn", message: `${learnerName} đã chuyển Buổi ${sessionData.session_number} sang khung giờ của bạn vào ${dateDisplay} lúc ${normStart}`, type: "class", is_read: false, action_url: sessionUrl });
        if (sessionData.teacher_id && sessionData.teacher_id !== new_teacher_id) {
          await supabaseClient.from("notifications").insert({ user_id: sessionData.teacher_id, title: "Học Viên Đã Đổi Giáo Viên", message: `${learnerName} đã chuyển Buổi ${sessionData.session_number} sang giáo viên khác.`, type: "class", is_read: false, action_url: "/teacher/dashboard" });
        }
        await supabaseClient.from("notifications").insert({ user_id: learner_id, title: "Đổi Lịch Thành Công", message: `Buổi ${sessionData.session_number} đã được chuyển sang ${newTeacherName} vào ${dateDisplay} lúc ${normStart}`, type: "class", is_read: false, action_url: sessionUrl });
      } catch { /* non-fatal */ }

      return new Response(JSON.stringify({ success: true, new_class_id: newClassId, new_teacher_name: newTeacherName, date: new_date, start_time: normStart }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================
    // ACTION: admin_assign
    // ============================
    if (action === "admin_assign") {
      // ── ROLE CHECK: verify caller is admin ──
      const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(authHeader);
      if (authError || !caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const { data: callerProfile } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();
      if (!callerProfile || callerProfile.role !== "admin") {
        return new Response(JSON.stringify({ error: "Admin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const REQ = `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      console.log(`[ADMIN-ASSIGN][${REQ}] START — learner=${learner_id}, session=${sprint_session_id}, caller=${caller.id}`);

      const tid = teacher_id;
      const dt = date;
      const stRaw = start_time;
      const etRaw = end_time;

      await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "0-received", status: "info", detail: `Request received`, data: { reqId: REQ, teacher_id: tid, date: dt, start_time: stRaw, end_time: etRaw } });

      if (!tid || !dt || !stRaw || !etRaw) {
        return new Response(JSON.stringify({ error: "Missing teacher_id, date, start_time, or end_time" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const st = normalizeTimeHHMM(stRaw);
      const et = normalizeTimeHHMM(etRaw);
      const stDb = st + ":00";
      const etDb = et + ":00";

      // Step 1: Look up session
      const { data: sessionData, error: sessionErr } = await supabaseClient.from("sprint_sessions").select("id, status, session_number, sprint_id, teacher_id, class_id").eq("id", sprint_session_id).maybeSingle();

      if (sessionErr || !sessionData) {
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "1-session-lookup", status: "error", detail: `Session error: ${sessionErr?.message || "not found"}` });
        return new Response(JSON.stringify({ error: "Sprint session not found", detail: sessionErr?.message }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log(`[ADMIN-ASSIGN][${REQ}] Session found: status=${sessionData.status}, class_id=${sessionData.class_id || "none"}`);
      await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "1-session-lookup", status: "ok", detail: `Session found: status=${sessionData.status}, class_id=${sessionData.class_id || "none"}`, data: { sprint_id: sessionData.sprint_id, session_number: sessionData.session_number } });

      // Step 2: Clean up old enrollment if this session was previously assigned to a different class
      if (sessionData.class_id) {
        const oldClassId = sessionData.class_id;
        console.log(`[ADMIN-ASSIGN][${REQ}] Cleaning old enrollment for class ${oldClassId}`);
        await supabaseClient.from("class_enrollments").delete().eq("class_id", oldClassId).eq("student_id", learner_id);

        // Safety net: clean up old class if empty after removing this enrollment
        const { count: oldRemaining } = await supabaseClient.from("class_enrollments").select("id", { count: "exact", head: true }).eq("class_id", oldClassId);
        if (oldRemaining === 0) {
          console.log(`[ADMIN-ASSIGN][${REQ}] Old class ${oldClassId} is now empty — cleaning up`);
          await supabaseClient.from("class_schedules").delete().eq("class_id", oldClassId);
          await supabaseClient.from("class_materials").delete().eq("class_id", oldClassId);
          await supabaseClient.from("classes").delete().eq("id", oldClassId);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "2-cleanup-empty-class", status: "ok", detail: `Cleaned up empty old class ${oldClassId}` });
        }
      }

      // Step 3: Find or create class + schedule
      const { data: existingSchedule, error: schedLookupErr } = await supabaseClient.from("class_schedules").select("id, class_id, status").eq("teacher_id", tid).eq("date", dt).eq("start_time", stDb).maybeSingle();

      if (schedLookupErr) {
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-schedule-lookup", status: "error", detail: `DB error: ${schedLookupErr.message}` });
        return new Response(JSON.stringify({ error: "Failed to look up schedule", detail: schedLookupErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let classId: string;
      let scheduleId: string | null = null;
      const createdClassIds: string[] = [];
      const createdScheduleIds: string[] = [];
      const maxStudents = 2;

      const canReuseSchedule = existingSchedule && existingSchedule.status !== "completed";

      if (canReuseSchedule) {
        classId = existingSchedule.class_id;
        scheduleId = existingSchedule.id;

        console.log(`[ADMIN-ASSIGN][${REQ}] Reusing class ${classId}, schedule ${scheduleId} (status=${existingSchedule.status})`);
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-reuse-class", status: "info", detail: `Reusing class ${classId}, schedule ${scheduleId}` });

        const { count: enrollmentCount, error: countErr } = await supabaseClient.from("class_enrollments").select("*", { count: "exact", head: true }).eq("class_id", classId);

        if (countErr) {
          console.error(`[ADMIN-ASSIGN][${REQ}] Count enrollments error:`, countErr.message);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-count-enroll", status: "error", detail: `Count error: ${countErr.message}` });
          return new Response(JSON.stringify({ error: "Lỗi kiểm tra sĩ số lớp", detail: countErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        console.log(`[ADMIN-ASSIGN][${REQ}] Class ${classId}: ${enrollmentCount || 0}/${maxStudents} enrolled`);
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-count-enroll", status: "info", detail: `Enrollment count: ${enrollmentCount || 0}/${maxStudents}` });

        const { data: existingEnr } = await supabaseClient.from("class_enrollments").select("id").eq("class_id", classId).eq("student_id", learner_id).maybeSingle();

        if (existingEnr) {
          console.log(`[ADMIN-ASSIGN][${REQ}] Learner ALREADY enrolled in class ${classId} — skipping enrollment, updating session directly`);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-already-enrolled", status: "warn", detail: `Already enrolled in class ${classId} — proceeding to update session` });
        } else {
          if ((enrollmentCount || 0) >= maxStudents) {
            await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-class-full", status: "error", detail: `Class full: ${enrollmentCount}/${maxStudents}` });
            return new Response(JSON.stringify({ error: "Lớp học đã đầy, vui lòng chọn khung giờ khác" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const { data: enrolled, error: enrollErr } = await supabaseClient.from("class_enrollments").insert({ class_id: classId, student_id: learner_id }).select("id").single();

          if (enrollErr || !enrolled) {
            console.error(`[ADMIN-ASSIGN][${REQ}] Enrollment failed:`, enrollErr?.message);
            await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "4-enroll-reuse", status: "error", detail: `Enroll failed: ${enrollErr?.message || "no row"}` });
            return new Response(JSON.stringify({ error: "Không thể xếp học viên vào lớp", detail: enrollErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          console.log(`[ADMIN-ASSIGN][${REQ}] Enrolled learner into existing class ${classId}`);
        }
      } else {
        if (existingSchedule) {
          console.log(`[ADMIN-ASSIGN][${REQ}] Existing schedule is COMPLETED — creating new class instead`);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-completed-schedule", status: "warn", detail: `Schedule ${existingSchedule.id} is completed — creating fresh class` });
        } else {
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-no-schedule", status: "info", detail: `No existing schedule — creating new class` });
        }

        let teacherName = "Teacher";
        try { const { data: tp } = await supabaseClient.from("profiles").select("full_name").eq("id", tid).maybeSingle(); if (tp?.full_name) teacherName = tp.full_name; } catch { /* ignore */ }

        const { data: newClass, error: createErr } = await supabaseClient.from("classes").insert({ teacher_id: tid, name: `Session with ${teacherName}`, subject: "English", level: "B1", status: "active", max_students: maxStudents, duration_minutes: duration_minutes || 60 }).select().single();

        if (createErr) {
          console.error(`[ADMIN-ASSIGN][${REQ}] Class create failed:`, createErr.message, createErr.code);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-create-class", status: "error", detail: `Class create failed: ${createErr.message}`, data: { code: createErr.code } });
          return new Response(JSON.stringify({ error: "Không thể tạo lớp học", detail: createErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        classId = newClass.id;
        createdClassIds.push(classId);
        console.log(`[ADMIN-ASSIGN][${REQ}] Class created: ${classId}`);

        const { data: newSchedule, error: scheduleErr } = await supabaseClient.from("class_schedules").insert({ class_id: classId, teacher_id: tid, date: dt, start_time: stDb, end_time: etDb, type: "regular", status: "scheduled" }).select("id").single();

        if (scheduleErr) {
          console.error(`[ADMIN-ASSIGN][${REQ}] Schedule create failed:`, scheduleErr.message);
          await supabaseClient.from("classes").delete().eq("id", classId);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "3-create-schedule", status: "error", detail: `Schedule create failed: ${scheduleErr.message}` });
          return new Response(JSON.stringify({ error: "Không thể tạo lịch học", detail: scheduleErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        scheduleId = newSchedule?.id ?? null;
        if (scheduleId) createdScheduleIds.push(scheduleId);
        console.log(`[ADMIN-ASSIGN][${REQ}] Schedule created: ${scheduleId}`);

        const { data: enrolled, error: enrollErr } = await supabaseClient.from("class_enrollments").insert({ class_id: classId, student_id: learner_id }).select("id").single();

        if (enrollErr || !enrolled) {
          console.error(`[ADMIN-ASSIGN][${REQ}] Enrollment failed:`, enrollErr?.message);
          await supabaseClient.from("class_schedules").delete().eq("id", scheduleId);
          await supabaseClient.from("classes").delete().eq("id", classId);
          await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "4-enroll-new", status: "error", detail: `Enroll failed: ${enrollErr?.message || "no row"}` });
          return new Response(JSON.stringify({ error: "Không thể xếp học viên vào lớp", detail: enrollErr?.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.log(`[ADMIN-ASSIGN][${REQ}] Enrolled learner into new class ${classId}`);
      }

      // Step 5: Update sprint_session
      const scheduledAt = buildScheduledAt(dt, st);
      console.log(`[ADMIN-ASSIGN][${REQ}] Updating session: class_id=${classId}, teacher_id=${tid}, scheduled_at=${scheduledAt}`);

      const updatePayload = { class_id: classId, teacher_id: tid, scheduled_at: scheduledAt, status: "in_progress" };

      const { data: updatedRows, error: updateErr } = await supabaseClient.from("sprint_sessions").update(updatePayload).eq("id", sprint_session_id).select("id, class_id, teacher_id, scheduled_at, status, sprint_id, session_number");

      if (updateErr) {
        console.error(`[ADMIN-ASSIGN][${REQ}] Session update ERROR:`, updateErr.message, updateErr.code);
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "5-update-session", status: "error", detail: `Update error: ${updateErr.message}`, data: { code: updateErr.code } });
        if (createdClassIds.length > 0) {
          for (const sid of createdScheduleIds) await supabaseClient.from("class_schedules").delete().eq("id", sid);
          for (const cid of createdClassIds) await supabaseClient.from("classes").delete().eq("id", cid);
        }
        return new Response(JSON.stringify({ error: "Không thể cập nhật buổi học", detail: updateErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!updatedRows || updatedRows.length === 0) {
        console.error(`[ADMIN-ASSIGN][${REQ}] Session update returned 0 rows!`);
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "5-update-session", status: "error", detail: "Update affected 0 rows" });
        if (createdClassIds.length > 0) {
          for (const sid of createdScheduleIds) await supabaseClient.from("class_schedules").delete().eq("id", sid);
          for (const cid of createdClassIds) await supabaseClient.from("classes").delete().eq("id", cid);
        }
        return new Response(JSON.stringify({ error: "Không thể cập nhật buổi học — không tìm thấy session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const updated = updatedRows[0];
      console.log(`[ADMIN-ASSIGN][${REQ}] Session updated OK — status=${updated.status}, class_id=${updated.class_id}`);

      // Verification with retry
      let verifyRow: any = null;
      for (let retry = 0; retry < 3; retry++) {
        if (retry > 0) await new Promise(r => setTimeout(r, 800));
        const result = await supabaseClient.from("sprint_sessions").select("id, status, class_id, teacher_id, scheduled_at").eq("id", sprint_session_id).maybeSingle();
        verifyRow = result.data;
        if (!result.error && verifyRow && verifyRow.status === "in_progress") break;
      }

      if (!verifyRow || verifyRow.status !== "in_progress") {
        console.error(`[ADMIN-ASSIGN][${REQ}] VERIFICATION FAILED — status=${verifyRow?.status || "not found"}`);
        await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "5-verify", status: "error", detail: `Verification failed: status=${verifyRow?.status || "not found"}` });
        return new Response(JSON.stringify({ error: "Xếp lịch không thành công — dữ liệu không được lưu" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log(`[ADMIN-ASSIGN][${REQ}] VERIFICATION PASSED`);
      await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "5-verify", status: "ok", detail: `Verified: status=in_progress, class_id=${verifyRow.class_id}` });

      // ── Step 6: Look up sprint content from course_sprint_templates ──
      let sessionTitle: string | null = null;
      let sessionDescription: string | null = null;
      let sessionMaterials: Array<{ file_name: string; file_path: string; file_size: number }> = [];

      try {
        const { data: sprintData } = await supabaseClient
          .from("learning_sprints")
          .select("enrollment_id, sprint_number")
          .eq("id", sessionData.sprint_id)
          .maybeSingle();

        if (sprintData) {
          const { data: enrollmentData } = await supabaseClient
            .from("enrollments")
            .select("course_id")
            .eq("id", sprintData.enrollment_id)
            .maybeSingle();

          if (enrollmentData) {
            const { data: templateData } = await supabaseClient
              .from("course_sprint_templates")
              .select("sessions_data")
              .eq("course_id", enrollmentData.course_id)
              .eq("sprint_number", sprintData.sprint_number)
              .maybeSingle();

            if (templateData?.sessions_data && Array.isArray(templateData.sessions_data)) {
              const sessionContent = (templateData.sessions_data as Array<Record<string, unknown>>)
                .find((s) => s.session_number === sessionData.session_number);

              if (sessionContent) {
                sessionTitle = (sessionContent.title as string) || null;
                sessionDescription = (sessionContent.description as string) || null;
                sessionMaterials = (sessionContent.materials as Array<{ file_name: string; file_path: string; file_size: number }>) || [];
                console.log(`[ADMIN-ASSIGN][${REQ}] Sprint content found — title="${sessionTitle}", materials=${sessionMaterials.length}`);
              }
            }
          }
        }
      } catch (contentErr) {
        console.log(`[ADMIN-ASSIGN][${REQ}] Sprint content lookup failed (non-fatal):`, contentErr);
      }

      // ── Step 7: Create class_materials from sprint content (only for newly created classes) ──
      if (createdClassIds.length > 0) {
        if (sessionMaterials.length > 0) {
          try {
            const materialRows = sessionMaterials.map((mat) => ({
              class_id: classId,
              teacher_id: tid,
              title: mat.file_name,
              description: sessionDescription || sessionTitle || `Buổi ${sessionData.session_number}`,
              file_name: mat.file_name,
              file_url: mat.file_path,
              file_size: mat.file_size || 0,
              file_type: mat.file_name.split(".").pop()?.toLowerCase() || "unknown",
            }));

            const { error: matErr } = await supabaseClient
              .from("class_materials")
              .insert(materialRows);

            if (matErr) {
              console.log(`[ADMIN-ASSIGN][${REQ}] class_materials insert error (non-fatal):`, matErr.message);
            } else {
              console.log(`[ADMIN-ASSIGN][${REQ}] Created ${materialRows.length} class_materials`);
            }
          } catch (matErr) {
            console.log(`[ADMIN-ASSIGN][${REQ}] class_materials error (non-fatal):`, matErr);
          }
        }

        // Also create a descriptive entry if we have title/description but no files
        if (sessionMaterials.length === 0 && (sessionTitle || sessionDescription)) {
          try {
            const { error: descErr } = await supabaseClient
              .from("class_materials")
              .insert({
                class_id: classId,
                teacher_id: tid,
                title: sessionTitle || `Buổi ${sessionData.session_number}`,
                description: sessionDescription || "",
              });

            if (descErr) {
              console.log(`[ADMIN-ASSIGN][${REQ}] class_materials description insert error (non-fatal):`, descErr.message);
            } else {
              console.log(`[ADMIN-ASSIGN][${REQ}] Created descriptive class_material entry`);
            }
          } catch (descErr) {
            console.log(`[ADMIN-ASSIGN][${REQ}] class_materials description error (non-fatal):`, descErr);
          }
        }
      }

      // ── Step 8: Notifications (enhanced with session content) ──
      try {
        let learnerName = "Student";
        let teacherName = "Teacher";
        try { const { data: lp } = await supabaseClient.from("profiles").select("full_name").eq("id", learner_id).maybeSingle(); if (lp?.full_name) learnerName = lp.full_name; } catch { /* ignore */ }
        try { const { data: tp } = await supabaseClient.from("profiles").select("full_name").eq("id", tid).maybeSingle(); if (tp?.full_name) teacherName = tp.full_name; } catch { /* ignore */ }

        const dateObj = new Date(dt + "T00:00:00");
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const dateDisplay = `${dayNames[getVnDayOfWeek(dateObj)]}, ${monthNames[getVnMonth(dateObj)]} ${getVnDate(dateObj)}`;
        const sessionUrl = `/dashboard/sprint/${sessionData.sprint_id}/session/${sprint_session_id}`;

        // Build session label with title if available
        const sessionLabel = sessionTitle
          ? `Buổi ${sessionData.session_number}: "${sessionTitle}"`
          : `Buổi ${sessionData.session_number}`;

        const teacherMsg = sessionTitle
          ? `Admin đã xếp học viên ${learnerName} vào ${sessionLabel} của bạn: ${dateDisplay} lúc ${st}`
          : `Admin đã xếp học viên ${learnerName} vào Buổi ${sessionData.session_number} của bạn: ${dateDisplay} lúc ${st}`;

        const learnerMsg = sessionTitle
          ? `Admin đã xếp ${sessionLabel} với giáo viên ${teacherName} vào ${dateDisplay} lúc ${st}`
          : `Admin đã xếp Buổi ${sessionData.session_number} với giáo viên ${teacherName} vào ${dateDisplay} lúc ${st}`;

        await supabaseClient.from("notifications").insert({ user_id: tid, title: "Học Viên Mới Được Xếp Vào Lớp", message: teacherMsg, type: "class", is_read: false, action_url: sessionUrl, related_schedule_id: scheduleId });
        await supabaseClient.from("notifications").insert({ user_id: learner_id, title: "Lịch Học Đã Được Xếp", message: learnerMsg, type: "class", is_read: false, action_url: sessionUrl, related_schedule_id: scheduleId });

        console.log(`[ADMIN-ASSIGN][${REQ}] Notifications sent (sessionLabel=${sessionLabel})`);
      } catch { /* non-fatal */ }

      console.log(`[ADMIN-ASSIGN][${REQ}] ALL DONE — success`);
      await logDiagnostic(supabaseClient, { action: "admin_assign", learner_id, sprint_session_id, step: "done", status: "ok", detail: "Complete success" });

      return new Response(JSON.stringify({ success: true, class_id: classId, session: verifyRow, verified: true, message: "Admin assigned student successfully!" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[reschedule-booking] FATAL:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
