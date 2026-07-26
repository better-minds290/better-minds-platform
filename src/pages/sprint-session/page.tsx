import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef, useCallback } from "react";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import { useAuth } from "@/hooks/useAuth";
import LearnerLiveLesson from "./components/LearnerLiveLesson";
import TeacherLiveLesson from "./components/TeacherLiveLesson";
import { getSupabase } from "@/lib/supabase";

interface SessionData {
  id: string;
  sprint_id: string;
  session_number: number;
  session_type: string;
  teacher_id: string | null;
  scheduled_at: string | null;
  status: string;
  completed_at: string | null;
  teacher_feedback: string | null;
  completion_rating: number | null;
  lesson_summary: string | null;
  sprint: {
    sprint_number: number;
    status: string;
    deadline: string;
  };
  course: {
    id: string;
    name: string;
    level: string;
  };
}

interface MaterialData {
  file_name: string;
  file_path: string;
  file_size?: number;
}

interface SprintContentData {
  title: string;
  objectives: string;
  vocabulary: Array<{ word: string; definition: string; example: string }>;
  reading_material: string;
  exercises: Array<{ instruction: string; content: string }>;
  sessions_data?: Array<{
    session_number: number;
    title: string;
    description: string;
    materials: Array<{ file_name: string; file_path: string; file_size?: number }>;
  }>;
}

function getCountdownParts(deadline: string) {
  const now = Date.now();
  const deadlineTime = new Date(deadline).getTime();
  const diff = deadlineTime - now;
  if (diff <= 0) return { hours: 0, minutes: 0, seconds: 0, isOverdue: true };
  const totalSeconds = Math.floor(diff / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    isOverdue: false,
  };
}

function CountdownTimer({ deadline }: { deadline: string }) {
  const { t } = useTranslation();
  const [parts, setParts] = useState(() => getCountdownParts(deadline));

  useEffect(() => {
    const interval = setInterval(() => setParts(getCountdownParts(deadline)), 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  const pad = (n: number) => String(n).padStart(2, "0");

  if (parts.isOverdue) {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-100 text-accent-700 text-sm font-semibold whitespace-nowrap">
        <i className="ri-alert-line"></i>
        {t("session.overdue")}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-center">
        <span className="text-xl font-bold text-foreground-950 tabular-nums leading-tight">{pad(parts.hours)}</span>
        <span className="text-[10px] text-foreground-400 uppercase leading-tight">hrs</span>
      </div>
      <span className="text-lg font-bold text-foreground-400 leading-tight">:</span>
      <div className="flex flex-col items-center">
        <span className="text-xl font-bold text-foreground-950 tabular-nums leading-tight">{pad(parts.minutes)}</span>
        <span className="text-[10px] text-foreground-400 uppercase leading-tight">min</span>
      </div>
      <span className="text-lg font-bold text-foreground-400 leading-tight">:</span>
      <div className="flex flex-col items-center">
        <span className="text-xl font-bold text-foreground-950 tabular-nums leading-tight">{pad(parts.seconds)}</span>
        <span className="text-[10px] text-foreground-400 uppercase leading-tight">sec</span>
      </div>
    </div>
  );
}

function getSessionTypeLabel(type: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    self_study: t("session.selfStudy"),
    live_session: t("session.liveSession"),
    vietnamese_teacher: t("session.vietnameseTeacher"),
    foreign_teacher: t("session.foreignTeacher"),
  };
  return labels[type] || type;
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

function getSessionTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    self_study: "ri-book-open-line",
    live_session: "ri-user-voice-line",
    vietnamese_teacher: "ri-user-voice-line",
    foreign_teacher: "ri-global-line",
  };
  return icons[type] || "ri-calendar-line";
}

function SessionDetailContent() {
  const { t } = useTranslation();
  const { sprintId, sessionId } = useParams<{ sprintId: string; sessionId: string }>();
  const supabase = getSupabase();
  const { profile, loading: authLoading } = useAuth();

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sprintSessions, setSprintSessions] = useState<Array<{id: string; session_number: number; status: string}>>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [learnerInfo, setLearnerInfo] = useState<{ full_name: string; level: string } | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);

  const allSessionsCompleted = sprintSessions.length === 3 && sprintSessions.every((s) => s.status === "completed");
  const sprintCompleted = session?.sprint?.status === "completed";

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setFetchError(null);

    try {
      // Step 1: Fetch session with sprint data (simple FK, no deep nesting)
      const { data: sessionData, error: sessionError } = await supabase
        .from("sprint_sessions")
        .select(`
          id, sprint_id, session_number, session_type, teacher_id,
          scheduled_at, status, completed_at, teacher_feedback, completion_rating, lesson_summary,
          learning_sprints!inner(
            id, sprint_number, status, deadline_session1, deadline_session2, deadline_session3, enrollment_id
          )
        `)
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) throw sessionError;

      if (sessionData) {
        const sprintData = (sessionData.learning_sprints as any);
        const sessionNum = sessionData.session_number;

        // Auto-transition in_progress → awaiting_feedback when 1 hour has passed since scheduled time
        if ((sessionData.status === "in_progress" || sessionData.status === "active") && sessionData.scheduled_at) {
          const oneHourAfter = new Date(new Date(sessionData.scheduled_at).getTime() + 60 * 60 * 1000).getTime();
          if (Date.now() > oneHourAfter) {
            await supabase
              .from("sprint_sessions")
              .update({ status: "awaiting_feedback" })
              .eq("id", sessionId);
            sessionData.status = "awaiting_feedback";
          }
        }

        let deadline: string;
        if (sessionNum === 3) deadline = sprintData?.deadline_session3;
        else if (sessionNum === 2) deadline = sprintData?.deadline_session2;
        else deadline = sprintData?.deadline_session1;

        // Step 2: Fetch course info via enrollment (separate reliable query)
        let courseId = "";
        let courseName = "Unknown Course";
        let courseLevel = "";

        if (sprintData?.enrollment_id) {
          const { data: enrollmentRow } = await supabase
            .from("enrollments")
            .select("course_id")
            .eq("id", sprintData.enrollment_id)
            .maybeSingle();

          if (enrollmentRow?.course_id) {
            const { data: courseRow } = await supabase
              .from("courses")
              .select("id, name, level")
              .eq("id", enrollmentRow.course_id)
              .maybeSingle();

            if (courseRow) {
              courseId = courseRow.id;
              courseName = courseRow.name;
              courseLevel = courseRow.level || "";
            }
          }
        }

        setSession({
          ...sessionData,
          sprint: {
            sprint_number: sprintData?.sprint_number ?? 1,
            status: sprintData?.status ?? "active",
            deadline: deadline ?? new Date().toISOString(),
          },
          course: {
            id: courseId,
            name: courseName,
            level: courseLevel,
          },
        });

        // Fetch sprint content title for this session
        if (courseId && sprintData?.sprint_number) {
          const { data: templateData } = await supabase
            .from("course_sprint_templates")
            .select("sessions_data")
            .eq("course_id", courseId)
            .eq("sprint_number", sprintData.sprint_number)
            .maybeSingle();

          if (templateData?.sessions_data) {
            const sessionsArr = templateData.sessions_data as any[];
            const matched = sessionsArr.find((s: any) => s.session_number === sessionNum);
            if (matched?.title) {
              setSessionTitle(matched.title);
            }
          }
        }

        // Fetch all sessions in this sprint for navigation
        if (sprintId) {
          const { data: allSessData } = await supabase
            .from("sprint_sessions")
            .select("id, session_number, status")
            .eq("sprint_id", sprintId)
            .order("session_number");
          setSprintSessions(allSessData || []);
        }

        // Fetch learner info for teacher view
        if (profile?.role === "vietnamese_teacher" || profile?.role === "foreign_teacher") {
          if (sprintData?.enrollment_id) {
            const { data: enrollmentRow } = await supabase
              .from("enrollments")
              .select("learner_id")
              .eq("id", sprintData.enrollment_id)
              .maybeSingle();

            if (enrollmentRow?.learner_id) {
              const { data: learnerProfile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", enrollmentRow.learner_id)
                .maybeSingle();
              setLearnerInfo({
                full_name: learnerProfile?.full_name || "Học viên",
                level: courseLevel,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Session fetch error:", err);
      setFetchError(t("session.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, sprintId, supabase, t]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const handleSubmitSuccess = useCallback(() => {
    // Refetch session to get updated status
    fetchSession();
  }, [fetchSession]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="min-h-screen bg-background-50">
        <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between h-16">
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">Better Minds</Link>
              <Link to="/dashboard" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors cursor-pointer">
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("session.backToDashboard")}</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-6 w-48 bg-background-200 rounded"></div>
            <div className="h-48 bg-background-200 rounded-lg"></div>
          </div>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background-50">
        <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between h-16">
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">Better Minds</Link>
              <Link to="/dashboard" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors cursor-pointer">
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("session.backToDashboard")}</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-16 text-center">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-background-200 mb-4">
            <i className="ri-error-warning-line text-2xl text-foreground-400"></i>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">{t("session.notFound")}</h2>
          <p className="text-sm text-foreground-500 mb-6">{fetchError}</p>
          <Link
            to="/dashboard"
            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-line mr-1.5"></i>
            {t("session.backToDashboard")}
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
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
                {profile?.role === "learner" ? (
                  <>
                    <Link to="/dashboard" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer">
                      {t("dashboard.navDashboard")}
                    </Link>
                    <Link to="/courses" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer">
                      {t("dashboard.navCourses")}
                    </Link>
                    <Link to="/dashboard/history" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer">
                      {t("dashboard.navHistory")}
                    </Link>
                  </>
                ) : (
                  <Link to="/teacher/dashboard" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer">
                    <i className="ri-dashboard-line mr-1.5"></i>
                    {t("session.backToDashboard")}
                  </Link>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <Link
                to="/dashboard"
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-600 hover:text-foreground-800 hover:bg-background-100 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("session.backToDashboard")}</span>
              </Link>
            </div>
          </div>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                {profile?.role === "learner" ? (
                  <>
                    <Link
                      to="/dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                    >
                      <i className="ri-dashboard-line mr-2"></i>{t("dashboard.navDashboard")}
                    </Link>
                    <Link
                      to="/courses"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                    >
                      <i className="ri-book-open-line mr-2"></i>{t("dashboard.navCourses")}
                    </Link>
                    <Link
                      to="/dashboard/history"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                    >
                      <i className="ri-history-line mr-2"></i>{t("dashboard.navHistory")}
                    </Link>
                  </>
                ) : (
                  <Link
                    to="/teacher/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                  >
                    <i className="ri-dashboard-line mr-2"></i>{t("session.backToDashboard")}
                  </Link>
                )}
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-foreground-400 mb-6">
          <Link to="/dashboard" className="hover:text-foreground-600 transition-colors cursor-pointer">
            {t("session.dashboard")}
          </Link>
          <i className="ri-arrow-right-s-line text-xs"></i>
          <span className="text-foreground-600 font-medium">
            {t("session.sprint")} {session.sprint.sprint_number} · {t("session.session")} {session.session_number}
          </span>
        </div>

        {/* Session Header Card */}
        <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-7 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={`w-14 h-14 flex items-center justify-center rounded-full flex-shrink-0 ${getSessionTypeColor(session.session_type)}`}>
                <i className={`${getSessionTypeIcon(session.session_type)} text-2xl`}></i>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-foreground-400 uppercase tracking-wider">
                    {t("session.sprint")} {session.sprint.sprint_number} · {t("session.session")} {session.session_number}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium whitespace-nowrap ${getSessionTypeColor(session.session_type)}`}>
                    {getSessionTypeLabel(session.session_type, t)}
                  </span>
                </div>
                <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-2">
                  {sessionTitle || getSessionTypeLabel(session.session_type, t)}
                </h1>

                {/* Big session info block — replaces old deadline countdown */}
                <div className="mt-3 space-y-1.5">
                  {session.scheduled_at && (
                    <p className="text-base text-foreground-700 flex items-center gap-2">
                      <i className="ri-calendar-line text-foreground-400 w-5 h-5 flex items-center justify-center"></i>
                      <span className="font-medium">
                        {new Date(session.scheduled_at).toLocaleString("vi-VN", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                  )}
                  {!session.scheduled_at && session.status !== "locked" && session.session_type !== "self_study" && (
                    <p className="text-base text-foreground-500 flex items-center gap-2">
                      <i className="ri-calendar-line text-foreground-400 w-5 h-5 flex items-center justify-center"></i>
                      <span className="italic">{t("session.noTeacherAssigned")}</span>
                    </p>
                  )}
                  {!session.scheduled_at && session.status !== "locked" && session.session_type === "self_study" && (
                    <p className="text-base text-foreground-500 flex items-center gap-2">
                      <i className="ri-calendar-line text-foreground-400 w-5 h-5 flex items-center justify-center"></i>
                      <span className="italic">{t("session.selfStudyFlexible")}</span>
                    </p>
                  )}
                  <p className="text-base text-foreground-700 flex items-center gap-2">
                    <i className="ri-book-open-line text-foreground-400 w-5 h-5 flex items-center justify-center"></i>
                    <span className="font-medium">{session.course.name}</span>
                    {session.course.level && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary-100 text-secondary-700 whitespace-nowrap">
                        {session.course.level}
                      </span>
                    )}
                  </p>
                  {learnerInfo && (
                    <p className="text-base text-foreground-700 flex items-center gap-2">
                      <i className="ri-user-line text-foreground-400 w-5 h-5 flex items-center justify-center"></i>
                      <span className="font-medium">Học viên: {learnerInfo.full_name}</span>
                    </p>
                  )}
                  {session.teacher_id && profile?.role === "learner" && (
                    <p className="text-base text-foreground-700 flex items-center gap-2">
                      <i className="ri-user-voice-line text-foreground-400 w-5 h-5 flex items-center justify-center"></i>
                      <span className="font-medium">Giáo viên của bạn</span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {session.status === "completed" && (
              <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-100 text-accent-700 text-base font-semibold whitespace-nowrap">
                <i className="ri-checkbox-circle-fill"></i>
                {t("session.completed")}
              </div>
            )}
            {session.status === "awaiting_feedback" && (
              <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-secondary-100/60 text-secondary-600 text-base font-semibold whitespace-nowrap">
                <i className="ri-time-line"></i>
                Chờ nhận xét
              </div>
            )}
          </div>

          {/* Session pipeline mini indicator */}
          <div className="mt-6 pt-5 border-t border-background-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground-500">{t("session.sprintProgress")}:</span>
              <div className="flex items-center gap-0">
                {[1, 2, 3].map((num) => {
                  const isCurrent = num === session.session_number;
                  const isPast = num < session.session_number;
                  const sessionInfo = sprintSessions.find((s) => s.session_number === num);
                  const isLocked = sessionInfo?.status === "locked";
                  const dot = (
                    <div
                      className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                        isCurrent ? "bg-primary-500 text-background-50 ring-2 ring-primary-200 ring-offset-2"
                          : isPast ? "bg-accent-500 text-background-50"
                          : isLocked ? "bg-background-200 text-foreground-400"
                          : "bg-secondary-400 text-background-50"
                      }`}
                    >
                      {isPast ? <i className="ri-check-line text-xs"></i> : isLocked ? <i className="ri-lock-line text-xs"></i> : num}
                    </div>
                  );
                  return (
                    <div key={num} className="flex items-center">
                      {num > 1 && <div className={`w-8 h-0.5 ${isPast ? "bg-accent-300" : "bg-background-300"}`}></div>}
                      {sessionInfo && !isLocked ? (
                        <Link
                          to={`/dashboard/sprint/${session.sprint_id}/session/${sessionInfo.id}`}
                          className="cursor-pointer"
                          title={`${t("session.session")} ${num}${isCurrent ? " (hiện tại)" : ""}`}
                        >
                          {dot}
                        </Link>
                      ) : (
                        <div title={isLocked ? `${t("session.session")} ${num} — ${t("session.lockedTitle")}` : ""}>{dot}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Session Content */}
        {/* Expired sprint warning */}
        {session.sprint.status === "expired" && (
          <div className="bg-accent-50 border border-accent-200 rounded-lg p-5 mb-6 flex items-start gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 shrink-0 mt-0.5">
              <i className="ri-timer-flash-line text-lg"></i>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-accent-800 mb-1">{t("session.sprintExpired")}</h3>
              <p className="text-sm text-accent-600">{t("session.sprintExpiredDesc")}</p>
            </div>
          </div>
        )}

        {session.status === "locked" && profile?.role === "learner" ? (
          <div className="bg-background-50 border border-background-200 rounded-lg p-8 md:p-10 text-center">
            <div className="w-20 h-20 mx-auto mb-5 flex items-center justify-center rounded-2xl bg-background-200">
              <i className="ri-lock-line text-3xl text-foreground-400"></i>
            </div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">
              {t("session.lockedTitle")}
            </h2>
            <p className="text-sm text-foreground-500 max-w-md mx-auto mb-2 leading-relaxed">
              {t("session.lockedDesc", { prevSession: session.session_number - 1 })}
            </p>
            <p className="text-xs text-foreground-400 mb-6">
              {t("session.lockedHint")}
            </p>

            {/* Clickable session navigation on locked screen */}
            <div className="flex items-center justify-center gap-0 mb-6">
              {sprintSessions.map((s, idx) => {
                const isCurrent = s.session_number === session.session_number;
                const isPast = s.session_number < session.session_number;
                const isLocked = s.status === "locked";
                const dot = (
                  <div
                    className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold ${
                      isCurrent ? "bg-background-200 text-foreground-400 ring-2 ring-background-300 ring-offset-2"
                        : isPast ? "bg-accent-500 text-background-50"
                        : isLocked ? "bg-background-200 text-foreground-400"
                        : "bg-secondary-400 text-background-50"
                    }`}
                  >
                    {isPast ? <i className="ri-check-line text-xs"></i> : isLocked ? <i className="ri-lock-line text-xs"></i> : s.session_number}
                  </div>
                );
                return (
                  <div key={s.id} className="flex items-center">
                    {idx > 0 && <div className={`w-10 h-0.5 ${isPast ? "bg-accent-300" : "bg-background-300"}`}></div>}
                    {!isLocked ? (
                      <Link
                        to={`/dashboard/sprint/${session.sprint_id}/session/${s.id}`}
                        className="cursor-pointer"
                      >
                        {dot}
                      </Link>
                    ) : (
                      dot
                    )}
                  </div>
                );
              })}
            </div>

            {/* Quick links to unlocked sessions */}
            {sprintSessions.filter((s) => s.status !== "locked" && s.id !== sessionId).length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-foreground-400 mb-2">{t("session.jumpToUnlocked")}</p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {sprintSessions
                    .filter((s) => s.status !== "locked" && s.id !== sessionId)
                    .map((s) => (
                      <Link
                        key={s.id}
                        to={`/dashboard/sprint/${session.sprint_id}/session/${s.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-background-100 text-foreground-600 hover:bg-background-200 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-arrow-right-line"></i>
                        {t("session.session")} {s.session_number}
                        {s.status === "completed" && <span className="ml-1 text-accent-600"><i className="ri-check-line"></i></span>}
                      </Link>
                    ))}
                </div>
              </div>
            )}

            <Link
              to="/dashboard"
              className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              <i className="ri-arrow-left-line mr-1.5"></i>
              {t("session.backToDashboard")}
            </Link>
          </div>
        ) : session.session_type === "self_study" && profile?.role === "learner" ? (
          <LearnerLiveLesson
            sessionId={session.id}
            sprintId={session.sprint_id}
            sessionNumber={session.session_number}
            sessionType={session.session_type}
            sessionTitle={sessionTitle}
            teacherId={session.teacher_id}
            scheduledAt={session.scheduled_at}
            status={session.status}
            teacherFeedback={session.teacher_feedback}
            completionRating={session.completion_rating}
            lessonSummary={session.lesson_summary}
          />
        ) : session.session_type === "self_study" && (profile?.role === "vietnamese_teacher" || profile?.role === "foreign_teacher") ? (
          <TeacherLiveLesson
            sessionId={session.id}
            sprintId={session.sprint_id}
            sessionNumber={session.session_number}
            sessionType={session.session_type}
            sessionTitle={sessionTitle}
            scheduledAt={session.scheduled_at}
            status={session.status}
            feedback={session.teacher_feedback}
            lessonSummary={session.lesson_summary}
            onStatusChange={handleSubmitSuccess}
          />
        ) : profile?.role === "learner" ? (
          <LearnerLiveLesson
            sessionId={session.id}
            sprintId={session.sprint_id}
            sessionNumber={session.session_number}
            sessionType={session.session_type}
            sessionTitle={sessionTitle}
            teacherId={session.teacher_id}
            scheduledAt={session.scheduled_at}
            status={session.status}
            teacherFeedback={session.teacher_feedback}
            completionRating={session.completion_rating}
            lessonSummary={session.lesson_summary}
          />
        ) : profile?.role === "vietnamese_teacher" || profile?.role === "foreign_teacher" ? (
          <TeacherLiveLesson
            sessionId={session.id}
            sprintId={session.sprint_id}
            sessionNumber={session.session_number}
            sessionType={session.session_type}
            sessionTitle={sessionTitle}
            scheduledAt={session.scheduled_at}
            status={session.status}
            feedback={session.teacher_feedback}
            lessonSummary={session.lesson_summary}
            onStatusChange={handleSubmitSuccess}
          />
        ) : (
          <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-background-200">
              <i className="ri-calendar-check-line text-2xl text-foreground-400"></i>
            </div>
            <h3 className="font-heading text-lg font-bold text-foreground-950 mb-2">
              {t("session.teacherSessionTitle")}
            </h3>
            <p className="text-sm text-foreground-500 max-w-md mx-auto">
              {t("session.teacherSessionDesc")}
            </p>
          </div>
        )}
      </main>

      {/* Sprint Completed Banner — link to Sprint Complete */}
      {(sprintCompleted || allSessionsCompleted) && (
        <div className="max-w-4xl mx-auto px-4 md:px-6 pb-8">
          <div className="bg-gradient-to-r from-accent-50 via-accent-100/50 to-accent-50 border border-accent-200 rounded-lg p-5 md:p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-full bg-accent-100 text-accent-600">
              <i className="ri-trophy-line text-xl"></i>
            </div>
            <h3 className="font-heading text-lg font-bold text-foreground-950 mb-1">
              Sprint {session.sprint.sprint_number} Completed!
            </h3>
            <p className="text-sm text-foreground-500 mb-4 max-w-md mx-auto">
              All sessions in this sprint are complete. Check out your recap and set up your next sprint!
            </p>
            <Link
              to={`/dashboard/sprint/${sprintId}/complete`}
              className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-trophy-line mr-1.5"></i>
              View Sprint Summary
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SprintSessionPage() {
  return (
    <AuthGuard allowedRoles={["learner", "vietnamese_teacher", "foreign_teacher", "admin"]}>
      <SessionDetailContent />
    </AuthGuard>
  );
}