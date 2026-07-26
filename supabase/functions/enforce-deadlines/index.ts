import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(
  supabaseUrl: string,
  supabaseKey: string,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  try {
    const res = await fetch(supabaseUrl + "/functions/v1/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + supabaseKey,
      },
      body: JSON.stringify({ to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getPauseThreshold(supabaseAdmin: ReturnType<typeof createClient>): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", "missed_deadline_pause_threshold")
      .maybeSingle();

    if (error || !data?.value) return 2;
    const val = data.value as { count?: number };
    return val.count || 2;
  } catch {
    return 2;
  }
}

async function notifyAdmins(
  supabaseAdmin: ReturnType<typeof createClient>,
  learnerName: string,
  learnerId: string,
  sprintNumber: number,
  missedCount: number,
  pauseThreshold: number,
  now: string
) {
  try {
    const { data: admins, error: adminError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("role", "admin");

    if (adminError || !admins || admins.length === 0) return;

    const title = "Learner Auto-Paused";
    const message =
      learnerName +
      " has been automatically paused after missing " +
      missedCount +
      " deadline" +
      (missedCount > 1 ? "s" : "") +
      " in a row (threshold: " +
      pauseThreshold +
      "). Last missed: Sprint " +
      sprintNumber +
      ".";

    const notifications = admins.map((admin) => ({
      user_id: admin.id,
      title,
      message,
      type: "auto_pause",
      is_read: false,
      created_at: now,
    }));

    await supabaseAdmin.from("notifications").insert(notifications);
  } catch {
    // Non-critical
  }
}

async function transitionSessionsToAwaitingFeedback(
  supabaseAdmin: ReturnType<typeof createClient>,
  now: Date,
  results: string[]
) {
  // BATCH MODE: Find ALL in_progress sessions whose scheduled time + 1h has passed
  const { data: staleSessions } = await supabaseAdmin
    .from("sprint_sessions")
    .select("id, session_number, scheduled_at, status, class_id, sprint_id")
    .eq("status", "in_progress")
    .not("scheduled_at", "is", null);

  if (!staleSessions || staleSessions.length === 0) {
    results.push("[BATCH] No in_progress sessions found");
    return;
  }

  let transitionedCount = 0;
  for (const session of staleSessions) {
    const sessionTime = new Date(session.scheduled_at);
    const sessionEndTime = new Date(sessionTime.getTime() + 1 * 60 * 60 * 1000);

    if (sessionEndTime.getTime() < now.getTime()) {
      await supabaseAdmin
        .from("sprint_sessions")
        .update({ status: "awaiting_feedback" })
        .eq("id", session.id);

      results.push("[BATCH] Session " + session.id + " (S" + session.session_number + "): in_progress → awaiting_feedback");
      transitionedCount++;

      // Create attendance records if class exists
      if (session.class_id) {
        const { data: enrollments } = await supabaseAdmin
          .from("class_enrollments")
          .select("student_id")
          .eq("class_id", session.class_id);

        if (enrollments && enrollments.length > 0) {
          const { data: schedule } = await supabaseAdmin
            .from("class_schedules")
            .select("id")
            .eq("class_id", session.class_id)
            .maybeSingle();

          const scheduleId = schedule?.id || null;

          for (const enr of enrollments) {
            const { data: existing } = await supabaseAdmin
              .from("session_attendance")
              .select("id")
              .eq("schedule_id", scheduleId)
              .eq("student_id", enr.student_id)
              .maybeSingle();

            if (!existing) {
              await supabaseAdmin
                .from("session_attendance")
                .insert({
                  schedule_id: scheduleId,
                  student_id: enr.student_id,
                  class_id: session.class_id,
                  status: "pending_review",
                  marked_at: now.toISOString(),
                });
            }
          }
        }
      }
    }
  }

  results.push("[BATCH] Total transitioned: " + transitionedCount + "/" + staleSessions.length);
}

async function processSingleUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  targetUserId: string,
  now: Date,
  results: string[]
) {
  const pauseThreshold = await getPauseThreshold(supabaseAdmin);

  // 1. Find the learner's active enrollment
  const { data: enrollment, error: enrollError } = await supabaseAdmin
    .from("enrollments")
    .select("id, learner_id, study_commitment, status, missed_deadlines")
    .eq("learner_id", targetUserId)
    .eq("status", "active")
    .maybeSingle();

  if (enrollError || !enrollment) {
    results.push("No active enrollment for user " + targetUserId);
    return;
  }

  const { data: learnerProfile } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("id", targetUserId)
    .maybeSingle();

  const learnerEmail = learnerProfile?.email || "";
  const learnerName = learnerProfile?.full_name || "Learner";

  // Session-level status transitions
  const { data: allSprints } = await supabaseAdmin
    .from("learning_sprints")
    .select("id, sprint_number, status, deadline_session1, deadline_session2, deadline_session3")
    .eq("enrollment_id", enrollment.id)
    .in("status", ["active", "pending", "locked"]);

  if (allSprints && allSprints.length > 0) {
    for (const sprint of allSprints) {
      if (sprint.status === "locked") continue;

      const { data: sessions } = await supabaseAdmin
        .from("sprint_sessions")
        .select("id, session_number, session_type, scheduled_at, status, class_id")
        .eq("sprint_id", sprint.id)
        .in("status", ["active", "in_progress", "locked", "available"]);

      if (!sessions) continue;

      for (const session of sessions) {
        if (session.session_number === 1 && session.session_type === "self_study") {
          continue;
        }

        if (!session.scheduled_at) continue;

        const sessionTime = new Date(session.scheduled_at);
        const sessionEndTime = new Date(sessionTime.getTime() + 1 * 60 * 60 * 1000);

        if (sessionEndTime.getTime() < now.getTime() && session.status !== "awaiting_feedback" && session.status !== "completed") {
          await supabaseAdmin
            .from("sprint_sessions")
            .update({ status: "awaiting_feedback" })
            .eq("id", session.id);

          results.push("Sprint " + sprint.sprint_number + " Session " + session.session_number + ": → awaiting_feedback");

          if (session.class_id) {
            const { data: enrollments } = await supabaseAdmin
              .from("class_enrollments")
              .select("student_id")
              .eq("class_id", session.class_id);

            if (enrollments && enrollments.length > 0) {
              const { data: schedule } = await supabaseAdmin
                .from("class_schedules")
                .select("id")
                .eq("class_id", session.class_id)
                .maybeSingle();

              const scheduleId = schedule?.id || null;

              for (const enr of enrollments) {
                const { data: existing } = await supabaseAdmin
                  .from("session_attendance")
                  .select("id")
                  .eq("schedule_id", scheduleId)
                  .eq("student_id", enr.student_id)
                  .maybeSingle();

                if (!existing) {
                  await supabaseAdmin
                    .from("session_attendance")
                    .insert({
                      schedule_id: scheduleId,
                      student_id: enr.student_id,
                      class_id: session.class_id,
                      status: "pending_review",
                      marked_at: now.toISOString(),
                    });
                }
              }
              results.push("  → Created attendance records for " + enrollments.length + " student(s)");
            }
          }
        }
      }
    }
  }

  // Sprint-level deadline enforcement
  const { data: activeSprints, error: sprintError } = await supabaseAdmin
    .from("learning_sprints")
    .select("id, sprint_number, status, deadline_session1, deadline_session2, deadline_session3")
    .eq("enrollment_id", enrollment.id)
    .eq("status", "active");

  if (sprintError || !activeSprints) return;

  for (const sprint of activeSprints) {
    const deadlines = [
      { label: "Session 1", field: sprint.deadline_session1, num: 1 },
      { label: "Session 2", field: sprint.deadline_session2, num: 2 },
      { label: "Session 3", field: sprint.deadline_session3, num: 3 },
    ];

    for (const dl of deadlines) {
      if (!dl.field) continue;
      const deadlineTime = new Date(dl.field).getTime();
      const hoursLeft = (deadlineTime - now.getTime()) / (1000 * 60 * 60);

      if (hoursLeft > 0 && hoursLeft <= 24 && learnerEmail) {
        const emailHtml = '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
          '<div style="background:#f0f9f0;border-radius:12px;padding:24px;text-align:center">' +
          '<h1 style="color:#166534;margin:0 0 8px;font-size:22px">⏰ Deadline Reminder</h1>' +
          '<p style="color:#166534;font-size:15px;margin:0">Sprint ' + sprint.sprint_number + ' — ' + dl.label + '</p>' +
          '</div>' +
          '<div style="padding:24px 0">' +
          '<p style="font-size:15px;color:#333;margin:0 0 8px">Hi ' + learnerName + ',</p>' +
          '<p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 16px">Your deadline for <strong>' + dl.label + '</strong> of <strong>Sprint ' + sprint.sprint_number + '</strong> is in <strong>' + Math.round(hoursLeft) + ' hours</strong>. Don\'t forget to complete it!</p>' +
          '<p style="font-size:13px;color:#888;margin:0">— The Better Minds Team</p>' +
          '</div></div>';

        await sendEmail(supabaseUrl, supabaseKey, learnerEmail,
          "Deadline Reminder — Sprint " + sprint.sprint_number + ", " + dl.label,
          emailHtml
        );
      }
    }

    const allDeadlines = [
      sprint.deadline_session1 ? new Date(sprint.deadline_session1).getTime() : 0,
      sprint.deadline_session2 ? new Date(sprint.deadline_session2).getTime() : 0,
      sprint.deadline_session3 ? new Date(sprint.deadline_session3).getTime() : 0,
    ];
    const latestDeadline = Math.max(...allDeadlines);
    if (latestDeadline > now.getTime()) continue;

    const { data: completedSessions } = await supabaseAdmin
      .from("sprint_sessions")
      .select("id, session_number")
      .eq("sprint_id", sprint.id)
      .eq("status", "completed");

    if (completedSessions && completedSessions.length > 0) {
      results.push("Sprint " + sprint.sprint_number + ": has completed sessions, skipped");
      continue;
    }

    await supabaseAdmin.from("learning_sprints").update({ status: "expired" }).eq("id", sprint.id);

    const currentMissed: number = enrollment.missed_deadlines || 0;
    const newMissedCount = currentMissed + 1;
    const shouldPause = newMissedCount >= pauseThreshold;

    const enrollmentUpdate: Record<string, unknown> = { missed_deadlines: newMissedCount };
    if (shouldPause) enrollmentUpdate.status = "paused";

    await supabaseAdmin.from("enrollments").update(enrollmentUpdate).eq("id", enrollment.id);

    enrollment.missed_deadlines = newMissedCount;
    if (shouldPause) enrollment.status = "paused";

    const notifTitle = "Sprint " + sprint.sprint_number + " Expired";
    const notifMsg = shouldPause
      ? "You missed the deadline for Sprint " + sprint.sprint_number + ". This is your " + newMissedCount + "nd missed sprint — your enrollment has been paused. Contact your admin to reactivate."
      : "You missed the deadline for Sprint " + sprint.sprint_number + ". Complete the next sprint on time to avoid being paused.";

    await supabaseAdmin.from("notifications").insert({
      user_id: targetUserId, title: notifTitle, message: notifMsg,
      type: "deadline", is_read: false, created_at: now.toISOString(),
    });

    if (shouldPause) {
      await notifyAdmins(
        supabaseAdmin,
        learnerName,
        targetUserId,
        sprint.sprint_number,
        newMissedCount,
        pauseThreshold,
        now.toISOString()
      );
    }

    if (learnerEmail) {
      const emailHtml = '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
        '<div style="background:#fef2f2;border-radius:12px;padding:24px;text-align:center">' +
        '<h1 style="color:#991b1b;margin:0 0 8px;font-size:22px">⚠ Sprint Expired</h1>' +
        '<p style="color:#991b1b;font-size:15px;margin:0">Sprint ' + sprint.sprint_number + '</p>' +
        '</div>' +
        '<div style="padding:24px 0">' +
        '<p style="font-size:15px;color:#333;margin:0 0 8px">Hi ' + learnerName + ',</p>' +
        '<p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 16px">Unfortunately, the deadline for <strong>Sprint ' + sprint.sprint_number + '</strong> has passed without any completed sessions.' +
        (shouldPause ? ' This was your <strong>' + newMissedCount + 'nd</strong> missed sprint, so your enrollment has been <strong>paused</strong>. Please contact your admin to reactivate.' : ' This is your <strong>' + newMissedCount + 'st</strong> missed sprint. One more will pause your enrollment.') +
        '</p><p style="font-size:13px;color:#888;margin:0">— The Better Minds Team</p>' +
        '</div></div>';

      await sendEmail(supabaseUrl, supabaseKey, learnerEmail,
        "Sprint Expired — " + sprint.sprint_number + (shouldPause ? " (Enrollment Paused)" : ""),
        emailHtml
      );
    }

    results.push("Sprint " + sprint.sprint_number + ": expired" + (shouldPause ? " — PAUSED" : "") + " (missed: " + newMissedCount + "/" + pauseThreshold + ")");
  }
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

    const now = new Date();
    const results: string[] = [];

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { body = {}; }

    const targetUserId = body.user_id as string | undefined;
    const batchMode = body.batch as boolean | undefined;

    // BATCH MODE: Process ALL in_progress sessions → awaiting_feedback
    // Triggered when no user_id specified, or when batch=true
    if (!targetUserId || batchMode === true) {
      results.push("[MODE] Batch — processing all sessions");
      await transitionSessionsToAwaitingFeedback(supabaseAdmin, now, results);

      // Also process all active enrollments for sprint-level deadlines
      const { data: allEnrollments } = await supabaseAdmin
        .from("enrollments")
        .select("learner_id")
        .eq("status", "active");

      if (allEnrollments && allEnrollments.length > 0) {
        results.push("[BATCH] Processing " + allEnrollments.length + " active enrollments for deadlines");
        for (const enr of allEnrollments) {
          await processSingleUser(supabaseAdmin, supabaseUrl, supabaseKey, enr.learner_id, now, results);
        }
      }

      return new Response(
        JSON.stringify({ enforced: results.length > 0, batch: true, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SINGLE USER MODE
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await processSingleUser(supabaseAdmin, supabaseUrl, supabaseKey, targetUserId || caller.id, now, results);

    return new Response(
      JSON.stringify({ enforced: results.length > 0, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
