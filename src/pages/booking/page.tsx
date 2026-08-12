import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import AuthGuard from "@/components/base/AuthGuard";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import NotificationBell from "@/components/feature/NotificationBell";

interface TeacherSlot {
  availability_id: string;
  teacher_id: string;
  teacher_name: string;
  teacher_avatar: string | null;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  class_id: string | null;
  booked_count: number;
  max_students: number;
  is_my_booking: boolean;
  is_completed: boolean;
  enrolled_names: string[];
  session_status?: string;
}

interface BookableSession {
  id: string;
  session_number: number;
  status: string;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function formatDuration(mins: number): string {
  if (mins === 30) return "30m";
  if (mins === 60) return "1h";
  if (mins === 90) return "1.5h";
  return `${mins}m`;
}

function normalizeTime(time: string): string {
  if (!time) return "00:00";
  return time.length > 5 ? time.substring(0, 5) : time;
}

function getWeekLabel(weekStart: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonday = getMondayOfWeek(today);

  const diffWeeks = Math.round((weekStart.getTime() - currentMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));

  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const formatRange = () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (weekStart.getMonth() === end.getMonth()) {
      return `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${end.getDate()}, ${weekStart.getFullYear()}`;
    }
    return `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${months[end.getMonth()]} ${end.getDate()}, ${weekStart.getFullYear()}`;
  };

  if (diffWeeks === 0) return "This Week";
  if (diffWeeks === 1) return `Next Week · ${formatRange()}`;
  if (diffWeeks === -1) return `Last Week · ${formatRange()}`;
  if (diffWeeks > 1) return `In ${diffWeeks} weeks · ${formatRange()}`;
  return `${formatRange()}`;
}

function BookingCalendarContent() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const supabase = getSupabase();

  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    // Default to next week so learners see bookable slots immediately
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return getMondayOfWeek(nextWeek);
  });

  const [slots, setSlots] = useState<TeacherSlot[]>([]);
  const [bookableSessions, setBookableSessions] = useState<BookableSession[]>([]);
  const [allBooked, setAllBooked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bookingSessionId, setBookingSessionId] = useState<string | null>(null);
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<TeacherSlot | null>(null);

  // Reschedule state
  const [rescheduleTarget, setRescheduleTarget] = useState<TeacherSlot | null>(null);
  const [rescheduleSlots, setRescheduleSlots] = useState<TeacherSlot[]>([]);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleInProgress, setRescheduleInProgress] = useState(false);
  const [selectedNewSlot, setSelectedNewSlot] = useState<TeacherSlot | null>(null);

  // Cancel state
  const [cancelTarget, setCancelTarget] = useState<TeacherSlot | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null);
  const [classToSessionMap, setClassToSessionMap] = useState<Record<string, string>>();

  // Real-time tick to auto-refresh passed classes every 30s
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);
  // suppress unused warning - tick drives re-renders for isSlotTimePassed
  void tick;

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);

    try {
      // Fetch bookable sessions (S2, S3 with status "available")
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("learner_id", profile.id)
        .eq("status", "active")
        .maybeSingle();

      let myBookedClassIds: string[] = [];
      let completedClassIds: string[] = [];
      let sessionStatusMap: Record<string, string> = {};

      if (enrollment) {
        const { data: activeSprint } = await supabase
          .from("learning_sprints")
          .select("id")
          .eq("enrollment_id", enrollment.id)
          .eq("status", "active")
          .maybeSingle();

        if (activeSprint) {
          const { data: sessions } = await supabase
            .from("sprint_sessions")
            .select("id, session_number, status, class_id")
            .eq("sprint_id", activeSprint.id)
            .in("session_number", [2, 3])
            .order("session_number");

          const allSessions = sessions || [];
          const available = allSessions.filter((s: any) => s.status === "available");
          const bookedOnes = allSessions.filter((s: any) => s.status === "in_progress" || s.status === "active");

          setBookableSessions(available);
          if (available.length > 0 && !bookingSessionId) {
            setBookingSessionId(available[0].id);
          }

          // Check if all sessions are booked
          if (available.length === 0 && allSessions.length > 0 && bookedOnes.length === allSessions.length) {
            setAllBooked(true);
          } else {
            setAllBooked(false);
          }

          // Get class_ids of sessions the learner has already booked
          myBookedClassIds = bookedOnes.map((s: any) => s.class_id).filter(Boolean);

          // Build class_id → sprint_session_id map for cancel/reschedule
          const sessionMap: Record<string, string> = {};
          bookedOnes.forEach((s: any) => {
            if (s.class_id) sessionMap[s.class_id] = s.id;
          });
          setClassToSessionMap(sessionMap);

          // Also track which classes have completed sessions
          completedClassIds = allSessions.filter((s: any) => s.status === "completed" && s.class_id).map((s: any) => s.class_id);

          // Track session status for each class
          allSessions.forEach((s: any) => {
            if (s.class_id) sessionStatusMap[s.class_id] = s.status;
          });
        } else {
          setBookableSessions([]);
          setAllBooked(false);
        }
      } else {
        setBookableSessions([]);
        setAllBooked(false);
      }

      const weekEndDate = new Date(weekStart);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const startStr = toLocalDateStr(weekStart);
      const endStr = toLocalDateStr(weekEndDate);

      // Fetch teacher availability
      const { data: availData, error: availError } = await supabase
        .from("teacher_availability")
        .select("id, teacher_id, date, start_time, end_time, duration_minutes, is_active")
        .eq("is_active", true)
        .gte("date", startStr)
        .lte("date", endStr)
        .order("date")
        .order("start_time");

      if (availError) throw availError;

      const teacherIds = [...new Set((availData || []).map((a: any) => a.teacher_id))] as string[];
      const teacherMap = new Map<string, { name: string; avatar: string | null }>();
      if (teacherIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", teacherIds);
        (profiles || []).forEach((p: any) => teacherMap.set(p.id, { name: p.full_name, avatar: p.avatar_url }));
      }

      // Get unavailable dates
      const { data: unavailableDates } = await supabase
        .from("teacher_unavailable_dates")
        .select("teacher_id, date")
        .gte("date", startStr)
        .lte("date", endStr);

      const unavailableSet = new Set<string>();
      (unavailableDates || []).forEach((ud: any) => {
        unavailableSet.add(`${ud.teacher_id}-${ud.date}`);
      });

      // Get existing class schedules for capacity info
      const { data: existingSchedules } = await supabase
        .from("class_schedules")
        .select("id, class_id, teacher_id, date, start_time, end_time")
        .gte("date", startStr)
        .lte("date", endStr);

      // Get classes for max_students
      const scheduleClassIds = [...new Set((existingSchedules || []).map((s: any) => s.class_id))] as string[];
      let classDataMap = new Map<string, { max_students: number; status: string }>();
      if (scheduleClassIds.length > 0) {
        const { data: classData } = await supabase
          .from("classes")
          .select("id, max_students, status")
          .in("id", scheduleClassIds);
        (classData || []).forEach((c: any) => {
          classDataMap.set(c.id, { max_students: c.max_students || 2, status: c.status || "" });
        });
      }

      // Get enrollments for capacity AND learner names
      const { data: allEnrollments } = await supabase
        .from("class_enrollments")
        .select("class_id, student_id")
        .in("class_id", scheduleClassIds.length > 0 ? scheduleClassIds : ["none"]);

      const enrollmentCounts: Record<string, number> = {};
      (allEnrollments || []).forEach((e: any) => {
        enrollmentCounts[e.class_id] = (enrollmentCounts[e.class_id] || 0) + 1;
      });

      // Fetch learner names for each class
      const enrolledStudentIds = [...new Set((allEnrollments || []).map((e: any) => e.student_id).filter(Boolean))] as string[];
      const classLearnerNamesMap: Record<string, string[]> = {};
      if (enrolledStudentIds.length > 0) {
        const { data: learnerProfiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", enrolledStudentIds);
        const nameMap: Record<string, string> = {};
        (learnerProfiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });
        (allEnrollments || []).forEach((e: any) => {
          if (!e.class_id || !e.student_id) return;
          if (!classLearnerNamesMap[e.class_id]) classLearnerNamesMap[e.class_id] = [];
          const name = nameMap[e.student_id] || "Unknown";
          classLearnerNamesMap[e.class_id].push(name);
        });
      }

      // Build schedule lookup: teacher_id-date-start_time → class info
      const scheduleLookup = new Map<string, { classId: string; booked: number; max: number }>();
      (existingSchedules || []).forEach((s: any) => {
        const key = `${s.teacher_id}-${s.date}-${normalizeTime(s.start_time)}`;
        const cls = classDataMap.get(s.class_id);
        scheduleLookup.set(key, {
          classId: s.class_id,
          booked: enrollmentCounts[s.class_id] || 0,
          max: cls?.max_students || 2,
        });
      });

      // Turn myBookedClassIds into a Set for fast lookup
      const myBookedClassSet = new Set(myBookedClassIds);
      const completedClassSet = new Set(completedClassIds);

      const mappedSlots: TeacherSlot[] = (availData || []).map((a: any) => {
        const dateStr = a.date;
        const classKey = `${a.teacher_id}-${dateStr}-${normalizeTime(a.start_time)}`;
        const cls = scheduleLookup.get(classKey);
        const isUnavailable = unavailableSet.has(`${a.teacher_id}-${dateStr}`);
        const teacher = teacherMap.get(a.teacher_id) || { name: "Teacher", avatar: null };
        const isMyBooking = cls ? myBookedClassSet.has(cls.classId) : false;
        const isCompleted = cls ? completedClassSet.has(cls.classId) : false;

        return {
          availability_id: a.id,
          teacher_id: a.teacher_id,
          teacher_name: teacher.name,
          teacher_avatar: teacher.avatar,
          date: dateStr,
          start_time: normalizeTime(a.start_time),
          end_time: normalizeTime(a.end_time),
          duration_minutes: a.duration_minutes || 60,
          class_id: cls?.classId || null,
          booked_count: isUnavailable ? 999 : (cls?.booked || 0),
          max_students: cls?.max || 2,
          is_my_booking: isMyBooking,
          is_completed: isCompleted,
          enrolled_names: cls?.classId ? (classLearnerNamesMap[cls.classId] || []) : [],
          session_status: cls?.classId ? sessionStatusMap[cls.classId] : undefined,
        };
      });

      // Step X: Also add class_schedules that don't have matching teacher_availability
      // (e.g., admin-assigned bookings that bypass availability, or teachers who set availability for future weeks only)
      // This ensures learners see ALL their booked/past classes, not just those with active availability records
      const existingSlotKeys = new Set(
        mappedSlots.map((s) => `${s.teacher_id}-${s.date}-${s.start_time}`)
      );

      // Fetch teacher profiles for schedule-only teachers not yet in teacherMap
      const scheduleTeacherIds = [...new Set(
        (existingSchedules || []).map((s: any) => s.teacher_id).filter((tid: string) => !teacherMap.has(tid))
      )] as string[];

      if (scheduleTeacherIds.length > 0) {
        const { data: extraProfiles } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", scheduleTeacherIds);
        (extraProfiles || []).forEach((p: any) => teacherMap.set(p.id, { name: p.full_name, avatar: p.avatar_url }));
      }

      (existingSchedules || []).forEach((s: any) => {
        const st = normalizeTime(s.start_time);
        const key = `${s.teacher_id}-${s.date}-${st}`;
        if (existingSlotKeys.has(key)) return; // Already covered by availability

        const teacher = teacherMap.get(s.teacher_id) || { name: "Teacher", avatar: null };
        const cls = classDataMap.get(s.class_id);
        const et = normalizeTime(s.end_time);

        mappedSlots.push({
          availability_id: `sched-fallback-${s.id}`,
          teacher_id: s.teacher_id,
          teacher_name: teacher.name,
          teacher_avatar: teacher.avatar,
          date: s.date,
          start_time: st,
          end_time: et,
          duration_minutes: 60,
          class_id: s.class_id,
          booked_count: enrollmentCounts[s.class_id] || 0,
          max_students: cls?.max_students || 2,
          is_my_booking: myBookedClassSet.has(s.class_id),
          is_completed: completedClassSet.has(s.class_id),
          enrolled_names: s.class_id ? (classLearnerNamesMap[s.class_id] || []) : [],
          session_status: s.class_id ? sessionStatusMap[s.class_id] : undefined,
        });
      });

      // One bookable option per teacher per date+time (keep distinct teachers; drop duplicate source rows)
      const seenSlotKeys = new Set<string>();
      const uniqueSlots: TeacherSlot[] = [];
      for (const s of mappedSlots) {
        const key = `${s.teacher_id}-${s.date}-${s.start_time}`;
        if (seenSlotKeys.has(key)) continue;
        seenSlotKeys.add(key);
        uniqueSlots.push(s);
      }

      setSlots(uniqueSlots);
    } catch (err) {
      console.error("Failed to fetch booking data:", err);
      showToast("error", "Unable to load available slots. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase, weekStart, showToast, bookingSessionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const daysOfWeek = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const slotsByDay = useMemo(() => {
    const grouped: Record<string, TeacherSlot[]> = {};
    slots.forEach((s) => {
      if (!grouped[s.date]) grouped[s.date] = [];
      grouped[s.date].push(s);
    });
    return grouped;
  }, [slots]);

  const timeRange = useMemo(() => {
    const times = new Set<string>();
    slots.forEach((s) => {
      times.add(s.start_time);
    });
    return Array.from(times).sort();
  }, [slots]);

  const weekLabel = useMemo(() => getWeekLabel(weekStart), [weekStart]);

  const isCurrentWeek = useMemo(() => {
    const currentMonday = getMondayOfWeek(new Date());
    return weekStart.getTime() === currentMonday.getTime();
  }, [weekStart]);

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const handlePrevWeek = () => {
    const prev = new Date(weekStart);
    prev.setDate(prev.getDate() - 7);
    setWeekStart(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 7);
    setWeekStart(next);
  };

  const handleSlotClick = (slot: TeacherSlot) => {
    if (slot.is_my_booking) return;
    if (slot.is_completed || isSlotTimePassed(slot)) return;
    if (slot.booked_count >= slot.max_students) return;
    if (bookableSessions.length === 0) return;
    if (!bookingSessionId) return;
    if (!isTodaySaturday()) {
      showToast("error", t("booking.saturdayOnlyToast"));
      return;
    }
    setConfirmModal(slot);
  };

  const handleConfirmBooking = async () => {
    if (!confirmModal || !profile?.id || !bookingSessionId) return;
    setBookingInProgress(true);

    try {
      const res = await supabase.functions.invoke("book-class", {
        body: {
          student_id: profile.id,
          sprint_session_id: bookingSessionId,
          teacher_id: confirmModal.teacher_id,
          date: confirmModal.date,
          start_time: confirmModal.start_time,
          end_time: confirmModal.end_time,
          duration_minutes: confirmModal.duration_minutes,
        },
      });

      if (res.error) {
        let errorMessage = res.error.message || "Booking failed";
        let errorDetail = "";
        try {
          // Supabase JS v2: error.context might be the parsed JSON body directly,
          // or a Response-like object with .text()/.json()
          const ctx = res.error.context;
          if (ctx) {
            let parsed: any = null;
            if (typeof ctx.text === "function") {
              const body = await ctx.text();
              try { parsed = JSON.parse(body); } catch { errorMessage = body || errorMessage; }
            } else if (typeof ctx.json === "function") {
              parsed = await ctx.json();
            } else if (typeof ctx === "object") {
              parsed = ctx;
            }
            if (parsed) {
              errorMessage = parsed.error || parsed.message || errorMessage;
              errorDetail = parsed.detail || parsed.code || "";
              if (parsed.debug && Array.isArray(parsed.debug)) {
                console.error("Book-class debug:", parsed.debug.join("\n"));
              }
            }
          }
        } catch {
          // fallback
        }
        const fullMessage = errorDetail ? `${errorMessage} (${errorDetail})` : errorMessage;
        console.error("Book-class error:", fullMessage);
        throw new Error(fullMessage);
      }

      const sessionNum = bookableSessions.find((s) => s.id === bookingSessionId)?.session_number || "";
      showToast(
        "success",
        t("booking.successMessage", { time: formatTime12h(confirmModal.start_time), day: formatDateDisplay(confirmModal.date), teacher: confirmModal.teacher_name })
      );

      setConfirmModal(null);
      setBookingSessionId(null);
      fetchData();
    } catch (err: any) {
      console.error("Booking error:", err);
      showToast("error", err.message || t("booking.failedToBook"));
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleRescheduleClick = async (slot: TeacherSlot) => {
    if (!isTodaySaturday()) {
      showToast("error", t("booking.saturdayOnlyReschedule"));
      return;
    }
    setRescheduleTarget(slot);
    setSelectedNewSlot(null);
    setRescheduleLoading(true);

    try {
      // Fetch ALL slots for the entire current week (not just same day)
      const weekEndDate = new Date(weekStart);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const startStr = toLocalDateStr(weekStart);
      const endStr = toLocalDateStr(weekEndDate);

      const { data: availData } = await supabase
        .from("teacher_availability")
        .select("id, teacher_id, date, start_time, end_time, duration_minutes, is_active")
        .eq("is_active", true)
        .gte("date", startStr)
        .lte("date", endStr)
        .order("date")
        .order("start_time");

      const teacherIds = [...new Set((availData || []).map((a: any) => a.teacher_id))] as string[];
      const teacherMap = new Map<string, { name: string; avatar: string | null }>();
      if (teacherIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", teacherIds);
        (profiles || []).forEach((p: any) => teacherMap.set(p.id, { name: p.full_name, avatar: p.avatar_url }));
      }

      // Get unavailable dates for the week
      const { data: unavailableDates } = await supabase
        .from("teacher_unavailable_dates")
        .select("teacher_id, date")
        .gte("date", startStr)
        .lte("date", endStr);

      const unavailableSet = new Set<string>();
      (unavailableDates || []).forEach((ud: any) => {
        unavailableSet.add(`${ud.teacher_id}-${ud.date}`);
      });

      // Get existing schedules for capacity across the week
      const { data: existingSchedules } = await supabase
        .from("class_schedules")
        .select("id, class_id, teacher_id, date, start_time, end_time")
        .gte("date", startStr)
        .lte("date", endStr);

      const scheduleClassIds = [...new Set((existingSchedules || []).map((s: any) => s.class_id))] as string[];
      let classDataMap = new Map<string, { max_students: number }>();
      if (scheduleClassIds.length > 0) {
        const { data: classData } = await supabase
          .from("classes")
          .select("id, max_students")
          .in("id", scheduleClassIds);
        (classData || []).forEach((c: any) => {
          classDataMap.set(c.id, { max_students: c.max_students || 2 });
        });
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
        const key = `${s.teacher_id}-${s.date}-${normalizeTime(s.start_time)}`;
        const cls = classDataMap.get(s.class_id);
        scheduleLookup.set(key, {
          classId: s.class_id,
          booked: enrollmentCounts[s.class_id] || 0,
          max: cls?.max_students || 2,
        });
      });

      const mappedSlots: TeacherSlot[] = (availData || [])
        .filter((a: any) => {
          // Exclude the current booking's exact teacher+date+time combo
          return !(a.teacher_id === slot.teacher_id && a.date === slot.date && normalizeTime(a.start_time) === slot.start_time);
        })
        .map((a: any) => {
          const dateStr = a.date;
          const classKey = `${a.teacher_id}-${dateStr}-${normalizeTime(a.start_time)}`;
          const cls = scheduleLookup.get(classKey);
          const isUnavailable = unavailableSet.has(`${a.teacher_id}-${dateStr}`);
          const teacher = teacherMap.get(a.teacher_id) || { name: "Teacher", avatar: null };

          return {
            availability_id: a.id,
            teacher_id: a.teacher_id,
            teacher_name: teacher.name,
            teacher_avatar: teacher.avatar,
            date: dateStr,
            start_time: normalizeTime(a.start_time),
            end_time: normalizeTime(a.end_time),
            duration_minutes: a.duration_minutes || 60,
            class_id: cls?.classId || null,
            booked_count: isUnavailable ? 999 : (cls?.booked || 0),
            max_students: cls?.max || 2,
            is_my_booking: false,
            is_completed: false,
            enrolled_names: [],
          };
        });

      // One option per teacher per date+time
      const seenSlotKeys = new Set<string>();
      const uniqueSlots: TeacherSlot[] = [];
      for (const s of mappedSlots) {
        const key = `${s.teacher_id}-${s.date}-${s.start_time}`;
        if (seenSlotKeys.has(key)) continue;
        seenSlotKeys.add(key);
        uniqueSlots.push(s);
      }

      setRescheduleSlots(uniqueSlots);
    } catch (err) {
      console.error("Failed to load reschedule slots:", err);
      showToast("error", t("booking.failedToLoad"));
    } finally {
      setRescheduleLoading(false);
    }
  };

  // Helper to check if TODAY is Saturday (VN timezone, booking window is open)
  const isTodaySaturday = (): boolean => {
    const now = new Date();
    const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vnDate.getUTCDay() === 6;
  };

  // Real-time check: has the slot's end time already passed? (VN timezone)
  const isSlotTimePassed = (slot: TeacherSlot): boolean => {
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const slotEnd = new Date(`${slot.date}T${slot.end_time}+07:00`);
    return slotEnd.getTime() < vnNow.getTime();
  };

  const handleCancelClick = (slot: TeacherSlot) => {
    if (!isTodaySaturday()) {
      showToast("error", t("booking.saturdayOnlyCancel"));
      return;
    }
    // Find the correct sprint_session_id from the class_id
    setCancelTarget(slot);
    const sessionId = slot.class_id ? classToSessionMap[slot.class_id] || null : null;
    setCancelSessionId(sessionId);
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget || !cancelTarget.class_id || !cancelSessionId) return;
    setCancelling(true);

    try {
      const res = await supabase.functions.invoke("cancel-booking", {
        body: {
          sprint_session_id: cancelSessionId,
          class_id: cancelTarget.class_id,
        },
      });

      if (res.error) {
        let errorMessage = res.error.message || "Cancel failed";
        let errorDetail = "";
        try {
          const ctx = res.error.context;
          if (ctx) {
            let parsed: any = null;
            if (typeof ctx.text === "function") {
              const body = await ctx.text();
              try { parsed = JSON.parse(body); } catch { errorMessage = body || errorMessage; }
            } else if (typeof ctx.json === "function") {
              parsed = await ctx.json();
            } else if (typeof ctx === "object") {
              parsed = ctx;
            }
            if (parsed) {
              errorMessage = parsed.error || parsed.message || errorMessage;
              errorDetail = parsed.detail || parsed.code || "";
            }
          }
        } catch {
          // fallback
        }
        const fullMessage = errorDetail ? `${errorMessage} (${errorDetail})` : errorMessage;
        console.error("Cancel error:", fullMessage);
        throw new Error(fullMessage);
      }

      showToast("success", t("booking.cancelSuccess", { teacher: cancelTarget.teacher_name }));

      setCancelTarget(null);
      setCancelSessionId(null);
      fetchData();
    } catch (err: any) {
      console.error("Cancel error:", err);
      showToast("error", err.message || t("booking.cancelFailed"));
    } finally {
      setCancelling(false);
    }
  };

  const handleConfirmReschedule = async () => {
    // Use classToSessionMap to get the correct sprint_session_id for the booked class
    const sessionId = rescheduleTarget?.class_id ? classToSessionMap[rescheduleTarget.class_id] : null;
    if (!rescheduleTarget || !selectedNewSlot || !profile?.id || !sessionId) return;
    setRescheduleInProgress(true);

    try {
      const res = await supabase.functions.invoke("reschedule-booking", {
        body: {
          action: "reschedule",
          learner_id: profile.id,
          sprint_session_id: sessionId,
          old_class_id: rescheduleTarget.class_id,
          new_teacher_id: selectedNewSlot.teacher_id,
          new_date: selectedNewSlot.date,
          new_start_time: selectedNewSlot.start_time,
          new_end_time: selectedNewSlot.end_time,
          new_duration_minutes: selectedNewSlot.duration_minutes,
        },
      });

      if (res.error) {
        let errorMessage = res.error.message || "Reschedule failed";
        let errorDetail = "";
        try {
          const ctx = res.error.context;
          if (ctx) {
            let parsed: any = null;
            if (typeof ctx.text === "function") {
              const body = await ctx.text();
              try { parsed = JSON.parse(body); } catch { errorMessage = body || errorMessage; }
            } else if (typeof ctx.json === "function") {
              parsed = await ctx.json();
            } else if (typeof ctx === "object") {
              parsed = ctx;
            }
            if (parsed) {
              errorMessage = parsed.error || parsed.message || errorMessage;
              errorDetail = parsed.detail || parsed.code || "";
            }
          }
        } catch {
          // fallback
        }
        const fullMessage = errorDetail ? `${errorMessage} (${errorDetail})` : errorMessage;
        console.error("Reschedule error:", fullMessage);
        throw new Error(fullMessage);
      }

      showToast(
        "success",
        t("booking.rescheduleSuccess", { time: formatTime12h(selectedNewSlot.start_time), day: formatDateDisplay(selectedNewSlot.date), teacher: selectedNewSlot.teacher_name })
      );

      setRescheduleTarget(null);
      setSelectedNewSlot(null);
      fetchData();
    } catch (err: any) {
      console.error("Reschedule error:", err);
      showToast("error", err.message || t("booking.rescheduleFailed"));
    } finally {
      setRescheduleInProgress(false);
    }
  };

  const selectedSessionNum = bookableSessions.find((s) => s.id === bookingSessionId)?.session_number || "";

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
        <div className="w-full px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <Link
                to="/dashboard"
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-arrow-left-line mr-1.5"></i>
                {t("booking.backToDashboard")}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        {/* Week Navigator */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground-950">{t("booking.title")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevWeek}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
            >
              <i className="ri-arrow-left-s-line"></i>
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(getMondayOfWeek(new Date()))}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isCurrentWeek
                  ? "bg-primary-100 text-primary-700 hover:bg-primary-200"
                  : "bg-background-100 text-foreground-500 hover:bg-background-200"
              }`}
            >
              {isCurrentWeek ? t("booking.thisWeek") : t("booking.todayLabel")}
            </button>
            <button
              type="button"
              onClick={handleNextWeek}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
            >
              <i className="ri-arrow-right-s-line"></i>
            </button>
          </div>
        </div>

        {/* All booked banner */}
        {allBooked && (
          <div className="mb-6 p-5 rounded-lg bg-accent-50 border border-accent-200 flex items-start gap-4">
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 shrink-0">
              <i className="ri-check-double-line text-lg"></i>
            </div>
            <div>
              <p className="text-sm font-semibold text-accent-800">{t("booking.allBookedTitle")}</p>
              <p className="text-xs text-accent-600 mt-0.5">
                {t("booking.allBookedDesc")}
              </p>
              <Link
                to="/dashboard"
                className="mt-2 inline-flex items-center px-4 py-1.5 rounded-md text-xs font-semibold bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-dashboard-line mr-1"></i>
                {t("booking.allBookedGoDashboard")}
              </Link>
            </div>
          </div>
        )}

        {/* Saturday booking window notice */}
        {!isTodaySaturday() && !allBooked && bookableSessions.length > 0 && (
          <div className="mb-6 p-5 rounded-lg bg-secondary-50 border border-secondary-200 flex items-start gap-4">
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600 shrink-0">
              <i className="ri-timer-line text-lg"></i>
            </div>
            <div>
              <p className="text-sm font-semibold text-secondary-800">{t("booking.saturdayOnlyTitle")}</p>
              <p className="text-xs text-secondary-600 mt-0.5" dangerouslySetInnerHTML={{ __html: t("booking.saturdayOnlyDesc") }}></p>
            </div>
          </div>
        )}

        {/* No bookable sessions (not all booked, just none yet) */}
        {!allBooked && bookableSessions.length === 0 && (
          <div className="mb-6 p-4 rounded-lg bg-accent-50 border border-accent-200 flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 shrink-0">
              <i className="ri-information-line"></i>
            </div>
            <div>
              <p className="text-sm font-semibold text-accent-800">{t("booking.noBookableSessions")}</p>
              <p className="text-xs text-accent-600 mt-0.5">
                {t("booking.noBookableSessionsDesc")}
              </p>
            </div>
          </div>
        )}

        {/* Session selector pills */}
        {bookableSessions.length > 0 && (
          <div className="mb-6 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground-600">{t("booking.bookFor")}</span>
            {bookableSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setBookingSessionId(s.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  bookingSessionId === s.id
                    ? "bg-primary-500 text-background-50"
                    : "bg-background-100 text-foreground-600 hover:bg-background-200"
                }`}
              >
                {t("booking.sessionNum", { num: s.session_number })}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
              <p className="text-sm text-foreground-400">{t("booking.loadingSlots")}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-background-200/70 bg-background-50 overflow-hidden">
            {/* Calendar Grid - Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <div className="min-w-[800px]">
                <div className="grid grid-cols-8 border-b border-background-200/70">
                  <div className="p-3 border-r border-background-200/70 bg-background-100/50">
                    <span className="text-xs font-medium text-foreground-400">{t("booking.timeColumn")}</span>
                  </div>
                  {daysOfWeek.map((day, i) => (
                    <div
                      key={i}
                      className={`p-3 text-center border-r border-background-200/70 ${
                        isToday(day) ? "bg-primary-50/50" : ""
                      }`}
                    >
                      <p className="text-xs font-semibold text-foreground-600">
                        {["CN", "T2", "T3", "T4", "T5", "T6", "T7"][day.getDay()]}
                      </p>
                      <p className={`text-lg font-bold ${isToday(day) ? "text-primary-600" : "text-foreground-900"}`}>
                        {day.getDate()}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="max-h-[500px] overflow-y-auto">
                  {timeRange.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-2xl bg-background-100 text-foreground-300">
                        <i className="ri-calendar-event-line text-2xl"></i>
                      </div>
                      <p className="text-sm text-foreground-500">{t("booking.noSlots")}</p>
                      <p className="text-xs text-foreground-400 mt-1">{t("booking.noSlotsHint")}</p>
                    </div>
                  ) : (
                    timeRange.map((time) => (
                      <div key={time} className="grid grid-cols-8 border-b border-background-100/70 min-h-[60px]">
                        <div className="p-2 border-r border-background-200/70 bg-background-50 flex items-center">
                          <span className="text-xs font-medium text-foreground-400">{formatTime12h(time)}</span>
                        </div>
                        {daysOfWeek.map((day, dayIdx) => {
                          const dateStr = toLocalDateStr(day);
                          const daySlots = slotsByDay[dateStr] || [];
                          const cellSlots = daySlots.filter((s) => s.start_time === time);
                          const isTodayCell = isToday(day);
                          const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));

                          return (
                            <div
                              key={dayIdx}
                              className={`p-1 border-r border-background-200/70 ${isTodayCell ? "bg-primary-50/30" : ""}`}
                            >
                              {cellSlots.length > 0 && (
                                <div className="space-y-1">
                                  {cellSlots.map((slot) => {
                                    const isFull = slot.booked_count >= slot.max_students;
                                    const isMine = slot.is_my_booking;
                                    const isDone = slot.is_completed;
                                    const isPassed = isSlotTimePassed(slot);
                                    return (
                                      <div key={`${slot.teacher_id}-${slot.availability_id}`} className="relative group/slot">
                                        {/* Hover tooltip */}
                                        <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 w-60 p-3 rounded-xl bg-foreground-900 text-background-50 text-xs shadow-xl opacity-0 invisible group-hover/slot:opacity-100 group-hover/slot:visible transition-all duration-200 pointer-events-none">
                                          <p className="font-semibold text-sm mb-1.5">{slot.teacher_name}</p>
                                          <div className="space-y-1 text-foreground-300">
                                            <p className="flex items-center gap-1.5">
                                              <i className="ri-time-line"></i>
                                              {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                                            </p>
                                            <p className="flex items-center gap-1.5">
                                              <i className="ri-hourglass-line"></i>
                                              {formatDuration(slot.duration_minutes)}
                                            </p>
                                            <p className="flex items-center gap-1.5">
                                              <i className="ri-user-line"></i>
                                              {slot.enrolled_names.length > 0
                                                ? slot.enrolled_names.join(", ")
                                                : t("booking.noStudents")}
                                              <span className="text-foreground-500">({slot.booked_count}/{slot.max_students})</span>
                                            </p>
                                          </div>
                                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-2 h-2 bg-foreground-900 rotate-45"></div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (isMine) {
                                              handleRescheduleClick(slot);
                                            } else {
                                              handleSlotClick(slot);
                                            }
                                          }}
                                          disabled={(!isMine && isFull) || isPast || isDone || isPassed || (!isMine && (bookableSessions.length === 0 || !bookingSessionId))}
                                          className={`w-full text-left p-2 rounded-lg text-xs transition-all duration-150 flex items-center gap-1.5 overflow-hidden ${
                                            isDone
                                              ? "bg-secondary-100 text-secondary-700 cursor-default border border-secondary-200"
                                              : isMine
                                                ? "bg-primary-100 text-primary-700 cursor-pointer border border-primary-200 hover:bg-primary-200 pr-8"
                                                : isFull
                                                  ? "bg-foreground-100 text-foreground-600 cursor-not-allowed border border-foreground-200"
                                                  : "bg-accent-50 text-accent-800 cursor-pointer border border-accent-200 hover:bg-accent-100"
                                          }`}
                                        >
                                          {/* Status color bar */}
                                          <div className={`w-2.5 h-6 rounded-full shrink-0 ${
                                            isDone ? "bg-secondary-500" :
                                            isMine ? "bg-primary-500" :
                                            isFull ? "bg-foreground-500" :
                                            "bg-accent-500"
                                          }`}></div>
                                          <span className="font-semibold truncate flex-1">{slot.teacher_name}</span>
                                          {isFull && <span className="text-[9px] px-1 py-0.5 rounded bg-foreground-200 text-foreground-700 font-bold shrink-0">{t("booking.fullLabel")}</span>}
                                          {isDone ? (
                                            <span className="text-[10px] flex-shrink-0 text-secondary-500">{t("booking.completedLabel")}</span>
                                          ) : isMine ? (
                                            <span className="inline-flex items-center gap-0.5 text-[10px] flex-shrink-0">
                                              <i className="ri-user-line text-primary-500"></i>
                                              <i className="ri-arrow-left-right-line text-primary-400"></i>
                                            </span>
                                          ) : isFull ? (
                                            <span className="text-[10px] flex-shrink-0 font-medium">{slot.booked_count}/{slot.max_students}</span>
                                          ) : (
                                            <span className="text-[10px] flex-shrink-0">{formatDuration(slot.duration_minutes)}</span>
                                          )}
                                        </button>
                                        {isMine && !isDone && (
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleCancelClick(slot); }}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-accent-100 text-accent-500 hover:bg-accent-200 hover:text-accent-600 opacity-100 md:opacity-0 md:group-hover/slot:opacity-100 transition-opacity cursor-pointer"
                                            title={t("booking.cancelTooltip")}
                                          >
                                            <i className="ri-arrow-right-s-line text-[10px]"></i>
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Mobile: List view */}
            <div className="md:hidden">
              {timeRange.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-2xl bg-background-100 text-foreground-300">
                    <i className="ri-calendar-event-line text-2xl"></i>
                  </div>
                  <p className="text-sm text-foreground-500">{t("booking.noSlotsWeek")}</p>
                </div>
              ) : (
                <div className="divide-y divide-background-100">
                  {daysOfWeek.map((day, dayIdx) => {
                    const dateStr = toLocalDateStr(day);
                    const daySlots = slotsByDay[dateStr] || [];
                    if (daySlots.length === 0) return null;
                    return (
                      <div key={dayIdx} className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${isToday(day) ? "bg-primary-500 text-background-50" : "bg-background-100 text-foreground-600"}`}>
                            {day.getDate()}
                          </span>
                          <span className="text-sm font-semibold text-foreground-800">
                            {["CN", "T2", "T3", "T4", "T5", "T6", "T7"][day.getDay()]}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {daySlots.map((slot) => {
                            const isFull = slot.booked_count >= slot.max_students;
                            const isMine = slot.is_my_booking;
                            const isDone = slot.is_completed;
                            const isPassed = isSlotTimePassed(slot);
                            return (
                              <div key={slot.availability_id} className="relative group/slot">
                                {/* Hover tooltip */}
                                <div className="absolute z-50 top-full right-0 mt-1 w-56 p-3 rounded-xl bg-foreground-900 text-background-50 text-xs shadow-xl opacity-0 invisible group-hover/slot:opacity-100 group-hover/slot:visible transition-all duration-200 pointer-events-none">
                                  <p className="font-semibold text-sm mb-1.5">{slot.teacher_name}</p>
                                  <div className="space-y-1 text-foreground-300">
                                    <p className="flex items-center gap-1.5">
                                      <i className="ri-time-line"></i>
                                      {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                                    </p>
                                    <p className="flex items-center gap-1.5">
                                      <i className="ri-hourglass-line"></i>
                                      {formatDuration(slot.duration_minutes)}
                                    </p>
                                    <p className="flex items-center gap-1.5">
                                      <i className="ri-user-line"></i>
                                      {slot.enrolled_names.length > 0
                                        ? slot.enrolled_names.join(", ")
                                        : t("booking.noStudents")}
                                      <span className="text-foreground-500">({slot.booked_count}/{slot.max_students})</span>
                                    </p>
                                  </div>
                                  <div className="absolute bottom-full right-4 w-2 h-2 bg-foreground-900 rotate-45"></div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isMine) {
                                      handleRescheduleClick(slot);
                                    } else {
                                      handleSlotClick(slot);
                                    }
                                  }}
                                  disabled={(!isMine && isFull) || isDone || isPassed || (!isMine && (bookableSessions.length === 0 || !bookingSessionId))}
                                  className={`w-full flex items-center justify-between p-3 rounded-lg text-sm transition-all overflow-hidden ${
                                    isDone
                                      ? "bg-secondary-100 text-secondary-700 cursor-default border border-secondary-200"
                                      : isMine
                                        ? "bg-primary-100 text-primary-700 cursor-pointer border border-primary-200 hover:bg-primary-200 pr-10"
                                        : isFull
                                          ? "bg-foreground-100 text-foreground-600 cursor-not-allowed border border-foreground-200"
                                          : "bg-accent-50 text-accent-800 cursor-pointer border border-accent-200 hover:bg-accent-100"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {/* Status color bar */}
                                    <div className={`w-2.5 h-6 rounded-full shrink-0 ${
                                      isDone ? "bg-secondary-500" :
                                      isMine ? "bg-primary-500" :
                                      isFull ? "bg-foreground-500" :
                                      "bg-accent-500"
                                    }`}></div>
                                    <span className="font-semibold truncate">{slot.teacher_name}</span>
                                    <span className="text-xs opacity-70 truncate">
                                      {formatTime12h(slot.start_time)} · {formatDuration(slot.duration_minutes)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {isFull && <span className="text-[9px] px-1 py-0.5 rounded bg-foreground-200 text-foreground-700 font-bold">{t("booking.fullLabel")}</span>}
                                    {isDone ? (
                                      <span className="text-xs text-secondary-500 flex-shrink-0">{t("booking.completedLabel")}</span>
                                    ) : isMine ? (
                                      <span className="inline-flex items-center gap-1 text-xs flex-shrink-0">
                                        <i className="ri-user-line text-primary-500"></i>
                                        <i className="ri-arrow-left-right-line text-primary-400"></i>
                                      </span>
                                    ) : isFull ? (
                                      <span className="text-xs flex-shrink-0 font-medium">{slot.booked_count}/{slot.max_students}</span>
                                    ) : (
                                      <i className="ri-add-circle-line text-accent-500 text-lg flex-shrink-0"></i>
                                    )}
                                  </div>
                                </button>
                                {isMine && !isDone && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleCancelClick(slot); }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-accent-100 text-accent-500 hover:bg-accent-200 hover:text-accent-600 opacity-100 md:opacity-0 md:group-hover/slot:opacity-100 transition-opacity cursor-pointer"
                                    title={t("booking.cancelTooltip")}
                                  >
                                    <i className="ri-close-line text-xs"></i>
                                  </button>
                                )}
                                {isDone && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleRescheduleClick(slot); }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-400 hover:bg-secondary-200 hover:text-secondary-600 opacity-100 md:opacity-0 md:group-hover/slot:opacity-100 transition-opacity cursor-pointer"
                                    title={t("booking.viewDetailTooltip")}
                                  >
                                    <i className="ri-arrow-right-s-line text-xs"></i>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex items-center gap-4 flex-wrap text-xs text-foreground-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-accent-50 border border-accent-200"></span>
            <span className="w-2 h-2 rounded-full bg-accent-500"></span>
            {t("booking.legendAvailable")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-primary-100 border border-primary-200"></span>
            <span className="w-2 h-2 rounded-full bg-primary-500"></span>
            {t("booking.legendBooked")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-foreground-100 border border-foreground-200"></span>
            <span className="w-2 h-2 rounded-full bg-foreground-500"></span>
            {t("booking.legendFull")}
          </span>
        </div>
      </main>

      {/* Confirmation Modal */}
      {confirmModal && bookingSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl border border-background-200">
            <div className="text-center mb-4">
              <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-full bg-primary-100 text-primary-600">
                <i className="ri-calendar-check-line text-xl"></i>
              </div>
              <h3 className="font-heading text-lg font-bold text-foreground-950">{t("booking.confirmTitle")}</h3>
              <p className="text-sm text-foreground-500 mt-1">
                {t("booking.bookConfirmSubtitle", { session: selectedSessionNum })}
              </p>
            </div>

            <div className="bg-background-100 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                  {confirmModal.teacher_name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground-900">{confirmModal.teacher_name}</p>
                  <p className="text-xs text-foreground-500">
                    {formatDateDisplay(confirmModal.date)} · {formatTime12h(confirmModal.start_time)} – {formatTime12h(confirmModal.end_time)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-foreground-500">
                <i className="ri-time-line"></i>
                <span>{t("booking.classDurationLabel", { duration: formatDuration(confirmModal.duration_minutes) })}</span>
                <span>·</span>
                <span>{t("booking.bookedCountLabel", { count: confirmModal.booked_count, max: confirmModal.max_students })}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t("booking.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmBooking}
                disabled={bookingInProgress}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {bookingInProgress ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-background-50 border-t-transparent rounded-full animate-spin"></div>
                    {t("booking.bookingInProgress")}
                  </span>
                ) : (
                  t("booking.confirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl border border-background-200 max-h-[85vh] flex flex-col">
            <div className="text-center mb-4">
              <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600">
                <i className="ri-arrow-left-right-line text-xl"></i>
              </div>
              <h3 className="font-heading text-lg font-bold text-foreground-950">{t("booking.rescheduleTitle")}</h3>
              <p className="text-sm text-foreground-500 mt-1">
                {t("booking.rescheduleDesc")}
              </p>
              {rescheduleSlots.length === 0 && !rescheduleLoading && (
                <div className="mt-3 p-3 rounded-lg bg-accent-50 border border-accent-200">
                  <p className="text-sm text-accent-800 font-medium">{t("booking.rescheduleNoSlots")}</p>
                  <p className="text-xs text-accent-600 mt-1" dangerouslySetInnerHTML={{ __html: t("booking.rescheduleNoSlotsDesc") }}></p>
                </div>
              )}
            </div>

            {rescheduleLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
                  <p className="text-sm text-foreground-400">{t("booking.rescheduleLoading")}</p>
                </div>
              </div>
            ) : rescheduleSlots.length > 0 ? (
              <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1">
                <p className="text-xs text-foreground-400 px-1">{t("booking.rescheduleSelectPrompt")}</p>
                {rescheduleSlots.map((slot) => {
                  const isFull = slot.booked_count >= slot.max_students;
                  const isSelected = selectedNewSlot?.availability_id === slot.availability_id;
                  return (
                    <button
                      key={slot.availability_id}
                      type="button"
                      onClick={() => !isFull && setSelectedNewSlot(slot)}
                      disabled={isFull}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                        isSelected
                          ? "bg-primary-50 border-2 border-primary-400"
                          : isFull
                            ? "bg-background-100 border border-background-200 opacity-50 cursor-not-allowed"
                            : "bg-background-50 border border-background-200 hover:border-primary-300 cursor-pointer"
                      }`}
                    >
                      <div className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-700 font-bold text-sm flex-shrink-0">
                        {slot.teacher_name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{slot.teacher_name}</p>
                        <p className="text-xs text-foreground-500">
                          {formatDateDisplay(slot.date)} · {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        {isFull ? (
                          <span className="text-xs text-foreground-400">{slot.booked_count}/{slot.max_students}</span>
                        ) : isSelected ? (
                          <i className="ri-checkbox-circle-fill text-primary-500 text-lg"></i>
                        ) : (
                          <span className="text-xs text-foreground-400">{formatDuration(slot.duration_minutes)}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex gap-3 pt-3 border-t border-background-200">
              <button
                type="button"
                onClick={() => { setRescheduleTarget(null); setSelectedNewSlot(null); }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t("booking.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmReschedule}
                disabled={!selectedNewSlot || rescheduleInProgress}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-secondary-600 text-background-50 hover:bg-secondary-700 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {rescheduleInProgress ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-background-50 border-t-transparent rounded-full animate-spin"></div>
                    {t("booking.rescheduleInProgress")}
                  </span>
                ) : (
                  t("booking.rescheduleConfirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl border border-background-200">
            <div className="text-center mb-4">
              <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-full bg-accent-100 text-accent-600">
                <i className="ri-close-circle-line text-xl"></i>
              </div>
              <h3 className="font-heading text-lg font-bold text-foreground-950">{t("booking.cancelConfirmTitle")}</h3>
              <p className="text-sm text-foreground-500 mt-1">
                {t("booking.cancelConfirmDesc")}
              </p>
            </div>

            <div className="bg-background-100 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                  {cancelTarget.teacher_name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground-900">{cancelTarget.teacher_name}</p>
                  <p className="text-xs text-foreground-500">
                    {formatDateDisplay(cancelTarget.date)} · {formatTime12h(cancelTarget.start_time)} – {formatTime12h(cancelTarget.end_time)}
                  </p>
                </div>
              </div>
              <div className="p-2.5 rounded-md bg-accent-50 border border-accent-200 mt-2">
                <p className="text-xs text-accent-700 flex items-start gap-1.5">
                  <i className="ri-information-line flex-shrink-0 mt-0.5"></i>
                  {t("booking.cancelInfo")}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setCancelTarget(null); setCancelSessionId(null); }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t("booking.cancelKeep")}
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-accent-500 text-background-50 hover:bg-accent-600 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {cancelling ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-background-50 border-t-transparent rounded-full animate-spin"></div>
                    {t("booking.cancelInProgress")}
                  </span>
                ) : (
                  t("booking.cancelConfirmButton")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-[slideUp_0.3s_ease-out]">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
              toast.type === "success"
                ? "bg-primary-600 text-background-50"
                : "bg-accent-600 text-background-50"
            }`}
          >
            <i className={toast.type === "success" ? "ri-check-line" : "ri-close-line"}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BookingCalendar() {
  return (
    <AuthGuard allowedRoles={["learner"]}>
      <BookingCalendarContent />
    </AuthGuard>
  );
}