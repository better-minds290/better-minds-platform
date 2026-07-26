import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";

interface SessionMaterial {
  id: string;
  title: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  description: string | null;
  created_at: string;
}

interface SprintSession {
  id: string;
  session_number: number;
  session_type: string;
  teacher_name: string | null;
  scheduled_at: string | null;
  status: string;
  completed_at: string | null;
  feedback: string | null;
  lesson_summary: string | null;
  completion_rating: number | null;
  class_id: string | null;
  materials: SessionMaterial[];
}

interface HistorySprint {
  id: string;
  sprint_number: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  duration_days: number;
  sessions: SprintSession[];
  course: {
    name: string;
    level: string;
  };
}

interface SprintDateInfo {
  startLabel: string;
  endLabel: string;
  isEstimated: boolean;
}

function getSessionTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    self_study: "ri-book-open-line",
    live_session: "ri-user-voice-line",
    vietnamese_teacher: "ri-user-voice-line",
    foreign_teacher: "ri-global-line",
  };
  return icons[type] || "ri-calendar-line";
}

function getSessionTypeColor(type: string): string {
  const colors: Record<string, string> = {
    self_study: "bg-primary-100 text-primary-700",
    live_session: "bg-accent-100 text-accent-700",
    vietnamese_teacher: "bg-secondary-100 text-secondary-700",
    foreign_teacher: "bg-accent-100 text-accent-700",
  };
  return colors[type] || "bg-background-200 text-foreground-600";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("vi-VN", { month: "long", day: "numeric", year: "numeric" });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("vi-VN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function computeDurationDays(createdAt: string, completedAt: string | null): number {
  if (!completedAt) return 0;
  return Math.max(1, Math.ceil((new Date(completedAt).getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string): string {
  if (fileType.includes("pdf")) return "ri-file-pdf-line";
  if (fileType.includes("image")) return "ri-image-line";
  if (fileType.includes("word") || fileType.includes("document")) return "ri-file-word-line";
  if (fileType.includes("sheet") || fileType.includes("excel")) return "ri-file-excel-line";
  if (fileType.includes("presentation") || fileType.includes("powerpoint")) return "ri-file-ppt-line";
  if (fileType.includes("video")) return "ri-video-line";
  if (fileType.includes("audio")) return "ri-music-line";
  if (fileType.includes("zip") || fileType.includes("rar") || fileType.includes("archive")) return "ri-file-zip-line";
  return "ri-file-text-line";
}

function computeSprintDates(sprints: HistorySprint[], enrollmentDate: string): Map<string, SprintDateInfo> {
  const result = new Map<string, SprintDateInfo>();
  const sorted = [...sprints].sort((a, b) => a.sprint_number - b.sprint_number);
  const enrollmentStart = new Date(enrollmentDate);
  let accumulatedDelayDays = 0;

  for (const sprint of sorted) {
    const expectedStart = new Date(enrollmentStart);
    expectedStart.setDate(enrollmentStart.getDate() + (sprint.sprint_number - 1) * 7 + accumulatedDelayDays);
    const expectedEnd = new Date(expectedStart);
    expectedEnd.setDate(expectedStart.getDate() + 6);

    if (sprint.completed_at) {
      const actualEnd = new Date(sprint.completed_at);
      result.set(sprint.id, {
        startLabel: formatDate(sprint.created_at),
        endLabel: formatDate(sprint.completed_at),
        isEstimated: false,
      });

      if (actualEnd > expectedEnd) {
        const delayDays = Math.ceil((actualEnd.getTime() - expectedEnd.getTime()) / (1000 * 60 * 60 * 24));
        accumulatedDelayDays += delayDays;
      }
    } else {
      result.set(sprint.id, {
        startLabel: formatDate(expectedStart.toISOString()),
        endLabel: formatDate(expectedEnd.toISOString()),
        isEstimated: true,
      });
    }
  }

  return result;
}

type TFunc = (key: string, options?: Record<string, unknown>) => string;

function getSessionTypeLabel(type: string, t: TFunc): string {
  const labels: Record<string, string> = {
    self_study: t("history.selfStudy"),
    live_session: t("session.liveSession"),
    vietnamese_teacher: t("history.vietnameseTeacher"),
    foreign_teacher: t("history.foreignTeacher"),
  };
  return labels[type] || type;
}

function getSprintStatusLabel(status: string, t: TFunc): string {
  const labels: Record<string, string> = {
    completed: t("history.sprintStatusCompleted"),
    expired: t("history.sprintStatusExpired"),
    active: t("history.sprintStatusActive"),
    pending: t("history.sprintStatusPending"),
    locked: t("history.sprintStatusLocked"),
  };
  return labels[status] || status;
}

function getSessionStatusLabel(status: string, t: TFunc): string {
  if (status === "completed") return t("history.sessionStatusDone");
  if (status === "absent") return t("history.sessionStatusAbsent");
  return status;
}

function getActiveSprintStatusLabel(status: string, t: TFunc): string {
  if (status === "active") return t("history.activeSprintLearning");
  return t("history.activeSprintPending");
}

function HistoryContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const supabase = getSupabase();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sprints, setSprints] = useState<HistorySprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSprint, setExpandedSprint] = useState<string | null>(null);
  const [highlightedSession, setHighlightedSession] = useState<string | null>(null);
  const [courseDisplayName, setCourseDisplayName] = useState<{ name: string; level: string } | null>(null);
  const [sprintDates, setSprintDates] = useState<Map<string, SprintDateInfo>>(new Map());
  const sessionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const learnerId = searchParams.get("learner");
  const isTeacherView = (profile?.role === "vietnamese_teacher" || profile?.role === "foreign_teacher" || profile?.role === "admin") && !!learnerId;
  const [viewedLearnerName, setViewedLearnerName] = useState<string>("");

  const fetchHistory = useCallback(async () => {
    const targetLearnerId = isTeacherView ? learnerId : profile?.id;
    if (!targetLearnerId) return;
    setLoading(true);
    setFetchError(null);

    try {
      if (isTeacherView && learnerId) {
        const { data: learnerProfile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", learnerId)
          .maybeSingle();
        if (learnerProfile) {
          setViewedLearnerName(learnerProfile.full_name || "Unknown");
        }
      }

      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id, course_id, enrolled_at")
        .eq("learner_id", targetLearnerId)
        .maybeSingle();

      if (!enrollment) {
        setSprints([]);
        setLoading(false);
        return;
      }

      const enrollmentDate = enrollment.enrolled_at || new Date().toISOString();

      let localCourseInfo: { name: string; level: string } | null = null;
      let localCourseId: string | null = null;
      if (enrollment.course_id) {
        const { data: courseData } = await supabase
          .from("courses")
          .select("name, level")
          .eq("id", enrollment.course_id)
          .maybeSingle();
        if (courseData) {
          localCourseInfo = { name: courseData.name, level: courseData.level };
          localCourseId = enrollment.course_id;
          setCourseDisplayName(localCourseInfo);
        }
      }

      const templateMaterialsMap = new Map<number, Map<number, SessionMaterial[]>>();
      if (localCourseId) {
        const { data: templates } = await supabase
          .from("course_sprint_templates")
          .select("sprint_number, sessions_data")
          .eq("course_id", localCourseId);

        (templates || []).forEach((tmpl: any) => {
          const sprintMaterialsMap = new Map<number, SessionMaterial[]>();
          if (tmpl.sessions_data) {
            (tmpl.sessions_data as any[]).forEach((sd: any) => {
              const mats: SessionMaterial[] = (sd.materials || []).map((m: any) => ({
                id: `material-${sd.session_number}-${m.file_name}`,
                title: sd.description || sd.title || null,
                file_name: m.file_name,
                file_url: m.file_path,
                file_type: m.file_name?.split('.').pop() || 'unknown',
                file_size: m.file_size || 0,
                description: sd.description || null,
                created_at: '',
              }));
              sprintMaterialsMap.set(sd.session_number, mats);
            });
          }
          templateMaterialsMap.set(tmpl.sprint_number, sprintMaterialsMap);
        });
      }

      const { data: sprintRows, error: sprintError } = await supabase
        .from("learning_sprints")
        .select("id, sprint_number, status, created_at, completed_at")
        .eq("enrollment_id", enrollment.id)
        .order("sprint_number", { ascending: false });

      if (sprintError) throw sprintError;
      if (!sprintRows || sprintRows.length === 0) {
        setSprints([]);
        setLoading(false);
        return;
      }

      const sprintsWithSessions: HistorySprint[] = [];

      for (const sprint of sprintRows) {
        const sprintMatsMap = localCourseId
          ? templateMaterialsMap.get(sprint.sprint_number)
          : undefined;

        const { data: sessionRows } = await supabase
          .from("sprint_sessions")
          .select("id, session_number, session_type, teacher_id, scheduled_at, status, completed_at, feedback, lesson_summary, completion_rating, class_id")
          .eq("sprint_id", sprint.id)
          .order("session_number", { ascending: true });

        const teacherIds = [...new Set((sessionRows || []).map((s) => s.teacher_id).filter(Boolean))] as string[];
        const teacherMap = new Map<string, string>();
        if (teacherIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", teacherIds);
          (profiles || []).forEach((p) => teacherMap.set(p.id, p.full_name));
        }

        const classIds = [...new Set((sessionRows || []).map((s) => s.class_id).filter(Boolean))] as string[];
        const classMaterialsMap = new Map<string, SessionMaterial[]>();
        if (classIds.length > 0) {
          const { data: materials } = await supabase
            .from("class_materials")
            .select("id, class_id, title, file_name, file_url, file_type, file_size, description, created_at")
            .in("class_id", classIds)
            .order("created_at", { ascending: true });
          (materials || []).forEach((m: any) => {
            const list = classMaterialsMap.get(m.class_id) || [];
            list.push({
              id: m.id,
              title: m.title,
              file_name: m.file_name,
              file_url: m.file_url,
              file_type: m.file_type,
              file_size: m.file_size,
              description: m.description,
              created_at: m.created_at,
            });
            classMaterialsMap.set(m.class_id, list);
          });
        }

        sprintsWithSessions.push({
          id: sprint.id,
          sprint_number: sprint.sprint_number,
          status: sprint.status,
          created_at: sprint.created_at,
          completed_at: sprint.completed_at,
          duration_days: computeDurationDays(sprint.created_at, sprint.completed_at),
          sessions: (sessionRows || []).map((s) => ({
            id: s.id,
            session_number: s.session_number,
            session_type: s.session_type,
            teacher_name: teacherMap.get(s.teacher_id) || null,
            scheduled_at: s.scheduled_at,
            status: s.status,
            completed_at: s.completed_at,
            feedback: s.feedback,
            lesson_summary: s.lesson_summary,
            completion_rating: s.completion_rating,
            class_id: s.class_id,
            materials: sprintMatsMap?.get(s.session_number) || classMaterialsMap.get(s.class_id) || [],
          })),
          course: localCourseInfo || { name: "", level: "" },
        });
      }

      setSprints(sprintsWithSessions);
      setSprintDates(computeSprintDates(sprintsWithSessions, enrollmentDate));
    } catch (err) {
      console.error("History fetch error:", err);
      setFetchError(t("history.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase, isTeacherView, learnerId, t]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const sprintId = searchParams.get("sprint");
    const sessionId = searchParams.get("session");
    if (!sprintId) return;

    const sprintExists = sprints.some((s) => s.id === sprintId);
    if (!sprintExists) return;

    setExpandedSprint(sprintId);
    if (sessionId) {
      setHighlightedSession(sessionId);
    }

    const newParams = new URLSearchParams(searchParams);
    newParams.delete("sprint");
    newParams.delete("session");
    setSearchParams(newParams, { replace: true });
  }, [searchParams, sprints]);

  useEffect(() => {
    if (!highlightedSession || !expandedSprint) return;
    const timer = setTimeout(() => {
      const el = sessionRefs.current.get(highlightedSession);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.transition = "box-shadow 0.3s ease";
        el.style.boxShadow = "0 0 0 3px var(--accent-400, #f59e0b)";
        setTimeout(() => {
          el.style.boxShadow = "";
        }, 2500);
      }
      setHighlightedSession(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [highlightedSession, expandedSprint]);

  const completedSprints = sprints.filter((s) => s.status === "completed");
  const activeSprint = sprints.find((s) => s.status === "active" || s.status === "pending");
  const expiredSprints = sprints.filter((s) => s.status === "expired");

  const totalCompletedSessions = completedSprints.reduce((sum, s) => sum + s.sessions.filter((ss) => ss.status === "completed").length, 0);
  const totalCompletedHours = completedSprints.reduce((sum, sprint) => {
    return sum + sprint.sessions
      .filter((ss) => ss.status === "completed")
      .reduce((sessSum, ss) => sessSum + (ss.session_type === "self_study" ? 1 : 2), 0);
  }, 0);
  const totalSessions = sprints.reduce((sum, s) => sum + s.sessions.length, 0);
  const overallCompletionRate = totalSessions > 0 ? Math.round((totalCompletedSessions / totalSessions) * 100) : 0;

  const toggleExpand = (sprintId: string) => {
    setExpandedSprint(expandedSprint === sprintId ? null : sprintId);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      const basePath = (__BASE_PATH__ as string) || "/";
      const prefix = basePath === "/" ? "" : basePath;
      window.location.href = `${prefix}/login`;
    }
  };

  const navLabel = isTeacherView ? t("history.navReports") : t("history.navDashboard");
  const breadcrumbParent = isTeacherView ? t("history.breadcrumbReports") : t("history.breadcrumbDashboard");
  const parentLink = isTeacherView ? "/teacher/dashboard?tab=reports" : "/dashboard";

  return (
    <div className="min-h-screen bg-background-50">
      <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
        <div className="w-full px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden w-9 h-9 flex items-center justify-center rounded-md text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                aria-label="Toggle menu"
              >
                <i className={mobileMenuOpen ? "ri-close-line text-lg" : "ri-menu-line text-lg"}></i>
              </button>
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to={parentLink}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {navLabel}
                </Link>
                {!isTeacherView && (
                  <Link
                    to="/courses"
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {t("history.navCourses")}
                  </Link>
                )}
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-primary-600 bg-primary-50 whitespace-nowrap cursor-default">
                  {t("history.navHistory")}
                </span>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <span className="text-sm font-medium text-foreground-700 hidden lg:inline">
                  {profile?.full_name}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("history.navSignOut")}</span>
              </button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <Link to={parentLink} onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer">
                  <i className="ri-dashboard-line mr-2"></i>{navLabel}
                </Link>
                {!isTeacherView && (
                  <Link to="/courses" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer">
                    <i className="ri-book-open-line mr-2"></i>{t("history.navCourses")}
                  </Link>
                )}
                <span className="px-3 py-2.5 rounded-md text-sm font-semibold text-primary-600 bg-primary-50 cursor-default">
                  <i className="ri-history-line mr-2"></i>{t("history.navHistory")}
                </span>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        {isTeacherView && (
          <div className="mb-6 p-4 rounded-xl bg-secondary-50 border border-secondary-200 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600">
                <i className="ri-user-search-line text-lg"></i>
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary-800">
                  {t("history.viewingLearner")} <strong>{viewedLearnerName || t("history.viewingLearnerDefault")}</strong>
                </p>
                <p className="text-xs text-secondary-600">{t("history.viewingLearnerDesc")}</p>
              </div>
            </div>
            <Link
              to="/teacher/dashboard?tab=reports"
              className="inline-flex items-center px-4 py-2 rounded-full text-xs font-semibold bg-secondary-500 text-background-50 hover:bg-secondary-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-arrow-left-line mr-1"></i>
              {t("history.backToReports")}
            </Link>
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-foreground-400 mb-3">
            <Link to={parentLink} className="hover:text-foreground-600 transition-colors cursor-pointer">
              {breadcrumbParent}
            </Link>
            <i className="ri-arrow-right-s-line text-xs"></i>
            <span className="text-foreground-600 font-medium">{t("history.breadcrumbHistory")}</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-1">
                {isTeacherView
                  ? t("history.headingTeacher", { name: viewedLearnerName || t("history.viewingLearnerDefault") })
                  : t("history.headingLearner")}
              </h1>
              <p className="text-sm text-foreground-500">
                {isTeacherView ? t("history.headingDescTeacher") : t("history.headingDescLearner")}
              </p>
            </div>
          </div>
        </div>

        {loading && (
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-background-200 rounded-lg"></div>
            ))}
          </div>
        )}

        {!loading && fetchError && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
              <i className="ri-error-warning-line text-2xl text-accent-600"></i>
            </div>
            <p className="text-sm text-foreground-500 mb-6">{fetchError}</p>
            <button
              onClick={fetchHistory}
              className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-refresh-line mr-1.5"></i>
              {t("history.retry")}
            </button>
          </div>
        )}

        {!loading && !fetchError && sprints.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto flex items-center justify-center rounded-2xl bg-background-100 mb-6">
              <i className="ri-history-line text-3xl text-foreground-400"></i>
            </div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">
              {t("history.emptyTitle")}
            </h2>
            <p className="text-sm text-foreground-500 mb-6 max-w-md mx-auto">
              {isTeacherView ? t("history.emptyTeacher") : t("history.emptyLearner")}
            </p>
            {!isTeacherView && (
            <Link
              to="/courses"
              className="inline-flex items-center px-6 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-compass-3-line mr-1.5"></i>
              {t("history.exploreCourses")}
            </Link>
            )}
          </div>
        )}

        {!loading && !fetchError && sprints.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="p-4 rounded-xl bg-background-50 border border-background-200">
                <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600 mb-2">
                  <i className="ri-stack-line text-base"></i>
                </div>
                <p className="text-xs text-foreground-400 mb-0.5">{t("history.statsTotalSprints")}</p>
                <p className="font-heading text-2xl font-bold text-foreground-950">{sprints.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-50 border border-background-200">
                <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600 mb-2">
                  <i className="ri-check-double-line text-base"></i>
                </div>
                <p className="text-xs text-foreground-400 mb-0.5">{t("history.statsCompleted")}</p>
                <p className="font-heading text-2xl font-bold text-foreground-950">{completedSprints.length}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-50 border border-background-200">
                <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600 mb-2">
                  <i className="ri-calendar-check-line text-base"></i>
                </div>
                <p className="text-xs text-foreground-400 mb-0.5">{t("history.statsSessionsDone")}</p>
                <p className="font-heading text-2xl font-bold text-foreground-950">{totalCompletedSessions}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-50 border border-background-200">
                <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600 mb-2">
                  <i className="ri-percent-line text-base"></i>
                </div>
                <p className="text-xs text-foreground-400 mb-0.5">{t("history.statsCompletionRate")}</p>
                <p className="font-heading text-2xl font-bold text-foreground-950">{overallCompletionRate}%</p>
              </div>
            </div>

            {activeSprint && (
              <div className="mb-6 p-4 rounded-xl bg-primary-50 border border-primary-200 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-100 text-primary-600">
                    <i className="ri-flashlight-line text-lg"></i>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary-800">
                      {t("history.activeSprintRunning", { n: activeSprint.sprint_number })}
                    </p>
                    <p className="text-xs text-primary-600">{getActiveSprintStatusLabel(activeSprint.status, t)}</p>
                  </div>
                </div>
                {!isTeacherView && (
                <Link
                  to="/dashboard"
                  className="inline-flex items-center px-4 py-2 rounded-md text-xs font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-arrow-right-line mr-1"></i>
                  {t("history.activeSprintGoLearn")}
                </Link>
                )}
              </div>
            )}

            <div className="space-y-4">
              <h2 className="font-heading text-lg font-bold text-foreground-950 flex items-center gap-2">
                <i className="ri-list-check text-accent-500"></i>
                {t("history.allSprints")}
              </h2>

              {sprints.map((sprint) => {
                const isExpanded = expandedSprint === sprint.id;
                const completedCount = sprint.sessions.filter((s) => s.status === "completed").length;
                const avgRating = sprint.sessions
                  .filter((s) => s.completion_rating && s.completion_rating > 0)
                  .reduce((acc, s) => acc + (s.completion_rating || 0), 0);
                const ratingCount = sprint.sessions.filter((s) => s.completion_rating && s.completion_rating > 0).length;

                return (
                  <div
                    key={sprint.id}
                    className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                      sprint.status === "completed"
                        ? "bg-background-50 border-background-200 hover:border-accent-300"
                        : sprint.status === "expired"
                          ? "bg-background-50 border-secondary-200 opacity-75"
                          : sprint.status === "active" || sprint.status === "pending"
                            ? "bg-primary-50 border-primary-200"
                            : "bg-background-100 border-background-200 opacity-60"
                    }`}
                  >
                    <button
                      onClick={() => toggleExpand(sprint.id)}
                      className="w-full text-left px-5 py-4 flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-12 h-12 flex items-center justify-center rounded-full text-lg font-bold flex-shrink-0 ${
                            sprint.status === "completed"
                              ? "bg-accent-100 text-accent-700"
                              : sprint.status === "expired"
                                ? "bg-secondary-100 text-secondary-600"
                                : sprint.status === "active" || sprint.status === "pending"
                                  ? "bg-primary-100 text-primary-700"
                                  : "bg-background-200 text-foreground-400"
                          }`}
                        >
                          {sprint.sprint_number}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-heading text-base font-bold text-foreground-950">
                              {t("history.sprint")} {sprint.sprint_number}
                            </h3>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                                sprint.status === "completed"
                                  ? "bg-accent-100 text-accent-700"
                                  : sprint.status === "expired"
                                    ? "bg-secondary-100 text-secondary-700"
                                    : sprint.status === "active"
                                      ? "bg-primary-100 text-primary-700"
                                      : sprint.status === "pending"
                                        ? "bg-secondary-100 text-secondary-700"
                                        : "bg-background-200 text-foreground-500"
                              }`}
                            >
                              {getSprintStatusLabel(sprint.status, t)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-foreground-500 flex-wrap">
                            {(() => {
                              const dateInfo = sprintDates.get(sprint.id);
                              if (!dateInfo) {
                                return (
                                  <span className="flex items-center gap-1">
                                    <i className="ri-calendar-line"></i>
                                    {formatDate(sprint.created_at)}
                                  </span>
                                );
                              }
                              if (sprint.status === "completed") {
                                return (
                                  <>
                                    <span className="flex items-center gap-1">
                                      <i className="ri-calendar-line"></i>
                                      {dateInfo.startLabel}
                                    </span>
                                    <span>→</span>
                                    <span className="flex items-center gap-1">
                                      <i className="ri-flag-line"></i>
                                      {dateInfo.endLabel}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <i className="ri-time-line"></i>
                                      {sprint.duration_days} {t("history.daysUnit")}
                                    </span>
                                  </>
                                );
                              }
                              if (sprint.status === "active" || sprint.status === "pending") {
                                return (
                                  <>
                                    <span className="flex items-center gap-1">
                                      <i className="ri-calendar-line"></i>
                                      {dateInfo.startLabel}
                                    </span>
                                    <span>→</span>
                                    {sprint.status === "pending" ? (
                                      <>
                                        <span className="flex items-center gap-1">
                                          <i className="ri-flag-line"></i>
                                          {dateInfo.endLabel}
                                        </span>
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-background-200 text-foreground-400">
                                          {t("history.estimated")}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="flex items-center gap-1 text-primary-600 font-medium">
                                        <i className="ri-hourglass-line"></i>
                                        {t("history.learningNow")}
                                      </span>
                                    )}
                                  </>
                                );
                              }
                              if (sprint.status === "locked") {
                                return (
                                  <>
                                    <span className="flex items-center gap-1">
                                      <i className="ri-calendar-line"></i>
                                      {dateInfo.startLabel}
                                    </span>
                                    <span>→</span>
                                    <span className="flex items-center gap-1">
                                      <i className="ri-flag-line"></i>
                                      {dateInfo.endLabel}
                                    </span>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-background-200 text-foreground-400">
                                      {t("history.notOpened")}
                                    </span>
                                  </>
                                );
                              }
                              return (
                                <>
                                  <span className="flex items-center gap-1">
                                    <i className="ri-calendar-line"></i>
                                    {dateInfo.startLabel}
                                  </span>
                                  <span>→</span>
                                  <span className="flex items-center gap-1">
                                    <i className="ri-flag-line"></i>
                                    {dateInfo.endLabel}
                                  </span>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-background-200 text-foreground-400">
                                    {t("history.estimated")}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="hidden sm:flex items-center gap-1.5">
                          <div className="flex items-center gap-0.5">
                            {sprint.sessions.map((s) => (
                              <div
                                key={s.session_number}
                                className={`w-2.5 h-2.5 rounded-full ${
                                  s.status === "completed" ? "bg-accent-500"
                                    : s.status === "absent" ? "bg-accent-400"
                                    : "bg-background-300"
                                }`}
                                title={`${t("history.session")} ${s.session_number}: ${s.status === "absent" ? t("history.sessionStatusAbsent") : s.status}`}
                              ></div>
                            ))}
                          </div>
                          <span className="text-xs text-foreground-500">
                            {completedCount}/{sprint.sessions.length}
                          </span>
                        </div>
                        <i
                          className={`ri-arrow-down-s-line text-foreground-400 transition-transform duration-200 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        ></i>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-background-200 pt-4 space-y-3">
                        {sprint.sessions.map((session) => (
                          <div
                            key={session.id}
                            ref={(el) => {
                              if (el) sessionRefs.current.set(session.id, el);
                              else sessionRefs.current.delete(session.id);
                            }}
                            className={`p-4 rounded-lg border ${
                              session.status === "completed"
                                ? "bg-accent-50/30 border-accent-200"
                                : session.status === "absent"
                                  ? "bg-accent-50/20 border-accent-200/50"
                                  : "bg-background-100 border-background-200"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={`w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 ${getSessionTypeColor(session.session_type)}`}
                              >
                                <i className={`${getSessionTypeIcon(session.session_type)} text-base`}></i>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground-900">
                                      {t("history.sessionNumber", { n: session.session_number, type: getSessionTypeLabel(session.session_type, t) })}
                                    </p>
                                    <div className="flex items-center gap-3 mt-0.5 text-xs text-foreground-500">
                                      {session.scheduled_at && (
                                        <span className="flex items-center gap-1">
                                          <i className="ri-calendar-line"></i>
                                          {formatDateTime(session.scheduled_at)}
                                        </span>
                                      )}
                                      {session.teacher_name && (session.class_id || session.status === "completed" || session.status === "in_progress") && (
                                        <span className="flex items-center gap-1">
                                          <i className="ri-user-line"></i>
                                          {session.teacher_name}
                                        </span>
                                      )}
                                      {session.teacher_name && !session.class_id && session.status !== "completed" && session.status !== "in_progress" && (
                                        <span className="flex items-center gap-1 text-foreground-400">
                                          <i className="ri-time-line"></i>
                                          {t("history.sessionNotScheduled")}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                                      session.status === "completed"
                                        ? "bg-accent-100 text-accent-700"
                                        : session.status === "absent"
                                          ? "bg-accent-100 text-accent-700"
                                          : session.status === "in_progress"
                                            ? "bg-primary-100 text-primary-700"
                                            : "bg-background-200 text-foreground-500"
                                    }`}
                                  >
                                    {getSessionStatusLabel(session.status, t)}
                                  </span>
                                </div>

                                {session.session_number !== 1 && session.status === "absent" && (
                                  <div className="mt-2 p-3 rounded-md bg-accent-50 border border-accent-200">
                                    <p className="text-xs font-semibold text-accent-700 flex items-center gap-1.5">
                                      <i className="ri-user-unfollow-line"></i>
                                      {t("history.sessionAbsentNote")}
                                    </p>
                                    {session.feedback && <p className="text-xs text-foreground-500 mt-1">{session.feedback}</p>}
                                  </div>
                                )}

                                {session.session_number !== 1 && session.status !== "absent" && session.feedback && (
                                  <div className="mt-2 p-3 rounded-md bg-background-50 border border-background-200">
                                    <p className="text-xs font-semibold text-foreground-700 mb-1">
                                      <i className="ri-chat-1-line mr-1"></i>
                                      {t("history.sessionTeacherFeedback")}
                                    </p>
                                    <p className="text-xs text-foreground-600 leading-relaxed">{session.feedback}</p>
                                  </div>
                                )}

                                {session.lesson_summary && (() => {
                                  let summary: { what_learned: string; questions: string } | null = null;
                                  try { summary = JSON.parse(session.lesson_summary); } catch { summary = null; }
                                  return summary ? (
                                    <div className="mt-2 p-3 rounded-md bg-background-50 border border-background-200">
                                      <p className="text-xs font-semibold text-foreground-700 mb-1">
                                        <i className="ri-file-text-line mr-1"></i>
                                        {t("history.sessionLessonSummary")}
                                      </p>
                                      <p className="text-xs text-foreground-600 leading-relaxed">
                                        {summary.what_learned}
                                      </p>
                                      {summary.questions && (
                                        <div className="mt-2 pt-2 border-t border-background-100">
                                          <p className="text-[11px] font-semibold text-foreground-500 mb-0.5">
                                            <i className="ri-question-line mr-1"></i>{t("history.sessionQuestions")}
                                          </p>
                                          <p className="text-xs text-foreground-500 italic leading-relaxed">
                                            &ldquo;{summary.questions}&rdquo;
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  ) : null;
                                })()}

                                {session.session_number !== 1 && session.status !== "absent" && session.completion_rating && session.completion_rating > 0 && (
                                  <div className="mt-2 flex items-center gap-1">
                                    <span className="text-xs text-foreground-500">{t("history.sessionRating")}</span>
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <i
                                        key={star}
                                        className={`text-xs ${
                                          star <= Math.round(session.completion_rating!)
                                            ? "ri-star-fill text-secondary-400"
                                            : "ri-star-line text-foreground-300"
                                        }`}
                                      ></i>
                                    ))}
                                  </div>
                                )}

                                {session.session_number === 1 && (
                                  <div className="mt-2 p-2 rounded-md bg-background-100 border border-background-200">
                                    <p className="text-xs text-foreground-500 italic flex items-center gap-1.5">
                                      <i className="ri-information-line"></i>
                                      {t("history.sessionFirstNote")}
                                    </p>
                                  </div>
                                )}

                                {session.materials && session.materials.length > 0 && (
                                  <div className="mt-3 p-3 rounded-md bg-background-100 border border-background-200">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-5 h-5 flex items-center justify-center rounded-full bg-primary-200">
                                        <i className="ri-folder-line text-xs text-primary-600"></i>
                                      </div>
                                      <p className="text-xs font-semibold text-foreground-700">
                                        {t("history.sessionMaterials")}
                                      </p>
                                      <span className="text-xs text-foreground-400">({session.materials.length})</span>
                                    </div>
                                    <div className="space-y-1.5 ml-7">
                                      {session.materials.map((mat) => (
                                        <a
                                          key={mat.id}
                                          href={mat.file_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-2.5 p-2 rounded-md bg-background-50 border border-background-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors cursor-pointer group"
                                        >
                                          <div className="w-7 h-7 flex items-center justify-center rounded-md bg-primary-100 text-primary-600 flex-shrink-0">
                                            <i className={`${getFileIcon(mat.file_type)} text-xs`}></i>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-foreground-800 group-hover:text-primary-700 transition-colors truncate">
                                              {mat.title || mat.file_name}
                                            </p>
                                            <p className="text-[11px] text-foreground-400 flex items-center gap-1.5">
                                              <span className="truncate">{mat.file_name}</span>
                                              <span>·</span>
                                              <span className="whitespace-nowrap">{formatFileSize(mat.file_size)}</span>
                                            </p>
                                          </div>
                                          <div className="w-6 h-6 flex items-center justify-center rounded-full bg-background-200 group-hover:bg-primary-100 transition-colors flex-shrink-0">
                                            <i className="ri-download-line text-[10px] text-foreground-500 group-hover:text-primary-600"></i>
                                          </div>
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {(!session.materials || session.materials.length === 0) && session.session_type !== "self_study" && session.class_id && (
                                  <div className="mt-2 p-2 rounded-md bg-background-100 border border-background-200 border-dashed">
                                    <p className="text-xs text-foreground-400 italic flex items-center gap-1.5">
                                      <i className="ri-file-forbid-line"></i>
                                      {t("history.sessionNoMaterials")}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}

                        {ratingCount > 0 && (
                          <div className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-background-100">
                            <span className="text-xs text-foreground-500">{t("history.sprintAvgRating")}</span>
                            <span className="text-sm font-bold text-foreground-900">
                              {(avgRating / ratingCount).toFixed(1)}
                            </span>
                            <div className="flex items-center">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <i
                                  key={star}
                                  className={`text-xs ${
                                    star <= Math.round(avgRating / ratingCount)
                                      ? "ri-star-fill text-secondary-400"
                                      : "ri-star-line text-foreground-300"
                                  }`}
                                ></i>
                              ))}
                            </div>
                          </div>
                        )}

                        {sprint.status === "completed" && !isTeacherView && (
                          <Link
                            to={`/dashboard/sprint/${sprint.id}/complete`}
                            className="inline-flex items-center px-4 py-2 rounded-md text-xs font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 border border-accent-200 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-award-line mr-1.5"></i>
                            {t("history.viewSprintDetail")}
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {completedSprints.length > 0 && (
              <div className="mt-10 p-6 rounded-xl bg-background-50 border border-background-200">
                <h2 className="font-heading text-lg font-bold text-foreground-950 mb-4 flex items-center gap-2">
                  <i className="ri-bar-chart-line text-primary-500"></i>
                  {t("history.summaryTitle")}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-accent-50 border border-accent-200">
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 mb-2">
                      <i className="ri-trophy-line"></i>
                    </div>
                    <p className="text-xs text-foreground-500 mb-0.5">{t("history.summarySprintsCompleted")}</p>
                    <p className="font-heading text-xl font-bold text-foreground-950">{completedSprints.length} / {sprints.length}</p>
                    <p className="text-xs text-foreground-500 mt-1">
                      {completedSprints.length > 0 && sprints.length > 0
                        ? t("history.summaryCompletionPercent", { pct: Math.round((completedSprints.length / sprints.length) * 100) })
                        : t("history.summaryStartNow")}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-primary-50 border border-primary-200">
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 mb-2">
                      <i className="ri-time-line"></i>
                    </div>
                    <p className="text-xs text-foreground-500 mb-0.5">{t("history.summaryTotalHours")}</p>
                    <p className="font-heading text-xl font-bold text-foreground-950">
                      {totalCompletedHours}{t("history.summaryHoursUnit")}
                    </p>
                    <p className="text-xs text-foreground-500 mt-1">{t("history.summarySessionsDone", { n: totalCompletedSessions })}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-secondary-50 border border-secondary-200">
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600 mb-2">
                      <i className="ri-fire-line"></i>
                    </div>
                    <p className="text-xs text-foreground-500 mb-0.5">{t("history.summaryStreak")}</p>
                    <p className="font-heading text-xl font-bold text-foreground-950">
                      {(() => {
                        let streak = 0;
                        for (let i = sprints.length - 1; i >= 0; i--) {
                          if (sprints[i].status === "completed") streak++;
                          else break;
                        }
                        return streak;
                      })()}
                    </p>
                    <p className="text-xs text-foreground-500 mt-1">{t("history.summaryStreakDesc")}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <AuthGuard allowedRoles={["learner", "vietnamese_teacher", "foreign_teacher", "admin"]}>
      <HistoryContent />
    </AuthGuard>
  );
}