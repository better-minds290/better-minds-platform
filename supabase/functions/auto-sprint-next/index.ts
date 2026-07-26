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

interface TeacherRecommendation {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  role: string;
  currentLoad: number;
  availableSlots: number;
  suggestedDate: string | null;
  matchScore: number;
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

function findBestSlot(
  slots: TimeSlot[],
  preferredRange: { startHour: number; endHour: number },
  deadlineDate: Date,
  minDaysFromNow: number,
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
      if (overlapEnd - overlapStart >= 1) {
        const sessionHour = Math.floor(overlapStart + (overlapEnd - overlapStart - 1) / 2);
        const sessionDate = new Date(d);
        sessionDate.setHours(sessionHour, 0, 0, 0);
        const prefCenter = (preferredRange.startHour + preferredRange.endHour) / 2;
        const hourScore = -Math.abs(sessionHour - prefCenter);
        const dayScore = -(sessionDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
        candidates.push({ scheduledAt: sessionDate, dayOfWeek, score: hourScore + dayScore * 0.1 });
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

    const body = await req.json();
    const { sprint_id } = body;

    const todayStr = new Date().toISOString().split("T")[0];

    if (!sprint_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("id", caller.id)
        .maybeSingle();

      if (!profile) {
        return new Response(JSON.stringify({ error: "Profile not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: enrollment } = await supabaseAdmin
        .from("enrollments")
        .select("id, status, preferred_time")
        .eq("learner_id", caller.id)
        .in("status", ["active", "completed"])
        .order("status", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!enrollment) {
        return new Response(JSON.stringify({ error: "No enrollment found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (enrollment.status === "completed") {
        return new Response(JSON.stringify({
          success: true,
          message: "All sprints completed. Congratulations!",
          all_done: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: sprints } = await supabaseAdmin
        .from("learning_sprints")
        .select("id, sprint_number, status, deadline_session1, deadline_session2, deadline_session3")
        .eq("enrollment_id", enrollment.id)
        .order("sprint_number", { ascending: true });

      if (!sprints || sprints.length === 0) {
        return new Response(JSON.stringify({ error: "No sprints found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const justCompleted = sprints.filter((s) => s.status === "completed").pop();
      const nextPending = sprints.find((s) => s.status === "pending" || s.status === "locked");

      if (!nextPending && justCompleted) {
        try {
          await fetch(
            supabaseUrl + "/functions/v1/sprint-continuity",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + supabaseKey,
              },
              body: JSON.stringify({ action: "check_complete", sprint_id: justCompleted.id }),
            }
          );
        } catch {
          // Non-blocking
        }

        return new Response(JSON.stringify({
          success: true,
          message: "Continuity triggered. Please refresh.",
          trigger_continuity: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!nextPending) {
        return new Response(JSON.stringify({
          success: true,
          message: "All sprints completed. Congratulations!",
          all_done: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (nextPending.status === "locked") {
        try {
          const contRes = await fetch(
            supabaseUrl + "/functions/v1/sprint-continuity",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + supabaseKey,
              },
              body: JSON.stringify({ action: "check_complete", sprint_id: justCompleted?.id || nextPending.id }),
            }
          );

          if (contRes.ok) {
            const contData = await contRes.json();
            return new Response(JSON.stringify({
              success: true,
              sprint: {
                id: nextPending.id,
                sprint_number: nextPending.sprint_number,
                status: "locked",
                deadline_session1: nextPending.deadline_session1,
                deadline_session2: nextPending.deadline_session2,
                deadline_session3: nextPending.deadline_session3,
              },
              recommendations: contData,
              auto_activated: false,
              all_done: false,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } catch {
          // Fall through to manual mode
        }
      }

      if (nextPending.teacher_preferences) {
        return new Response(JSON.stringify({
          success: true,
          sprint: nextPending,
          recommendations: nextPending.teacher_preferences,
          already_generated: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const preferredRange = preferredTimeToHours(enrollment.preferred_time || "");

      const { data: vnTeachers } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "vietnamese_teacher");

      const { data: foreignTeachers } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "foreign_teacher");

      const allTeachers = [...(vnTeachers || []), ...(foreignTeachers || [])];
      
      if (allTeachers.length === 0) {
        return new Response(JSON.stringify({ error: "No teachers available" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const allTeacherIds = allTeachers.map((t) => t.id);

      const { data: availability } = await supabaseAdmin
        .from("teacher_availability")
        .select("teacher_id, day_of_week, start_time, end_time")
        .in("teacher_id", allTeacherIds)
        .eq("is_active", true)
        .gte("date", todayStr);

      const { data: upcomingSessions } = await supabaseAdmin
        .from("sprint_sessions")
        .select("teacher_id")
        .in("teacher_id", allTeacherIds)
        .in("status", ["in_progress", "locked", "available"])
        .not("teacher_id", "is", null);

      const loadMap = new Map<string, number>();
      allTeacherIds.forEach((id) => loadMap.set(id, 0));
      (upcomingSessions || []).forEach((s) => {
        loadMap.set(s.teacher_id, (loadMap.get(s.teacher_id) || 0) + 1);
      });

      const vnRecs: TeacherRecommendation[] = (vnTeachers || []).map((t) => {
        const slots = (availability || [])
          .filter((a) => a.teacher_id === t.id)
          .map((a) => {
            const start = parseTime(a.start_time);
            const end = parseTime(a.end_time);
            return { dayOfWeek: a.day_of_week, startHour: start.hour, startMin: start.min, endHour: end.hour, endMin: end.min };
          });

        const deadline = nextPending.deadline_session2 ? new Date(nextPending.deadline_session2) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const bestSlot = slots.length > 0 ? findBestSlot(slots, preferredRange, deadline, 1) : null;

        return {
          teacherId: t.id,
          teacherName: t.full_name || "Unknown",
          teacherEmail: t.email || "",
          role: "vietnamese_teacher",
          currentLoad: loadMap.get(t.id) || 0,
          availableSlots: slots.length,
          suggestedDate: bestSlot ? bestSlot.scheduledAt.toISOString() : null,
          matchScore: bestSlot ? Math.round((50 + (slots.length * 5) - (loadMap.get(t.id) || 0) * 3)) : 0,
        };
      });

      const foreignRecs: TeacherRecommendation[] = (foreignTeachers || []).map((t) => {
        const slots = (availability || [])
          .filter((a) => a.teacher_id === t.id)
          .map((a) => {
            const start = parseTime(a.start_time);
            const end = parseTime(a.end_time);
            return { dayOfWeek: a.day_of_week, startHour: start.hour, startMin: start.min, endHour: end.hour, endMin: end.min };
          });

        const deadline = nextPending.deadline_session3 ? new Date(nextPending.deadline_session3) : new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
        const bestSlot = slots.length > 0 ? findBestSlot(slots, preferredRange, deadline, 3) : null;

        return {
          teacherId: t.id,
          teacherName: t.full_name || "Unknown",
          teacherEmail: t.email || "",
          role: "foreign_teacher",
          currentLoad: loadMap.get(t.id) || 0,
          availableSlots: slots.length,
          suggestedDate: bestSlot ? bestSlot.scheduledAt.toISOString() : null,
          matchScore: bestSlot ? Math.round((50 + (slots.length * 5) - (loadMap.get(t.id) || 0) * 3)) : 0,
        };
      });

      vnRecs.sort((a, b) => b.matchScore - a.matchScore || a.currentLoad - b.currentLoad);
      foreignRecs.sort((a, b) => b.matchScore - a.matchScore || a.currentLoad - b.currentLoad);

      const topVN = vnRecs.length > 0 ? vnRecs[0] : null;
      const topForeign = foreignRecs.length > 0 ? foreignRecs[0] : null;

      const recommendations = {
        session2: {
          recommended: topVN ? { teacherId: topVN.teacherId, teacherName: topVN.teacherName, suggestedDate: topVN.suggestedDate } : null,
          alternatives: vnRecs.slice(0, 5).map((r) => ({ teacherId: r.teacherId, teacherName: r.teacherName, suggestedDate: r.suggestedDate, matchScore: r.matchScore })),
        },
        session3: {
          recommended: topForeign ? { teacherId: topForeign.teacherId, teacherName: topForeign.teacherName, suggestedDate: topForeign.suggestedDate } : null,
          alternatives: foreignRecs.slice(0, 5).map((r) => ({ teacherId: r.teacherId, teacherName: r.teacherName, suggestedDate: r.suggestedDate, matchScore: r.matchScore })),
        },
        generatedAt: new Date().toISOString(),
        preferredTime: enrollment.preferred_time,
      };

      await supabaseAdmin
        .from("learning_sprints")
        .update({ teacher_preferences: recommendations })
        .eq("id", nextPending.id);

      await supabaseAdmin.from("notifications").insert({
        user_id: caller.id,
        title: "Next Sprint Ready — Choose Your Teachers",
        message: "Sprint " + nextPending.sprint_number + " is ready! Review the teacher recommendations and confirm your schedule. Teacher-led sessions need at least 1 week advance confirmation.",
        type: "system",
        is_read: false,
        created_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({
        success: true,
        sprint: {
          id: nextPending.id,
          sprint_number: nextPending.sprint_number,
          status: nextPending.status,
          deadline_session1: nextPending.deadline_session1,
          deadline_session2: nextPending.deadline_session2,
          deadline_session3: nextPending.deadline_session3,
        },
        recommendations,
        all_done: false,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: sprint } = await supabaseAdmin
      .from("learning_sprints")
      .select("id, sprint_number, enrollment_id, status, teacher_preferences, deadline_session2, deadline_session3")
      .eq("id", sprint_id)
      .maybeSingle();

    if (!sprint) {
      return new Response(JSON.stringify({ error: "Sprint not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (sprint.teacher_preferences) {
      return new Response(JSON.stringify({
        success: true,
        sprint: { id: sprint.id, sprint_number: sprint.sprint_number, status: sprint.status },
        recommendations: sprint.teacher_preferences,
        already_generated: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "No recommendations found. Use auto mode (without sprint_id) to generate." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
