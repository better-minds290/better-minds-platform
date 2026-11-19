import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { formatVietnamDateTime, getUiDateLocale } from "@/lib/datetime";
import {
  buildTeacherFeedbackSubmitGrades,
  canEnableTeacherGradeSubmit,
  canMutateLearnerOnCard,
  canShowAllAbsentSessionComplete,
  feedbackBlockCopyKey,
  feedbackDraftKey,
  feedbackPanelLayoutClass,
  groupTeacherFeedbackCards,
  isLearnerBlockedFromFeedback,
  isPendingTeacherFeedbackSession,
  shouldShowTeacherGradeSubmit,
  type FeedbackAttendanceRow,
  type FeedbackEnrollmentRow,
  type FeedbackMutationBlock,
  type FeedbackProfileRow,
  type FeedbackScheduleRow,
  type FeedbackSessionRow,
} from "@/lib/teacherFeedback";

interface SessionStudent {
  studentId: string;
  studentName: string;
  studentEmail: string;
  grade: number | null;
  feedback: string | null;
  attendanceId: string | null;
  attendanceStatus: string | null;
  sessionId: string | null;
  sprintId: string | null;
  sprintNumber: number | null;
  enrollmentId: string | null;
  sessionStatus: string | null;
  courseName: string | null;
  mutationBlockedReason: FeedbackMutationBlock;
}

interface PendingSession {
  cardId: string;
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
  scheduleAmbiguous: boolean;
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
  const [absentConfirm, setAbsentConfirm] = useState<{
    session: PendingSession;
    student: SessionStudent;
  } | null>(null);
  const markingAbsentLock = useRef(false);

  const markStudentAbsent = async (session: PendingSession, student: SessionStudent): Promise<boolean> => {
    if (markingAbsentLock.current) return false;
    if (!canMutateLearnerOnCard({ scheduleAmbiguous: session.scheduleAmbiguous, learner: student })) {
      setErrorMsg(t(feedbackBlockCopyKey(student.mutationBlockedReason, session.scheduleAmbiguous)));
      setTimeout(() => setErrorMsg(null), 4000);
      return false;
    }
    if (!student.sessionId || !session.scheduleId) {
      setErrorMsg(t("feedback.markAbsentError"));
      setTimeout(() => setErrorMsg(null), 4000);
      return false;
    }
    const key = feedbackDraftKey(student.sessionId, student.studentId);
    markingAbsentLock.current = true;
    setMarkingAbsent(key);
    setErrorMsg(null);

    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke("record-learner-attendance", {
        body: {
          action: "mark_absent",
          student_id: student.studentId,
          session_id: student.sessionId,
          schedule_id: session.scheduleId,
          class_id: session.classId || null,
          session_number: session.sessionNumber,
          sprint_id: student.sprintId,
          sprint_number: student.sprintNumber,
          enrollment_id: student.enrollmentId,
          course_name: student.courseName || session.courseName,
          learner_name: student.studentName,
        },
      });

      if (fnErr) throw new Error(fnErr.message);
      if (result?.error) throw new Error(result.error);

      setAbsentStudents((prev) => {
        const sessionSet = new Set(prev[session.cardId] || []);
        sessionSet.add(student.studentId);
        return { ...prev, [session.cardId]: sessionSet };
      });

      const absentFeedback = t("feedback.absentFeedback");
      setStudentGrades((prev) => ({
        ...prev,
        [key]: { grade: 0, feedback: absentFeedback },
      }));

      setSessions((prev) =>
        prev.map((s) => {
          if (s.cardId !== session.cardId) return s;
          return {
            ...s,
            students: s.students.map((st) => {
              if (st.studentId !== student.studentId) return st;
              return {
                ...st,
                grade: 0,
                feedback: absentFeedback,
                attendanceStatus: "absent",
                sessionStatus: "absent",
              };
            }),
          };
        })
      );

      setAbsentSuccess(key);
      setTimeout(() => setAbsentSuccess(null), 3000);
      return true;
    } catch (err: any) {
      setErrorMsg(err?.message || t("feedback.markAbsentError"));
      setTimeout(() => setErrorMsg(null), 4000);
      return false;
    } finally {
      markingAbsentLock.current = false;
      setMarkingAbsent(null);
    }
  };

  const dismissAbsentConfirm = () => {
    if (markingAbsent !== null || markingAbsentLock.current) return;
    setAbsentConfirm(null);
  };

  const handleConfirmAbsent = async () => {
    if (!absentConfirm || markingAbsent !== null || markingAbsentLock.current) return;
    const succeeded = await markStudentAbsent(absentConfirm.session, absentConfirm.student);
    if (succeeded) setAbsentConfirm(null);
  };

  const fetchSessions = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setFetchError(false);
    try {
      const sessionSelect = `
          id, sprint_id, session_number, session_type, status, scheduled_at, class_id, teacher_id,
          teacher_feedback, completion_rating, feedback,
          sprint:learning_sprints!sprint_id(
            sprint_number, status,
            enrollment:enrollments!learning_sprints_enrollment_id_fkey(
              id, learner_id,
              course:courses!enrollments_course_id_fkey(name)
            )
          )
        `;
      const { data: sessionsData, error: sessionsErr } = await supabase
        .from("sprint_sessions")
        .select(sessionSelect)
        .eq("teacher_id", profile.id)
        .in("status", ["awaiting_feedback", "completed", "absent"])
        .neq("session_type", "self_study")
        .order("session_number", { ascending: false });

      if (sessionsErr) throw sessionsErr;

      type FeedbackSessionQueryRow = Record<string, unknown> & { id: string; class_id: string | null };
      const anchorRows = (sessionsData || []) as FeedbackSessionQueryRow[];
      const anchorClassIds = [...new Set(anchorRows.map((row) => row.class_id).filter(Boolean))] as string[];
      let mergedRows = anchorRows;
      if (anchorClassIds.length > 0) {
        const { data: classSessionRows, error: classSessErr } = await supabase
          .from("sprint_sessions")
          .select(sessionSelect)
          .eq("teacher_id", profile.id)
          .in("class_id", anchorClassIds)
          .neq("session_type", "self_study");
        if (classSessErr) throw classSessErr;
        const byId = new Map<string, FeedbackSessionQueryRow>();
        anchorRows.forEach((row) => byId.set(row.id, row));
        ((classSessionRows || []) as FeedbackSessionQueryRow[]).forEach((row) => {
          if (!byId.has(row.id)) byId.set(row.id, row);
        });
        mergedRows = [...byId.values()];
      }

      if (mergedRows.length === 0) {
        setSessions([]);
        setLoading(false);
        return;
      }

      const sessionRows: FeedbackSessionRow[] = mergedRows.map((row: Record<string, unknown>) => {
        const sprint = row.sprint as {
          sprint_number?: number;
          enrollment?: { id?: string; learner_id?: string; course?: { name?: string } };
        } | null;
        return {
          id: row.id as string,
          sprint_id: row.sprint_id as string,
          session_number: row.session_number as number,
          session_type: row.session_type as string,
          status: row.status as string,
          scheduled_at: (row.scheduled_at as string | null) || null,
          class_id: (row.class_id as string | null) || null,
          teacher_id: (row.teacher_id as string | null) || null,
          completion_rating: (row.completion_rating as number | null) ?? null,
          teacher_feedback: (row.teacher_feedback as string | null) || null,
          feedback: (row.feedback as string | null) || null,
          sprint_number: sprint?.sprint_number || 0,
          enrollment_id: sprint?.enrollment?.id || null,
          learner_id: sprint?.enrollment?.learner_id || null,
          course_name: sprint?.enrollment?.course?.name || t("teacher.unknownCourseName"),
        };
      });

      const classIds = [...new Set(sessionRows.map((s) => s.class_id).filter(Boolean))] as string[];
      let enrollments: FeedbackEnrollmentRow[] = [];
      let schedules: FeedbackScheduleRow[] = [];
      let attendance: FeedbackAttendanceRow[] = [];
      let profiles: FeedbackProfileRow[] = [];

      if (classIds.length > 0) {
        const [enrollRes, schedRes] = await Promise.all([
          supabase.from("class_enrollments").select("class_id, student_id").in("class_id", classIds),
          supabase.from("class_schedules").select("id, class_id, status").in("class_id", classIds),
        ]);
        if (enrollRes.error) throw enrollRes.error;
        if (schedRes.error) throw schedRes.error;
        enrollments = (enrollRes.data || []) as FeedbackEnrollmentRow[];
        schedules = (schedRes.data || []) as FeedbackScheduleRow[];

        const scheduleIds = schedules.map((s) => s.id);
        if (scheduleIds.length > 0) {
          const attRes = await supabase
            .from("session_attendance")
            .select("id, schedule_id, student_id, grade, teacher_feedback, status")
            .in("schedule_id", scheduleIds);
          if (attRes.error) throw attRes.error;
          attendance = (attRes.data || []) as FeedbackAttendanceRow[];
        }
      }

      const profileIds = [
        ...new Set([
          ...sessionRows.map((s) => s.learner_id).filter(Boolean),
          ...enrollments.map((e) => e.student_id),
        ]),
      ] as string[];
      if (profileIds.length > 0) {
        const profRes = await supabase.from("profiles").select("id, full_name, email").in("id", profileIds);
        if (profRes.error) throw profRes.error;
        profiles = (profRes.data || []) as FeedbackProfileRow[];
      }

      const cards = groupTeacherFeedbackCards({
        sessions: sessionRows,
        enrollments,
        attendance,
        schedules,
        profiles,
        fallbackName: t("teacher.unknownName"),
      });

      const result: PendingSession[] = cards.map((card) => ({
        cardId: card.cardId,
        sessionId: card.representativeSessionId || card.cardId,
        sprintId: card.learners.find((l) => l.sprintId)?.sprintId || "",
        sprintNumber: card.learners.find((l) => l.sprintNumber)?.sprintNumber || 0,
        sessionNumber: card.sessionNumber,
        sessionType: card.sessionType,
        status: card.status,
        scheduledAt: card.scheduledAt,
        courseName: card.courseName,
        classId: card.classId,
        scheduleId: card.scheduleId,
        scheduleAmbiguous: card.scheduleAmbiguous,
        students: card.learners.map((learner) => ({
          studentId: learner.studentId,
          studentName: learner.studentName || t("teacher.unknownName"),
          studentEmail: learner.studentEmail,
          grade: learner.grade,
          feedback: learner.feedback,
          attendanceId: learner.attendanceId,
          attendanceStatus: learner.attendanceStatus,
          sessionId: learner.sessionId,
          sprintId: learner.sprintId,
          sprintNumber: learner.sprintNumber,
          enrollmentId: learner.enrollmentId,
          sessionStatus: learner.sessionStatus,
          courseName: learner.courseName,
          mutationBlockedReason: learner.mutationBlockedReason,
        })),
      }));

      setSessions(result);

      const initial: Record<string, { grade: number; feedback: string }> = {};
      result.forEach((s) => {
        s.students.forEach((st) => {
          const key = feedbackDraftKey(st.sessionId, st.studentId);
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
  }, [profile?.id, supabase, t]);

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
      return (b.scheduledAt || "").localeCompare(a.scheduledAt || "");
    });
  }, [sessions]);

  const filteredSessions = sortedSessions.filter((s) => {
    if (filter === "pending") return isPendingTeacherFeedbackSession(s.status);
    if (filter === "reviewed") return s.status === "completed";
    return true;
  });

  const toggleExpand = (cardId: string) => {
    setExpandedId(expandedId === cardId ? null : cardId);
  };

  const handleGradeChange = (learnerSessionId: string | null, studentId: string, grade: number) => {
    const key = feedbackDraftKey(learnerSessionId, studentId);
    setStudentGrades((prev) => ({ ...prev, [key]: { ...prev[key], grade } }));
  };

  const handleFeedbackChange = (learnerSessionId: string | null, studentId: string, feedback: string) => {
    const key = feedbackDraftKey(learnerSessionId, studentId);
    setStudentGrades((prev) => ({ ...prev, [key]: { ...prev[key], feedback } }));
  };

  const submitGrades = async (session: PendingSession) => {
    if (session.scheduleAmbiguous) {
      setErrorMsg(t("feedback.ambiguousSchedule"));
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }
    setSavingId(session.cardId);
    setErrorMsg(null);

    try {
      const { data: authData } = await supabase.auth.getSession();
      const teacherId = authData?.session?.user?.id;
      const absSet = absentStudents[session.cardId] || new Set<string>();
      const learnerInputs = session.students.map((st) => ({
        studentId: st.studentId,
        sessionId: st.sessionId,
        grade: st.grade,
        feedback: st.feedback,
        mutationBlockedReason: st.mutationBlockedReason,
        attendanceStatus:
          st.attendanceStatus === "absent" || absSet.has(st.studentId) ? "absent" : st.attendanceStatus,
      }));

      const grades = buildTeacherFeedbackSubmitGrades({
        sessionId: session.sessionId,
        learners: learnerInputs,
        drafts: studentGrades,
      });
      const allAbsent = canShowAllAbsentSessionComplete({
        sessionStatus: session.status,
        learners: learnerInputs,
      });
      if (grades.length === 0 && !allAbsent) {
        setErrorMsg(t("feedback.submitError"));
        setSavingId(null);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke("complete-session", {
        body: {
          session_id: session.sessionId,
          teacher_id: teacherId,
          grades,
        },
      });

      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);

      const completed = !!result?.session_completed;
      const submittedByStudent = new Map(grades.map((row) => [row.student_id, row]));
      setSessions((prev) =>
        prev.map((s) =>
          s.cardId === session.cardId
            ? {
                ...s,
                status: completed ? "completed" : s.status,
                students: s.students.map((st) => {
                  const row = submittedByStudent.get(st.studentId);
                  if (!row || isLearnerBlockedFromFeedback(st)) return st;
                  const abs = st.attendanceStatus === "absent" || (absentStudents[s.cardId] || new Set()).has(st.studentId);
                  if (abs) return st;
                  return {
                    ...st,
                    grade: row.grade,
                    feedback: row.feedback,
                    sessionStatus: completed ? "completed" : st.sessionStatus,
                  };
                }),
              }
            : s
        )
      );

      setSaveSuccess(session.cardId);
      setTimeout(() => setSaveSuccess(null), 3000);
      if (completed) setExpandedId(null);
      if (completed) await fetchSessions();
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
      year: "numeric",
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
            const isExpanded = expandedId === session.cardId;
            const isPending = isPendingTeacherFeedbackSession(session.status);
            const isSaving = savingId === session.cardId;
            const justSaved = saveSuccess === session.cardId;
            const absSet = absentStudents[session.cardId] || new Set<string>();
            const learnersForAction = session.students.map((s) => ({
              studentId: s.studentId,
              sessionId: s.sessionId,
              grade: s.grade,
              feedback: s.feedback,
              mutationBlockedReason: s.mutationBlockedReason,
              attendanceStatus: s.attendanceStatus === "absent" || absSet.has(s.studentId) ? "absent" : s.attendanceStatus,
            }));
            const showSubmit = shouldShowTeacherGradeSubmit({
              sessionStatus: session.status,
              scheduleAmbiguous: session.scheduleAmbiguous,
              learners: learnersForAction,
            });
            const showAllAbsentComplete = canShowAllAbsentSessionComplete({
              sessionStatus: session.status,
              learners: learnersForAction,
            });
            const gradedCount = session.students.filter((s) => s.grade !== null || s.attendanceStatus === "absent" || absSet.has(s.studentId)).length;
            const totalStudents = session.students.length;

            return (
              <div
                key={session.cardId}
                className={`rounded-xl border transition-all duration-200 ${
                  justSaved
                    ? "border-accent-300 bg-accent-50/50"
                    : isPending
                      ? "border-secondary-200 bg-secondary-50/40"
                      : "border-background-200/70 bg-background-50"
                }`}
              >
                <div
                  onClick={() => toggleExpand(session.cardId)}
                  className={feedbackPanelLayoutClass.cardHeader}
                >
                  <div className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm shrink-0">
                    <i className={session.sessionType === "foreign_teacher" ? "ri-global-line" : "ri-user-voice-line"}></i>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-foreground-900">
                        {t("feedback.cardHeader", {
                          session: session.sessionNumber,
                          type: getSessionTypeLabel(session.sessionType),
                          when: formatDate(session.scheduledAt),
                        })}
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
                          const isAbsent = st.attendanceStatus === "absent" || absSet.has(st.studentId);
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

                  <div className={feedbackPanelLayoutClass.cardHeaderStatus}>
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
                      {session.scheduleAmbiguous && (
                        <p className="text-xs text-accent-700 flex items-center gap-1.5">
                          <i className="ri-error-warning-line"></i>
                          {t("feedback.ambiguousSchedule")}
                        </p>
                      )}
                      {session.students.map((student) => {
                        const key = feedbackDraftKey(student.sessionId, student.studentId);
                        const grade = studentGrades[key];
                        const isAbsent = student.attendanceStatus === "absent" || absSet.has(student.studentId);
                        const isGraded = student.grade !== null && !isAbsent;
                        const justMarkedAbsent = absentSuccess === key;
                        const canMutate = canMutateLearnerOnCard({
                          scheduleAmbiguous: session.scheduleAmbiguous,
                          learner: student,
                        });

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
                            <div className={feedbackPanelLayoutClass.learnerStatusRow}>
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 text-xs font-bold">
                                  {(student.studentName || "?").charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground-900">{student.studentName}</p>
                                  {student.sprintNumber != null && (
                                    <p className="text-xs text-foreground-500">{t("feedback.learnerSprintLabel", { sprint: student.sprintNumber })}</p>
                                  )}
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

                            {!canMutate && !isAbsent && !isGraded ? (
                              <div className="mt-2 p-3 rounded bg-background-50 border border-background-100">
                                <p className="text-xs text-accent-700 flex items-center gap-1.5">
                                  <i className="ri-error-warning-line"></i>
                                  {t(feedbackBlockCopyKey(student.mutationBlockedReason, session.scheduleAmbiguous))}
                                </p>
                              </div>
                            ) : isAbsent ? (
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
                                        onClick={() => handleGradeChange(student.sessionId, student.studentId, n)}
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
                                    onChange={(e) => handleFeedbackChange(student.sessionId, student.studentId, e.target.value)}
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

                      {/* Submit remains available for taught sessions with missing grades,
                          including Completed after Admin force-complete. */}
                      {showSubmit && (
                        <div className={feedbackPanelLayoutClass.actionRow}>
                          {/* Vắng học buttons for each non-graded student */}
                          <div className={feedbackPanelLayoutClass.absentActionGroup}>
                            {session.students.map((st) => {
                              const alreadyAbsent = st.attendanceStatus === "absent" || absSet.has(st.studentId);
                              if (alreadyAbsent || st.grade !== null) return null;
                              if (!canMutateLearnerOnCard({ scheduleAmbiguous: session.scheduleAmbiguous, learner: st })) return null;
                              const mKey = feedbackDraftKey(st.sessionId, st.studentId);
                              return (
                                <button
                                  key={st.studentId}
                                  type="button"
                                  onClick={() => setAbsentConfirm({ session, student: st })}
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
                            disabled={isSaving || !canEnableTeacherGradeSubmit({
                              scheduleAmbiguous: session.scheduleAmbiguous,
                              learners: session.students.map((st) => ({
                                studentId: st.studentId,
                                sessionId: st.sessionId,
                                grade: st.grade,
                                feedback: st.feedback,
                                mutationBlockedReason: st.mutationBlockedReason,
                                attendanceStatus: st.attendanceStatus === "absent" || absSet.has(st.studentId) ? "absent" : st.attendanceStatus,
                              })),
                              drafts: studentGrades,
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
                      {showAllAbsentComplete && (
                        <div className={feedbackPanelLayoutClass.actionRow}>
                          <span className="text-xs text-foreground-500 mr-auto flex items-center gap-1 max-sm:w-full max-sm:mr-0">
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
                            disabled={isSaving || session.scheduleAmbiguous}
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

      {absentConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={dismissAbsentConfirm}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-mark-absent-title"
            className="bg-background-50 rounded-2xl p-6 mx-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
              <i className="ri-user-unfollow-line text-xl"></i>
            </div>
            <h4 id="feedback-mark-absent-title" className="text-base font-semibold text-foreground-950 text-center mb-1">
              {t("feedback.markAbsentConfirmTitle")}
            </h4>
            <p className="text-sm text-foreground-500 text-center mb-6">
              {t("feedback.markAbsentConfirmMessageNamed", { name: absentConfirm.student.studentName })}
            </p>
            {errorMsg && (
              <p className="text-sm text-accent-700 text-center mb-4 flex items-center justify-center gap-1.5">
                <i className="ri-error-warning-line"></i>
                {errorMsg}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={dismissAbsentConfirm}
                disabled={markingAbsent !== null}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-700 hover:bg-background-200 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("feedback.markAbsentConfirmCancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmAbsent}
                disabled={markingAbsent !== null}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-background-50 hover:bg-accent-600 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                {markingAbsent !== null ? (
                  <>
                    <i className="ri-loader-4-line animate-spin"></i>
                    {t("feedback.markingAbsent")}
                  </>
                ) : (
                  t("feedback.markAbsentConfirmButton")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
