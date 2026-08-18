import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import { formatVietnamDate } from "@/lib/datetime";

interface AttendanceModalProps {
  scheduleId: string;
  classId: string;
  scheduleDate: string;
  scheduleTime: string;
  className: string;
  onClose: () => void;
}

interface Student {
  id: string;
  full_name: string;
  email: string;
}

interface AttendanceRecord {
  id: string;
  schedule_id: string;
  student_id: string;
  status: "present" | "absent" | "late" | "excused";
  note: string;
}

type AttendanceStatus = "present" | "absent" | "late" | "excused";

const STATUS_OPTIONS: { key: AttendanceStatus; icon: string; color: string; bg: string }[] = [
  { key: "present", icon: "ri-checkbox-circle-fill", color: "text-emerald-600", bg: "bg-emerald-100" },
  { key: "absent", icon: "ri-close-circle-fill", color: "text-accent-600", bg: "bg-accent-100" },
  { key: "late", icon: "ri-time-fill", color: "text-secondary-600", bg: "bg-secondary-100" },
  { key: "excused", icon: "ri-indeterminate-circle-fill", color: "text-primary-600", bg: "bg-primary-100" },
];

export default function AttendanceModal({
  scheduleId,
  classId,
  scheduleDate,
  scheduleTime,
  className,
  onClose,
}: AttendanceModalProps) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const supabase = getSupabase();

      // Fetch enrolled students
      const { data: enrollments, error: enrollErr } = await supabase
        .from("class_enrollments")
        .select("student_id, profiles!student_id(id, full_name, email)")
        .eq("class_id", classId);

      if (enrollErr) throw enrollErr;

      const studentList: Student[] = (enrollments || [])
        .map((e: Record<string, unknown>) => {
          const p = e.profiles as Record<string, unknown> | null;
          return p ? {
            id: p.id as string,
            full_name: p.full_name as string,
            email: p.email as string,
          } : null;
        })
        .filter(Boolean) as Student[];

      setStudents(studentList);

      // Fetch existing attendance
      const { data: existing, error: attErr } = await supabase
        .from("session_attendance")
        .select("*")
        .eq("schedule_id", scheduleId);

      if (attErr) throw attErr;

      const map: Record<string, AttendanceStatus> = {};
      const nMap: Record<string, string> = {};

      // Default all to present
      studentList.forEach((s) => {
        map[s.id] = "present";
        nMap[s.id] = "";
      });

      // Override with existing data
      (existing || []).forEach((r: AttendanceRecord) => {
        map[r.student_id] = r.status;
        nMap[r.student_id] = r.note || "";
      });

      setAttendanceMap(map);
      setNotesMap(nMap);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [scheduleId, classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleStatusChange = (studentId: string, status: AttendanceStatus) => {
    setAttendanceMap((prev) => ({ ...prev, [studentId]: status }));
  };

  const handleNoteChange = (studentId: string, note: string) => {
    setNotesMap((prev) => ({ ...prev, [studentId]: note }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const supabase = getSupabase();
      const upsertData = students.map((s) => ({
        schedule_id: scheduleId,
        student_id: s.id,
        class_id: classId,
        status: attendanceMap[s.id] || "present",
        note: notesMap[s.id] || "",
      }));

      const { error: upsertErr } = await supabase
        .from("session_attendance")
        .upsert(upsertData, { onConflict: "schedule_id, student_id" });

      if (upsertErr) throw upsertErr;

      setToast({ message: t("teacher.attendanceSaved"), type: "success" });
      setTimeout(() => onClose(), 500);
    } catch {
      setToast({ message: t("teacher.attendanceError"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return formatVietnamDate(dateStr, { weekday: "long", month: "short", day: "numeric", year: "numeric" }, "en-US");
  };

  const statusCount = Object.values(attendanceMap).reduce(
    (acc, s) => {
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background-50 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-background-200/70 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading text-lg font-bold text-foreground-950">
                {t("teacher.attendanceTitle")}
              </h3>
              <p className="text-sm text-foreground-500 mt-0.5">
                {className} — {formatDate(scheduleDate)} — {scheduleTime}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-colors duration-150 cursor-pointer"
            >
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>

          {/* Status summary */}
          {students.length > 0 && !loading && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.key} className="flex items-center gap-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${opt.bg} ${opt.color} whitespace-nowrap`}>
                    <i className={`${opt.icon} text-xs mr-1`}></i>
                    {t(`teacher.attendance${opt.key.charAt(0).toUpperCase() + opt.key.slice(1)}`)}
                  </span>
                  <span className="text-xs font-semibold text-foreground-700">{statusCount[opt.key] || 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-background-100"></div>
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-3">
                <i className="ri-error-warning-line text-xl"></i>
              </div>
              <p className="text-sm text-foreground-700 font-medium mb-1">{t("teacher.attendanceLoadError")}</p>
              <button
                onClick={fetchData}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
              >
                <i className="ri-refresh-line"></i>
                {t("teacher.retry")}
              </button>
            </div>
          ) : students.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-3">
                <i className="ri-user-search-line text-xl"></i>
              </div>
              <p className="text-sm text-foreground-700 font-medium">{t("teacher.attendanceNoStudents")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {students.map((student) => {
                const status = attendanceMap[student.id] || "present";
                return (
                  <div
                    key={student.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-background-200/70 bg-background-50"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-sm shrink-0">
                        {student.full_name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 truncate">{student.full_name}</p>
                        <p className="text-xs text-foreground-500 truncate">{student.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={status}
                        onChange={(e) => handleStatusChange(student.id, e.target.value as AttendanceStatus)}
                        className="text-xs rounded-lg border border-background-200 bg-background-50 px-2.5 py-1.5 text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            {t(`teacher.attendance${opt.key.charAt(0).toUpperCase() + opt.key.slice(1)}`)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={notesMap[student.id] || ""}
                        onChange={(e) => handleNoteChange(student.id, e.target.value)}
                        placeholder={t("teacher.attendanceNotePlaceholder")}
                        maxLength={200}
                        className="flex-1 sm:w-40 text-xs rounded-lg border border-background-200 bg-background-50 px-2.5 py-1.5 text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {students.length > 0 && !loading && !error && (
          <div className="px-6 py-4 border-t border-background-200/70 shrink-0 flex items-center justify-between">
            <p className="text-xs text-foreground-400">
              {students.length} {t("teacher.students")} — {Object.values(attendanceMap).filter((s) => s !== "present").length > 0
                ? t("teacher.attendanceMarked")
                : t("teacher.attendanceNotMarked")}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium text-foreground-600 hover:text-foreground-900 hover:bg-background-100 transition-colors duration-200 cursor-pointer whitespace-nowrap"
              >
                {t("teacher.materialsCancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <i className="ri-loader-4-line animate-spin"></i>
                    {t("teacher.attendanceSaving")}
                  </>
                ) : (
                  <>
                    <i className="ri-check-line"></i>
                    {t("teacher.attendanceSave")}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[60] px-5 py-3 rounded-xl text-sm font-medium shadow-lg transition-all duration-300 ${
          toast.type === "success" ? "bg-primary-500 text-background-50" : "bg-accent-500 text-background-50"
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