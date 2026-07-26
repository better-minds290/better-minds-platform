import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TimeSlot {
  dayOfWeek: number;
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
}

interface TeacherCandidate {
  teacherId: string;
  currentLoad: number;
  slots: TimeSlot[];
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
  switch (preferred?.toLowerCase()) {
    case "morning": return { startHour: 6, endHour: 12 };
    case "afternoon": return { startHour: 12, endHour: 17 };
    case "evening": return { startHour: 17, endHour: 22 };
    default: return { startHour: 8, endHour: 20 };
  }
}

function findBestSlot(
  slots: TimeSlot[],
  preferredRange: { startHour: number; endHour: number },
  deadlineDate: Date,
  minDaysFromNow: number,
  sessionDurationHours: number
): { scheduledAt: Date; dayOfWeek: number } | null {
  const now = new Date();
  const maxDate = new Date(deadlineDate);
  const minDate = new Date(now.getTime() + minDaysFromNow * 24 * 60 * 60 * 1000);

  const candidates: Array<{ scheduledAt: Date; dayOfWeek: number; score: number }> = [];

  for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = getVnDayOfWeek(d);

    for (const slot of slots) {
      if (slot.dayOfWeek !== dayOfWeek) continue;

      const overlapStart = Math.max(slot.startHour + slot.startMin / 60, preferredRange.startHour);
      const overlapEnd = Math.min(slot.endHour + slot.endMin / 60, preferredRange.endHour);

      if (overlapEnd - overlapStart >= sessionDurationHours) {
        const sessionHour = Math.floor(overlapStart + (overlapEnd - overlapStart - sessionDurationHours) / 2);
        const sessionDate = new Date(d);
        // Store VN-local time properly: set UTC hours to (VN hour - 7)
        sessionDate.setUTCHours(sessionHour - 7, 0, 0, 0);

        const prefCenter = (preferredRange.startHour + preferredRange.endHour) / 2;
        const hourScore = -Math.abs(sessionHour - prefCenter);
        const dayScore = -(sessionDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

        candidates.push({
          scheduledAt: sessionDate,
          dayOfWeek,
          score: hourScore + dayScore * 0.1,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return { scheduledAt: candidates[0].scheduledAt, dayOfWeek: candidates[0].dayOfWeek };
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

    const body = await req.json();
    const { sprint_id } = body;

    if (!sprint_id) {
      return new Response(JSON.stringify({ error: "Missing sprint_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: sprint, error: sprintError } = await supabaseAdmin
      .from("learning_sprints")
      .select("id, enrollment_id, sprint_number, deadline_session2, deadline_session3")
      .eq("id", sprint_id)
      .maybeSingle();

    if (sprintError || !sprint) {
      return new Response(JSON.stringify({ error: "Sprint not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: enrollment } = await supabaseAdmin
      .from("enrollments")
      .select("id, learner_id, preferred_time")
      .eq("id", sprint.enrollment_id)
      .maybeSingle();

    if (!enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const preferredRange = preferredTimeToHours(enrollment.preferred_time || "");

    const { data: sessions } = await supabaseAdmin
      .from("sprint_sessions")
      .select("id, session_number, session_type")
      .eq("sprint_id", sprint_id)
      .in("session_number", [2, 3])
      .order("session_number", { ascending: true });

    if (!sessions || sessions.length === 0) {
      return new Response(JSON.stringify({ error: "No sessions to schedule" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results: Array<{
      session_number: number;
      session_type: string;
      teacher_id: string | null;
      teacher_name: string | null;
      scheduled_at: string | null;
      status: string;
    }> = [];

    const todayStr = new Date().toISOString().split("T")[0];

    for (const session of sessions) {
      const teacherRole = session.session_type === "vietnamese_teacher"
        ? "vietnamese_teacher"
        : "foreign_teacher";

      const { data: teachers } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, default_meeting_link")
        .eq("role", teacherRole);

      if (!teachers || teachers.length === 0) {
        results.push({
          session_number: session.session_number,
          session_type: session.session_type,
          teacher_id: null,
          teacher_name: null,
          scheduled_at: null,
          status: "no_teacher_available",
        });
        continue;
      }

      const teacherIds = teachers.map((t) => t.id);
      const { data: availability } = await supabaseAdmin
        .from("teacher_availability")
        .select("teacher_id, day_of_week, start_time, end_time")
        .in("teacher_id", teacherIds)
        .eq("is_active", true)
        .gte("date", todayStr);

      const { data: upcomingSessions } = await supabaseAdmin
        .from("sprint_sessions")
        .select("teacher_id")
        .in("teacher_id", teacherIds)
        .in("status", ["in_progress", "locked", "available"])
        .not("teacher_id", "is", null);

      const loadMap = new Map<string, number>();
      teacherIds.forEach((id) => loadMap.set(id, 0));
      (upcomingSessions || []).forEach((s) => {
        loadMap.set(s.teacher_id, (loadMap.get(s.teacher_id) || 0) + 1);
      });

      const candidates: TeacherCandidate[] = teachers.map((t) => {
        const teacherSlots = (availability || [])
          .filter((a) => a.teacher_id === t.id)
          .map((a) => {
            const start = parseTime(a.start_time);
            const end = parseTime(a.end_time);
            return {
              dayOfWeek: a.day_of_week,
              startHour: start.hour,
              startMin: start.min,
              endHour: end.hour,
              endMin: end.min,
            };
          });

        return {
          teacherId: t.id,
          currentLoad: loadMap.get(t.id) || 0,
          slots: teacherSlots,
        };
      }).filter((c) => c.slots.length > 0);

      if (candidates.length === 0) {
        results.push({
          session_number: session.session_number,
          session_type: session.session_type,
          teacher_id: null,
          teacher_name: null,
          scheduled_at: null,
          status: "no_availability",
        });
        continue;
      }

      candidates.sort((a, b) => a.currentLoad - b.currentLoad);

      const deadlineField = session.session_number === 2
        ? sprint.deadline_session2
        : sprint.deadline_session3;

      const deadlineDate = deadlineField ? new Date(deadlineField) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const minDaysFromNow = session.session_number === 2 ? 1 : 3;

      let bestAssignment: { teacherId: string; teacherName: string; scheduledAt: Date; meetingLink: string | null } | null = null;

      for (const candidate of candidates) {
        const slot = findBestSlot(candidate.slots, preferredRange, deadlineDate, minDaysFromNow, 1);

        if (slot) {
          const teacherData = teachers.find((t) => t.id === candidate.teacherId);
          bestAssignment = {
            teacherId: candidate.teacherId,
            teacherName: teacherData?.full_name || "Unknown",
            scheduledAt: slot.scheduledAt,
            meetingLink: teacherData?.default_meeting_link || null,
          };
          break;
        }
      }

      if (bestAssignment) {
        const updatePayload: Record<string, unknown> = {
          teacher_id: bestAssignment.teacherId,
          scheduled_at: bestAssignment.scheduledAt.toISOString(),
        };
        if (bestAssignment.meetingLink) {
          updatePayload.meeting_link = bestAssignment.meetingLink;
        }

        const { error: updateError } = await supabaseAdmin
          .from("sprint_sessions")
          .update(updatePayload)
          .eq("id", session.id);

        if (updateError) {
          console.error("Failed to update session " + session.id + ":", updateError);
          results.push({
            session_number: session.session_number,
            session_type: session.session_type,
            teacher_id: null,
            teacher_name: null,
            scheduled_at: null,
            status: "update_failed",
          });
        } else {
          results.push({
            session_number: session.session_number,
            session_type: session.session_type,
            teacher_id: bestAssignment.teacherId,
            teacher_name: bestAssignment.teacherName,
            scheduled_at: bestAssignment.scheduledAt.toISOString(),
            status: "scheduled",
          });
        }
      } else {
        const fallbackTeacherId = candidates[0].teacherId;
        const fallbackTeacher = teachers.find((t) => t.id === fallbackTeacherId);
        const fallbackTeacherName = fallbackTeacher?.full_name || "Unknown";

        const updatePayload: Record<string, unknown> = {
          teacher_id: fallbackTeacherId,
          scheduled_at: deadlineDate.toISOString(),
        };
        if (fallbackTeacher?.default_meeting_link) {
          updatePayload.meeting_link = fallbackTeacher.default_meeting_link;
        }

        const { error: updateError } = await supabaseAdmin
          .from("sprint_sessions")
          .update(updatePayload)
          .eq("id", session.id);

        if (!updateError) {
          results.push({
            session_number: session.session_number,
            session_type: session.session_type,
            teacher_id: fallbackTeacherId,
            teacher_name: fallbackTeacherName,
            scheduled_at: deadlineDate.toISOString(),
            status: "no_slot_fallback_to_deadline",
          });
        } else {
          results.push({
            session_number: session.session_number,
            session_type: session.session_type,
            teacher_id: null,
            teacher_name: null,
            scheduled_at: null,
            status: "update_failed",
          });
        }
      }
    }

    const scheduledSessions = results.filter((r) => r.teacher_name && r.scheduled_at);
    if (scheduledSessions.length > 0 && enrollment) {
      const sessionList = scheduledSessions
        .map((s) => "Session " + s.session_number + " with " + s.teacher_name + " on " + new Date(s.scheduled_at!).toLocaleDateString("en-US", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))
        .join("; ");

      await supabaseAdmin.from("notifications").insert({
        user_id: enrollment.learner_id,
        title: "Sessions Scheduled — Sprint " + sprint.sprint_number,
        message: "Your upcoming sessions have been scheduled: " + sessionList + ". Check your dashboard for details!",
        type: "system",
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sprint_id,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
