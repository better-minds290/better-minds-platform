import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import ClassModal from "./ClassModal";
import ClassStudentsPanel from "./ClassStudentsPanel";
import {
  calendarDateToLocalDate,
  formatVietnamDateShortVi,
  getMondayOfWeek,
  toLocalDateStr,
  vietnamTodayStr,
} from "@/lib/datetime";

interface ClassData {
  id: string;
  name: string;
  course_id: string | null;
  course_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  teacher_role: string | null;
  subject: string;
  level: string;
  room: string;
  max_students: number;
  status: string;
  student_count: number;
  created_at: string;
  schedule_text: string;
  is_current_week: boolean;
  session_stats: {
    total: number;
    completed: number;
    in_progress: number;
    locked: number;
  };
}

function formatTimeShort(time: string): string {
  if (!time) return "";
  const t = time.length > 5 ? time.substring(0, 5) : time;
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

export default function AdminClasses() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClassData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Students panel state
  const [studentsPanelOpen, setStudentsPanelOpen] = useState(false);
  const [studentsPanelClass, setStudentsPanelClass] = useState<ClassData | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchClasses = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabase();

      const weekMonday = getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr()));
      const weekSunday = new Date(weekMonday);
      weekSunday.setDate(weekMonday.getDate() + 6);
      const weekMondayStr = toLocalDateStr(weekMonday);
      const weekSundayStr = toLocalDateStr(weekSunday);

      const [classesRes, coursesRes, teachersRes, enrollRes] = await Promise.all([
        supabase.from("classes").select("*").order("created_at", { ascending: false }),
        supabase.from("courses").select("id, name"),
        supabase.from("profiles").select("id, full_name, role").in("role", ["vietnamese_teacher", "foreign_teacher"]),
        supabase.from("class_enrollments").select("class_id, student_id"),
      ]);

      if (classesRes.error || !classesRes.data || classesRes.data.length === 0) {
        setClasses([]);
        return;
      }

      const classIds = classesRes.data.map((c: any) => c.id);

      const courseMap = new Map<string, string>();
      (coursesRes.data || []).forEach((c) => courseMap.set(c.id, c.name));

      const teacherMap = new Map<string, { full_name: string; role: string }>();
      (teachersRes.data || []).forEach((t) => teacherMap.set(t.id, { full_name: t.full_name, role: t.role }));

      const studentCounts = new Map<string, number>();
      (enrollRes.data || []).forEach((en) => {
        studentCounts.set(en.class_id, (studentCounts.get(en.class_id) || 0) + 1);
      });

      // Fetch schedules & sessions in parallel
      const [schedulesRes, sessionsRes] = await Promise.all([
        supabase.from("class_schedules").select("class_id, date, start_time, end_time").in("class_id", classIds).order("date").order("start_time"),
        supabase.from("sprint_sessions").select("class_id, status").in("class_id", classIds),
      ]);

      // Build schedule map: class_id → [{ date, start_time, end_time }]
      const scheduleMap = new Map<string, { date: string; start_time: string; end_time: string }[]>();
      (schedulesRes.data || []).forEach((s: any) => {
        if (!scheduleMap.has(s.class_id)) scheduleMap.set(s.class_id, []);
        scheduleMap.get(s.class_id)!.push({ date: s.date, start_time: s.start_time, end_time: s.end_time });
      });

      // Build session stats map: class_id → { total, completed, in_progress, locked }
      const sessionStatsMap = new Map<string, { total: number; completed: number; in_progress: number; locked: number }>();
      (sessionsRes.data || []).forEach((s: any) => {
        if (!sessionStatsMap.has(s.class_id)) {
          sessionStatsMap.set(s.class_id, { total: 0, completed: 0, in_progress: 0, locked: 0 });
        }
        const stats = sessionStatsMap.get(s.class_id)!;
        stats.total++;
        if (s.status === "completed") stats.completed++;
        else if (s.status === "in_progress") stats.in_progress++;
        else if (s.status === "locked") stats.locked++;
      });

      const merged: ClassData[] = classesRes.data.map((c: any) => {
        const courseInfo = c.course_id ? courseMap.get(c.course_id) : null;
        const teacherInfo = c.teacher_id ? teacherMap.get(c.teacher_id) : null;
        const classSchedules = scheduleMap.get(c.id) || [];
        const stats = sessionStatsMap.get(c.id) || { total: 0, completed: 0, in_progress: 0, locked: 0 };

        // Build schedule text: "20/07 (T2) 8:00 AM–9:00 AM, 22/07 (T4) 10:00 AM–11:00 AM"
        let scheduleText = "";
        if (classSchedules.length > 0) {
          scheduleText = classSchedules.map((s) => {
            return `${formatVietnamDateShortVi(s.date)} ${formatTimeShort(s.start_time)}–${formatTimeShort(s.end_time)}`;
          }).join(", ");
        }

        // Check if class has any schedule in current week
        let isCurrentWeek = false;
        for (const s of classSchedules) {
          if (s.date >= weekMondayStr && s.date <= weekSundayStr) {
            isCurrentWeek = true;
            break;
          }
        }

        return {
          id: c.id,
          name: c.name || "Untitled",
          course_id: c.course_id || null,
          course_name: courseInfo || null,
          teacher_id: c.teacher_id || null,
          teacher_name: teacherInfo?.full_name || null,
          teacher_role: teacherInfo?.role || null,
          subject: c.subject || "-",
          level: c.level || "-",
          room: c.room || "-",
          max_students: c.max_students ?? 15,
          status: c.status || "draft",
          student_count: studentCounts.get(c.id) || 0,
          created_at: c.created_at || "",
          schedule_text: scheduleText,
          is_current_week: isCurrentWeek,
          session_stats: stats,
        };
      });

      // Sort: current-week classes first, then by created_at desc
      merged.sort((a, b) => {
        if (a.is_current_week && !b.is_current_week) return -1;
        if (!a.is_current_week && b.is_current_week) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setClasses(merged);
    } catch (err) {
      console.error("Failed to fetch classes:", err);
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const handleCreate = () => {
    setEditingClass(null);
    setModalOpen(true);
  };

  const handleEdit = (cls: ClassData) => {
    setEditingClass(cls);
    setModalOpen(true);
  };

  const handleModalSuccess = () => {
    showToast(
      "success",
      editingClass ? t("auth.adminClassUpdateSuccess") : t("auth.adminClassCreateSuccess")
    );
    fetchClasses();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const { error: delErr } = await supabase.from("classes").delete().eq("id", deleteTarget.id);
      if (delErr) throw delErr;
      showToast("success", t("auth.adminClassDeleteSuccess"));
      setDeleteTarget(null);
      fetchClasses();
    } catch (err) {
      console.error("Delete class error:", err);
      showToast("error", t("auth.adminClassError"));
    } finally {
      setDeleting(false);
    }
  };

  // Only show classes with schedules in the current week
  const currentWeekClasses = classes.filter((c) => c.is_current_week);

  const filtered = currentWeekClasses.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.course_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.teacher_name || "").toLowerCase().includes(search.toLowerCase()) ||
      c.subject.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const activeCount = currentWeekClasses.filter((c) => {
    const isFullyCompleted =
      c.session_stats.total > 0 &&
      c.session_stats.completed === c.session_stats.total;
    return !isFullyCompleted;
  }).length;
  const totalStudents = currentWeekClasses.reduce((sum, c) => sum + c.student_count, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
            {t("auth.adminClassManagement")}
          </h2>
          <p className="text-sm text-foreground-500">{t("auth.adminClassSubtitle")}</p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-background-50 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-add-line text-base"></i>
          {t("auth.adminCreateClass")}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">{t("auth.adminActiveClasses")}</p>
          <p className="font-heading text-2xl font-bold text-accent-600">{activeCount}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">{t("auth.adminThisWeekClasses")}</p>
          <p className="font-heading text-2xl font-bold text-foreground-950">{currentWeekClasses.length}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">{t("auth.adminStudents")}</p>
          <p className="font-heading text-2xl font-bold text-primary-600">{totalStudents}</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("auth.adminSearchClasses")}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchClasses}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-foreground-400">Loading classes...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-4">
            <i className="ri-building-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.adminNoClasses")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((cls) => (
            <div
              key={cls.id}
              className="group p-5 rounded-xl bg-background-50 border border-background-200 hover:border-background-300 transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading text-base font-semibold text-foreground-950 mb-0.5 truncate">
                    {cls.name}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => {
                      const isCompleted =
                        cls.status === "active" &&
                        cls.session_stats.total > 0 &&
                        cls.session_stats.completed === cls.session_stats.total;
                      if (isCompleted) {
                        return (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-primary-100 text-primary-700">
                            {t("auth.adminCompleted")}
                          </span>
                        );
                      }
                      return (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                            cls.status === "active"
                              ? "bg-accent-100 text-accent-700"
                              : "bg-background-200 text-foreground-500"
                          }`}
                        >
                          {t(cls.status === "active" ? "auth.adminActive" : "auth.adminDraft")}
                        </span>
                      );
                    })()}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-primary-100 text-primary-700 whitespace-nowrap">
                      {cls.level}
                    </span>
                    {cls.is_current_week && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-100 text-accent-700 whitespace-nowrap">
                        {t("auth.adminThisWeek")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={() => {
                      setStudentsPanelClass(cls);
                      setStudentsPanelOpen(true);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-primary-50 text-foreground-400 hover:text-primary-500 transition-colors cursor-pointer"
                    title={t("auth.adminClassStudentsTitle")}
                  >
                    <i className="ri-group-line text-sm"></i>
                  </button>
                  <button
                    onClick={() => handleEdit(cls)}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-background-200 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                    title={t("auth.adminEdit")}
                  >
                    <i className="ri-pencil-line text-sm"></i>
                  </button>
                  <button
                    onClick={() => setDeleteTarget(cls)}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent-50 text-foreground-400 hover:text-accent-500 transition-colors cursor-pointer"
                    title={t("auth.adminDelete")}
                  >
                    <i className="ri-delete-bin-line text-sm"></i>
                  </button>
                </div>
              </div>

              {/* Course & Teacher info */}
              <div className="space-y-2 mb-4">
                {cls.course_name && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-6 h-6 flex items-center justify-center rounded-md bg-primary-50 text-primary-500 flex-shrink-0">
                      <i className="ri-book-open-line text-xs"></i>
                    </div>
                    <span className="text-foreground-600 font-medium">{cls.course_name}</span>
                  </div>
                )}
                {cls.teacher_name ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-6 h-6 rounded-full bg-secondary-100 flex items-center justify-center text-[10px] font-semibold text-secondary-700 flex-shrink-0">
                      {cls.teacher_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-foreground-600 font-medium">{cls.teacher_name}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                      cls.teacher_role === "foreign_teacher"
                        ? "bg-accent-100 text-accent-700"
                        : "bg-secondary-100 text-secondary-700"
                    }`}>
                      {cls.teacher_role === "foreign_teacher" ? t("auth.adminCourseTeacherForeign") : t("auth.adminCourseTeacherVN")}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-foreground-400">
                    <div className="w-6 h-6 flex items-center justify-center rounded-md bg-background-100 text-foreground-300 flex-shrink-0">
                      <i className="ri-user-unfollow-line text-xs"></i>
                    </div>
                    <span>{t("auth.adminClassNoTeacher")}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 flex-wrap text-xs text-foreground-400">
                <span className="inline-flex items-center gap-1">
                  <i className="ri-book-read-line text-foreground-400"></i>
                  {cls.subject}
                </span>
                {cls.room && cls.room !== "-" && (
                  <span className="inline-flex items-center gap-1">
                    <i className="ri-map-pin-line text-foreground-400"></i>
                    {cls.room}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <i className="ri-user-line text-foreground-400"></i>
                  {cls.student_count}/{cls.max_students} {t("auth.adminStudents").toLowerCase()}
                </span>
              </div>

              {/* Schedule info */}
              {cls.schedule_text && (
                <div className="mt-3 flex items-start gap-1.5 text-xs text-foreground-500">
                  <i className="ri-calendar-line text-foreground-400 mt-0.5 flex-shrink-0"></i>
                  <span className="leading-relaxed">{cls.schedule_text}</span>
                </div>
              )}

              {/* Session status summary */}
              {cls.session_stats.total > 0 && (
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  {cls.session_stats.completed > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0"></span>
                      <span className="text-foreground-600 font-medium">{cls.session_stats.completed}</span>
                      <span className="text-foreground-400">{t("auth.adminSessionDone")}</span>
                    </span>
                  )}
                  {cls.session_stats.in_progress > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <span className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0"></span>
                      <span className="text-foreground-600 font-medium">{cls.session_stats.in_progress}</span>
                      <span className="text-foreground-400">{t("auth.adminSessionActive")}</span>
                    </span>
                  )}
                  {cls.session_stats.locked > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <span className="w-2 h-2 rounded-full bg-foreground-300 flex-shrink-0"></span>
                      <span className="text-foreground-600 font-medium">{cls.session_stats.locked}</span>
                      <span className="text-foreground-400">{t("auth.adminSessionLocked")}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-foreground-400">
        {filtered.length} / {currentWeekClasses.length} {t("auth.adminClasses").toLowerCase()} – {t("auth.adminThisWeek")}
      </p>

      <ClassModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingClass(null);
        }}
        onSuccess={handleModalSuccess}
        editClass={editingClass}
      />

      <ClassStudentsPanel
        open={studentsPanelOpen}
        onClose={() => {
          setStudentsPanelOpen(false);
          setStudentsPanelClass(null);
        }}
        classId={studentsPanelClass?.id || ""}
        className={studentsPanelClass?.name || ""}
        classTeacherId={studentsPanelClass?.teacher_id || null}
        classTeacherName={studentsPanelClass?.teacher_name || null}
        onSuccess={(message) => {
          showToast("success", message);
          fetchClasses();
        }}
      />

      {/* Delete Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteTarget(null)}
          ></div>
          <div className="relative w-full max-w-sm mx-4 bg-background-50 rounded-2xl border border-background-200 shadow-lg p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-11 h-11 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
              <i className="ri-delete-bin-line text-xl text-accent-500"></i>
            </div>
            <h3 className="text-center font-heading text-lg font-semibold text-foreground-950 mb-1.5">
              {t("auth.adminDeleteClassConfirmTitle")}
            </h3>
            <p className="text-center text-sm text-foreground-500 mb-6">
              {t("auth.adminDeleteClassConfirmMessage")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground-700 bg-background-100 hover:bg-background-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-background-50 bg-accent-500 hover:bg-accent-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deleting && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                )}
                {deleting ? "..." : t("auth.adminDeleteConfirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-lg text-sm font-medium shadow-lg animate-in slide-in-from-bottom-4 duration-300 max-w-xs ${
            toast.type === "success"
              ? "bg-primary-500 text-background-50"
              : "bg-accent-500 text-background-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <i className={toast.type === "success" ? "ri-check-line" : "ri-error-warning-line"}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}