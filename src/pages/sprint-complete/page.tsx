import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import CelebrationHero from "./components/CelebrationHero";
import SessionRecapCard from "./components/SessionRecapCard";
import { getSupabase } from "@/lib/supabase";
import { addCalendarDays, formatVietnamDate, vietnamTodayStr, getVietnamDateParts } from "@/lib/datetime";

interface RecapSession {
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
  materials: Array<{
    id: string;
    title: string | null;
    file_name: string;
    file_url: string;
    file_type: string;
    file_size: number;
    description: string | null;
    created_at: string;
  }>;
}

interface SprintRecap {
  id: string;
  sprint_number: number;
  status: string;
  created_at: string;
  completed_at: string;
  sessions: RecapSession[];
  course: {
    name: string;
    level: string;
    total_sprints: number;
  };
  duration_days: number;
}

function computeDurationDays(createdAt: string, completedAt: string): number {
  return Math.ceil((new Date(completedAt).getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
}

function SprintCompleteContent() {
  const { t } = useTranslation();
  const { sprintId } = useParams<{ sprintId: string }>();
  const supabase = getSupabase();

  const [sprint, setSprint] = useState<SprintRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchSprint = useCallback(async () => {
    if (!sprintId) return;
    setLoading(true);
    setFetchError(null);

    try {
      const { data: sprintData, error: sprintErr } = await supabase
        .from("learning_sprints")
        .select("id, sprint_number, status, created_at, completed_at, enrollment:enrollments!learning_sprints_enrollment_id_fkey(course_id, course:courses!enrollments_course_id_fkey(name, level, total_sprints))")
        .eq("id", sprintId)
        .maybeSingle();

      if (sprintErr) throw sprintErr;
      if (!sprintData) {
        setFetchError(t("complete.notFound"));
        setLoading(false);
        return;
      }

      const enrollmentData = (sprintData as any)?.enrollment;
      const courseData = enrollmentData?.course;
      const courseId = enrollmentData?.course_id as string | null;

      const { data: sessions, error: sessErr } = await supabase
        .from("sprint_sessions")
        .select("id, session_number, session_type, teacher_id, scheduled_at, status, completed_at, feedback, lesson_summary, completion_rating, class_id")
        .eq("sprint_id", sprintData.id)
        .order("session_number", { ascending: true });

      if (sessErr) throw sessErr;

      // Batch-fetch teacher names
      const teacherIds = [...new Set((sessions || []).map((s: any) => s.teacher_id).filter(Boolean))] as string[];
      const teacherMap = new Map<string, string>();
      if (teacherIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", teacherIds);
        (profiles || []).forEach((p: any) => teacherMap.set(p.id, p.full_name));
      }

      // Fetch sprint materials from course_sprint_templates.sessions_data
      const sessionMaterialsMap = new Map<number, any[]>();
      if (courseId) {
        const { data: template } = await supabase
          .from("course_sprint_templates")
          .select("sessions_data")
          .eq("course_id", courseId)
          .eq("sprint_number", sprintData.sprint_number)
          .maybeSingle();

        if (template?.sessions_data) {
          (template.sessions_data as any[]).forEach((sd: any) => {
            const mats = (sd.materials || []).map((m: any) => ({
              id: `material-${sd.session_number}-${m.file_name}`,
              title: sd.description || sd.title || null,
              file_name: m.file_name,
              file_url: m.file_path,
              file_type: m.file_name?.split('.').pop() || 'unknown',
              file_size: m.file_size || 0,
              description: sd.description || null,
              created_at: '',
            }));
            sessionMaterialsMap.set(sd.session_number, mats);
          });
        }
      }

      setSprint({
        id: sprintData.id,
        sprint_number: sprintData.sprint_number,
        status: sprintData.status,
        created_at: sprintData.created_at,
        completed_at: sprintData.completed_at || sprintData.created_at,
        sessions: (sessions || []).map((s: any) => ({
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
          materials: sessionMaterialsMap.get(s.session_number) || [],
        })),
        course: {
          name: courseData?.name || "Course",
          level: courseData?.level || "",
          total_sprints: courseData?.total_sprints || 24,
        },
        duration_days: computeDurationDays(sprintData.created_at, sprintData.completed_at || sprintData.created_at),
      });
    } catch (err) {
      console.error("Sprint recap fetch error:", err);
      setFetchError(t("complete.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [sprintId, supabase, t]);

  useEffect(() => {
    fetchSprint();
  }, [fetchSprint]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background-50">
        <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between h-16">
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">Better Minds</Link>
              <Link to="/dashboard" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors cursor-pointer">
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("complete.backToDashboard")}</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-48 bg-background-200 rounded-lg"></div>
            <div className="h-32 bg-background-200 rounded-lg"></div>
          </div>
        </main>
      </div>
    );
  }

  if (!sprint || fetchError) {
    return (
      <div className="min-h-screen bg-background-50">
        <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between h-16">
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">Better Minds</Link>
              <Link to="/dashboard" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors cursor-pointer">
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("complete.backToDashboard")}</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-16 text-center">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-background-200 mb-4">
            <i className="ri-error-warning-line text-2xl text-foreground-400"></i>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">{t("complete.notFound")}</h2>
          <p className="text-sm text-foreground-500 mb-6">{fetchError}</p>
          <Link
            to="/dashboard"
            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-line mr-1.5"></i>
            {t("complete.backToDashboard")}
          </Link>
        </main>
      </div>
    );
  }

  const nextSprintNumber = sprint.sprint_number + 1;

  const vnParts = getVietnamDateParts(new Date());
  const currentDay = vnParts?.weekday ?? 0;
  let daysUntilSaturday = (6 - currentDay + 7) % 7;
  if (daysUntilSaturday === 0) daysUntilSaturday = 7;

  const nextSaturdayStr = formatVietnamDate(
    addCalendarDays(vietnamTodayStr(), daysUntilSaturday),
    { day: "numeric", month: "numeric", year: "numeric" },
    "vi-VN"
  );

  const isLastSprint = sprint.sprint_number >= sprint.course.total_sprints;

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
                  to="/dashboard"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("complete.dashboard")}
                </Link>
                <Link
                  to="/dashboard"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("complete.history")}
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <Link
                to="/dashboard"
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-600 hover:text-foreground-800 hover:bg-background-100 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("complete.backToDashboard")}</span>
              </Link>
            </div>
          </div>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <Link
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-dashboard-line mr-2"></i>{t("complete.dashboard")}
                </Link>
                <Link
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-history-line mr-2"></i>{t("complete.history")}
                </Link>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <div className="mb-8">
          <CelebrationHero
            sprintNumber={sprint.sprint_number}
            courseName={sprint.course.name}
            courseLevel={sprint.course.level}
            startDate={sprint.created_at}
            endDate={sprint.completed_at}
            durationDays={sprint.duration_days}
            totalSessions={sprint.sessions.length}
          />
        </div>

        <section className="mb-8">
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-5 flex items-center gap-2">
            <i className="ri-file-list-3-line text-primary-500"></i>
            {t("complete.sessionRecap")}
          </h2>
          <div className="space-y-4">
            {sprint.sessions.map((session, idx) => (
              <SessionRecapCard
                key={session.id}
                session={session}
                index={idx}
                total={sprint.sessions.length}
              />
            ))}
          </div>
        </section>

        <section className="mb-8">
          <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-8">
            <h2 className="font-heading text-lg font-bold text-foreground-950 mb-4 flex items-center gap-2">
              <i className="ri-lightbulb-line text-secondary-500"></i>
              {t("complete.keyTakeaways")}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-accent-50 border border-accent-200/50">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 mb-3">
                  <i className="ri-brain-line text-accent-600"></i>
                </div>
                <h4 className="text-sm font-semibold text-foreground-900 mb-1">{t("complete.takeawayGrammar")}</h4>
                <p className="text-xs text-foreground-600 leading-relaxed">
                  {t("complete.takeawayGrammarDesc")}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-primary-50 border border-primary-200/50">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 mb-3">
                  <i className="ri-chat-smile-2-line text-primary-600"></i>
                </div>
                <h4 className="text-sm font-semibold text-foreground-900 mb-1">{t("complete.takeawaySpeaking")}</h4>
                <p className="text-xs text-foreground-600 leading-relaxed">
                  {t("complete.takeawaySpeakingDesc")}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-secondary-50 border border-secondary-200/50">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary-100 mb-3">
                  <i className="ri-book-2-line text-secondary-600"></i>
                </div>
                <h4 className="text-sm font-semibold text-foreground-900 mb-1">{t("complete.takeawayVocab")}</h4>
                <p className="text-xs text-foreground-600 leading-relaxed">
                  {t("complete.takeawayVocabDesc")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {isLastSprint ? (
          <section>
            <div className="bg-gradient-to-br from-background-50 via-accent-50/30 to-background-50 border border-background-200 rounded-lg p-6 md:p-10 text-center">
              <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
                <i className="ri-medal-line text-3xl text-accent-600"></i>
              </div>
              <h2 className="font-heading text-2xl font-bold text-foreground-950 mb-2">
                {t("complete.courseCompleted")}
              </h2>
              <p className="text-sm text-foreground-500 max-w-lg mx-auto mb-2">
                {t("complete.courseCompletedDesc")}
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-foreground-400 mb-6">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-50 border border-accent-200/50">
                  <i className="ri-check-double-line text-accent-600"></i>
                  {sprint.course.total_sprints}/{sprint.course.total_sprints} Sprints
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-50 border border-accent-200/50">
                  <i className="ri-calendar-check-line text-accent-600"></i>
                  {sprint.duration_days} days
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-dashboard-line mr-1.5"></i>
                  {t("complete.backToDashboard")}
                </Link>
                <Link
                  to="/courses"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold bg-background-100 text-foreground-700 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-compass-line mr-1.5"></i>
                  {t("complete.exploreMoreCourses")}
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section>
            <div className="bg-gradient-to-r from-background-50 via-primary-50/30 to-background-50 border border-background-200 rounded-lg p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100">
                      <i className="ri-rocket-line text-primary-600"></i>
                    </div>
                    <span className="text-xs font-semibold text-foreground-400 uppercase tracking-wider">
                      {t("complete.upNext")}
                    </span>
                  </div>
                  <h3 className="font-heading text-xl font-bold text-foreground-950 mb-1">
                    {t("complete.sprint")} {nextSprintNumber} {t("complete.comingSoon")}
                  </h3>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 text-xs font-semibold">
                      <i className="ri-calendar-event-line"></i>
                      {t("complete.nextSprintSaturday")} {nextSaturdayStr}
                    </span>
                    <span className="text-xs text-foreground-500">
                      ({t("complete.daysRemaining", { count: daysUntilSaturday })})
                    </span>
                  </div>
                  <p className="text-sm text-foreground-500">
                    {t("complete.nextSprintDesc")}
                  </p>
                </div>
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer flex-shrink-0"
                >
                  <i className="ri-dashboard-line mr-1.5"></i>
                  {t("complete.backToDashboard")}
                </Link>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function SprintCompletePage() {
  return (
    <AuthGuard allowedRoles={["learner", "vietnamese_teacher", "foreign_teacher", "admin"]}>
      <SprintCompleteContent />
    </AuthGuard>
  );
}