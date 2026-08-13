import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface Learner {
  id: string;
  full_name: string;
  email: string;
}

interface TeacherSlot {
  availability_id: string;
  teacher_id: string;
  teacher_name: string;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  class_id: string | null;
  booked_count: number;
  max_students: number;
}

interface AdminAssignLearnerProps {
  preselectedLearnerId?: string;
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

export default function AdminAssignLearner({ preselectedLearnerId }: AdminAssignLearnerProps) {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [learners, setLearners] = useState<Learner[]>([]);
  const [learnerSearch, setLearnerSearch] = useState("");
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [learnerSessions, setLearnerSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [slots, setSlots] = useState<TeacherSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TeacherSlot | null>(null);

  const [loadingLearners, setLoadingLearners] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ... existing code ...
  const fetchLearners = useCallback(async () => {
    setLoadingLearners(true);
    try {
      const [{ data: profiles }, { data: enrollments }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, is_active")
          .eq("role", "learner")
          .order("full_name"),
        supabase.from("enrollments").select("learner_id, status"),
      ]);

      const activeIds = new Set(
        (enrollments || [])
          .filter((e: any) => e.status === "active" || e.status === "paused")
          .map((e: any) => e.learner_id)
      );
      const completedOnlyIds = new Set(
        (enrollments || [])
          .filter((e: any) => e.status === "completed" && !activeIds.has(e.learner_id))
          .map((e: any) => e.learner_id)
      );

      // Pending (no enrollment) + active; exclude completed-only learners from scheduling
      setLearners(
        (profiles || []).filter((l: any) => l.is_active !== false && !completedOnlyIds.has(l.id))
      );
    } catch (err) {
      console.error("Failed to fetch learners:", err);
    } finally {
      setLoadingLearners(false);
    }
  }, [supabase]);

  useEffect(() => { fetchLearners(); }, [fetchLearners]);

  // Auto-select preselected learner from URL (only once)
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (preselectedLearnerId && learners.length > 0) {
      const learner = learners.find((l) => l.id === preselectedLearnerId);
      if (learner) {
        autoSelectedRef.current = true;
        setSelectedLearner(learner);
        setSelectedSession(null);
        setSelectedSlot(null);
        setSlots([]);
        // Fetch sessions for this learner
        (async () => {
          try {
            const { data: enrollment } = await supabase
              .from("enrollments")
              .select("id")
              .eq("learner_id", learner.id)
              .in("status", ["active", "paused"])
              .order("enrolled_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!enrollment) return;

            const { data: activeSprint } = await supabase
              .from("learning_sprints")
              .select("id")
              .eq("enrollment_id", enrollment.id)
              .eq("status", "active")
              .maybeSingle();

            if (!activeSprint) return;

            const { data: sessions } = await supabase
              .from("sprint_sessions")
              .select("id, session_number, session_type, status, teacher_id, scheduled_at, class_id, sprint:learning_sprints!sprint_id(sprint_number)")
              .eq("sprint_id", activeSprint.id)
              .order("session_number");

            setLearnerSessions(sessions || []);
          } catch {
            // ignore
          }
        })();
      }
    }
  }, [preselectedLearnerId, learners, supabase]);

  const handleSelectLearner = async (learner: Learner) => {
    setSelectedLearner(learner);
    setSelectedSession(null);
    setSelectedSlot(null);
    setSlots([]);

    try {
      // Find learner's active enrollment and sprint with available/booked sessions
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("learner_id", learner.id)
        .in("status", ["active", "paused"])
        .order("enrolled_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!enrollment) {
        setLearnerSessions([]);
        return;
      }

      const { data: activeSprint } = await supabase
        .from("learning_sprints")
        .select("id")
        .eq("enrollment_id", enrollment.id)
        .eq("status", "active")
        .maybeSingle();

      if (!activeSprint) {
        setLearnerSessions([]);
        return;
      }

      const { data: sessions } = await supabase
        .from("sprint_sessions")
        .select("id, session_number, session_type, status, teacher_id, scheduled_at, class_id, sprint:learning_sprints!sprint_id(sprint_number)")
        .eq("sprint_id", activeSprint.id)
        .order("session_number");

      setLearnerSessions(sessions || []);
    } catch (err) {
      console.error("Failed to fetch learner sessions:", err);
    }
  };

  const handleSelectSession = async (sessionId: string, explicitOffset?: number) => {
    setSelectedSession(sessionId);
    setSelectedSlot(null);
    setLoadingSlots(true);

    const effectiveOffset = explicitOffset !== undefined ? explicitOffset : weekOffset;

    try {
      // Get exactly 1 week of teacher availability based on effectiveOffset
      const today = new Date();
      const monday = new Date(today);
      const day = monday.getDay();
      const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
      monday.setDate(diff);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() + effectiveOffset * 7);

      const endDate = new Date(monday);
      endDate.setDate(endDate.getDate() + 6);
      const startStr = monday.toISOString().split("T")[0];
      const endStr = endDate.toISOString().split("T")[0];

      const { data: availData } = await supabase
        .from("teacher_availability")
        .select("id, teacher_id, date, start_time, end_time, duration_minutes, is_active")
        .eq("is_active", true)
        .gte("date", startStr)
        .lte("date", endStr)
        .order("date")
        .order("start_time");

      const teacherIds = [...new Set((availData || []).map((a: any) => a.teacher_id))] as string[];
      const teacherMap = new Map<string, string>();
      if (teacherIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", teacherIds);
        (profiles || []).forEach((p: any) => teacherMap.set(p.id, p.full_name));
      }

      const { data: unavailableDates } = await supabase
        .from("teacher_unavailable_dates")
        .select("teacher_id, date")
        .gte("date", startStr)
        .lte("date", endStr);
      const unavailableSet = new Set<string>();
      (unavailableDates || []).forEach((ud: any) => unavailableSet.add(`${ud.teacher_id}-${ud.date}`));

      const { data: existingSchedules } = await supabase
        .from("class_schedules")
        .select("id, class_id, teacher_id, date, start_time")
        .gte("date", startStr)
        .lte("date", endStr);

      const scheduleClassIds = [...new Set((existingSchedules || []).map((s: any) => s.class_id))] as string[];
      let classDataMap = new Map<string, number>();
      if (scheduleClassIds.length > 0) {
        const { data: classData } = await supabase
          .from("classes")
          .select("id, max_students")
          .in("id", scheduleClassIds);
        (classData || []).forEach((c: any) => classDataMap.set(c.id, c.max_students || 2));
      }

      const { data: allEnrollments } = await supabase
        .from("class_enrollments")
        .select("class_id")
        .in("class_id", scheduleClassIds.length > 0 ? scheduleClassIds : ["none"]);
      const enrollmentCounts: Record<string, number> = {};
      (allEnrollments || []).forEach((e: any) => {
        enrollmentCounts[e.class_id] = (enrollmentCounts[e.class_id] || 0) + 1;
      });

      const scheduleLookup = new Map<string, { classId: string; booked: number; max: number }>();
      (existingSchedules || []).forEach((s: any) => {
        const key = `${s.teacher_id}-${s.date}-${s.start_time}`;
        scheduleLookup.set(key, {
          classId: s.class_id,
          booked: enrollmentCounts[s.class_id] || 0,
          max: classDataMap.get(s.class_id) || 2,
        });
      });

      const mappedSlots: TeacherSlot[] = (availData || []).map((a: any) => {
        const classKey = `${a.teacher_id}-${a.date}-${a.start_time}`;
        const cls = scheduleLookup.get(classKey);
        return {
          availability_id: a.id,
          teacher_id: a.teacher_id,
          teacher_name: teacherMap.get(a.teacher_id) || t("auth.adminAssignTeacher"),
          date: a.date,
          start_time: a.start_time,
          end_time: a.end_time,
          duration_minutes: a.duration_minutes || 60,
          class_id: cls?.classId || null,
          booked_count: unavailableSet.has(`${a.teacher_id}-${a.date}`) ? 999 : (cls?.booked || 0),
          max_students: cls?.max || 2,
        };
      });

      // Filter out slots whose end time has already passed (VN timezone)
      const now = new Date();
      const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const futureSlots = mappedSlots.filter((slot) => {
        const slotEnd = new Date(`${slot.date}T${slot.end_time}+07:00`);
        return slotEnd.getTime() > vnNow.getTime();
      });
      setSlots(futureSlots);
    } catch (err) {
      console.error("Failed to fetch slots:", err);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Extracts a human-readable error from a Supabase Functions invoke error
  const getStatusMessage = (status: number): string => {
    const map: Record<number, string> = {
      400: t("auth.adminAssignError400"),
      401: t("auth.adminAssignError401"),
      403: t("auth.adminAssignError403"),
      404: t("auth.adminAssignError404"),
      409: t("auth.adminAssignError409"),
      500: t("auth.adminAssignError500"),
    };
    return map[status] || t("auth.adminAssignErrorHttp", { status });
  };

  const extractErrorMsg = (funcErr: any, fallback: string): string => {
    if (!funcErr) return fallback;

    const status = funcErr.status;

    // Try context first — Supabase v2 FunctionsHttpError nests response in context
    if (funcErr.context) {
      const ctx = funcErr.context;
      try {
        // Case 1: context is a raw JSON string
        if (typeof ctx === "string") {
          try {
            const parsed = JSON.parse(ctx);
            if (parsed.error) return parsed.error;
            if (parsed.detail) return parsed.detail;
            if (parsed.message) return parsed.message;
          } catch { return ctx.substring(0, 200); }
        }
        // Case 2: context.json (pre-parsed by Supabase client)
        if (ctx.json && typeof ctx.json === "object") {
          if (ctx.json.error) return ctx.json.error;
          if (ctx.json.detail) return ctx.json.detail;
          if (ctx.json.message) return ctx.json.message;
          return JSON.stringify(ctx.json).substring(0, 200);
        }
        // Case 3: context.body (raw body string)
        if (ctx.body && typeof ctx.body === "string") {
          try {
            const parsed = JSON.parse(ctx.body);
            if (parsed.error) return parsed.error;
            if (parsed.detail) return parsed.detail;
            if (parsed.message) return parsed.message;
          } catch { return ctx.body.substring(0, 200); }
        }
        // Case 4: context.text
        if (ctx.text && typeof ctx.text === "string") return ctx.text.substring(0, 200);
        // Case 5: context.statusText
        if (ctx.statusText && typeof ctx.statusText === "string") return ctx.statusText;
        // Case 6: context has status directly
        if (ctx.status) {
          return getStatusMessage(ctx.status);
        }
      } catch { /* keep going */ }
    }

    // Fallback: use status code from the error itself
    if (status) {
      return getStatusMessage(status);
    }

    // Try the message as last resort
    if (funcErr.message && typeof funcErr.message === "string" &&
        funcErr.message !== "Edge Function returned a non-2xx status code" &&
        funcErr.message !== "FetchError") {
      return funcErr.message;
    }

    return fallback;
  };

  const callInvoke = async (fnName: string, body: Record<string, any>): Promise<any> => {
    console.log(`[AdminAssign] Calling ${fnName}:`, JSON.stringify(body));
    try {
      const res = await supabase.functions.invoke(fnName, { body });
      console.log(`[AdminAssign] ${fnName} OK:`, JSON.stringify(res?.data));
      return res?.data;
    } catch (invokeErr: any) {
      // Dump EVERYTHING — we need to see the real error
      console.error(`[AdminAssign] ${fnName} FAILED — full dump:`, {
        name: invokeErr?.name,
        message: invokeErr?.message,
        status: invokeErr?.status,
        context: invokeErr?.context,
        contextType: typeof invokeErr?.context,
        contextKeys: invokeErr?.context ? Object.keys(invokeErr.context) : 'null',
        rawString: String(invokeErr),
        allProps: invokeErr ? Object.getOwnPropertyNames(invokeErr) : [],
        protoProps: invokeErr ? Object.getOwnPropertyNames(Object.getPrototypeOf(invokeErr)) : [],
      });
      // Try one more thing: JSON.stringify may reveal hidden props
      try {
        console.error(`[AdminAssign] ${fnName} JSON:`, JSON.stringify(invokeErr));
      } catch { /* can't stringify */ }
      const msg = extractErrorMsg(invokeErr, t("auth.adminAssignFnFailed", { fnName }));
      throw { _from: fnName, message: msg, rawError: invokeErr, status: invokeErr?.status };
    }
  };

  const callRescheduleBooking = async () => {
    return callInvoke("reschedule-booking", {
      action: "admin_assign",
      learner_id: selectedLearner!.id,
      sprint_session_id: selectedSession!,
      teacher_id: selectedSlot!.teacher_id,
      date: selectedSlot!.date,
      start_time: selectedSlot!.start_time,
      end_time: selectedSlot!.end_time,
      duration_minutes: selectedSlot!.duration_minutes,
    });
  };

  const handleAssign = async () => {
    if (!selectedLearner || !selectedSession || !selectedSlot) return;
    setAssigning(true);

    console.log(`[AdminAssign] Assign: learner=${selectedLearner.id}, session=${selectedSession}, status=${selectedSessionData?.status}, teacher=${selectedSlot.teacher_id}, date=${selectedSlot.date}`);

    try {
      console.log("[AdminAssign] Using reschedule-booking (admin_assign)");
      const fnResult = await callRescheduleBooking();
      console.log("[AdminAssign] reschedule-booking response:", JSON.stringify(fnResult));

      // Edge function already verified the DB update internally
      // If it returned success + verified, the data is committed
      if (fnResult?.success && fnResult?.verified) {
        console.log("[AdminAssign] Edge function confirmed DB update — trust & proceed");

        // Optimistic update: immediately mark the session as booked in the list
        setLearnerSessions((prev) =>
          prev.map((s) =>
            s.id === selectedSession ? { ...s, status: "in_progress" } : s
          )
        );

        showToast("success", t("auth.adminAssignSuccess", { learner: selectedLearner.full_name, teacher: selectedSlot.teacher_name, date: formatDateDisplay(selectedSlot.date) }));

        // Refresh list from DB in background
        if (selectedLearner) {
          handleSelectLearner(selectedLearner);
        }

        setSelectedSession(null);
        setSelectedSlot(null);
        setSlots([]);
        return;
      }

      // If edge function didn't confirm verification, fall back to client-side check
      console.log("[AdminAssign] Edge function did not confirm — running client verification...");

      let verifyData: any = null;
      const maxRetries = 4;
      
      for (let retry = 0; retry < maxRetries; retry++) {
        if (retry > 0) {
          await new Promise((r) => setTimeout(r, 600 * retry));
        }
        
        const result = await supabase
          .from("sprint_sessions")
          .select("id, status, class_id, teacher_id, scheduled_at")
          .eq("id", selectedSession)
          .maybeSingle();
        
        verifyData = result.data;
        
        if (!result.error && verifyData && verifyData.status === "in_progress") {
          console.log("[AdminAssign] Client verification passed after " + (retry + 1) + " attempt(s)");
          break;
        }
      }

      if (!verifyData || verifyData.status !== "in_progress") {
        console.error("[AdminAssign] All verifications failed — session status:", verifyData?.status || "not found");
        showToast("error", t("auth.adminAssignVerifyFailed"));
        return;
      }

      setLearnerSessions((prev) =>
        prev.map((s) =>
          s.id === selectedSession ? { ...s, status: "in_progress" } : s
        )
      );

      showToast("success", t("auth.adminAssignSuccess", { learner: selectedLearner.full_name, teacher: selectedSlot.teacher_name, date: formatDateDisplay(selectedSlot.date) }));

      if (selectedLearner) {
        await handleSelectLearner(selectedLearner);
      }

      setSelectedSession(null);
      setSelectedSlot(null);
      setSlots([]);
    } catch (err: any) {
      const errMsg = err?.message || t("auth.adminAssignGenericError");
      console.error(`[AdminAssign] Error:`, errMsg, err);
      showToast("error", errMsg);
    } finally {
      setAssigning(false);
    }
  };

  const selectedSessionData = learnerSessions.find((s) => s.id === selectedSession);

  const filteredLearners = learners.filter((l) => {
    if (!learnerSearch.trim()) return true;
    const q = learnerSearch.trim().toLowerCase();
    return (
      (l.full_name || "").toLowerCase().includes(q) ||
      (l.email || "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-8">
        <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">{t("auth.adminAssignTitle")}</h2>
        <p className="text-sm text-foreground-500">{t("auth.adminAssignSubtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Step 1: Select Learner */}
        <div className="bg-background-50 border border-background-200 rounded-xl p-5">
          <h3 className="font-heading text-sm font-bold text-foreground-800 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">1</span>
            {t("auth.adminAssignStep1")}
          </h3>
          {loadingLearners ? (
            <div className="py-8 text-center text-sm text-foreground-400">{t("auth.adminAssignLoading")}</div>
          ) : (
            <>
              <div className="relative mb-3">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
                <input
                  type="text"
                  value={learnerSearch}
                  onChange={(e) => setLearnerSearch(e.target.value)}
                  placeholder={t("auth.adminSearchLearners")}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all"
                />
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {filteredLearners.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handleSelectLearner(l)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all cursor-pointer ${
                      selectedLearner?.id === l.id
                        ? "bg-primary-50 border border-primary-200 text-primary-800 font-semibold"
                        : "hover:bg-background-100 text-foreground-700 border border-transparent"
                    }`}
                  >
                    <p className="font-medium truncate">{l.full_name}</p>
                    <p className="text-xs text-foreground-400 truncate">{l.email}</p>
                  </button>
                ))}
                {learners.length === 0 && (
                  <p className="text-sm text-foreground-400 py-4 text-center">{t("auth.adminAssignNoLearners")}</p>
                )}
                {learners.length > 0 && filteredLearners.length === 0 && (
                  <p className="text-sm text-foreground-400 py-4 text-center">{t("auth.adminAssignNoLearners")}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Step 2: Select Session */}
        <div className="bg-background-50 border border-background-200 rounded-xl p-5">
          <h3 className="font-heading text-sm font-bold text-foreground-800 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">2</span>
            {t("auth.adminAssignStep2")}
          </h3>
          {!selectedLearner ? (
            <p className="text-sm text-foreground-400 py-8 text-center">{t("auth.adminAssignSelectLearnerFirst")}</p>
          ) : learnerSessions.length === 0 ? (
            <p className="text-sm text-foreground-400 py-8 text-center">{t("auth.adminAssignNoOpenSessions")}</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {learnerSessions.map((s) => {
                const isBooked = s.status === "in_progress" || s.status === "active";
                const isCompleted = s.status === "completed";
                const isAvailable = s.status === "available";
                const isDisabled = isCompleted || isBooked;
                const sessionType = s.session_type === "self_study" ? t("auth.adminAssignSelfStudy") : t("auth.adminAssignLive");
                const statusLabel = isCompleted ? t("auth.adminAssignCompleted") : isBooked ? t("auth.adminAssignBooked") : t("auth.adminAssignAvailable");
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => isAvailable && handleSelectSession(s.id)}
                    disabled={isDisabled}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                      selectedSession === s.id
                        ? "bg-primary-50 border border-primary-200 text-primary-800 font-semibold cursor-pointer"
                        : isDisabled
                          ? "bg-background-100 text-foreground-300 cursor-not-allowed"
                          : "hover:bg-background-100 text-foreground-700 border border-transparent cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {t("auth.adminAssignSessionLabel", { num: s.session_number, type: sessionType })}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        isCompleted ? "bg-accent-100 text-accent-700" :
                        isBooked ? "bg-primary-100 text-primary-700" :
                        "bg-secondary-100 text-secondary-700"
                      }`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-foreground-400 mt-0.5">
                      {t("auth.adminAssignSprint")} {(s.sprint as any)?.sprint_number || "?"}
                      {s.scheduled_at && ` · ${new Date(s.scheduled_at).toLocaleString("vi-VN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Step 3: Select Slot */}
        <div className="bg-background-50 border border-background-200 rounded-xl p-5">
          <h3 className="font-heading text-sm font-bold text-foreground-800 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">3</span>
            {t("auth.adminAssignStep3")}
          </h3>
          {!selectedSession ? (
            <p className="text-sm text-foreground-400 py-8 text-center">{t("auth.adminAssignSelectSessionFirst")}</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => {
                    const newOffset = weekOffset - 1;
                    setWeekOffset(newOffset);
                    handleSelectSession(selectedSession!, newOffset);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-background-100 text-foreground-500 hover:bg-background-200 cursor-pointer"
                >
                  <i className="ri-arrow-left-s-line text-sm"></i>
                </button>
                <span className="text-xs text-foreground-500 flex-1 text-center">
                  {t("auth.adminAssignWeek", { offset: weekOffset === 0 ? t("auth.adminAssignThisWeek") : weekOffset > 0 ? `+${weekOffset}` : weekOffset })}
                </span>
                <button
                  onClick={() => {
                    const newOffset = weekOffset + 1;
                    setWeekOffset(newOffset);
                    handleSelectSession(selectedSession!, newOffset);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-background-100 text-foreground-500 hover:bg-background-200 cursor-pointer"
                >
                  <i className="ri-arrow-right-s-line text-sm"></i>
                </button>
              </div>
              {loadingSlots ? (
                <div className="py-8 text-center">
                  <div className="w-6 h-6 mx-auto border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="text-xs text-foreground-400 mt-2">{t("auth.adminAssignLoading")}</p>
                </div>
              ) : slots.length === 0 ? (
                <p className="text-sm text-foreground-400 py-8 text-center">{t("auth.adminAssignNoSlots")}</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {slots.map((slot) => {
                    const isFull = slot.booked_count >= slot.max_students;
                    const isSelected = selectedSlot?.availability_id === slot.availability_id;
                    return (
                      <button
                        key={slot.availability_id}
                        type="button"
                        onClick={() => !isFull && setSelectedSlot(slot)}
                        disabled={isFull}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                          isSelected
                            ? "bg-primary-50 border border-primary-200 text-primary-800 font-semibold cursor-pointer"
                            : isFull
                              ? "bg-background-100 text-foreground-300 cursor-not-allowed"
                              : "hover:bg-background-100 text-foreground-700 border border-transparent cursor-pointer"
                        }`}
                      >
                        <p className="font-medium truncate">{slot.teacher_name}</p>
                        <p className="text-xs text-foreground-400">
                          {formatDateDisplay(slot.date)} · {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Assign Button */}
      {selectedLearner && selectedSession && selectedSlot && (
        <div className="mt-6 p-4 rounded-xl bg-accent-50 border border-accent-200 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground-900">
              {t("auth.adminAssignConfirm", { learner: selectedLearner.full_name, session: selectedSessionData?.session_number })}
            </p>
            <p className="text-xs text-foreground-500">
              {selectedSlot.teacher_name} · {formatDateDisplay(selectedSlot.date)} · {formatTime12h(selectedSlot.start_time)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleAssign}
            disabled={assigning}
            className="inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            {assigning ? (
              <>
                <div className="w-4 h-4 border-2 border-background-50 border-t-transparent rounded-full animate-spin mr-2"></div>
                {t("auth.adminAssignAssigning")}
              </>
            ) : (
              <>
                <i className="ri-user-follow-line mr-1.5"></i>
                {t("auth.adminAssignButton")}
              </>
            )}
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] animate-[slideUp_0.3s_ease-out]">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === "success" ? "bg-primary-500 text-background-50" : "bg-accent-500 text-background-50"
          }`}>
            <i className={toast.type === "success" ? "ri-check-line" : "ri-error-warning-line"}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}