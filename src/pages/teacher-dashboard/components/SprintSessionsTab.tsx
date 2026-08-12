import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { Link } from "react-router-dom";

interface SprintSession {
  id: string;
  sprint_id: string;
  session_number: number;
  session_type: string;
  teacher_id: string;
  scheduled_at: string | null;
  status: string;
  meeting_link: string | null;
  lesson_summary: string | null;
  feedback: string | null;
  grade: number | null;
  sprint_number: number;
  sprint_status: string;
  course_name: string;
  course_level: string;
  course_id: string;
  student_name: string;
  student_email: string;
  student_phone: string;
  student_avatar_url: string | null;
  learner_id: string;
  completed_sessions: number;
  total_sessions: number;
  session_materials: Array<{ file_name: string; file_path: string; file_size?: number }>;
  session_description: string | null;
  class_id: string | null;
  self_study_questions: string | null;
}

function groupSessionsByClass(sessions: SprintSession[]): SprintSession[][] {
  const groups = new Map<string, SprintSession[]>();
  sessions.forEach((s) => {
    const datePart = s.scheduled_at
      ? (s.scheduled_at.includes("T") ? s.scheduled_at.split("T")[0] : s.scheduled_at.split(" ")[0])
      : "no-date";
    const key = `${s.class_id || `sprint-${s.sprint_id}`}_${s.session_number}_${s.session_type}_${datePart}_${s.sprint_number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  });
  return Array.from(groups.values());
}

function getGroupStatus(sessions: SprintSession[]): string {
  const statuses = sessions.map((s) => s.status);
  if (statuses.includes("awaiting_feedback")) return "awaiting_feedback";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.includes("active")) return "active";
  if (statuses.includes("in_progress")) return "in_progress";
  return statuses[0] || "locked";
}

type FilterType = "all" | "upcoming" | "completed";

export default function SprintSessionsTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [sessions, setSessions] = useState<SprintSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [filter, setFilter] = useState<FilterType>("upcoming");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setFetchError(false);
    try {
      const supabase = getSupabase();

      // Step 1: Fetch all sprint_sessions for this teacher
      const { data: sessionsData, error: sessionsErr } = await supabase
        .from("sprint_sessions")
        .select("id, sprint_id, session_number, session_type, teacher_id, scheduled_at, status, meeting_link, lesson_summary, feedback, grade, class_id")
        .eq("teacher_id", profile.id)
        .order("scheduled_at", { ascending: false })
        .order("session_number", { ascending: false });

      if (sessionsErr) throw sessionsErr;

      if (!sessionsData || sessionsData.length === 0) {
        setSessions([]);
        setLoading(false);
        return;
      }

      // Step 2: Fetch Session 1 lesson summaries (source of truth for self-study submissions)
      const sprintIds = [...new Set(sessionsData.map((s: { sprint_id: string }) => s.sprint_id))];
      const summaryBySprintId: Record<
        string,
        { lesson_summary: string | null; teacher_feedback: string | null }
      > = {};

      if (sprintIds.length > 0) {
        const { data: session1Rows } = await supabase
          .from("sprint_sessions")
          .select("sprint_id, lesson_summary, teacher_feedback")
          .in("sprint_id", sprintIds)
          .eq("session_number", 1);

        (session1Rows || []).forEach(
          (row: { sprint_id: string; lesson_summary: string | null; teacher_feedback: string | null }) => {
            summaryBySprintId[row.sprint_id] = {
              lesson_summary: row.lesson_summary,
              teacher_feedback: row.teacher_feedback,
            };
          }
        );
      }

      // Step 3: Fetch all related sprints
      const { data: sprintsData } = await supabase
        .from("learning_sprints")
        .select("id, sprint_number, status, enrollment_id")
        .in("id", sprintIds);

      const sprintMap: Record<string, any> = {};
      (sprintsData || []).forEach((sp: any) => { sprintMap[sp.id] = sp; });

      // Step 4: Fetch all related enrollments
      const enrollmentIds = [...new Set((sprintsData || []).map((sp: any) => sp.enrollment_id).filter(Boolean))];
      const { data: enrollmentsData } = await supabase
        .from("enrollments")
        .select("id, learner_id, course_id")
        .in("id", enrollmentIds);

      const enrollmentMap: Record<string, any> = {};
      (enrollmentsData || []).forEach((en: any) => { enrollmentMap[en.id] = en; });

      // Step 5: Fetch courses and learner profiles
      const courseIds = [...new Set((enrollmentsData || []).map((en: any) => en.course_id).filter(Boolean))];
      const learnerIds = [...new Set((enrollmentsData || []).map((en: any) => en.learner_id).filter(Boolean))];

      const [coursesResult, profilesResult] = await Promise.all([
        courseIds.length > 0
          ? supabase.from("courses").select("id, name, level").in("id", courseIds)
          : Promise.resolve({ data: [] }),
        learnerIds.length > 0
          ? supabase.from("profiles").select("id, full_name, email, phone, avatar_url").in("id", learnerIds)
          : Promise.resolve({ data: [] }),
      ]);

      const courseMap: Record<string, any> = {};
      (coursesResult.data || []).forEach((c: any) => { courseMap[c.id] = c; });

      const profileMap: Record<string, any> = {};
      (profilesResult.data || []).forEach((p: any) => { profileMap[p.id] = p; });

      // Step 6: Build per-learner session stats
      const learnerSessionStats: Record<string, { completed: number; total: number }> = {};
      sessionsData.forEach((s: any) => {
        const sprint = sprintMap[s.sprint_id];
        const enrollment = sprint ? enrollmentMap[sprint.enrollment_id] : null;
        const lid = enrollment?.learner_id;
        if (!lid) return;
        if (!learnerSessionStats[lid]) learnerSessionStats[lid] = { completed: 0, total: 0 };
        learnerSessionStats[lid].total++;
        if (s.status === "completed") learnerSessionStats[lid].completed++;
      });

      // Step 6.5: Fetch course_sprint_templates for session materials
      const sprintTemplateKeys: Array<{ courseId: string; sprintNum: number }> = [];
      const seenTemplateKeys = new Set<string>();
      (sprintsData || []).forEach((sp: any) => {
        const enrollment = enrollmentMap[sp.enrollment_id];
        if (!enrollment?.course_id) return;
        const key = `${enrollment.course_id}-${sp.sprint_number}`;
        if (!seenTemplateKeys.has(key)) {
          seenTemplateKeys.add(key);
          sprintTemplateKeys.push({ courseId: enrollment.course_id, sprintNum: sp.sprint_number });
        }
      });

      const templateMaterialsMap: Record<string, Record<number, Array<{ file_name: string; file_path: string; file_size?: number }>>> = {};
      const templateDescriptionMap: Record<string, Record<number, string>> = {};

      if (sprintTemplateKeys.length > 0) {
        const orFilters = sprintTemplateKeys
          .map((k) => `and(course_id.eq.${k.courseId},sprint_number.eq.${k.sprintNum})`)
          .join(",");
        const { data: templates } = await supabase
          .from("course_sprint_templates")
          .select("course_id, sprint_number, sessions_data")
          .or(orFilters);

        (templates || []).forEach((t: any) => {
          const cid: string = t.course_id;
          const sn: number = t.sprint_number;
          const tKey = `${cid}-${sn}`;
          if (!templateMaterialsMap[tKey]) templateMaterialsMap[tKey] = {};
          if (!templateDescriptionMap[tKey]) templateDescriptionMap[tKey] = {};
          (t.sessions_data || []).forEach((sd: any) => {
            const sessNum = sd.session_number;
            templateMaterialsMap[tKey][sessNum] = sd.materials || [];
            templateDescriptionMap[tKey][sessNum] = sd.description || "";
          });
        });
      }

      // Step 7: Map to final SprintSession array
      const mapped: SprintSession[] = sessionsData.map((s: any) => {
        const sprint = sprintMap[s.sprint_id];
        const enrollment = sprint ? enrollmentMap[sprint.enrollment_id] : null;
        const course = enrollment ? courseMap[enrollment.course_id] : null;
        const learner = enrollment ? profileMap[enrollment.learner_id] : null;
        const lid: string = enrollment?.learner_id || "";
        const stats = learnerSessionStats[lid] || { completed: 0, total: 0 };
        const mKey = `${enrollment?.course_id || ""}-${sprint?.sprint_number || 0}`;
        const session1Data = summaryBySprintId[s.sprint_id];
        const session1Feedback = session1Data?.teacher_feedback ?? null;
        const selfStudyQuestions = session1Feedback?.startsWith("Câu hỏi: ")
          ? session1Feedback.replace("Câu hỏi: ", "")
          : null;
        const session1Summary = session1Data?.lesson_summary?.trim()
          ? session1Data.lesson_summary
          : null;

        return {
          id: s.id,
          sprint_id: s.sprint_id,
          session_number: s.session_number,
          session_type: s.session_type,
          teacher_id: s.teacher_id,
          scheduled_at: s.scheduled_at,
          status: s.status,
          meeting_link: s.meeting_link,
          lesson_summary: session1Summary,
          self_study_questions: selfStudyQuestions,
          feedback: s.feedback,
          grade: s.grade,
          sprint_number: sprint?.sprint_number ?? 0,
          sprint_status: sprint?.status ?? "active",
          course_name: course?.name || "Unknown Course",
          course_level: course?.level || "",
          course_id: enrollment?.course_id || "",
          student_name: learner?.full_name || "Unknown",
          student_email: learner?.email || "",
          student_phone: learner?.phone || "",
          student_avatar_url: learner?.avatar_url || null,
          learner_id: lid,
          completed_sessions: stats.completed,
          total_sessions: stats.total,
          session_materials: (templateMaterialsMap[mKey] && templateMaterialsMap[mKey][s.session_number]) || [],
          session_description: (templateDescriptionMap[mKey] && templateDescriptionMap[mKey][s.session_number]) || null,
          class_id: s.class_id || null,
        };
      });

      setSessions(mapped);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.sprint_status === "locked") return false;
      if (filter === "upcoming") return s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked";
      if (filter === "completed") return s.status === "completed";
      return true;
    });
  }, [sessions, filter]);

  const groupedSessions = useMemo(() => {
    return groupSessionsByClass(filteredSessions);
  }, [filteredSessions]);

  const allUpcoming = sessions.filter((s) => s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked" && s.sprint_status !== "locked");
  const allCompleted = sessions.filter((s) => s.status === "completed");
  const upcomingCount = groupSessionsByClass(allUpcoming).length;
  const completedCount = groupSessionsByClass(allCompleted).length;

  const getSessionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      self_study: t("session.selfStudy"),
      live_session: t("session.liveSession"),
      vietnamese_teacher: t("session.vietnameseTeacher"),
      foreign_teacher: t("session.foreignTeacher"),
    };
    return labels[type] || type;
  };

  const getSessionTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      self_study: "bg-primary-100 text-primary-700",
      live_session: "bg-accent-100 text-accent-700",
      vietnamese_teacher: "bg-secondary-100 text-secondary-700",
      foreign_teacher: "bg-accent-100 text-accent-700",
    };
    return colors[type] || "bg-background-200 text-foreground-600";
  };

  const getStatusBadge = (status: string) => {
    if (status === "completed") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
          <i className="ri-check-line text-[10px]"></i>
          {t("teacher.completed")}
        </span>
      );
    }
    if (status === "awaiting_feedback") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
          <i className="ri-time-line text-[10px]"></i>
          {t("teacher.sprintSessionsAwaitingFeedback")}
        </span>
      );
    }
    if (status === "in_progress") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
          <i className="ri-time-line text-[10px]"></i>
          {t("teacher.inProgress")}
        </span>
      );
    }
    if (status === "locked") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-background-200 text-foreground-500 whitespace-nowrap">
          <i className="ri-lock-line text-[10px]"></i>
          {t("dashboard.locked")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 whitespace-nowrap">
        {status}
      </span>
    );
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("vi-VN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  function parseLessonSummary(
    summary: string | null,
    questionsFromSession1?: string | null
  ): { what_learned: string; questions: string } | null {
    if (!summary || !summary.trim()) return null;
    let parsed: { what_learned: string; questions: string };
    try {
      parsed = JSON.parse(summary);
    } catch {
      parsed = { what_learned: summary, questions: "" };
    }
    if (!parsed.questions && questionsFromSession1) {
      parsed.questions = questionsFromSession1;
    }
    return parsed;
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-28 rounded-full bg-background-100"></div>
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-xl bg-background-50 border border-background-200/70"></div>
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

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h3 className="font-heading text-lg font-bold text-foreground-950 mb-1">
            {t("teacher.navSessions")}
          </h3>
          <p className="text-sm text-foreground-500">{t("teacher.sessionsSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter("upcoming")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
              filter === "upcoming"
                ? "bg-secondary-500 text-background-50"
                : "bg-background-100 text-foreground-600 hover:bg-background-200"
            }`}
          >
            <i className="ri-time-line"></i>
            {t("teacher.filterUpcoming")}
            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              filter === "upcoming" ? "bg-background-50/20 text-background-50" : "bg-background-200 text-foreground-500"
            }`}>
              {upcomingCount}
            </span>
          </button>
          <button
            onClick={() => setFilter("completed")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
              filter === "completed"
                ? "bg-accent-500 text-background-50"
                : "bg-background-100 text-foreground-600 hover:bg-background-200"
            }`}
          >
            <i className="ri-check-double-line"></i>
            {t("teacher.filterCompleted")}
            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              filter === "completed" ? "bg-background-50/20 text-background-50" : "bg-background-200 text-foreground-500"
            }`}>
              {completedCount}
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
            {t("teacher.filterAll")}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {groupedSessions.length === 0 ? (
        <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
            <i className="ri-calendar-2-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-900 font-semibold mb-1">
            {sessions.length === 0 ? t("teacher.noSessionsYet") : t("teacher.noSessionsForFilter")}
          </p>
          <p className="text-xs text-foreground-500">
            {sessions.length === 0 ? t("teacher.noSessionsYetDesc") : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedSessions.map((group) => {
            const session = group[0];
            const groupStatus = getGroupStatus(group);
            const sessionUrl = `/dashboard/sprint/${session.sprint_id}/session/${session.id}`;
            const hasSummary = group.some((s) => !!s.lesson_summary?.trim());
            const hasFeedback = group.some((s) => !!s.feedback);
            const isExpanded = expandedId === session.id + "-group";
            const studentCount = group.length;
            const studentNames = group.map((s) => s.student_name).join(", ");
            const avgProgress = group.length > 0
              ? Math.round(group.reduce((sum, s) => sum + (s.total_sessions > 0 ? Math.round((s.completed_sessions / s.total_sessions) * 100) : 0), 0) / group.length)
              : 0;

            return (
              <div
                key={session.id + "-group"}
                className={`rounded-xl border bg-background-50 overflow-hidden transition-colors duration-150 cursor-pointer ${isExpanded ? "border-background-300 shadow-sm" : "border-background-200/70 hover:border-background-300"}`}
                onClick={() => setExpandedId(isExpanded ? null : session.id + "-group")}
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Session type icon */}
                    <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${getSessionTypeColor(session.session_type)}`}>
                      <i className={`${
                        session.session_type === "self_study" ? "ri-book-open-line" :
                        session.session_type === "vietnamese_teacher" ? "ri-user-voice-line" : "ri-global-line"
                      } text-lg`}></i>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground-900">
                          {getSessionTypeLabel(session.session_type)} · {t("session.session")} {session.session_number} · {t("dashboard.sprint")} {session.sprint_number}
                        </span>
                        {getStatusBadge(groupStatus)}
                        {hasSummary && !hasFeedback && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                            <i className="ri-file-text-line text-[10px]"></i>
                            {t("teacher.summarySubmitted")}
                          </span>
                        )}
                        {hasFeedback && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                            <i className="ri-check-double-line text-[10px]"></i>
                            {t("teacher.feedbackGiven")}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-wrap text-xs text-foreground-500">
                        <span className="flex items-center gap-1">
                          <i className="ri-building-line text-foreground-300"></i>
                          {session.course_name}
                        </span>
                        {session.scheduled_at && (
                          <span className="flex items-center gap-1 text-xs text-foreground-400">
                            <i className="ri-calendar-line text-foreground-300"></i>
                            {formatDate(session.scheduled_at)}
                          </span>
                        )}
                        {/* Student names */}
                        <span className="flex items-center gap-1 text-foreground-600 font-medium flex-wrap">
                          <i className="ri-user-line text-foreground-300"></i>
                          {t("teacher.studentLabel")}: {studentNames}
                          {studentCount > 1 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-primary-100 text-primary-700 whitespace-nowrap">
                              {studentCount} HV
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Meeting link chip */}
                      {session.meeting_link && groupStatus !== "completed" && (
                        <div className="mt-2 flex items-center gap-2">
                          <a
                            href={session.meeting_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-vidicon-line text-[11px]"></i>
                            {t("liveLesson.joinNow")}
                          </a>
                        </div>
                      )}

                      {/* Session Materials from course_sprint_templates */}
                      {session.session_materials && session.session_materials.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-medium text-foreground-400 flex items-center gap-1">
                            <i className="ri-file-line text-[11px]"></i>
                            {t("teacher.sprintSessionsMaterials")}
                          </span>
                          {session.session_materials.map((mat, mIdx) => (
                            <a
                              key={mIdx}
                              href={mat.file_path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
                              title={mat.file_name}
                            >
                              {mat.file_name}
                              <i className="ri-external-link-line text-[9px]"></i>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Session Description from admin template */}
                      {session.session_description && (
                        <p className="mt-2 text-xs text-foreground-500 leading-relaxed line-clamp-2">
                          <i className="ri-file-text-line text-[11px] mr-1 text-foreground-400"></i>
                          {session.session_description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Mini progress indicator */}
                      <div className="hidden sm:flex items-center gap-1.5">
                        <div className="w-14 h-1.5 rounded-full bg-background-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent-500 transition-all duration-300"
                            style={{ width: `${avgProgress}%` }}
                          ></div>
                        </div>
                        <span className="text-[10px] font-semibold text-foreground-400 w-7 text-right">{avgProgress}%</span>
                      </div>
                      <Link
                        to={sessionUrl}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
                      >
                        {t("teacher.openSession")}
                        <i className="ri-arrow-right-line text-[11px]"></i>
                      </Link>
                      <i className={`ri-arrow-down-s-line text-foreground-400 text-sm transition-transform duration-200 ml-1 ${isExpanded ? "rotate-180" : ""}`}></i>
                    </div>
                  </div>
                </div>

              {/* Expanded detail section */}
              {isExpanded && (
                <div className="px-5 pb-5 border-t border-background-100 pt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                  {/* Student list in expanded view */}
                  {studentCount > 1 && (
                    <div className="p-4 rounded-lg bg-background-50/50 border border-background-200/70">
                      <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i className="ri-team-line"></i>
                        {t("teacher.sprintSessionsStudentList", { count: studentCount })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.map((s) => (
                          <span key={s.learner_id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-background-100 text-foreground-700 border border-background-200/70">
                            {s.student_avatar_url ? (
                              <img src={s.student_avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-secondary-100 flex items-center justify-center text-[10px] text-secondary-600 font-bold">
                                {s.student_name.charAt(0)}
                              </div>
                            )}
                            {s.student_name}
                            {s.status === "completed" && (
                              <i className="ri-check-line text-accent-500 text-[10px]"></i>
                            )}
                            {s.status === "awaiting_feedback" && (
                              <span className="text-[9px] text-secondary-600">{t("teacher.sprintSessionsAwaitingBadge")}</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lesson Summary — per learner */}
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider flex items-center gap-1.5">
                      <i className="ri-file-text-line"></i>
                      {t("teacher.expandedLessonSummary")}
                    </p>
                    {group.map((s) => {
                      const parsed = parseLessonSummary(s.lesson_summary, s.self_study_questions);
                      return (
                        <div
                          key={s.learner_id}
                          className="p-4 rounded-lg bg-background-50/50 border border-background-200/70"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            {s.student_avatar_url ? (
                              <img src={s.student_avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-secondary-100 flex items-center justify-center text-[10px] text-secondary-600 font-bold">
                                {s.student_name.charAt(0)}
                              </div>
                            )}
                            <p className="text-sm font-semibold text-foreground-900">{s.student_name}</p>
                          </div>
                          {parsed ? (
                            <>
                              <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">
                                {parsed.what_learned}
                              </p>
                              {parsed.questions && (
                                <div className="mt-3 pt-3 border-t border-background-100">
                                  <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                    <i className="ri-question-line"></i>
                                    {t("teacher.expandedQuestions")}
                                  </p>
                                  <p className="text-sm text-foreground-600 italic whitespace-pre-wrap">
                                    &ldquo;{parsed.questions}&rdquo;
                                  </p>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-foreground-500 italic">
                              {t("liveLesson.noSummaryForTeacher")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Feedback */}
                  {session.feedback && (
                    <div className="p-4 rounded-lg bg-accent-50/50 border border-accent-200/70">
                      <p className="text-[11px] font-semibold text-accent-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i className="ri-chat-check-line"></i>
                        {t("teacher.expandedYourFeedback")}
                      </p>
                      <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">
                        {session.feedback}
                      </p>
                    </div>
                  )}

                  {/* Rating */}
                  {session.grade && session.grade > 0 && (
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-xs text-foreground-500">{t("complete.rating")}:</span>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <i
                            key={star}
                            className={`text-sm ${
                              star <= session.grade!
                                ? "ri-star-fill text-secondary-400"
                                : "ri-star-line text-foreground-300"
                            }`}
                          ></i>
                        ))}
                      </div>
                      <span className="text-sm font-bold text-foreground-900">{session.grade}/5</span>
                    </div>
                  )}

                  {/* Materials in expanded view */}
                  {session.session_materials && session.session_materials.length > 0 && (
                    <div className="p-4 rounded-lg bg-background-50/50 border border-background-200/70">
                      <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i className="ri-folder-line"></i>
                        {t("teacher.expandedSessionMaterials")}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {session.session_materials.map((mat, mIdx) => (
                          <a
                            key={mIdx}
                            href={mat.file_path}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-file-line text-[11px]"></i>
                            {mat.file_name}
                            <i className="ri-external-link-line text-[9px]"></i>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Session Description in expanded view */}
                  {session.session_description && (
                    <div className="p-4 rounded-lg bg-background-50/50 border border-background-200/70">
                      <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i className="ri-file-text-line"></i>
                        {t("teacher.sprintSessionsSessionDesc")}
                      </p>
                      <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">
                        {session.session_description}
                      </p>
                    </div>
                  )}
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