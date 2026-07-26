import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConfirmBody {
  sprint_id: string;
  session2_teacher_id: string;
  session3_teacher_id: string;
}

function getVnDayOfWeek(date: Date): number {
  const vnDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnDate.getUTCDay();
}

function parseTime(timeStr: string): { hour: number; min: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h, min: m };
}

function preferredTimeToHours(preferred: string): { startHour: number; endHour: number } {
  const lower = preferred?.toLowerCase() || "";
  if (lower.includes("morning")) return { startHour: 6, endHour: 12 };
  if (lower.includes("afternoon")) return { startHour: 12, endHour: 17 };
  if (lower.includes("evening")) return { startHour: 17, endHour: 22 };
  return { startHour: 8, endHour: 20 };
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

    const body: ConfirmBody = await req.json();
    const { sprint_id, session2_teacher_id, session3_teacher_id } = body;

    if (!sprint_id || !session2_teacher_id || !session3_teacher_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: sprint_id, session2_teacher_id, session3_teacher_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: sprint } = await supabaseAdmin
      .from("learning_sprints")
      .select("id, sprint_number, enrollment_id, status, deadline_session2, deadline_session3, teacher_preferences")
      .eq("id", sprint_id)
      .maybeSingle();

    if (!sprint) {
      return new Response(JSON.stringify({ error: "Sprint not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: enrollment } = await supabaseAdmin
      .from("enrollments")
      .select("id, learner_id, preferred_time")
      .eq("id", sprint.enrollment_id)
      .eq("learner_id", caller.id)
      .maybeSingle();

    if (!enrollment) {
      return new Response(JSON.stringify({ error: "Not authorized to confirm this sprint" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: teacher2 } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, role, default_meeting_link")
      .eq("id", session2_teacher_id)
      .maybeSingle();

    const { data: teacher3 } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, role, default_meeting_link")
      .eq("id", session3_teacher_id)
      .maybeSingle();

    if (!teacher2 || teacher2.role !== "vietnamese_teacher") {
      return new Response(JSON.stringify({ error: "Session 2 teacher must be a Vietnamese Teacher" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!teacher3 || teacher3.role !== "foreign_teacher") {
      return new Response(JSON.stringify({ error: "Session 3 teacher must be a Foreign Teacher" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const deadlineS2 = sprint.deadline_session2 ? new Date(sprint.deadline_session2) : null;
    const deadlineS3 = sprint.deadline_session3 ? new Date(sprint.deadline_session3) : null;

    let needsExtension = false;
    let extendedDeadlines: { s2: string | null; s3: string | null } = { s2: null, s3: null };

    if (deadlineS2 && deadlineS2 < oneWeekFromNow) {
      const newDeadlineS2 = new Date(oneWeekFromNow);
      needsExtension = true;
      extendedDeadlines.s2 = newDeadlineS2.toISOString();
    }

    if (deadlineS3) {
      const s2Effective = extendedDeadlines.s2 ? new Date(extendedDeadlines.s2) : deadlineS2;
      const minS3 = s2Effective ? new Date(s2Effective.getTime() + 2 * 24 * 60 * 60 * 1000) : oneWeekFromNow;

      if (deadlineS3 < minS3) {
        const newDeadlineS3 = new Date(Math.max(minS3.getTime(), oneWeekFromNow.getTime() + 2 * 24 * 60 * 60 * 1000));
        needsExtension = true;
        extendedDeadlines.s3 = newDeadlineS3.toISOString();
      }
    }

    const { data: sprintFull } = await supabaseAdmin
      .from("learning_sprints")
      .select("deadline_session1")
      .eq("id", sprint_id)
      .maybeSingle();

    let deadlineS1Extended: string | null = null;
    if (sprintFull?.deadline_session1) {
      const dl1 = new Date(sprintFull.deadline_session1);
      if (dl1 < new Date(now.getTime() + 24 * 60 * 60 * 1000)) {
        deadlineS1Extended = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
        needsExtension = true;
      }
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const preferredRange = preferredTimeToHours(enrollment.preferred_time || "");

    const { data: avail2 } = await supabaseAdmin
      .from("teacher_availability")
      .select("day_of_week, start_time, end_time")
      .eq("teacher_id", session2_teacher_id)
      .eq("is_active", true)
      .gte("date", todayStr);

    let scheduledAt2: string | null = null;
    const s2Deadline = extendedDeadlines.s2 ? new Date(extendedDeadlines.s2) : deadlineS2;
    if (s2Deadline && avail2 && avail2.length > 0) {
      const slots = avail2.map((a) => {
        const start = parseTime(a.start_time);
        const end = parseTime(a.end_time);
        return { dayOfWeek: a.day_of_week, startHour: start.hour, startMin: start.min, endHour: end.hour, endMin: end.min };
      });

      const now2 = new Date();
      const minS2 = new Date(now2.getTime() + 1 * 24 * 60 * 60 * 1000);

      for (let d = new Date(minS2); d <= s2Deadline; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = getVnDayOfWeek(d);
        for (const slot of slots) {
          if (slot.dayOfWeek !== dayOfWeek) continue;
          const overlapStart = Math.max(slot.startHour + slot.startMin / 60, preferredRange.startHour);
          const overlapEnd = Math.min(slot.endHour + slot.endMin / 60, preferredRange.endHour);
          if (overlapEnd - overlapStart >= 1) {
            const sessionHour = Math.floor(overlapStart + (overlapEnd - overlapStart - 1) / 2);
            const sessionDate = new Date(d);
            sessionDate.setUTCHours(sessionHour - 7, 0, 0, 0);
            scheduledAt2 = sessionDate.toISOString();
            break;
          }
        }
        if (scheduledAt2) break;
      }
    }

    if (!scheduledAt2 && s2Deadline) {
      scheduledAt2 = s2Deadline.toISOString();
    }

    const { data: avail3 } = await supabaseAdmin
      .from("teacher_availability")
      .select("day_of_week, start_time, end_time")
      .eq("teacher_id", session3_teacher_id)
      .eq("is_active", true)
      .gte("date", todayStr);

    let scheduledAt3: string | null = null;
    const s3Deadline = extendedDeadlines.s3 ? new Date(extendedDeadlines.s3) : deadlineS3;
    if (s3Deadline && avail3 && avail3.length > 0) {
      const slots = avail3.map((a) => {
        const start = parseTime(a.start_time);
        const end = parseTime(a.end_time);
        return { dayOfWeek: a.day_of_week, startHour: start.hour, startMin: start.min, endHour: end.hour, endMin: end.min };
      });

      const minS3 = scheduledAt2 ? new Date(new Date(scheduledAt2).getTime() + 2 * 24 * 60 * 60 * 1000) : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      for (let d = new Date(minS3); d <= s3Deadline; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = getVnDayOfWeek(d);
        for (const slot of slots) {
          if (slot.dayOfWeek !== dayOfWeek) continue;
          const overlapStart = Math.max(slot.startHour + slot.startMin / 60, preferredRange.startHour);
          const overlapEnd = Math.min(slot.endHour + slot.endMin / 60, preferredRange.endHour);
          if (overlapEnd - overlapStart >= 1) {
            const sessionHour = Math.floor(overlapStart + (overlapEnd - overlapStart - 1) / 2);
            const sessionDate = new Date(d);
            sessionDate.setUTCHours(sessionHour - 7, 0, 0, 0);
            scheduledAt3 = sessionDate.toISOString();
            break;
          }
        }
        if (scheduledAt3) break;
      }
    }

    if (!scheduledAt3 && s3Deadline) {
      scheduledAt3 = s3Deadline.toISOString();
    }

    // Sprint stays LOCKED (not active!) until Saturday unlock
    const updatePayload: Record<string, unknown> = {
      status: "locked",
      teacher_preferences: {
        ...(sprint.teacher_preferences || {}),
        confirmed: true,
        confirmedAt: new Date().toISOString(),
        selectedTeachers: {
          session2: { teacherId: session2_teacher_id, teacherName: teacher2.full_name },
          session3: { teacherId: session3_teacher_id, teacherName: teacher3.full_name },
        },
      },
    };

    if (extendedDeadlines.s2) {
      updatePayload.deadline_session2 = extendedDeadlines.s2;
    }
    if (extendedDeadlines.s3) {
      updatePayload.deadline_session3 = extendedDeadlines.s3;
    }
    if (deadlineS1Extended) {
      updatePayload.deadline_session1 = deadlineS1Extended;
    }

    await supabaseAdmin
      .from("learning_sprints")
      .update(updatePayload)
      .eq("id", sprint_id);

    const session2Update: Record<string, unknown> = {
      teacher_id: session2_teacher_id,
      scheduled_at: scheduledAt2,
      status: "locked",
    };
    if (teacher2.default_meeting_link) {
      session2Update.meeting_link = teacher2.default_meeting_link;
    }

    await supabaseAdmin
      .from("sprint_sessions")
      .update(session2Update)
      .eq("sprint_id", sprint_id)
      .eq("session_number", 2);

    const session3Update: Record<string, unknown> = {
      teacher_id: session3_teacher_id,
      scheduled_at: scheduledAt3,
      status: "locked",
    };
    if (teacher3.default_meeting_link) {
      session3Update.meeting_link = teacher3.default_meeting_link;
    }

    await supabaseAdmin
      .from("sprint_sessions")
      .update(session3Update)
      .eq("sprint_id", sprint_id)
      .eq("session_number", 3);

    // DO NOT unlock Session 1 — Sprint will be unlocked on Saturday via sprint-continuity check_saturday_unlock

    await supabaseAdmin.from("notifications").insert({
      user_id: caller.id,
      title: "Sprint " + sprint.sprint_number + " Confirmed!",
      message: "Giáo viên của bạn là " + teacher2.full_name + " (Buổi 2) và " + teacher3.full_name + " (Buổi 3). Sprint sẽ được mở khóa vào Thứ 7 tới. Hãy kiên nhẫn nhé!",
      type: "system",
      is_read: false,
      created_at: new Date().toISOString(),
    });

    for (const tid of [session2_teacher_id, session3_teacher_id]) {
      await supabaseAdmin.from("notifications").insert({
        user_id: tid,
        title: "New Sprint Assigned",
        message: "You have been assigned to Sprint " + sprint.sprint_number + " for a learner. Check your schedule for details.",
        type: "system",
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sprint_id,
      sprint_number: sprint.sprint_number,
      session2: { teacher_id: session2_teacher_id, teacher_name: teacher2.full_name, scheduled_at: scheduledAt2 },
      session3: { teacher_id: session3_teacher_id, teacher_name: teacher3.full_name, scheduled_at: scheduledAt3 },
      deadlines_extended: needsExtension,
      extended_deadlines: extendedDeadlines,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
