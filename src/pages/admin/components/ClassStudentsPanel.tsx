import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import {
  calendarDateToLocalDate,
  formatVietnamDateShortVi,
  getMondayOfWeek,
  toLocalDateStr,
  vietnamTodayStr,
} from "@/lib/datetime";

interface EnrolledStudent {
  student_id: string;
  student_name: string;
  student_email: string;
  enrollment_id: string;
  session_numbers: number[];
  session_ids: string[];
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
  is_unavailable: boolean;
  is_current_class: boolean;
}

interface ClassStudentsPanelProps {
  open: boolean;
  onClose: () => void;
  classId: string;
  className: string;
  classTeacherId: string | null;
  classTeacherName: string | null;
  onSuccess: (message: string) => void;
}

function normHHMM(time: string): string {
  if (!time) return "00:00";
  return time.length > 5 ? time.substring(0, 5) : time;
}

function formatTime12h(time: string): string {
  const t = normHHMM(time);
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDateShort(dateStr: string): string {
  return formatVietnamDateShortVi(dateStr);
}

export default function ClassStudentsPanel({
  open,
  onClose,
  classId,
  className,
  classTeacherId,
  classTeacherName,
  onSuccess,
}: ClassStudentsPanelProps) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reassign state
  const [reassignTarget, setReassignTarget] = useState<EnrolledStudent | null>(null);
  const [availableSlots, setAvailableSlots] = useState<TeacherSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);

  // Cancel state
  const [cancelTarget, setCancelTarget] = useState<EnrolledStudent | null>(null);
  const [actioning, setActioning] = useState(false);

  const supabase = getSupabase();

  const fetchStudents = async () => {
    if (!classId) return;
    setLoading(true);
    setError("");

    try {
      // Get enrollments
      const { data: enrollments, error: enrErr } = await supabase
        .from("class_enrollments")
        .select("id, student_id")
        .eq("class_id", classId);

      if (enrErr) throw enrErr;
      if (!enrollments || enrollments.length === 0) {
        setStudents([]);
        return;
      }

      const studentIds = enrollments.map((e) => e.student_id);

      // Get student profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", studentIds);

      const profileMap = new Map<string, { full_name: string; email: string }>();
      (profiles || []).forEach((p) => profileMap.set(p.id, { full_name: p.full_name || "Unknown", email: p.email || "" }));

      // Get sprint_sessions for this class
      const { data: sessions } = await supabase
        .from("sprint_sessions")
        .select("id, sprint_id, session_number")
        .eq("class_id", classId);

      // Map student → { numbers, ids }
      const studentSessionNums = new Map<string, number[]>();
      const studentSessionIds = new Map<string, string[]>();

      if (sessions && sessions.length > 0) {
        const sprintIds = [...new Set(sessions.map((s) => s.sprint_id))];

        const { data: sprints } = await supabase
          .from("learning_sprints")
          .select("id, enrollment_id")
          .in("id", sprintIds);

        if (sprints) {
          const enrollmentIds = [...new Set(sprints.map((s) => s.enrollment_id))];

          const { data: courseEnrollments } = await supabase
            .from("enrollments")
            .select("id, learner_id")
            .in("id", enrollmentIds);

          if (courseEnrollments) {
            const enrollmentToLearner = new Map<string, string>();
            courseEnrollments.forEach((ce) => enrollmentToLearner.set(ce.id, ce.learner_id));

            const sprintToEnrollment = new Map<string, string>();
            sprints.forEach((s) => sprintToEnrollment.set(s.id, s.enrollment_id));

            sessions.forEach((ss) => {
              const enrId = sprintToEnrollment.get(ss.sprint_id);
              if (!enrId) return;
              const learnerId = enrollmentToLearner.get(enrId);
              if (!learnerId) return;
              if (!studentSessionNums.has(learnerId)) studentSessionNums.set(learnerId, []);
              if (!studentSessionIds.has(learnerId)) studentSessionIds.set(learnerId, []);
              studentSessionNums.get(learnerId)!.push(ss.session_number);
              studentSessionIds.get(learnerId)!.push(ss.id);
            });
          }
        }
      }

      const merged: EnrolledStudent[] = enrollments.map((e) => {
        const profile = profileMap.get(e.student_id);
        return {
          student_id: e.student_id,
          student_name: profile?.full_name || "Unknown",
          student_email: profile?.email || "",
          enrollment_id: e.id,
          session_numbers: (studentSessionNums.get(e.student_id) || []).sort((a, b) => a - b),
          session_ids: studentSessionIds.get(e.student_id) || [],
        };
      });

      setStudents(merged);
    } catch (err) {
      console.error("Failed to fetch class students:", err);
      setError(t("auth.adminClassError"));
    } finally {
      setLoading(false);
    }
  };

  // Fetch teacher availability slots for a given week offset (same source as booking calendar)
  const fetchAvailableSlots = async (offset: number) => {
    setSlotsLoading(true);
    try {
      const monday = getMondayOfWeek(calendarDateToLocalDate(vietnamTodayStr()));
      monday.setDate(monday.getDate() + offset * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const startStr = toLocalDateStr(monday);
      const endStr = toLocalDateStr(sunday);

      // 1. Teacher availability in this week
      const { data: availData } = await supabase
        .from("teacher_availability")
        .select("id, teacher_id, date, start_time, end_time, duration_minutes, is_active")
        .eq("is_active", true)
        .gte("date", startStr)
        .lte("date", endStr)
        .order("date")
        .order("start_time");

      const avail = availData || [];

      // 2. Teacher names
      const teacherIds = [...new Set(avail.map((a: any) => a.teacher_id))] as string[];
      const teacherMap = new Map<string, string>();
      if (teacherIds.length > 0) {
        const { data: tProfiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", teacherIds);
        (tProfiles || []).forEach((p: any) => teacherMap.set(p.id, p.full_name || "Unknown"));
      }

      // 3. Teacher day-offs
      const { data: unavailableDates } = await supabase
        .from("teacher_unavailable_dates")
        .select("teacher_id, date")
        .gte("date", startStr)
        .lte("date", endStr);
      const unavailableSet = new Set<string>();
      (unavailableDates || []).forEach((ud: any) => unavailableSet.add(`${ud.teacher_id}|${ud.date}`));

      // 4. Existing class_schedules this week → link slot to class + capacity
      const { data: existingSchedules } = await supabase
        .from("class_schedules")
        .select("id, class_id, teacher_id, date, start_time")
        .gte("date", startStr)
        .lte("date", endStr);

      const scheduleClassIds = [...new Set((existingSchedules || []).map((s: any) => s.class_id))] as string[];

      const maxMap = new Map<string, number>();
      if (scheduleClassIds.length > 0) {
        const { data: classData } = await supabase
          .from("classes")
          .select("id, max_students")
          .in("id", scheduleClassIds);
        (classData || []).forEach((c: any) => maxMap.set(c.id, c.max_students || 2));
      }

      const countMap = new Map<string, number>();
      if (scheduleClassIds.length > 0) {
        const { data: allEnrollments } = await supabase
          .from("class_enrollments")
          .select("class_id")
          .in("class_id", scheduleClassIds);
        (allEnrollments || []).forEach((e: any) => {
          countMap.set(e.class_id, (countMap.get(e.class_id) || 0) + 1);
        });
      }

      const scheduleLookup = new Map<string, { classId: string; booked: number; max: number }>();
      (existingSchedules || []).forEach((s: any) => {
        const st = normHHMM(s.start_time);
        const key = `${s.teacher_id}|${s.date}|${st}`;
        scheduleLookup.set(key, {
          classId: s.class_id,
          booked: countMap.get(s.class_id) || 0,
          max: maxMap.get(s.class_id) || 2,
        });
      });

      // 5. Build slots
      const mapped: TeacherSlot[] = avail.map((a: any) => {
        const st = normHHMM(a.start_time);
        const et = normHHMM(a.end_time);
        const key = `${a.teacher_id}|${a.date}|${st}`;
        const cls = scheduleLookup.get(key);
        const isUnavailable = unavailableSet.has(`${a.teacher_id}|${a.date}`);
        return {
          availability_id: a.id,
          teacher_id: a.teacher_id,
          teacher_name: teacherMap.get(a.teacher_id) || "Teacher",
          date: a.date,
          start_time: st,
          end_time: et,
          duration_minutes: a.duration_minutes || 60,
          class_id: cls?.classId || null,
          booked_count: cls?.booked || 0,
          max_students: cls?.max || 2,
          is_unavailable: isUnavailable,
          is_current_class: cls?.classId === classId,
        };
      });

      // Filter out slots whose end time has already passed (VN timezone)
      const now = new Date();
      const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const futureSlots = mapped.filter((slot) => {
        const slotEnd = new Date(`${slot.date}T${slot.end_time}:00+07:00`);
        return slotEnd.getTime() > vnNow.getTime();
      });

      setAvailableSlots(futureSlots);
    } catch (err) {
      console.error("Failed to fetch available slots:", err);
      setAvailableSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchStudents();
    }
  }, [open, classId]);

  const handleOpenReassign = (student: EnrolledStudent) => {
    setReassignTarget(student);
    setSelectedSlotId("");
    setWeekOffset(0);
    fetchAvailableSlots(0);
  };

  const handleChangeWeek = (delta: number) => {
    const next = weekOffset + delta;
    setWeekOffset(next);
    setSelectedSlotId("");
    fetchAvailableSlots(next);
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setActioning(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-manage-enrollment", {
        body: {
          action: "cancel",
          class_id: classId,
          student_id: cancelTarget.student_id,
        },
      });

      if (fnErr || !data?.success) {
        throw new Error(data?.error || fnErr?.message || "Cancel failed");
      }

      onSuccess(data.message || t("auth.adminClassCancelSuccess"));
      setCancelTarget(null);
      fetchStudents();
    } catch (err: any) {
      setError(err?.message || t("auth.adminClassError"));
    } finally {
      setActioning(false);
    }
  };

  const handleReassign = async () => {
    if (!reassignTarget || !selectedSlotId) return;
    const slot = availableSlots.find((s) => s.availability_id === selectedSlotId);
    if (!slot) return;

    // The session to move = the student's session currently in THIS class
    const sessionId = reassignTarget.session_ids[0];
    if (!sessionId) {
      setError(t("auth.adminReassignNoSession"));
      return;
    }

    setActioning(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("reschedule-booking", {
        body: {
          action: "admin_assign",
          learner_id: reassignTarget.student_id,
          sprint_session_id: sessionId,
          teacher_id: slot.teacher_id,
          date: slot.date,
          start_time: slot.start_time,
          end_time: slot.end_time,
          duration_minutes: slot.duration_minutes,
        },
      });

      if (fnErr || !data?.success) {
        throw new Error(data?.error || fnErr?.message || "Reassign failed");
      }

      onSuccess(
        t("auth.adminReassignSlotSuccess", {
          student: reassignTarget.student_name,
          teacher: slot.teacher_name,
          date: formatDateShort(slot.date),
        })
      );
      setReassignTarget(null);
      setSelectedSlotId("");
      fetchStudents();
    } catch (err: any) {
      setError(err?.message || t("auth.adminClassError"));
    } finally {
      setActioning(false);
    }
  };

  if (!open) return null;

  const weekLabel =
    weekOffset === 0
      ? t("auth.adminReassignThisWeek")
      : weekOffset > 0
        ? t("auth.adminReassignWeekAhead", { count: weekOffset })
        : t("auth.adminReassignWeekAgo", { count: Math.abs(weekOffset) });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-foreground-950/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background-50 border-l border-background-200 shadow-xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-background-200 flex-shrink-0">
          <div>
            <h3 className="font-heading text-base font-semibold text-foreground-950">
              {t("auth.adminClassStudentsTitle")}
            </h3>
            <p className="text-xs text-foreground-500 mt-0.5">{className}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-lg bg-accent-50 border border-accent-200 text-sm text-accent-700 flex items-center gap-2 flex-shrink-0">
            <i className="ri-error-warning-line text-base flex-shrink-0"></i>
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError("")}
              className="text-accent-500 hover:text-accent-700 cursor-pointer"
            >
              <i className="ri-close-line"></i>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-3">
                <i className="ri-user-unfollow-line text-xl"></i>
              </div>
              <p className="text-sm text-foreground-500">{t("auth.adminClassNoStudents")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {students.map((student) => (
                <div
                  key={student.student_id}
                  className="p-4 rounded-xl bg-background-50 border border-background-200"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-secondary-100 flex items-center justify-center text-sm font-semibold text-secondary-700 flex-shrink-0">
                      {student.student_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 truncate">
                        {student.student_name}
                      </p>
                      <p className="text-xs text-foreground-500 truncate">{student.student_email}</p>
                      {student.session_numbers.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {student.session_numbers.map((n) => (
                            <span
                              key={n}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-primary-100 text-primary-700 whitespace-nowrap"
                            >
                              {t("booking.sessionNum", { num: n })}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCancelTarget(student)}
                      className="flex-1 px-3 py-2 text-xs font-medium text-accent-600 bg-accent-50 hover:bg-accent-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
                    >
                      <i className="ri-close-circle-line text-sm"></i>
                      {t("auth.adminClassCancelStudent")}
                    </button>
                    <button
                      onClick={() => handleOpenReassign(student)}
                      className="flex-1 px-3 py-2 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
                    >
                      <i className="ri-arrow-left-right-line text-sm"></i>
                      {t("auth.adminClassReassignStudent")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
            onClick={() => !actioning && setCancelTarget(null)}
          ></div>
          <div className="relative w-full max-w-sm mx-4 bg-background-50 rounded-2xl border border-background-200 shadow-lg p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-11 h-11 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
              <i className="ri-user-unfollow-line text-xl text-accent-500"></i>
            </div>
            <h3 className="text-center font-heading text-base font-semibold text-foreground-950 mb-1.5">
              {t("auth.adminCancelEnrollmentTitle")}
            </h3>
            <p className="text-center text-sm text-foreground-500 mb-6">
              {t("auth.adminCancelEnrollmentDesc", { student: cancelTarget.student_name, class: className })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={actioning}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground-700 bg-background-100 hover:bg-background-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleCancel}
                disabled={actioning}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-background-50 bg-accent-500 hover:bg-accent-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {actioning && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                )}
                {actioning ? "..." : t("auth.adminConfirmCancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign Dialog — teacher availability slots */}
      {reassignTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
            onClick={() => !actioning && setReassignTarget(null)}
          ></div>
          <div className="relative w-full max-w-md mx-4 bg-background-50 rounded-2xl border border-background-200 shadow-lg flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Scrollable header + content */}
            <div className="overflow-y-auto px-6 pt-6 flex-1">
              <div className="w-11 h-11 mx-auto flex items-center justify-center rounded-full bg-primary-100 mb-4">
                <i className="ri-calendar-schedule-line text-xl text-primary-500"></i>
              </div>
              <h3 className="text-center font-heading text-base font-semibold text-foreground-950 mb-1.5">
                {t("auth.adminReassignTitle")}
              </h3>
              <p className="text-center text-sm text-foreground-500 mb-4">
                {t("auth.adminReassignSlotDesc", { student: reassignTarget.student_name })}
              </p>

              {/* Week navigation */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => handleChangeWeek(-1)}
                  disabled={slotsLoading}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-background-100 text-foreground-500 hover:bg-background-200 cursor-pointer disabled:opacity-50"
                >
                  <i className="ri-arrow-left-s-line text-sm"></i>
                </button>
                <span className="flex-1 text-center text-xs font-medium text-foreground-600">{weekLabel}</span>
                <button
                  onClick={() => handleChangeWeek(1)}
                  disabled={slotsLoading}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-background-100 text-foreground-500 hover:bg-background-200 cursor-pointer disabled:opacity-50"
                >
                  <i className="ri-arrow-right-s-line text-sm"></i>
                </button>
              </div>

              {/* Slot selector */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-foreground-700 mb-1.5">
                  {t("auth.adminReassignSelectSlot")}
                </label>
                {slotsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-6 justify-center text-xs text-foreground-400">
                    <div className="w-3.5 h-3.5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
                    {t("auth.adminClassLoading")}
                  </div>
                ) : availableSlots.length === 0 ? (
                  <p className="text-xs text-foreground-400 px-1 py-6 text-center">{t("auth.adminReassignNoSlots")}</p>
                ) : (
                  <div className="space-y-1 border border-background-200 rounded-lg">
                    {availableSlots.map((slot) => {
                      const isFull = slot.is_unavailable || slot.booked_count >= slot.max_students;
                      const disabled = isFull || slot.is_current_class;
                      const isSelected = selectedSlotId === slot.availability_id && !disabled;
                      return (
                        <button
                          key={slot.availability_id}
                          onClick={() => !disabled && setSelectedSlotId(slot.availability_id)}
                          disabled={disabled}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                            disabled
                              ? "bg-background-100/50 cursor-not-allowed"
                              : "hover:bg-background-100 cursor-pointer"
                          } ${isSelected ? "bg-primary-50" : ""}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`text-sm font-medium truncate ${disabled ? "text-foreground-400" : "text-foreground-900"}`}>
                                {slot.teacher_name}
                              </p>
                              {slot.is_current_class && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-secondary-200 text-secondary-700 whitespace-nowrap">
                                  {t("auth.adminReassignCurrentSlot")}
                                </span>
                              )}
                              {!slot.is_current_class && slot.is_unavailable && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-foreground-200 text-foreground-500 whitespace-nowrap">
                                  {t("auth.adminReassignDayOff")}
                                </span>
                              )}
                              {!slot.is_current_class && !slot.is_unavailable && slot.booked_count >= slot.max_students && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-foreground-200 text-foreground-500 whitespace-nowrap">
                                  {t("auth.adminFull")}
                                </span>
                              )}
                              {!disabled && slot.class_id && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-100 text-accent-700 whitespace-nowrap">
                                  {t("auth.adminReassignHasClass")}
                                </span>
                              )}
                              {!disabled && !slot.class_id && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-100 text-primary-700 whitespace-nowrap">
                                  {t("auth.adminReassignNewClass")}
                                </span>
                              )}
                            </div>
                            <p className={`text-xs mt-0.5 ${disabled ? "text-foreground-300" : "text-foreground-500"}`}>
                              <i className="ri-time-line mr-1 text-[10px]"></i>
                              {formatDateShort(slot.date)} · {formatTime12h(slot.start_time)} – {formatTime12h(slot.end_time)}
                            </p>
                            {slot.class_id && (
                              <p className={`text-[11px] mt-0.5 ${disabled ? "text-foreground-300" : "text-foreground-400"}`}>
                                {slot.booked_count}/{slot.max_students} {t("auth.adminStudents").toLowerCase()}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <i className="ri-check-line text-primary-500 text-sm flex-shrink-0"></i>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Fixed action buttons */}
            <div className="flex gap-3 px-6 py-4 border-t border-background-200 flex-shrink-0">
              <button
                onClick={() => setReassignTarget(null)}
                disabled={actioning}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground-700 bg-background-100 hover:bg-background-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleReassign}
                disabled={!selectedSlotId || actioning}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-background-50 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {actioning && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                )}
                {actioning ? "..." : t("auth.adminConfirmReassign")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}