import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { formatVietnamDateTime, getUiDateLocale } from "@/lib/datetime";
import { isPendingTeacherFeedbackSession } from "@/lib/teacherFeedback";

interface SessionStudent {
  studentId: string;
  studentName: string;
  studentEmail: string;
  grade: number | null;
  feedback: string | null;
  attendanceId: string | null;
  attendanceStatus: string | null;
}

interface PendingSession {
  sessionId: string;
  sprintId: string;
  sprintNumber: number;
  sessionNumber: number;
  sessionType: string;
  status: string;
  scheduledAt: string | null;
  courseName: string;
  students: SessionStudent[];
  classId: string | null;
  scheduleId: string | null;
}

const ratingColors = ["bg-accent-400", "bg-secondary-400", "bg-secondary-300", "bg-primary-300", "bg-primary-400"];

export default function FeedbackTab() {
  const { t, i18n } = useTranslation();
  const dateLocale = getUiDateLocale(i18n.language);
  const ratingLabels = [t("liveLesson.ratingPoor"), t("liveLesson.ratingFair"), t("liveLesson.ratingGood"), t("liveLesson.ratingGreat"), t("liveLesson.ratingExcellent")];
  const { profile } = useAuth();
  const supabase = getSupabase();

  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [filter, setFilter] = useState<"pending" | "reviewed" | "all">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [studentGrades, setStudentGrades] = useState<Record<string, { grade: number; feedback: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [absentStudents, setAbsentStudents] = useState<Record<string, Set<string>>>({});
  const [markingAbsent, setMarkingAbsent] = useState<string | null>(null);
  const [absentSuccess, setAbsentSuccess] = useState<string | null>(null);

  const markStudentAbsent = async (session: PendingSession, student: SessionStudent) => {
    const key = `${session.sessionId}_${student.studentId}`;
    setMarkingAbsent(key);
    setErrorMsg(null);

    try {
      const { data: authData } = await supabase.auth.getSession();

      const scheduleId = session.scheduleId;

      // Get enrollment info
      const { data: sprintData } = await supabase
        .from("learning_sprints")
        .select("enrollment_id")
        .eq("id", session.sprintId)
        .maybeSingle();

      let enrollmentId = null;
      let learnerName = student.studentName;
      const courseName = session.courseName;

      if (sprintData?.enrollment_id) {
        enrollmentId = sprintData.enrollment_id;
        const { data: enrollData } = await supabase
          .from("enrollments")
          .select("learner_id")
          .eq("id", enrollmentId)
          .maybeSingle();

        if (enrollData?.learner_id) {
          const { data: learnerProf } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", enrollData.learner_id)
            .maybeSingle();
          learnerName = learnerProf?.full_name || student.studentName;
        }
      }

      const { error: fnErr } = await supabase.functions.invoke("record-learner-attendance", {
        body: {
          action: "mark_absent",
          student_id: student.studentId,
          session_id: session.sessionId,
          schedule_id: scheduleId,
          class_id: session.classId || null,
          session_number: session.sessionNumber,
          sprint_id: session.sprintId,
          sprint_number: session.sprintNumber,
          enrollment_id: enrollmentId,
          course_name: courseName,
          learner_name: learnerName,
        },
      });

      if (fnErr) throw new Error(fnErr.message);

      // Mark as absent locally
      setAbsentStudents((prev) => {
        const sessionSet = new Set(prev[session.sessionId] || []);
        sessionSet.add(student.studentId);
        return { ...prev, [session.sessionId]: sessionSet };
      });

      const absentFeedback = t("feedback.absentFeedback");
      setStudentGrades((prev) => ({
        ...prev,
        [key]: { grade: 0, feedback: absentFeedback },
      }));

      setSessions((prev) =>
        prev.map((s) => {
          if (s.sessionId !== session.sessionId) return s;
          return {
            ...s,
            students: s.students.map((st) => {
              if (st.studentId !== student.studentId) return st;
              return { ...st, grade: 0, feedback: absentFeedback, attendanceStatus: "absent" };
            }),
          };
        })
      );

      setAbsentSuccess(key);
      setTimeout(() => setAbsentSuccess(null), 3000);

      const newAbsentSet = new Set(absentStudents[session.sessionId] || []);
      newAbsentSet.add(student.studentId);

      const allDone = session.students.every((st) => {
        if (st.studentId === student.studentId) return true;
        if (st.attendanceStatus === "absent" || absentStudents[session.sessionId]?.has(st.studentId)) return true;
        const sk = `${session.sessionId}_${st.studentId}`;
        const sg = studentGrades[sk];
        return sg && sg.feedback && sg.feedback.trim().length > 0;
      });

      if (allDone) {
        const teacherId = authData?.session?.user?.id;
        const gradesForSubmit = session.students.map((st) => {
          if (st.studentId === student.studentId) {
            return { student_id: st.studentId, grade: 0, feedback: absentFeedback };
          }
          if (st.attendanceStatus === "absent" || absentStudents[session.sessionId]?.has(st.studentId)) {
            return { student_id: st.studentId, grade: 0, feedback: absentFeedback };
          }
          const sk = `${session.sessionId}_${st.studentId}`;
          const sg = studentGrades[sk];
          return {
            student_id: st.studentId,
            grade: sg?.grade || st.grade || 3,
            feedback: sg?.feedback || st.feedback || "",
          };
        });

        const { error: completeErr } = await supabase.functions.invoke("complete-session", {
          body: {
            session_id: session.sessionId,
            teacher_id: teacherId,
            grades: gradesForSubmit,
          },
        });

        if (!completeErr) {
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === session.sessionId
                ? { ...s, status: "completed" }
                : s
            )
          );
          setSaveSuccess(session.sessionId);
          setTimeout(() => setSaveSuccess(null), 3000);
          setExpandedId(null);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t("feedback.markAbsentError"));
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setMarkingAbsent(null);
    }
  };

  const fetchSessions = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setFetchError(false);
    try {
      // Fetch sessions that need grading or have been graded
      const { data: sessionsData, error: sessionsErr } = await supabase
        .from("sprint_sessions")
        .select(`
          id, sprint_id, session_number, session_type, status, scheduled_at, class_id,
          teacher_feedback, completion_rating,
          sprint:learning_sprints!sprint_id(
            sprint_number, status,
            enrollment:enrollments!learning_sprints_enrollment_id_fkey(
              learner_id,
              course:courses!enrollments_course_id_fkey(name)
            )
          )
        `)
        .eq("teacher_id", profile.id)
        .in("status", ["awaiting_feedback", "completed"])
        .neq("session_type", "self_study")
        .order("session_number", { ascending: false });

      if (sessionsErr) throw sessionsErr;

      if (!sessionsData || sessionsData.length === 0) {
        setSessions([]);
        setLoading(false);
        return;
      }

      const result: PendingSession[] = [];

      for (const session of sessionsData) {
        const sData = session as any;
        const students: SessionStudent[] = [];
        let scheduleId: string | null = null;

        if (sData.class_id) {
          // Get class_schedule
          const { data: schedule } = await supabase
            .from("class_schedules")
            .select("id")
            .eq("class_id", sData.class_id)
            .maybeSingle();

          scheduleId = schedule?.id || null;

          if (schedule) {
            // Get attendance with grades
            const { data: attendance } = await supabase
              .from("session_attendance")
              .select("id, student_id, grade, teacher_feedback, status")
              .eq("schedule_id", schedule.id);

            if (attendance && attendance.length > 0) {
              const studentIds = attendance.map((a: any) => a.student_id);

              const { data: profiles } = await supabase
                .from("profiles")
                .select("id, full_name, email")
                .in("id", studentIds);

              const profileMap: Record<string, { name: string; email: string }> = {};
              (profiles || []).forEach((p: any) => {
                profileMap[p.id] = { name: p.full_name, email: p.email };
              });

              attendance.forEach((a: any) => {
                students.push({
                  studentId: a.student_id,
                  studentName: profileMap[a.student_id]?.name || t("teacher.unknownName"),
                  studentEmail: profileMap[a.student_id]?.email || "",
                  grade: a.grade,
                  feedback: a.teacher_feedback,
                  attendanceId: a.id,
                  attendanceStatus: a.status || null,
                });
              });
            }

            // CRITICAL: Also ensure the sprint session's own learner is included,
            // even if they don't have a session_attendance record for this schedule.
            const currentLearnerId = sData.sprint?.enrollment?.learner_id;
            if (currentLearnerId && !students.some((st) => st.studentId === currentLearnerId)) {
              const { data: learnerProfile } = await supabase
                .from("profiles")
                .select("full_name, email")
                .eq("id", currentLearnerId)
                .maybeSingle();

              students.push({
                studentId: currentLearnerId,
                studentName: learnerProfile?.full_name || t("liveLesson.studentInfo"),
                studentEmail: learnerProfile?.email || "",
                grade: sData.completion_rating || null,
                feedback: sData.teacher_feedback || null,
                attendanceId: null,
                attendanceStatus: null,
              });
            }
          }
        }

        // If no class_id, use sprint_session data
        if (students.length === 0) {
          const learnerId = sData.sprint?.enrollment?.learner_id;
          if (learnerId) {
            const { data: learnerProfile } = await supabase
              .from("profiles")
              .select("full_name, email")
              .eq("id", learnerId)
              .maybeSingle();

            students.push({
              studentId: learnerId,
              studentName: learnerProfile?.full_name || t("liveLesson.studentInfo"),
              studentEmail: learnerProfile?.email || "",
              grade: sData.completion_rating || null,
              feedback: sData.teacher_feedback || null,
              attendanceId: null,
              attendanceStatus: null,
            });
          }
        }

        result.push({
          sessionId: sData.id,
          sprintId: sData.sprint_id,
          sprintNumber: sData.sprint?.sprint_number || 0,
          sessionNumber: sData.session_number,
          sessionType: sData.session_type,
          status: sData.status,
          scheduledAt: sData.scheduled_at,
          courseName: sData.sprint?.enrollment?.course?.name || t("teacher.unknownCourseName"),
          students,
          classId: sData.class_id || null,
          scheduleId: scheduleId || null,
        });
      }

      setSessions(result);

      // Initialize grade state
      const initial: Record<string, { grade: number; feedback: string }> = {};
      result.forEach((s) => {
        s.students.forEach((st) => {
          const key = `${s.sessionId}_${st.studentId}`;
          initial[key] = {
            grade: st.grade || 3,
            feedback: st.feedback || "",
          };
        });
      });
      setStudentGrades(initial);
    } catch (err) {
      console.error("FeedbackTab fetch error:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const pendingCount = sessions.filter((s) => isPendingTeacherFeedbackSession(s.status)).length;
  const reviewedCount = sessions.filter((s) => s.status === "completed").length;

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      // Pending first — includes taught sessions whose parent sprint was admin-completed
      if (isPendingTeacherFeedbackSession(a.status) && !isPendingTeacherFeedbackSession(b.status)) return -1;
      if (!isPendingTeacherFeedbackSession(a.status) && isPendingTeacherFeedbackSession(b.status)) return 1;
      // Then by sprint number desc
      return b.sprintNumber - a.sprintNumber;
    });
  }, [sessions]);

  const filteredSessions = sortedSessions.filter((s) => {
    if (filter === "pending") return isPendingTeacherFeedbackSession(s.status);
    if (filter === "reviewed") return s.status === "completed";
    return true;
  });

  const toggleExpand = (sessionId: string) => {
    setExpandedId(expandedId === sessionId ? null : sessionId);
  };

  const handleGradeChange = (sessionId: string, studentId: string, grade: number) => {
    const key = `${sessionId}_${studentId}`;
    setStudentGrades((prev) => ({ ...prev, [key]: { ...prev[key], grade } }));
  };

  const handleFeedbackChange = (sessionId: string, studentId: string, feedback: string) => {
    const key = `${sessionId}_${studentId}`;
    setStudentGrades((prev) => ({ ...prev, [key]: { ...prev[key], feedback } }));
  };

  const submitGrades = async (session: PendingSession) => {
    setSavingId(session.sessionId);
    setErrorMsg(null);

    try {
      const { data: authData } = await supabase.auth.getSession();
      const teacherId = authData?.session?.user?.id;

      const grades = session.students.map((st) => {
        const key = `${session.sessionId}_${st.studentId}`;
        const g = studentGrades[key];
        return {
          student_id: st.studentId,
          grade: g?.grade || 3,
          feedback: g?.feedback || "",
        };
      });

      const { data: result, error } = await supabase.functions.invoke("complete-session", {
        body: {
          session_id: session.sessionId,
          teacher_id: teacherId,
          grades,
        },
      });

      if (error) throw new Error(error.message);

      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === session.sessionId
            ? {
                ...s,
                status: result?.session_completed ? "completed" : s.status,
                students: s.students.map((st) => {
                  const key = `${s.sessionId}_${st.studentId}`;
                  return {
                    ...st,
                    grade: studentGrades[key]?.grade || st.grade,
                    feedback: studentGrades[key]?.feedback || st.feedback,
                  };
                }),
              }
            : s
        )
      );

      setSaveSuccess(session.sessionId);
      setTimeout(() => setSaveSuccess(null), 3000);
      setExpandedId(null);
    } catch (err: any) {
      setErrorMsg(err?.message || t("feedback.submitError"));
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setSavingId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return formatVietnamDateTime(dateStr, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }, dateLocale);
  };

  const getSessionTypeLabel = (type: string) => {
    if (type === "vietnamese_teacher") return t("feedback.sessionTypeVN");
    if (type === "foreign_teacher") return t("feedback.sessionTypeForeign");
    if (type === "live_session") return t("session.liveSession");
    return type;
  };

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-28 rounded-xl bg-background-50 border border-background-200/70"></div>
          <div className="h-28 rounded-xl bg-background-50 border border-background-200/70"></div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-xl bg-background-50 border border-background-200/70"></div>
        ))}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-error-warning-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-700 font-medium mb-1">{t("teacher.fetchError")}</p>
        <button
          onClick={fetchSessions}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line"></i>
          {t("teacher.retry")}
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-file-text-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-900 font-semibold mb-1">{t("feedback.emptyTitle")}</p>
        <p className="text-xs text-foreground-500">{t("feedback.emptyDesc")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary Header */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div
          onClick={() => setFilter("pending")}
          className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
            filter === "pending"
              ? "border-secondary-300 bg-secondary-50/60"
              : "border-background-200/70 bg-background-50 hover:border-secondary-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-secondary-100 text-secondary-600">
              <i className="ri-time-line text-lg"></i>
            </div>
            <span className="text-2xl font-heading font-bold text-secondary-600">{pendingCount}</span>
          </div>
          <p className="text-sm font-semibold text-foreground-900">{t("feedback.pendingLabel")}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("feedback.pendingDesc")}</p>
        </div>
        <div
          onClick={() => setFilter("reviewed")}
          className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
            filter === "reviewed"
              ? "border-accent-300 bg-accent-50/60"
              : "border-background-200/70 bg-background-50 hover:border-accent-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-accent-100 text-accent-600">
              <i className="ri-check-double-line text-lg"></i>
            </div>
            <span className="text-2xl font-heading font-bold text-accent-600">{reviewedCount}</span>
          </div>
          <p className="text-sm font-semibold text-foreground-900">{t("feedback.reviewedLabel")}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("feedback.reviewedDesc")}</p>
        </div>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div className="mb-4 p-3 rounded-md bg-accent-100 text-accent-700 text-sm flex items-center gap-2">
          <i className="ri-error-warning-line"></i>
          {errorMsg}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button
          onClick={() => setFilter("pending")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
            filter === "pending"
              ? "bg-secondary-500 text-background-50"
              : "bg-background-100 text-foreground-600 hover:bg-background-200"
          }`}
        >
          <i className="ri-time-line"></i>
          {t("feedback.filterPending")}
          <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
            filter === "pending" ? "bg-background-50/20 text-background-50" : "bg-background-200 text-foreground-500"
          }`}>
            {pendingCount}
          </span>
        </button>
        <button
          onClick={() => setFilter("reviewed")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
            filter === "reviewed"
              ? "bg-accent-500 text-background-50"
              : "bg-background-100 text-foreground-600 hover:bg-background-200"
          }`}
        >
          <i className="ri-check-double-line"></i>
          {t("feedback.filterReviewed")}
          <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
            filter === "reviewed" ? "bg-background-50/20 text-background-50" : "bg-background-200 text-foreground-500"
          }`}>
            {reviewedCount}
          </span>
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
            filter === "all"
              ? "bg-foreground-800 text-background-50"
              : "bg-background-100 text-foreground-600 hover:bg-background-200"
          }`}
        >
          <i className="ri-list-check-3"></i>
          {t("feedback.filterAll")}
        </button>
      </div>

      {/* Empty state for filter */}
      {filteredSessions.length === 0 ? (
        <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
            <i className="ri-file-text-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-900 font-semibold mb-1">
            {filter === "pending" ? t("feedback.emptyPending") : filter === "reviewed" ? t("feedback.emptyReviewed") : t("feedback.emptyAll")}
          </p>
          <p className="text-xs text-foreground-500">
            {filter === "pending" ? t("feedback.allReviewed") : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSessions.map((session) => {
            const isExpanded = expandedId === session.sessionId;
            const isPending = isPendingTeacherFeedbackSession(session.status);
            const isSaving = savingId === session.sessionId;
            const justSaved = saveSuccess === session.sessionId;
            const absSet = absentStudents[session.sessionId] || new Set<string>();
            const gradedCount = session.students.filter((s) => s.grade !== null || s.attendanceStatus === "absent" || absSet.has(s.studentId)).length;
            const totalStudents = session.students.length;

            return (
              <div
                key={session.sessionId}
                className={`rounded-xl border transition-all duration-200 ${
                  justSaved
                    ? "border-accent-300 bg-accent-50/50"
                    : isPending
                      ? "border-secondary-200 bg-secondary-50/40"
                      : "border-background-200/70 bg-background-50"
                }`}
              >
                <div
                  onClick={() => toggleExpand(session.sessionId)}
                  className="flex items-start gap-4 p-5 cursor-pointer group"
                >
                  <div className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm shrink-0">
                    <i className={session.sessionType === "foreign_teacher" ? "ri-global-line" : "ri-user-voice-line"}></i>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-foreground-900">
                        {t("feedback.sprintSessionLabel", { sprint: session.sprintNumber, session: session.sessionNumber })}
                      </span>
                      {isPending && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary-500 text-background-50 whitespace-nowrap animate-pulse">
                          <i className="ri-alert-fill text-[9px]"></i>
                          {t("feedback.awaitingFeedbackBadge")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                        {getSessionTypeLabel(session.sessionType)}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-background-100 text-foreground-600 whitespace-nowrap">
                        <i className="ri-building-line text-[10px]"></i>
                        {session.courseName}
                      </span>
                      <span className="text-xs text-foreground-400 flex items-center gap-1">
                        <i className="ri-calendar-line text-[10px]"></i>
                        {formatDate(session.scheduledAt)}
                      </span>
                    </div>
                    {session.students.length > 0 && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {session.students.map((st) => {
                          const isAbsent = st.attendanceStatus === "absent" || absentStudents[session.sessionId]?.has(st.studentId);
                          return (
                          <span
                            key={st.studentId}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
                              isAbsent
                                ? "bg-accent-100 text-accent-700"
                                : st.grade !== null
                                  ? "bg-accent-100 text-accent-700"
                                  : "bg-secondary-100 text-secondary-700"
                            }`}
                          >
                            {isAbsent ? (
                              <>
                                <i className="ri-user-unfollow-line"></i>
                                {st.studentName}: {t("feedback.absentLabel")}
                              </>
                            ) : st.grade !== null ? (
                              <>
                                <i className="ri-check-line"></i>
                                {st.studentName}: {st.grade}/5
                              </>
                            ) : (
                              <>
                                <i className="ri-time-line"></i>
                                {st.studentName}: {t("feedback.notGradedLabel")}
                              </>
                            )}
                          </span>
                        )})}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {session.status === "completed" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                        <i className="ri-check-double-line text-[10px]"></i>
                        {gradedCount}/{totalStudents}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                        {gradedCount}/{totalStudents}
                      </span>
                    )}
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-300"/>
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-background-100">
                    <div className="mt-4 space-y-4">
                      {session.students.map((student) => {
                        const key = `${session.sessionId}_${student.studentId}`;
                        const grade = studentGrades[key];
                        const isAbsent = student.attendanceStatus === "absent" || absSet.has(student.studentId);
                        const isGraded = student.grade !== null && !isAbsent;
                        const isMarkingThis = markingAbsent === key;
                        const justMarkedAbsent = absentSuccess === key;

                        return (
                          <div
                            key={student.studentId}
                            className={`p-4 rounded-lg border transition-all duration-200 ${
                              justMarkedAbsent
                                ? "bg-accent-50/40 border-accent-300"
                                : isAbsent
                                  ? "bg-accent-50/30 border-accent-200"
                                  : isGraded
                                    ? "bg-accent-50/30 border-accent-200"
                                    : "bg-secondary-50/40 border-secondary-200"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 text-xs font-bold">
                                  {student.studentName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground-900">{student.studentName}</p>
                                  <p className="text-xs text-foreground-400">{student.studentEmail}</p>
                                </div>
                              </div>
                              {isAbsent ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-accent-500 text-background-50 dark:text-foreground-950 whitespace-nowrap">
                                  <i className="ri-user-unfollow-line"></i>
                                  {t("feedback.absentBadge")}
                                </span>
                              ) : isGraded ? (
                                <div className="flex items-center gap-1">
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <div
                                      key={n}
                                      className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                                        n <= (grade?.grade || student.grade || 0)
                                          ? `${ratingColors[n - 1]} text-white`
                                          : "bg-background-100 text-foreground-400"
                                      }`}
                                    >
                                      {n}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs font-medium text-secondary-600 flex items-center gap-1">
                                  <i className="ri-time-line"></i>
                                  {t("feedback.notGradedStatus")}
                                </span>
                              )}
                            </div>

                            {isAbsent ? (
                              <div className="mt-2 p-3 rounded bg-background-50 border border-background-100">
                                <p className="text-xs text-foreground-500 flex items-center gap-1.5">
                                  <i className="ri-information-line"></i>
                                  {t("feedback.absentNote")}
                                </p>
                              </div>
                            ) : isGraded && student.feedback ? (
                              <div className="mt-2 p-3 rounded bg-background-50 border border-background-100">
                                <p className="text-xs text-foreground-600">{student.feedback}</p>
                              </div>
                            ) : isGraded ? null : (
                              <div className="space-y-3 mt-2">
                                <div>
                                  <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t("feedback.gradeLabel")}</label>
                                  <div className="flex items-center gap-1.5">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        onClick={() => handleGradeChange(session.sessionId, student.studentId, n)}
                                        className={`w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-bold transition-all duration-150 cursor-pointer border-2 ${
                                          (grade?.grade || 3) >= n
                                            ? `${ratingColors[n - 1]} border-transparent text-white`
                                            : "border-background-200 text-foreground-400 hover:border-background-300"
                                        }`}
                                      >
                                        {n}
                                      </button>
                                    ))}
                                    <span className="ml-2 text-xs text-foreground-500">
                                      {ratingLabels[(grade?.grade || 3) - 1]}
                                    </span>
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-600 mb-1.5">
                                    {t("feedback.feedbackLabel")} <span className="text-accent-500">{t("feedback.feedbackRequired")}</span>
                                  </label>
                                  <textarea
                                    value={grade?.feedback || ""}
                                    onChange={(e) => handleFeedbackChange(session.sessionId, student.studentId, e.target.value)}
                                    rows={3}
                                    maxLength={500}
                                    className="w-full px-3 py-2 rounded-md border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 transition-colors resize-y"
                                    placeholder={t("feedback.feedbackPlaceholder", { name: student.studentName })}
                                  />
                                  <p className="text-[10px] text-foreground-400 mt-0.5">
                                    {(grade?.feedback || "").length} / 500
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Submit button for pending sessions */}
                      {isPending && session.students.some((s) => {
                        const alreadyAbsent = s.attendanceStatus === "absent" || absSet.has(s.studentId);
                        return !alreadyAbsent && s.grade === null;
                      }) && (
                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-background-200">
                          {/* Vắng học buttons for each non-graded student */}
                          <div className="flex items-center gap-2 mr-auto">
                            {session.students.map((st) => {
                              const alreadyAbsent = st.attendanceStatus === "absent" || absSet.has(st.studentId);
                              if (alreadyAbsent || st.grade !== null) return null;
                              const mKey = `${session.sessionId}_${st.studentId}`;
                              return (
                                <button
                                  key={st.studentId}
                                  type="button"
                                  onClick={() => markStudentAbsent(session, st)}
                                  disabled={markingAbsent !== null}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium bg-accent-100 text-accent-700 hover:bg-accent-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                                >
                                  {markingAbsent === mKey ? (
                                    <>
                                      <i className="ri-loader-4-line animate-spin"></i>
                                      {t("feedback.markingAbsent")}
                                    </>
                                  ) : (
                                    <>
                                      <i className="ri-user-unfollow-line"></i>
                                      {st.studentName.split(" ").pop()}: {t("feedback.markAbsentLabel")}
                                    </>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedId(null)}
                            className="px-4 py-2 rounded-md text-xs font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {t("feedback.leaveForLater")}
                          </button>
                          <button
                            type="button"
                            onClick={() => submitGrades(session)}
                            disabled={isSaving || !session.students.every((st) => {
                              const alreadyAbsent = st.attendanceStatus === "absent" || absSet.has(st.studentId);
                              if (alreadyAbsent) return true;
                              const k = `${session.sessionId}_${st.studentId}`;
                              const g = studentGrades[k];
                              return g && g.feedback.trim().length > 0;
                            })}
                            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                          >
                            {isSaving ? (
                              <>
                                <i className="ri-loader-4-line animate-spin"></i>
                                {t("feedback.submitting")}
                              </>
                            ) : (
                              <>
                                <i className="ri-check-line"></i>
                                {t("feedback.submitGrades")}
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Submit button when ALL students are absent - allow completion without grades */}
                      {isPending && session.students.every((s) => {
                        const alreadyAbsent = s.attendanceStatus === "absent" || absSet.has(s.studentId);
                        return alreadyAbsent;
                      }) && (
                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-background-200">
                          <span className="text-xs text-foreground-500 mr-auto flex items-center gap-1">
                            <i className="ri-information-line"></i>
                            {t("feedback.allAbsentInfo")}
                          </span>
                          <button
                            type="button"
                            onClick={() => setExpandedId(null)}
                            className="px-4 py-2 rounded-md text-xs font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {t("feedback.leaveForLater")}
                          </button>
                          <button
                            type="button"
                            onClick={() => submitGrades(session)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                          >
                            {isSaving ? (
                              <>
                                <i className="ri-loader-4-line animate-spin"></i>
                                {t("feedback.submitting")}
                              </>
                            ) : (
                              <>
                                <i className="ri-check-line"></i>
                                {t("feedback.completeSession")}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}