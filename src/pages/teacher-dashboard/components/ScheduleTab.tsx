import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { formatVietnamDate, getUiDateLocale } from "@/lib/datetime";

import AttendanceModal from "./AttendanceModal";
import ClassDetailPanel from "./ClassDetailPanel";

interface ScheduleTabProps {
  todayStr: string;
}

type FilterType = "all" | "upcoming" | "completed";

interface ClassData {
  id: string;
  name: string;
  teacher_id: string;
  subject: string;
  level: string;
  room: string;
  status: string;
  max_students: number;
  created_at: string;
  course_id?: string;
}

interface ScheduleData {
  id: string;
  class_id: string;
  teacher_id: string;
  date: string;
  start_time: string;
  end_time: string;
  type: string;
  status: string;
  created_at: string;
}

interface EnrollmentData {
  id: string;
  class_id: string;
  student_id: string;
  enrolled_at: string;
}

interface SprintSessionData {
  id: string;
  class_id: string;
  session_number: number;
  status: string;
}

export default function ScheduleTab({ todayStr }: ScheduleTabProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getUiDateLocale(i18n.language);
  const { profile } = useAuth();
  const [filter, setFilter] = useState<FilterType>("upcoming");
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentData[]>([]);
  const [sprintSessions, setSprintSessions] = useState<SprintSessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Attendance modal state
  const [attendanceTarget, setAttendanceTarget] = useState<ScheduleData | null>(null);
  const [attendanceChecked, setAttendanceChecked] = useState<Record<string, boolean>>({});

  // Helper: determine TRUE completion by cross-referencing sprint_sessions
  const isTrulyCompleted = useCallback((scheduleId: string, classId: string): boolean => {
    const sched = schedules.find((s) => s.id === scheduleId);
    if (!sched || sched.status !== "completed") return false;
    // If class_schedules says completed, also check sprint_sessions
    const linked = sprintSessions.filter((ss) => ss.class_id === classId);
    if (linked.length === 0) return false; // No sprint session = not truly completed
    return linked.every((ss) => ss.status === "completed");
  }, [schedules, sprintSessions]);

  const fetchData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(false);
    try {
      const supabase = getSupabase();
      const [classesRes, schedulesRes] = await Promise.all([
        supabase.from("classes").select("*").eq("teacher_id", profile.id).order("created_at", { ascending: false }),
        supabase.from("class_schedules").select("*").eq("teacher_id", profile.id).order("date", { ascending: true }),
      ]);

      if (classesRes.error) throw classesRes.error;
      if (schedulesRes.error) throw schedulesRes.error;

      const classData = (classesRes.data || []) as ClassData[];
      setClasses(classData);
      setSchedules((schedulesRes.data || []) as ScheduleData[]);

      // Fetch enrollments + sprint_sessions in parallel
      if (classData.length > 0) {
        const classIds = classData.map((c) => c.id);
        const [enrRes, sprintRes] = await Promise.all([
          supabase.from("class_enrollments").select("*").in("class_id", classIds),
          supabase.from("sprint_sessions").select("id, class_id, session_number, status").in("class_id", classIds),
        ]);
        setEnrollments((enrRes.data || []) as EnrollmentData[]);
        setSprintSessions((sprintRes.data || []) as SprintSessionData[]);
      } else {
        setEnrollments([]);
        setSprintSessions([]);
      }

      // Check attendance records
      if ((schedulesRes.data || []).length > 0) {
        const scheduleIds = (schedulesRes.data as ScheduleData[]).map((s) => s.id);
        const { data: attData } = await supabase
          .from("session_attendance")
          .select("schedule_id")
          .in("schedule_id", scheduleIds);

        const checked: Record<string, boolean> = {};
        (attData || []).forEach((a: { schedule_id: string }) => {
          checked[a.schedule_id] = true;
        });
        setAttendanceChecked(checked);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const displayClasses = classes;
  const displaySchedules = schedules;
  const displayEnrollments = enrollments;
  const displaySprintSessions = sprintSessions;

  // Build enriched class data with schedule and enrollment info
  const enrichedClasses = useMemo(() => {
    return displayClasses.map((cls) => {
      const classSchedules = displaySchedules.filter((s) => s.class_id === cls.id);
      const studentCount = displayEnrollments.filter((e) => e.class_id === cls.id).length;

      // Cross-reference sprint_sessions for true completion
      const linkedSessions = displaySprintSessions.filter((ss) => ss.class_id === cls.id);

      // Mark each schedule: is it TRULY completed?
      const schedulesWithTrueStatus = classSchedules.map((sched) => {
        let trueStatus = sched.status;
        // If class_schedules says completed but sprint_sessions don't agree → not completed
        if (sched.status === "completed") {
          if (linkedSessions.length === 0) {
            trueStatus = "open"; // No sprint session = shouldn't be marked completed
          } else if (!linkedSessions.every((ss) => ss.status === "completed")) {
            trueStatus = "open"; // Sprint session not completed = shouldn't show as completed
          }
        }
        return { ...sched, trueStatus };
      });

      const upcomingCount = schedulesWithTrueStatus.filter((s) => s.trueStatus !== "completed" && s.date >= todayStr).length;
      const completedCount = schedulesWithTrueStatus.filter((s) => s.trueStatus === "completed").length;
      const studentCountFinal = studentCount;

      let filteredScheds = [...schedulesWithTrueStatus];
      if (filter === "upcoming") {
        filteredScheds = filteredScheds.filter((s) => s.date >= todayStr && s.trueStatus !== "completed");
      } else if (filter === "completed") {
        filteredScheds = filteredScheds.filter((s) => s.trueStatus === "completed");
      }
      filteredScheds.sort((a, b) => {
        if (filter === "completed") return b.date.localeCompare(a.date);
        return a.date.localeCompare(b.date);
      });

      const matchesFilter = filter === "all" || filteredScheds.length > 0;

      return { ...cls, classSchedules: schedulesWithTrueStatus, upcomingCount, completedCount, studentCount: studentCountFinal, filteredScheds, matchesFilter };
    }).filter((c) => c.matchesFilter);
  }, [displayClasses, displaySchedules, displayEnrollments, displaySprintSessions, filter, todayStr]);

  const formatDate = (dateStr: string) => {
    return formatVietnamDate(dateStr, { weekday: "short", month: "short", day: "numeric", year: "numeric" }, dateLocale);
  };

  const formatTimeShort = (time: string) => {
    const [h] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}${period}`;
  };

  const handleMarkComplete = async (scheduleId: string, classId: string) => {
    setUpdatingId(scheduleId);
    try {
      const supabase = getSupabase();

      // Check if class has any enrollments (empty class = cannot complete)
      const classEnrollments = displayEnrollments.filter((e) => e.class_id === classId);
      if (classEnrollments.length === 0) {
        setToast({
          message: t("teacher.scheduleEmptyClassToast"),
          type: "error",
        });
        setUpdatingId(null);
        return;
      }

      // Check if there are linked sprint_sessions
      const { data: linkedSessions } = await supabase
        .from("sprint_sessions")
        .select("id, status")
        .eq("class_id", classId);

      if (!linkedSessions || linkedSessions.length === 0) {
        setToast({
          message: t("teacher.scheduleNoSprintToast"),
          type: "error",
        });
        setUpdatingId(null);
        return;
      }

      const ungradedSessions = linkedSessions.filter(
        (s: any) => s.status !== "completed"
      );
      if (ungradedSessions.length > 0) {
        setToast({
          message: t("teacher.scheduleUngradedToast", { count: ungradedSessions.length }),
          type: "error",
        });
        setUpdatingId(null);
        return;
      }

      const { error: updateErr } = await supabase
        .from("class_schedules")
        .update({ status: "completed" })
        .eq("id", scheduleId);

      if (updateErr) throw updateErr;
      setSchedules((prev) =>
        prev.map((s) => (s.id === scheduleId ? { ...s, status: "completed" } : s))
      );
      setToast({ message: t("teacher.scheduleUpdated"), type: "success" });
    } catch {
      setToast({ message: t("teacher.scheduleUpdateError"), type: "error" });
    } finally {
      setUpdatingId(null);
    }
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: t("teacher.filterAll") },
    { key: "upcoming", label: t("teacher.filterUpcoming") },
    { key: "completed", label: t("teacher.filterCompleted") },
  ];

  // Loading state
  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-9 w-56 rounded-full bg-background-100"></div>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-background-50 border border-background-200/70"></div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-error-warning-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-700 font-medium mb-1">{t("teacher.fetchError")}</p>
        <button
          onClick={fetchData}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line"></i>
          {t("teacher.retry")}
        </button>
      </div>
    );
  }

  // Empty state
  if (displayClasses.length === 0) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-calendar-2-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-900 font-semibold mb-1">{t("teacher.noClassesYet")}</p>
        <p className="text-xs text-foreground-500">{t("teacher.noClassesYetDesc")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center mb-6">
        <div className="flex items-center bg-background-100 rounded-full p-0.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                filter === f.key
                  ? "bg-background-50 text-foreground-950 shadow-sm"
                  : "text-foreground-500 hover:text-foreground-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="mb-5">
        <h3 className="font-heading text-lg font-bold text-foreground-950 mb-1">{t("teacher.scheduleTitle")}</h3>
        <p className="text-sm text-foreground-500">{t("teacher.scheduleSubtitle")}</p>
      </div>

      {/* Empty filtered */}
      {enrichedClasses.length === 0 ? (
        <div className="p-10 rounded-xl bg-background-50 border border-background-200/70 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
            <i className="ri-calendar-2-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500 font-medium">
            {filter === "completed" ? t("teacher.noCompleted") : t("teacher.noUpcoming")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {enrichedClasses.map((cls) => {
            const isExpanded = expandedClassId === cls.id;
            const totalSchedules = cls.classSchedules.length;

            return (
              <div
                key={cls.id}
                className={`rounded-xl border transition-all duration-200 ${
                  isExpanded ? "border-primary-200 bg-primary-50/20" : "border-background-200/70 bg-background-50"
                }`}
              >
                {/* Class header - clickable */}
                <button
                  onClick={() => setExpandedClassId(isExpanded ? null : cls.id)}
                  className="w-full text-left p-5 cursor-pointer group"
                >
                  <div className="flex items-start gap-4">
                    {/* Class icon */}
                    <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${
                      isExpanded ? "bg-primary-100 text-primary-600" : "bg-accent-100 text-accent-600"
                    }`}>
                      <i className="ri-book-open-line text-lg"></i>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h4 className="text-base font-heading font-bold text-foreground-950">{cls.name}</h4>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                          {cls.subject}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-background-100 text-foreground-600 whitespace-nowrap">
                          {cls.level}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 flex-wrap text-xs text-foreground-500 mt-1">
                        <span className="flex items-center gap-1">
                          <i className="ri-map-pin-line text-foreground-300"></i>
                          {cls.room || "-"}
                        </span>
                        <span className="flex items-center gap-1">
                          <i className="ri-group-line text-foreground-300"></i>
                          {cls.studentCount}/{cls.max_students} {t("teacher.students")}
                        </span>
                        {cls.studentCount >= cls.max_students && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent-100 text-accent-600 whitespace-nowrap">
                            {t("teacher.full")}
                          </span>
                        )}
                        {cls.studentCount === 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                            <i className="ri-user-unfollow-line"></i>
                            {t("teacher.scheduleEmpty")}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <i className="ri-calendar-2-line text-foreground-300"></i>
                          {totalSchedules} {t("teacher.lessons")}
                        </span>
                        {cls.upcomingCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary-100 text-primary-700 whitespace-nowrap">
                            <i className="ri-time-line"></i>
                            {cls.upcomingCount} {t("teacher.upcoming").toLowerCase()}
                          </span>
                        )}
                      </div>

                      {/* Inline upcoming schedule preview */}
                      {cls.filteredScheds.slice(0, 3).length > 0 && (
                        <div className="mt-3 space-y-1">
                          {cls.filteredScheds.slice(0, 3).map((sched) => {
                            const isTrulyComplete = sched.trueStatus === "completed";
                            const isPastDate = sched.date < todayStr;
                            const isTodayCell = sched.date === todayStr;
                            const isEmptyClass = cls.studentCount === 0;
                            return (
                              <div key={sched.id} className="flex items-center gap-3 text-xs">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isTrulyComplete ? "bg-primary-400" :
                                  isEmptyClass ? "bg-secondary-400" :
                                  isTodayCell ? "bg-primary-500" : "bg-accent-500"
                                }`}></span>
                                <span className={`font-medium min-w-[80px] ${
                                  isTrulyComplete ? "text-foreground-400 line-through" :
                                  isEmptyClass ? "text-secondary-500" :
                                  "text-foreground-700"
                                }`}>
                                  {formatDate(sched.date)}
                                </span>
                                <span className={`font-mono ${
                                  isTrulyComplete ? "text-foreground-400" :
                                  isEmptyClass ? "text-secondary-500" :
                                  "text-foreground-600"
                                }`}>
                                  {formatTimeShort(sched.start_time)} – {formatTimeShort(sched.end_time)}
                                </span>
                                {isTodayCell && !isTrulyComplete && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-primary-500 text-background-50 whitespace-nowrap">
                                    {t("teacher.filterToday")}
                                  </span>
                                )}
                                {isTrulyComplete && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                                    <i className="ri-check-double-line mr-0.5"></i>
                                    {t("teacher.completed")}
                                  </span>
                                )}
                                {isEmptyClass && !isTrulyComplete && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                                    <i className="ri-user-unfollow-line"></i>
                                    {t("teacher.scheduleEmpty")}
                                  </span>
                                )}
                                {/* Mini action buttons — only for non-completed, non-empty classes */}
                                {!isTrulyComplete && !isEmptyClass && (
                                  <div className="flex items-center gap-1 ml-auto">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setAttendanceTarget(sched); }}
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                        attendanceChecked[sched.id]
                                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                          : "bg-secondary-100 text-secondary-700 hover:bg-secondary-200"
                                      }`}
                                    >
                                      <i className={`text-[9px] ${attendanceChecked[sched.id] ? "ri-check-double-line" : "ri-clipboard-line"}`}></i>
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleMarkComplete(sched.id, cls.id); }}
                                      disabled={updatingId === sched.id}
                                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                                    >
                                      {updatingId === sched.id ? (
                                        <i className="ri-loader-4-line animate-spin text-[9px]"></i>
                                      ) : (
                                        <i className="ri-check-line text-[9px]"></i>
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {cls.filteredScheds.length > 3 && (
                            <p className="text-[10px] text-foreground-400 pl-4">{t("teacher.scheduleMoreLessons", { count: cls.filteredScheds.length - 3 })}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expand chevron */}
                    <div className="shrink-0 self-center">
                      <i className={`text-foreground-300 text-lg transition-transform duration-200 ${isExpanded ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}`}></i>
                    </div>
                  </div>
                </button>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="px-5 pb-5">
                    <ClassDetailPanel
                      classId={cls.id}
                      className={cls.name}
                      classSubject={cls.subject}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Attendance Modal */}
      {attendanceTarget && (
        <AttendanceModal
          scheduleId={attendanceTarget.id}
          classId={attendanceTarget.class_id}
          scheduleDate={attendanceTarget.date}
          scheduleTime={`${attendanceTarget.start_time} - ${attendanceTarget.end_time}`}
          className={displayClasses.find((c) => c.id === attendanceTarget.class_id)?.name || t("teacher.unknownName")}
          onClose={() => {
            setAttendanceTarget(null);
            fetchData();
          }}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-lg transition-all duration-300 ${
          toast.type === "success"
            ? "bg-primary-500 text-background-50"
            : "bg-accent-500 text-background-50"
        }`}>
          <div className="flex items-center gap-2">
            <i className={`text-base ${toast.type === "success" ? "ri-checkbox-circle-line" : "ri-close-circle-line"}`}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}