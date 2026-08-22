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

function isLearnerBookingWindowOpen(date: Date): boolean {
  const vnDay = getVnDayOfWeek(date);
  return vnDay === 6 || vnDay === 0;
}

function getVnMonth(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCMonth();
}

function getVnDate(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCDate();
}

/** Weekday of a YYYY-MM-DD slot date in Vietnam (UTC+7). Noon avoids UTC midnight shifting the day. */
function weekdayFromSlotDate(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
}

/** Session 2 = Mon–Thu (1–4). Session 3 = Fri–Sun (5, 6, 0). Other session numbers are unchanged. */
function isSlotAllowedForSession(sessionNumber: number, dateStr: string): boolean {
  if (sessionNumber !== 2 && sessionNumber !== 3) return true;
  const dow = weekdayFromSlotDate(dateStr);
  if (sessionNumber === 2) return dow >= 1 && dow <= 4;
  return dow === 0 || dow >= 5;
}

function sessionDayRestrictedError(sessionNumber: number): string {
  if (sessionNumber === 2) return "Session 2 can only be booked on Monday–Thursday.";
  if (sessionNumber === 3) return "Session 3 can only be booked on Friday–Sunday.";
  return "This session cannot be booked on the selected day.";
}

function createSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in edge function environment");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let supabaseClient: ReturnType<typeof createClient>;

  try {
    supabaseClient = createSupabaseClient();
  } catch (envErr: any) {
    console.error("[book-class] ENV ERROR:", envErr.message);
    return new Response(
      JSON.stringify({ error: "Server configuration error", detail: envErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const debugLog: string[] = [];

  try {
    debugLog.push("[0] book-class invoked");

    let body: any;
    try {
      body = await req.json();
      debugLog.push(`[1] body parsed: student_id=${body?.student_id}, session=${body?.sprint_session_id}, teacher=${body?.teacher_id}, date=${body?.date}, is_admin=${body?.is_admin}`);
    } catch (parseErr: any) {
      debugLog.push(`[1-ERR] JSON parse failed: ${parseErr?.message}`);
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", detail: parseErr?.message, debug: debugLog }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { student_id, sprint_session_id, teacher_id, date, start_time, end_time, duration_minutes, is_admin } = body;

    if (!student_id || !sprint_session_id || !teacher_id || !date || !start_time || !end_time) {
      debugLog.push(`[2] Missing fields: student_id=${!!student_id}, session=${!!sprint_session_id}, teacher=${!!teacher_id}, date=${!!date}, start=${!!start_time}, end=${!!end_time}`);
      return new Response(
        JSON.stringify({ error: "Missing required fields", debug: debugLog }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Weekend booking WINDOW guard (Saturday or Sunday in VN time)
    // Admins bypass this check via is_admin flag
    if (!is_admin) {
      const today = new Date();
      if (!isLearnerBookingWindowOpen(today)) {
        const todayDayOfWeek = getVnDayOfWeek(today);
        debugLog.push(`[3] Rejected: today is not a booking window day (day=${todayDayOfWeek})`);
        return new Response(
          JSON.stringify({ error: "Booking is only open on Saturdays and Sundays. Please come back on the weekend.", code: "NOT_BOOKING_DAY", debug: debugLog }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // NOTE: Booking window is weekend-only, but learners can book any day the teacher is available.
    }

    debugLog.push("[3] Weekend booking window check passed" + (is_admin ? " (admin bypass)" : ""));

    // Learner lifecycle guard: only active (or legacy paused) enrollments may book
    const { data: learnerEnrollment, error: enrollStatusErr } = await supabaseClient
      .from("enrollments")
      .select("id, status")
      .eq("learner_id", student_id)
      .order("enrolled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (enrollStatusErr) {
      debugLog.push(`[3b-ERR] enrollment lookup failed: ${enrollStatusErr.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to verify enrollment status", detail: enrollStatusErr.message, debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!learnerEnrollment) {
      debugLog.push("[3b] No enrollment found — reject booking");
      return new Response(
        JSON.stringify({ error: "No active enrollment found. Please enroll in a course first.", code: "NO_ENROLLMENT", debug: debugLog }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (learnerEnrollment.status === "completed") {
      debugLog.push("[3b] Enrollment completed — reject booking");
      return new Response(
        JSON.stringify({ error: "Your course is completed. Booking is no longer available.", code: "ENROLLMENT_COMPLETED", debug: debugLog }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (learnerEnrollment.status !== "active" && learnerEnrollment.status !== "paused") {
      debugLog.push(`[3b] Enrollment status not bookable: ${learnerEnrollment.status}`);
      return new Response(
        JSON.stringify({ error: "Enrollment is not active for booking.", code: "ENROLLMENT_INACTIVE", debug: debugLog }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push(`[3b] Enrollment OK: id=${learnerEnrollment.id}, status=${learnerEnrollment.status}`);

    const { data: sessionData, error: sessionErr } = await supabaseClient
      .from("sprint_sessions")
      .select("id, status, session_number, sprint_id")
      .eq("id", sprint_session_id)
      .maybeSingle();

    if (sessionErr) {
      debugLog.push(`[4-ERR] Session lookup DB error: ${sessionErr.message} (code=${sessionErr.code})`);
      return new Response(
        JSON.stringify({ error: "Database error looking up session", detail: sessionErr.message, debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!sessionData) {
      debugLog.push(`[4-ERR] Session not found: ${sprint_session_id}`);
      return new Response(
        JSON.stringify({ error: "Sprint session not found", debug: debugLog }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push(`[4] Session found: status=${sessionData.status}, number=${sessionData.session_number}`);

    if (sessionData.status !== "available") {
      debugLog.push(`[5] Session not available (current status: ${sessionData.status})`);
      return new Response(
        JSON.stringify({ error: "Session is not available for booking", debug: debugLog }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push("[5] Session available — checking session weekday rule");

    if (!is_admin && !isSlotAllowedForSession(sessionData.session_number, date)) {
      debugLog.push(`[5b] Rejected: session ${sessionData.session_number} cannot book date=${date}`);
      return new Response(
        JSON.stringify({ error: sessionDayRestrictedError(sessionData.session_number), code: "SESSION_DAY_RESTRICTED", debug: debugLog }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push("[5b] Session weekday check passed" + (is_admin ? " (admin bypass)" : ""));
    debugLog.push("[5c] Checking existing schedule");

    const { data: existingSchedule, error: schedLookupErr } = await supabaseClient
      .from("class_schedules")
      .select("id, class_id")
      .eq("teacher_id", teacher_id)
      .eq("date", date)
      .eq("start_time", start_time)
      .maybeSingle();

    if (schedLookupErr) {
      debugLog.push(`[6-ERR] Schedule lookup error: ${schedLookupErr.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to look up schedule", detail: schedLookupErr.message, debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push(`[6] Existing schedule: ${existingSchedule ? 'FOUND (class=' + existingSchedule.class_id + ')' : 'NOT FOUND'}`);

    let classId: string;
    let scheduleId: string | null = existingSchedule?.id ?? null;
    const maxStudents = 2;

    if (existingSchedule) {
      classId = existingSchedule.class_id;

      const { count: enrollmentCount, error: countErr } = await supabaseClient
        .from("class_enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId);

      if (countErr) {
        debugLog.push(`[7-ERR] Enrollment count error: ${countErr.message}`);
        return new Response(
          JSON.stringify({ error: "Failed to count enrollments", detail: countErr.message, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      debugLog.push(`[7] Reuse class ${classId}: enrolled=${enrollmentCount}/${maxStudents}`);

      if ((enrollmentCount || 0) >= maxStudents) {
        debugLog.push(`[7-ERR] Class full`);
        return new Response(
          JSON.stringify({ error: "Class is full", debug: debugLog }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existingEnr } = await supabaseClient
        .from("class_enrollments")
        .select("id")
        .eq("class_id", classId)
        .eq("student_id", student_id)
        .maybeSingle();

      if (existingEnr) {
        debugLog.push(`[7-ERR] Already enrolled`);
        return new Response(
          JSON.stringify({ error: "Already enrolled in this class", debug: debugLog }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      debugLog.push("[7] Creating new class + schedule");

      let teacherName = "Teacher";
      try {
        const { data: tp } = await supabaseClient
          .from("profiles")
          .select("full_name")
          .eq("id", teacher_id)
          .maybeSingle();
        if (tp?.full_name) teacherName = tp.full_name;
      } catch { /* ignore — use default */ }
      debugLog.push(`[8] Teacher name: ${teacherName}`);

      const { data: newClass, error: createErr } = await supabaseClient
        .from("classes")
        .insert({
          teacher_id,
          name: `Session with ${teacherName}`,
          subject: "English",
          level: "B1",
          status: "active",
          max_students: maxStudents,
          duration_minutes: duration_minutes || 60,
        })
        .select()
        .single();

      if (createErr) {
        debugLog.push(`[8-ERR] Class create failed: ${createErr.message} (code=${createErr.code}, details=${createErr.details})`);
        return new Response(
          JSON.stringify({ error: "Failed to create class", detail: createErr.message, code: createErr.code, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      classId = newClass.id;
      debugLog.push(`[9] Class created: id=${classId}`);

      const { data: newSchedule, error: scheduleErr } = await supabaseClient
        .from("class_schedules")
        .insert({
          class_id: classId,
          teacher_id,
          date,
          start_time,
          end_time,
          type: "regular",
          status: "scheduled",
        })
        .select("id")
        .single();

      if (scheduleErr) {
        debugLog.push(`[9-ERR] Schedule create failed: ${scheduleErr.message} (code=${scheduleErr.code})`);
        return new Response(
          JSON.stringify({ error: "Failed to create schedule", detail: scheduleErr.message, code: scheduleErr.code, debug: debugLog }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      scheduleId = newSchedule?.id ?? null;
      debugLog.push(`[10] Schedule created: id=${scheduleId}`);
    }

    debugLog.push("[11] Creating class enrollment");
    const { data: enrollment, error: enrollErr } = await supabaseClient
      .from("class_enrollments")
      .insert({
        class_id: classId,
        student_id,
      })
      .select()
      .single();

    if (enrollErr) {
      debugLog.push(`[11-ERR] Enrollment failed: ${enrollErr.message} (code=${enrollErr.code}, details=${enrollErr.details})`);
      return new Response(
        JSON.stringify({ error: "Failed to create enrollment", detail: enrollErr.message, code: enrollErr.code, debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push(`[12] Enrollment created: id=${enrollment?.id}`);

    // FIX: start_time from DB is already HH:MM:SS, don't append :00
    const scheduledAt = `${date}T${start_time}+07:00`;
    debugLog.push(`[13] Updating sprint_session: status=in_progress, scheduled_at=${scheduledAt}`);

    const { error: updateErr } = await supabaseClient
      .from("sprint_sessions")
      .update({
        class_id: classId,
        teacher_id,
        scheduled_at: scheduledAt,
        status: "in_progress",
      })
      .eq("id", sprint_session_id);

    if (updateErr) {
      debugLog.push(`[13-ERR] Session update failed: ${updateErr.message} (code=${updateErr.code})`);
      return new Response(
        JSON.stringify({ error: "Failed to update session", detail: updateErr.message, code: updateErr.code, debug: debugLog }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    debugLog.push("[14] Sending notifications");

    // Notifications are non-critical — don't fail the booking if they error
    let learnerName = "Student";
    let teacherNameNotif = "Teacher";
    try {
      try {
        const { data: lp } = await supabaseClient.from("profiles").select("full_name").eq("id", student_id).maybeSingle();
        if (lp?.full_name) learnerName = lp.full_name;
      } catch { /* ignore */ }
      try {
        const { data: tp } = await supabaseClient.from("profiles").select("full_name").eq("id", teacher_id).maybeSingle();
        if (tp?.full_name) teacherNameNotif = tp.full_name;
      } catch { /* ignore */ }

      const dateObj = new Date(date + "T00:00:00");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dateDisplay = `${monthNames[getVnMonth(dateObj)]} ${getVnDate(dateObj)}`;
      const sessionUrl = `/dashboard/sprint/${sessionData.sprint_id}/session/${sprint_session_id}`;

      const { error: notifTeacherErr } = await supabaseClient.from("notifications").insert({
        user_id: teacher_id,
        title: "New Booking",
        message: `${learnerName} booked Session ${sessionData.session_number} on ${dateDisplay} at ${start_time}`,
        type: "class", is_read: false, action_url: "/teacher/dashboard", related_schedule_id: scheduleId,
      });
      if (notifTeacherErr) debugLog.push(`[14a] Teacher notif error (non-fatal): ${notifTeacherErr.message}`);

      const { error: notifLearnerErr } = await supabaseClient.from("notifications").insert({
        user_id: student_id,
        title: "Booking Confirmed",
        message: `Session ${sessionData.session_number} booked with ${teacherNameNotif} on ${dateDisplay} at ${start_time}`,
        type: "class", is_read: false, action_url: sessionUrl, related_schedule_id: scheduleId,
      });
      if (notifLearnerErr) debugLog.push(`[14b] Learner notif error (non-fatal): ${notifLearnerErr.message}`);
    } catch (notifErr) {
      debugLog.push(`[14] Notification error (non-fatal): ${notifErr}`);
    }

    debugLog.push("[DONE] Booking successful");

    return new Response(
      JSON.stringify({
        success: true,
        enrollment_id: enrollment.id,
        class_id: classId,
        session_number: sessionData.session_number,
        date,
        start_time,
        end_time,
        duration_minutes: duration_minutes || 60,
        teacher_name: teacherNameNotif,
        debug: debugLog,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    debugLog.push(`[FATAL] ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) debugLog.push(`[FATAL-STACK] ${err.stack}`);
    console.error("[book-class] UNEXPECTED ERROR:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err), debug: debugLog }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
