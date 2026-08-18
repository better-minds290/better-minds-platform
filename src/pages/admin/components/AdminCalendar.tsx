import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import {
  calendarDateToLocalDate,
  formatVietnamSlotDate,
  getMondayOfWeek,
  toLocalDateStr,
  vietnamTodayStr,
} from "@/lib/datetime";

interface CalendarSlot {
  slot_type: "booked" | "available" | "unavailable";
  schedule_id?: string;
  class_id?: string;
  class_name?: string;
  teacher_id: string;
  teacher_name: string;
  teacher_avatar: string | null;
  learner_id?: string | null;
  learner_name?: string | null;
  all_learner_names?: string[];
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  session_number?: number | null;
  session_status?: string;
  max_students?: number;
  booked_count?: number;
}

interface CellData {
  booked: CalendarSlot[];
  availableSlots: CalendarSlot[];
  availableCount: number;
  availableTeachers: string[];
  unavailableCount: number;
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  return formatVietnamSlotDate(dateStr);
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

function getWeekLabel(weekStart: Date): string {
  const currentMonday = getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr()));
  const diffWeeks = Math.round((weekStart.getTime() - currentMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formatRange = () => {
    if (weekStart.getMonth() === end.getMonth()) {
      return `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${end.getDate()}, ${weekStart.getFullYear()}`;
    }
    return `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${months[end.getMonth()]} ${end.getDate()}, ${weekStart.getFullYear()}`;
  };
  if (diffWeeks === 0) return "This Week · " + formatRange();
  if (diffWeeks === 1) return "Next Week · " + formatRange();
  if (diffWeeks === -1) return "Last Week · " + formatRange();
  if (diffWeeks > 1) return `In ${diffWeeks} weeks · ${formatRange()}`;
  if (diffWeeks < -1) return `${Math.abs(diffWeeks)} weeks ago · ${formatRange()}`;
  return formatRange();
}

export default function AdminCalendar() {
  const { t } = useTranslation();
  const supabase = getSupabase();
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr())));
  const [openTooltipKey, setOpenTooltipKey] = useState<string | null>(null);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jumpDateStr, setJumpDateStr] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const statusConfig: Record<string, { bg: string; dot: string }> = {
    booked: { bg: "bg-primary-100 border border-primary-200", dot: "bg-primary-500" },
    active: { bg: "bg-primary-100 border border-primary-200", dot: "bg-primary-500" },
    in_progress: { bg: "bg-primary-100 border border-primary-200", dot: "bg-primary-500" },
    completed: { bg: "bg-secondary-100 border border-secondary-300", dot: "bg-secondary-500" },
    available: { bg: "bg-accent-50 border border-accent-200", dot: "bg-accent-500" },
  };

  const getBadgeClass = (sessionStatus: string, isEmptyClass: boolean): string => {
    if (isEmptyClass) return "bg-secondary-200 text-secondary-700";
    switch (sessionStatus) {
      case "completed": return "bg-secondary-200 text-secondary-700";
      default: return "bg-primary-200 text-primary-700";
    }
  };

  const getStatusLabel = (slot: CalendarSlot): string => {
    if (slot.slot_type === "available") return t("auth.adminCalendarLegendAvailable");
    const s = slot.session_status || "";
    switch (s) {
      case "completed": return t("auth.adminCalendarStatusDone");
      case "active":
      case "in_progress": return t("auth.adminCalendarStatusActive");
      default: return s;
    }
  };

  const dayLabels = [
    t("auth.adminCalendarDaySun"),
    t("auth.adminCalendarDayMon"),
    t("auth.adminCalendarDayTue"),
    t("auth.adminCalendarDayWed"),
    t("auth.adminCalendarDayThu"),
    t("auth.adminCalendarDayFri"),
    t("auth.adminCalendarDaySat"),
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const weekEndDate = new Date(weekStart);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const startStr = toLocalDateStr(weekStart);
      const endStr = toLocalDateStr(weekEndDate);

      // ── 1. Fetch ALL 3 data sources in parallel ──
      const [availRes, unavailRes, schedRes] = await Promise.all([
        supabase
          .from("teacher_availability")
          .select("id, teacher_id, date, start_time, end_time, duration_minutes, is_active")
          .eq("is_active", true)
          .gte("date", startStr)
          .lte("date", endStr)
          .order("date")
          .order("start_time"),
        supabase
          .from("teacher_unavailable_dates")
          .select("teacher_id, date, reason")
          .gte("date", startStr)
          .lte("date", endStr),
        supabase
          .from("class_schedules")
          .select("id, class_id, teacher_id, date, start_time, end_time")
          .gte("date", startStr)
          .lte("date", endStr)
          .order("date")
          .order("start_time"),
      ]);

      if (availRes.error) throw availRes.error;
      if (unavailRes.error) throw unavailRes.error;
      if (schedRes.error) throw schedRes.error;

      const availData = availRes.data || [];
      const unavailData = unavailRes.data || [];
      const schedData = schedRes.data || [];

      // ── 2. Collect all unique teacher_id + class_id ──
      const allTeacherIds = new Set<string>();
      availData.forEach((a: any) => allTeacherIds.add(a.teacher_id));
      unavailData.forEach((u: any) => allTeacherIds.add(u.teacher_id));
      schedData.forEach((s: any) => allTeacherIds.add(s.teacher_id));

      const classIds = [...new Set(schedData.map((s: any) => s.class_id))] as string[];

      // ── 3. Fetch enrichment data ──
      const [profilesRes, classesRes, enrollRes, sprintRes] = await Promise.all([
        allTeacherIds.size > 0
          ? supabase.from("profiles").select("id, full_name, avatar_url").in("id", [...allTeacherIds])
          : { data: [] },
        classIds.length > 0
          ? supabase.from("classes").select("id, name, max_students").in("id", classIds)
          : { data: [] },
        classIds.length > 0
          ? supabase.from("class_enrollments").select("class_id, student_id").in("class_id", classIds)
          : { data: [] },
        classIds.length > 0
          ? supabase.from("sprint_sessions").select("id, class_id, session_number, status").in("class_id", classIds)
          : { data: [] },
      ]);

      // Profile map
      const profileMap = new Map<string, { name: string; avatar: string | null }>();
      (profilesRes.data || []).forEach((p: any) => {
        profileMap.set(p.id, { name: p.full_name || "Unknown", avatar: p.avatar_url });
      });

      // Class map
      const classMap = new Map<string, { name: string; max_students: number }>();
      (classesRes.data || []).forEach((c: any) => {
        classMap.set(c.id, { name: c.name || "Unnamed", max_students: c.max_students || 2 });
      });

      // Enrollment map: class_id → student_ids
      const enrollMap = new Map<string, string[]>();
      const allLearnerIds = new Set<string>();
      (enrollRes.data || []).forEach((e: any) => {
        if (!e.student_id) return;
        if (!enrollMap.has(e.class_id)) enrollMap.set(e.class_id, []);
        enrollMap.get(e.class_id)!.push(e.student_id);
        allLearnerIds.add(e.student_id);
      });

      // Learner profile map
      let learnerMap = new Map<string, { name: string }>();
      if (allLearnerIds.size > 0) {
        const { data: lpData } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", [...allLearnerIds]);
        (lpData || []).forEach((p: any) => {
          learnerMap.set(p.id, { name: p.full_name || "Unknown" });
        });
      }

      // Session status map: class_id → { session_number, status }
      const sessionClassMap = new Map<string, { session_number: number; status: string }>();
      (sprintRes.data || []).forEach((ss: any) => {
        if (!ss.class_id) return;
        const existing = sessionClassMap.get(ss.class_id);
        const priority: Record<string, number> = {
          in_progress: 6, active: 5, completed: 4, missed: 3, available: 2, pending: 1, cancelled: 0,
        };
        const curP = existing ? (priority[existing.status] ?? -1) : -1;
        const newP = priority[ss.status] ?? 0;
        if (!existing || newP > curP) {
          sessionClassMap.set(ss.class_id, { session_number: ss.session_number, status: ss.status });
        }
      });

      // ── 4. Build unavailable set: teacher_id + date ──
      const unavailableSet = new Set<string>();
      const unavailableMap = new Map<string, string[]>(); // date → teacher names
      unavailData.forEach((u: any) => {
        const key = `${u.teacher_id}|${u.date}`;
        unavailableSet.add(key);
        if (!unavailableMap.has(u.date)) unavailableMap.set(u.date, []);
        const p = profileMap.get(u.teacher_id);
        unavailableMap.get(u.date)!.push(p?.name || "Unknown");
      });

      // ── 5. Build schedule lookup: teacher_id|date|start_time → schedule info ──
      const schedLookup = new Map<string, { scheduleId: string; classId: string }>();
      schedData.forEach((s: any) => {
        const st = typeof s.start_time === "string" ? s.start_time.substring(0, 5) : String(s.start_time);
        const key = `${s.teacher_id}|${s.date}|${st}`;
        schedLookup.set(key, { scheduleId: s.id, classId: s.class_id });
      });

      // ── 6. Build final slots from availability ──
      const mappedSlots: CalendarSlot[] = [];

      availData.forEach((a: any) => {
        const teacher = profileMap.get(a.teacher_id);
        const teacherName = teacher?.name || "Unknown";
        const teacherAvatar = teacher?.avatar || null;
        const st = typeof a.start_time === "string" ? a.start_time.substring(0, 5) : String(a.start_time);
        const et = typeof a.end_time === "string" ? a.end_time.substring(0, 5) : String(a.end_time);
        const dur = a.duration_minutes || 60;
        const isUnavailable = unavailableSet.has(`${a.teacher_id}|${a.date}`);
        const schedKey = `${a.teacher_id}|${a.date}|${st}`;
        const sched = schedLookup.get(schedKey);

        if (sched) {
          // Booked slot
          const cls = classMap.get(sched.classId);
          const learnerIds = enrollMap.get(sched.classId) || [];
          const firstLearnerId = learnerIds[0] || null;
          const learner = firstLearnerId ? learnerMap.get(firstLearnerId) : null;
          const allLearnerNames = learnerIds.map((id: string) => learnerMap.get(id)?.name || "Unknown");
          const session = sessionClassMap.get(sched.classId);

          mappedSlots.push({
            slot_type: "booked",
            schedule_id: sched.scheduleId,
            class_id: sched.classId,
            class_name: cls?.name || "Unnamed",
            teacher_id: a.teacher_id,
            teacher_name: teacherName,
            teacher_avatar: teacherAvatar,
            learner_id: firstLearnerId,
            learner_name: learner?.name || null,
            all_learner_names: allLearnerNames,
            date: a.date,
            start_time: st,
            end_time: et,
            duration_minutes: dur,
            session_number: session?.session_number || null,
            session_status: session?.status || "available",
            max_students: cls?.max_students || 2,
            booked_count: learnerIds.length,
          });
        } else if (isUnavailable) {
          // Skip unavailable slots — not useful on calendar
        } else {
          // Available slot
          mappedSlots.push({
            slot_type: "available",
            teacher_id: a.teacher_id,
            teacher_name: teacherName,
            teacher_avatar: teacherAvatar,
            date: a.date,
            start_time: st,
            end_time: et,
            duration_minutes: dur,
            max_students: 2,
            booked_count: 0,
          });
        }
      });

      // ── 7. Also add booked class_schedules that may not have a matching availability ──
      // (e.g., admin-assigned bookings that bypass availability)
      const existingAvailKeys = new Set(
        mappedSlots.filter((s) => s.slot_type === "booked").map((s) => `${s.teacher_id}|${s.date}|${s.start_time}`)
      );

      schedData.forEach((s: any) => {
        const st = typeof s.start_time === "string" ? s.start_time.substring(0, 5) : String(s.start_time);
        const key = `${s.teacher_id}|${s.date}|${st}`;
        if (existingAvailKeys.has(key)) return; // Already covered

        const teacher = profileMap.get(s.teacher_id);
        const cls = classMap.get(s.class_id);
        const learnerIds = enrollMap.get(s.class_id) || [];
        const firstLearnerId = learnerIds[0] || null;
        const learner = firstLearnerId ? learnerMap.get(firstLearnerId) : null;
        const allLearnerNames = learnerIds.map((id: string) => learnerMap.get(id)?.name || "Unknown");
        const session = sessionClassMap.get(s.class_id);
        const et = typeof s.end_time === "string" ? s.end_time.substring(0, 5) : String(s.end_time || "00:00");

        mappedSlots.push({
          slot_type: "booked",
          schedule_id: s.id,
          class_id: s.class_id,
          class_name: cls?.name || "Unnamed",
          teacher_id: s.teacher_id,
          teacher_name: teacher?.name || "Unknown",
          teacher_avatar: teacher?.avatar || null,
          learner_id: firstLearnerId,
          learner_name: learner?.name || null,
          all_learner_names: allLearnerNames,
          date: s.date,
          start_time: st,
          end_time: et,
          duration_minutes: 60,
          session_number: session?.session_number || null,
          session_status: session?.status || "available",
          max_students: cls?.max_students || 2,
          booked_count: learnerIds.length,
        });
      });

      setSlots(mappedSlots);
    } catch (err: any) {
      console.error("Admin calendar fetch error:", err);
      setError(err.message || "Failed to load calendar data");
    } finally {
      setLoading(false);
    }
  }, [supabase, weekStart]);

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

  // Build cell data: for each (date, start_time), aggregate booked + available
  const cellDataMap = useMemo(() => {
    const map = new Map<string, CellData>();

    slots.forEach((s) => {
      const cellKey = `${s.date}|${s.start_time}`;
      if (!map.has(cellKey)) {
        map.set(cellKey, {
          booked: [],
          availableSlots: [],
          availableCount: 0,
          availableTeachers: [],
          unavailableCount: 0,
        });
      }
      const cell = map.get(cellKey)!;

      if (s.slot_type === "booked") {
        cell.booked.push(s);
      } else if (s.slot_type === "available") {
        cell.availableCount++;
        cell.availableTeachers.push(s.teacher_name);
        cell.availableSlots.push(s);
      }
    });

    return map;
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
    const currentMonday = getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr()));
    return weekStart.getTime() === currentMonday.getTime();
  }, [weekStart]);

  const isToday = (date: Date) => toLocalDateStr(date) === vietnamTodayStr();

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

  const handleJumpToDate = () => {
    if (!jumpDateStr) return;
    const d = new Date(jumpDateStr + "T00:00:00");
    if (isNaN(d.getTime())) return;
    setWeekStart(getMondayOfWeek(d));
    setShowDatePicker(false);
    setJumpDateStr("");
  };

  const handleJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleJumpToDate();
    }
  };

  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredSlots = useMemo(() => {
    if (statusFilter === "all") return slots;
    if (statusFilter === "available") return slots.filter((s) => s.slot_type === "available");
    return slots.filter((s) => s.slot_type === "booked" && s.session_status === statusFilter);
  }, [slots, statusFilter]);

  // Rebuild cell data from filtered slots
  const filteredCellDataMap = useMemo(() => {
    const map = new Map<string, CellData>();

    filteredSlots.forEach((s) => {
      const cellKey = `${s.date}|${s.start_time}`;
      if (!map.has(cellKey)) {
        map.set(cellKey, {
          booked: [],
          availableSlots: [],
          availableCount: 0,
          availableTeachers: [],
          unavailableCount: 0,
        });
      }
      const cell = map.get(cellKey)!;

      if (s.slot_type === "booked") {
        cell.booked.push(s);
      } else if (s.slot_type === "available") {
        cell.availableCount++;
        cell.availableTeachers.push(s.teacher_name);
        cell.availableSlots.push(s);
      }
    });

    return map;
  }, [filteredSlots]);

  const filteredTimeRange = useMemo(() => {
    const times = new Set<string>();
    filteredSlots.forEach((s) => {
      times.add(s.start_time);
    });
    return Array.from(times).sort();
  }, [filteredSlots]);

  const stats = useMemo(() => {
    const total = slots.length;
    const booked = slots.filter((s) => s.slot_type === "booked").length;
    const available = slots.filter((s) => s.slot_type === "available").length;
    const completed = slots.filter((s) => s.slot_type === "booked" && s.session_status === "completed").length;
    const active = slots.filter((s) => s.slot_type === "booked" && (s.session_status === "active" || s.session_status === "in_progress")).length;
    return { total, booked, available, completed, active };
  }, [slots]);

  return (
    <div>
      {/* Header + Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground-950">{t("auth.adminCalendarTitle")}</h2>
          <p className="text-sm text-foreground-500 mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-background-100 text-foreground-600 border border-background-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            <option value="all">{t("auth.adminCalendarFilterAll", { count: stats.total })}</option>
            <option value="available">{t("auth.adminCalendarFilterAvailable", { count: stats.available })}</option>
            <option value="active">{t("auth.adminCalendarFilterActive", { count: stats.active })}</option>
            <option value="completed">{t("auth.adminCalendarFilterCompleted", { count: stats.completed })}</option>
          </select>

          {/* Date picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDatePicker(!showDatePicker)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-background-100 text-foreground-600 hover:bg-background-200 border border-background-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-calendar-line"></i>
              {t("auth.adminCalendarPickDate")}
            </button>
            {showDatePicker && (
              <div className="absolute top-full mt-2 right-0 z-30 bg-background-50 border border-background-200 rounded-xl p-3 shadow-lg">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={jumpDateStr}
                    onChange={(e) => setJumpDateStr(e.target.value)}
                    onKeyDown={handleJumpKeyDown}
                    className="px-3 py-1.5 rounded-md text-xs border border-background-200 bg-background-50 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300"
                  />
                  <button
                    type="button"
                    onClick={handleJumpToDate}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t("auth.adminCalendarGo")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Week navigation */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrevWeek}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
              title={t("auth.adminCalendarPrevWeek")}
            >
              <i className="ri-arrow-left-s-line"></i>
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr())))}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isCurrentWeek
                  ? "bg-primary-100 text-primary-700 hover:bg-primary-200"
                  : "bg-background-100 text-foreground-500 hover:bg-background-200"
              }`}
            >
              {isCurrentWeek ? t("auth.adminCalendarThisWeek") : t("auth.adminCalendarToday")}
            </button>
            <button
              type="button"
              onClick={handleNextWeek}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
              title={t("auth.adminCalendarNextWeek")}
            >
              <i className="ri-arrow-right-s-line"></i>
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-accent-50 border border-accent-200 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 shrink-0">
            <i className="ri-error-warning-line"></i>
          </div>
          <div>
            <p className="text-sm font-semibold text-accent-800">{t("auth.adminCalendarError")}</p>
            <p className="text-xs text-accent-600 mt-0.5">{error}</p>
            <button
              type="button"
              onClick={fetchData}
              className="mt-2 px-3 py-1 rounded-md text-xs font-medium bg-accent-100 text-accent-700 hover:bg-accent-200 transition-colors cursor-pointer"
            >
              {t("dashboard.retry")}
            </button>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-background-100 text-xs text-foreground-500">
          <span className="font-semibold text-foreground-700">{stats.booked}</span> {t("auth.adminCalendarSessions")}
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-100 text-xs text-accent-700">
          <span className="font-semibold">{stats.available}</span> {t("auth.adminCalendarLegendAvailable")}
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-100 text-xs text-primary-700">
          <span className="font-semibold">{stats.active}</span> {t("auth.adminCalendarActiveLabel")}
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary-100 text-xs text-secondary-700">
          <span className="font-semibold">{stats.completed}</span> {t("auth.adminCalendarCompletedLabel")}
        </div>
      </div>

      {/* Calendar Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
            <p className="text-sm text-foreground-400">{t("auth.adminCalendarLoading")}</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-background-200/70 bg-background-50 overflow-hidden">
          {/* Desktop Grid */}
          <div className="hidden md:block overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-8 border-b border-background-200/70">
                <div className="p-3 border-r border-background-200/70 bg-background-100/50">
                  <span className="text-xs font-medium text-foreground-400">{t("auth.adminCalendarTime")}</span>
                </div>
                {daysOfWeek.map((day, i) => (
                  <div
                    key={i}
                    className={`p-3 text-center border-r border-background-200/70 ${
                      isToday(day) ? "bg-primary-50/50" : ""
                    }`}
                  >
                    <p className="text-xs font-semibold text-foreground-600">{dayLabels[day.getDay()]}</p>
                    <p className={`text-lg font-bold ${isToday(day) ? "text-primary-600" : "text-foreground-900"}`}>
                      {day.getDate()}
                    </p>
                  </div>
                ))}
              </div>

              <div className="max-h-[550px] overflow-y-auto">
                {filteredTimeRange.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-2xl bg-background-100 text-foreground-300">
                      <i className="ri-calendar-event-line text-3xl"></i>
                    </div>
                    <p className="text-sm font-medium text-foreground-500">{t("auth.adminCalendarEmpty")}</p>
                    <p className="text-xs text-foreground-400 mt-1">{t("auth.adminCalendarEmptyHint")}</p>
                  </div>
                ) : (
                  filteredTimeRange.map((time) => (
                    <div key={time} className="grid grid-cols-8 border-b border-background-100/70 min-h-[70px]">
                      <div className="p-2 border-r border-background-200/70 bg-background-50 flex items-center">
                        <span className="text-xs font-medium text-foreground-400">{formatTime12h(time)}</span>
                      </div>
                      {daysOfWeek.map((day, dayIdx) => {
                        const dateStr = toLocalDateStr(day);
                        const cellKey = `${dateStr}|${time}`;
                        const cell = filteredCellDataMap.get(cellKey);
                        const isTodayCell = isToday(day);

                        return (
                          <div
                            key={dayIdx}
                            className={`p-1 border-r border-background-200/70 ${isTodayCell ? "bg-primary-50/30" : ""}`}
                          >
                            {cell && cell.booked.length > 0 ? (
                              (() => {
                                const primary = cell.booked[0];
                                const sessCfg = statusConfig[primary.session_status || "available"] || statusConfig.available;
                                const isEmptyClass = cell.booked.every((s) => (s.booked_count || 0) === 0);
                                const tipKey = `desk-booked-${cellKey}`;
                                const tipOpen = openTooltipKey === tipKey;
                                return (
                                  <div
                                    className={`relative group/slot w-full p-2 rounded-lg text-xs transition-all cursor-pointer ${
                                      isEmptyClass
                                        ? "bg-secondary-100 border border-secondary-200 opacity-80"
                                        : sessCfg.bg
                                    }`}
                                    onClick={() => setOpenTooltipKey(tipOpen ? null : tipKey)}
                                  >
                                    <div className={`absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 w-64 p-3 rounded-xl bg-foreground-900 text-background-50 text-xs shadow-xl transition-all duration-200 pointer-events-none ${
                                      tipOpen ? "opacity-100 visible" : "opacity-0 invisible group-hover/slot:opacity-100 group-hover/slot:visible"
                                    }`}>
                                      <p className="font-semibold text-sm mb-1">
                                        {formatTime12h(primary.start_time)} – {formatTime12h(primary.end_time)}
                                      </p>
                                      <div className="space-y-2 text-foreground-300">
                                        {cell.booked.map((slot, idx) => (
                                          <div key={slot.schedule_id || `${slot.teacher_id}-${idx}`} className="border-t border-foreground-700 pt-2 first:border-0 first:pt-0">
                                            <p className="flex items-center gap-1.5 font-medium text-background-50">
                                              <i className="ri-user-star-line"></i>
                                              {slot.teacher_name}
                                            </p>
                                            <p className="flex items-center gap-1.5 mt-0.5">
                                              <i className="ri-team-line"></i>
                                              {slot.booked_count || 0} / {slot.max_students || 2} {t("auth.adminCalendarLearnersBooked")}
                                            </p>
                                          </div>
                                        ))}
                                        {cell.availableSlots.length > 0 && (
                                          <div className="border-t border-foreground-700 pt-2">
                                            <p className="text-accent-300 font-medium mb-1">{t("auth.adminCalendarLegendAvailable")}</p>
                                            {cell.availableSlots.map((slot, idx) => (
                                              <p key={`avail-${slot.teacher_id}-${idx}`} className="flex items-center gap-1.5">
                                                <i className="ri-user-star-line"></i>
                                                {slot.teacher_name} — 0 / {slot.max_students || 2}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-2 h-2 bg-foreground-900 rotate-45"></div>
                                    </div>

                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isEmptyClass ? "bg-secondary-400" : sessCfg.dot}`}></span>
                                      <span className={`font-semibold truncate ${isEmptyClass ? "text-secondary-700" : "text-foreground-900"}`}>
                                        {primary.teacher_name}
                                        {cell.booked.length > 1 ? ` +${cell.booked.length - 1}` : ""}
                                      </span>
                                    </div>
                                    {primary.learner_name && !isEmptyClass && (
                                      <p className="text-[11px] text-foreground-600 truncate mb-0.5">
                                        <i className="ri-user-line mr-0.5"></i>
                                        {primary.learner_name}
                                        {(primary.booked_count || 0) > 1 && ` +${(primary.booked_count || 0) - 1}`}
                                      </p>
                                    )}
                                    {isEmptyClass && (
                                      <p className="text-[11px] text-secondary-600 truncate mb-0.5">
                                        <i className="ri-user-line mr-0.5"></i>
                                        {t("calendar.noStudents")}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-1.5 text-[10px] text-foreground-400">
                                      <span>{formatDuration(primary.duration_minutes)}</span>
                                      <span>·</span>
                                      <span>{primary.booked_count}/{primary.max_students}</span>
                                      {cell.booked.length > 1 && (
                                        <>
                                          <span>·</span>
                                          <span>{cell.booked.length} GV</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()
                            ) : cell && cell.availableCount > 0 ? (
                              (() => {
                                const tipKey = `desk-avail-${cellKey}`;
                                const tipOpen = openTooltipKey === tipKey;
                                const sample = cell.availableSlots[0];
                                return (
                                  <div
                                    className="relative group/slot w-full p-2 rounded-lg text-xs bg-accent-50 border border-accent-200 cursor-pointer"
                                    onClick={() => setOpenTooltipKey(tipOpen ? null : tipKey)}
                                  >
                                    <div className={`absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 w-64 p-3 rounded-xl bg-foreground-900 text-background-50 text-xs shadow-xl transition-all duration-200 pointer-events-none ${
                                      tipOpen ? "opacity-100 visible" : "opacity-0 invisible group-hover/slot:opacity-100 group-hover/slot:visible"
                                    }`}>
                                      <p className="font-semibold text-sm mb-1">
                                        {sample
                                          ? `${formatTime12h(sample.start_time)} – ${formatTime12h(sample.end_time)}`
                                          : formatTime12h(time)}
                                      </p>
                                      <div className="space-y-1.5 text-foreground-300">
                                        {cell.availableSlots.map((slot, idx) => (
                                          <div key={`a-${slot.teacher_id}-${idx}`}>
                                            <p className="flex items-center gap-1.5 font-medium text-background-50">
                                              <i className="ri-user-star-line"></i>
                                              {slot.teacher_name}
                                            </p>
                                            <p className="flex items-center gap-1.5 text-foreground-400">
                                              <i className="ri-team-line"></i>
                                              0 / {slot.max_students || 2} {t("auth.adminCalendarLearnersBooked")}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-2 h-2 bg-foreground-900 rotate-45"></div>
                                    </div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-accent-500"></span>
                                      <span className="font-semibold text-accent-800">
                                        {t("auth.adminCalendarAvailableTeachers", { count: cell.availableCount })}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-accent-600 truncate">
                                      {cell.availableTeachers.slice(0, 2).join(", ")}
                                      {cell.availableTeachers.length > 2 ? ` +${cell.availableTeachers.length - 2}` : ""}
                                    </p>
                                  </div>
                                );
                              })()
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Mobile List */}
          <div className="md:hidden">
            {filteredSlots.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-2xl bg-background-100 text-foreground-300">
                  <i className="ri-calendar-event-line text-3xl"></i>
                </div>
                <p className="text-sm font-medium text-foreground-500">{t("auth.adminCalendarEmpty")}</p>
              </div>
            ) : (
              <div className="divide-y divide-background-100">
                {daysOfWeek.map((day, dayIdx) => {
                  const dateStr = toLocalDateStr(day);
                  const daySlots = filteredSlots.filter((s) => s.date === dateStr);
                  if (daySlots.length === 0) return null;
                  return (
                    <div key={dayIdx} className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${isToday(day) ? "bg-primary-500 text-background-50" : "bg-background-100 text-foreground-600"}`}>
                          {day.getDate()}
                        </span>
                        <span className="text-sm font-semibold text-foreground-800">{dayLabels[day.getDay()]}</span>
                      </div>
                      <div className="space-y-2">
                        {daySlots.map((slot, sIdx) => {
                          if (slot.slot_type === "available") {
                            const tipKey = `mob-avail-${slot.teacher_id}-${slot.date}-${slot.start_time}`;
                            const tipOpen = openTooltipKey === tipKey;
                            return (
                              <div
                                key={`avail-${sIdx}`}
                                className="relative group/slot p-3 rounded-lg bg-accent-50 border border-accent-200 cursor-pointer"
                                onClick={() => setOpenTooltipKey(tipOpen ? null : tipKey)}
                              >
                                <div className={`absolute z-50 top-full right-0 mt-1 w-60 p-3 rounded-xl bg-foreground-900 text-background-50 text-xs shadow-xl transition-all duration-200 pointer-events-none ${
                                  tipOpen ? "opacity-100 visible" : "opacity-0 invisible group-hover/slot:opacity-100 group-hover/slot:visible"
                                }`}>
                                  <p className="font-semibold text-sm mb-1">
                                    {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                                  </p>
                                  <div className="space-y-1 text-foreground-300">
                                    <p className="flex items-center gap-1.5 font-medium text-background-50">
                                      <i className="ri-user-star-line"></i>
                                      {slot.teacher_name}
                                    </p>
                                    <p className="flex items-center gap-1.5">
                                      <i className="ri-team-line"></i>
                                      0 / {slot.max_students || 2} {t("auth.adminCalendarLearnersBooked")}
                                    </p>
                                  </div>
                                  <div className="absolute bottom-full right-4 w-2 h-2 bg-foreground-900 rotate-45"></div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-accent-500"></span>
                                  <span className="font-semibold text-sm text-accent-800">{slot.teacher_name}</span>
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-200 text-accent-700">
                                    {t("auth.adminCalendarLegendAvailable")}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-accent-600 mt-1">
                                  <span>{formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}</span>
                                  <span>·</span>
                                  <span>{formatDuration(slot.duration_minutes)}</span>
                                </div>
                              </div>
                            );
                          }
                          // Booked slot
                          const cfg = statusConfig[slot.session_status || "available"] || statusConfig.available;
                          const isEmptyClass = (slot.booked_count || 0) === 0;
                          const tipKey = `mob-booked-${slot.schedule_id || sIdx}`;
                          const tipOpen = openTooltipKey === tipKey;
                          return (
                            <div
                              key={slot.schedule_id || `booked-${sIdx}`}
                              className={`relative group/slot p-3 rounded-lg cursor-pointer ${
                              isEmptyClass ? "bg-secondary-100 border border-secondary-200 opacity-80" : cfg.bg
                            }`}
                              onClick={() => setOpenTooltipKey(tipOpen ? null : tipKey)}
                            >
                              {/* Hover / tap tooltip */}
                              <div className={`absolute z-50 top-full right-0 mt-1 w-60 p-3 rounded-xl bg-foreground-900 text-background-50 text-xs shadow-xl transition-all duration-200 pointer-events-none ${
                                tipOpen ? "opacity-100 visible" : "opacity-0 invisible group-hover/slot:opacity-100 group-hover/slot:visible"
                              }`}>
                                <p className="font-semibold text-sm mb-1">
                                  {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                                </p>
                                <div className="space-y-1 text-foreground-300">
                                  <p className="flex items-center gap-1.5 font-medium text-background-50">
                                    <i className="ri-user-star-line"></i>
                                    {slot.teacher_name}
                                  </p>
                                  <p className="flex items-center gap-1.5">
                                    <i className="ri-team-line"></i>
                                    {slot.booked_count || 0} / {slot.max_students || 2} {t("auth.adminCalendarLearnersBooked")}
                                  </p>
                                  {slot.session_number && (
                                    <p className="flex items-center gap-1.5">
                                      <i className="ri-book-3-line"></i>
                                      {t("auth.adminCalendarSessionNum", { num: slot.session_number })}
                                    </p>
                                  )}
                                </div>
                                <div className="absolute bottom-full right-4 w-2 h-2 bg-foreground-900 rotate-45"></div>
                              </div>

                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${isEmptyClass ? "bg-secondary-400" : cfg.dot}`}></span>
                                  <span className={`font-semibold text-sm ${isEmptyClass ? "text-secondary-700" : "text-foreground-900"}`}>{slot.teacher_name}</span>
                                </div>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getBadgeClass(slot.session_status || "available", isEmptyClass)}`}>
                                  {isEmptyClass ? t("calendar.emptyBadge") : getStatusLabel(slot)}
                                </span>
                              </div>
                              {slot.learner_name && !isEmptyClass && (
                                <p className="text-xs text-foreground-600 mb-1">
                                  <i className="ri-user-line mr-1"></i>
                                  {slot.learner_name}
                                  {(slot.booked_count || 0) > 1 && ` +${(slot.booked_count || 0) - 1}`}
                                </p>
                              )}
                              {isEmptyClass && (
                                <p className="text-xs text-secondary-600 mb-1">
                                  <i className="ri-user-line mr-1"></i>
                                  Chưa có học viên
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-xs text-foreground-500">
                                <span>{formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}</span>
                                <span>·</span>
                                <span>{formatDuration(slot.duration_minutes)}</span>
                                {slot.session_number && (
                                  <>
                                    <span>·</span>
                                    <span>{t("auth.adminCalendarSessionNum", { num: slot.session_number })}</span>
                                  </>
                                )}
                                <span>·</span>
                                <span>{slot.booked_count}/{slot.max_students}</span>
                              </div>
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
          {t("auth.adminCalendarLegendAvailable")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-primary-100 border border-primary-200"></span>
          <span className="w-2 h-2 rounded-full bg-primary-500"></span>
          {t("auth.adminCalendarLegendActive")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-secondary-100 border border-secondary-300"></span>
          <span className="w-2 h-2 rounded-full bg-secondary-500"></span>
          {t("auth.adminCalendarLegendCompleted")}
        </span>
      </div>
    </div>
  );
}