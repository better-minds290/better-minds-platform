import { useAuth } from "@/hooks/useAuth";
import AuthGuard from "@/components/base/AuthGuard";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import SprintProgress from "./components/SprintProgress";
import UpcomingLessons from "./components/UpcomingLessons";
import StatsOverview from "./components/StatsOverview";
import CourseProgressBar from "./components/CourseProgressBar";
import { getSupabase } from "@/lib/supabase";
import NotificationBell from "@/components/feature/NotificationBell";

interface DashboardData {
  enrollment: {
    id: string;
    course_id: string | null;
    enrolled_at: string;
    course_name: string | null;
    course_level: string | null;
  } | null;
  currentSprint: {
    id: string;
    sprint_number: number;
    status: string;
  } | null;
  sessions: Array<{
    id: string;
    session_number: number;
    session_type: string;
    teacher_name: string | null;
    scheduled_at: string | null;
    status: string;
    meeting_link: string | null;
    class_id: string | null;
  }>;
  upcomingLessons: Array<{
    id: string;
    sprintId: string;
    sprintNumber: number;
    sessionNumber: number;
    sessionType: string;
    teacherName: string;
    scheduledAt: string;
    status: string;
    meetingLink: string | null;
    classId: string | null;
    courseName: string | null;
    courseLevel: string | null;
  }>;
  classMaterials: Array<{
    id: string;
    class_id: string;
    title: string;
    description: string | null;
    file_name: string;
    file_url: string;
    file_type: string;
  }>;
  completedSprints: Array<{
    id: string;
    sprint_number: number;
    status: string;
    created_at: string;
    completed_at: string;
  }>;
  statsData: {
    totalSprints: number;
    completedSprints: number;
    currentStreak: number;
    completionRate: number;
    enrolledSince: string;
    courseName: string | null;
    courseLevel: string | null;
    courseTotalSprints: number;
  };
}

interface OtherCourse {
  id: string;
  name: string;
  description: string;
  level: string;
  is_active: boolean;
  total_sprints: number;
}

function computeStreak(sprints: Array<{ completed_at: string | null }>): number {
  const sorted = [...sprints]
    .filter((s) => s.completed_at)
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime());
  if (sorted.length === 0) return 0;
  return sorted.length;
}

function DashboardContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const supabase = getSupabase();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [learnerStatus, setLearnerStatus] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [startingSprint, setStartingSprint] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [otherCourses, setOtherCourses] = useState<OtherCourse[]>([]);
  const [otherCoursesLoading, setOtherCoursesLoading] = useState(false);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (!profile?.id) return;

    setLoading(true);
    setFetchError(null);

    try {
      const { data: enrollmentRows, error: enrollError } = await supabase
        .from("enrollments")
        .select("id, course_id, enrolled_at, status, missed_deadlines")
        .eq("learner_id", profile?.id)
        .order("enrolled_at", { ascending: false })
        .limit(1);

      if (enrollError) throw enrollError;

      const enrollment = enrollmentRows?.[0] || null;

      if (!enrollment) {
        setLearnerStatus(null);
        setData({
          enrollment: null,
          currentSprint: null,
          sessions: [],
          upcomingLessons: [],
          classMaterials: [],
          completedSprints: [],
          statsData: {
            totalSprints: 0, completedSprints: 0, currentStreak: 0, completionRate: 0,
            enrolledSince: "",
            courseName: null, courseLevel: null,
            courseTotalSprints: 0,
          },
        });
        setLoading(false);
        return;
      }

      setLearnerStatus(enrollment.status || "active");

      // Fetch course info separately for reliability
      let courseName: string | null = null;
      let courseLevel: string | null = null;
      let courseTotalSprints = 0;
      if (enrollment.course_id) {
        const { data: courseRows } = await supabase
          .from("courses")
          .select("name, level, total_sprints")
          .eq("id", enrollment.course_id)
          .limit(1);
        const courseRow = courseRows?.[0] || null;
        courseName = courseRow?.name || null;
        courseLevel = courseRow?.level || null;
        courseTotalSprints = courseRow?.total_sprints || 0;
      }

      const { data: sprints, error: sprintError } = await supabase
        .from("learning_sprints")
        .select("id, sprint_number, status, created_at, completed_at")
        .eq("enrollment_id", enrollment.id)
        .order("sprint_number", { ascending: true });

      if (sprintError) throw sprintError;

      let activeSprint = sprints?.find((s) => s.status === "active") || null;
      let pendingSprint = sprints?.find((s) => s.status === "pending") || null;
      let lockedSprint = sprints?.find((s) => s.status === "locked") || null;
      const completedSprints = sprints?.filter((s) => s.status === "completed") || [];

      // If no active sprint but there's a pending one, use it
      const currentSprint = activeSprint || pendingSprint || lockedSprint || null;

      // Fetch sessions for current sprint
      let sessions: DashboardData["sessions"] = [];
      let upcomingLessons: DashboardData["upcomingLessons"] = [];

      if (currentSprint) {
        const { data: sessionRows, error: sessError } = await supabase
          .from("sprint_sessions")
          .select("id, session_number, session_type, scheduled_at, status, teacher_id, meeting_link, class_id")
          .eq("sprint_id", currentSprint.id)
          .order("session_number", { ascending: true });

        if (sessError) {
          console.error("Sessions fetch error:", sessError);
        } else if (sessionRows) {
          const teacherIds = [...new Set(sessionRows.map((s: any) => s.teacher_id).filter(Boolean))] as string[];
          const teacherMap = new Map<string, string>();
          if (teacherIds.length > 0) {
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", teacherIds);
            (profiles || []).forEach((p: any) => teacherMap.set(p.id, p.full_name));
          }

          sessions = sessionRows.map((s: any) => ({
            id: s.id,
            session_number: s.session_number,
            session_type: s.session_type,
            teacher_name: teacherMap.get(s.teacher_id) || null,
            scheduled_at: s.scheduled_at,
            status: s.status,
            meeting_link: s.meeting_link || null,
            class_id: s.class_id || null,
          }));

          upcomingLessons = sessionRows
            .filter((s: any) => (s.status === "in_progress" || s.status === "active") && s.scheduled_at)
            .map((s: any) => ({
              id: s.id,
              sprintId: currentSprint.id,
              sprintNumber: currentSprint.sprint_number,
              sessionNumber: s.session_number,
              sessionType: s.session_type,
              teacherName: teacherMap.get(s.teacher_id) || "",
              scheduledAt: s.scheduled_at!,
              status: s.status,
              meetingLink: s.meeting_link || null,
              classId: s.class_id || null,
              courseName: courseName || null,
              courseLevel: courseLevel || null,
            }))
            .sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
        }
      }

      // Fetch class materials for booked sessions
      let classMaterials: DashboardData["classMaterials"] = [];
      const bookedClassIds = upcomingLessons.map((l) => l.classId).filter(Boolean) as string[];
      if (bookedClassIds.length > 0) {
        const { data: materialsData } = await supabase
          .from("class_materials")
          .select("id, class_id, title, description, file_name, file_url, file_type")
          .in("class_id", bookedClassIds);

        if (materialsData) {
          classMaterials = materialsData;
        }
      }

      const allSprints = sprints || [];
      const totalSprints = allSprints.length;
      const completedCount = completedSprints.length;

      setData({
        enrollment: {
          id: enrollment.id,
          course_id: enrollment.course_id || null,
          enrolled_at: enrollment.enrolled_at,
          course_name: courseName || null,
          course_level: courseLevel || null,
        },
        currentSprint,
        sessions,
        upcomingLessons,
        classMaterials,
        completedSprints: completedSprints.map((s) => ({
          id: s.id,
          sprint_number: s.sprint_number,
          status: s.status,
          created_at: s.created_at,
          completed_at: s.completed_at!,
        })),
        statsData: {
          totalSprints,
          completedSprints: completedCount,
          currentStreak: computeStreak(completedSprints as any),
          completionRate: totalSprints > 0 ? Math.round((completedCount / totalSprints) * 100) : 0,
          enrolledSince: enrollment.enrolled_at,
          courseName: courseName || null,
          courseLevel: courseLevel || null,
          courseTotalSprints,
        },
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setFetchError(t("dashboard.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [supabase, t, profile?.id]);

  // Fetch other available courses
  useEffect(() => {
    async function fetchOtherCourses() {
      if (!data?.enrollment?.id) return;
      setOtherCoursesLoading(true);
      try {
        const { data: courseRows } = await supabase
          .from("courses")
          .select("id, name, description, level, is_active, total_sprints")
          .eq("is_active", true)
          .order("level", { ascending: true });

        const { data: enrollRows } = await supabase
          .from("enrollments")
          .select("course_id")
          .eq("id", data.enrollment.id)
          .limit(1);

        const enrolledCourseId = enrollRows?.[0]?.course_id || null;

        const filtered = (courseRows || [])
          .filter((c) => c.id !== enrolledCourseId)
          .slice(0, 3);

        setOtherCourses(filtered);
      } catch (err) {
        console.error("Fetch other courses error:", err);
      } finally {
        setOtherCoursesLoading(false);
      }
    }

    fetchOtherCourses();
  }, [supabase, data?.enrollment?.id]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleStartSprint = async () => {
    if (!data?.currentSprint) return;
    setStartingSprint(true);

    try {
      const { data: result, error } = await supabase.functions.invoke("sprint-continuity", {
        body: {
          action: "check_saturday_unlock",
          sprint_id: data.currentSprint.id,
        },
      });

      if (error) throw new Error(error.message);

      if (result && result.unlocked) {
        showToast("success", t("dashboard.sprintUnlockSuccess", { n: data.currentSprint.sprint_number }));
      } else if (result && result.locked) {
        const nextDate = result.next_unlock_date ? new Date(result.next_unlock_date) : null;
        const dateStr = nextDate
          ? `ngày ${nextDate.getDate()}/${nextDate.getMonth() + 1}`
          : t("dashboard.sprintUnlockOnSaturday");
        showToast("error", t("dashboard.sprintUnlockOnDate", { date: dateStr }));
      }
      fetchDashboard();
    } catch (err: any) {
      console.error("Sprint unlock check error:", err);
      showToast("error", err.message || t("dashboard.sprintUnlockFailed"));
    } finally {
      setStartingSprint(false);
    }
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

  const roleLabel = () => {
    switch (profile?.role) {
      case "learner": return t("dashboard.roleLearner");
      case "vietnamese_teacher": return t("dashboard.roleVNTeacher");
      case "foreign_teacher": return t("dashboard.roleForeignTeacher");
      case "admin": return t("dashboard.roleAdmin");
      default: return t("dashboard.roleUser");
    }
  };

  const isEnrolled = data?.enrollment !== null;

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
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-primary-600 bg-primary-50 whitespace-nowrap">
                  {t("dashboard.navDashboard")}
                </span>
                <Link
                  to="/courses"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-book-open-line mr-1.5"></i>
                  {t("dashboard.navCourses")}
                </Link>
                <Link
                  to="/dashboard/book"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-calendar-line mr-1.5"></i>
                  {t("dashboard.book")}
                </Link>
                <Link
                  to="/dashboard/history"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-history-line mr-1.5"></i>
                  {t("dashboard.navHistory")}
                </Link>
                <Link
                  to="/profile"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("dashboard.navProfile")}
                </Link>
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
                title={t("dashboard.signOut")}
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("dashboard.signOut")}</span>
              </button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <span className="px-3 py-2.5 rounded-md text-sm font-semibold text-primary-600 bg-primary-50 whitespace-nowrap cursor-default">
                  <i className="ri-dashboard-line mr-2"></i>{t("dashboard.navDashboard")}
                </span>
                <Link
                  to="/courses"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-book-open-line mr-2"></i>{t("dashboard.navCourses")}
                </Link>
                <Link
                  to="/dashboard/book"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-calendar-line mr-2"></i>{t("dashboard.bookSessions")}
                </Link>
                <Link
                  to="/dashboard/history"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-history-line mr-2"></i>{t("dashboard.navHistory")}
                </Link>
                <Link
                  to="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-user-settings-line mr-2"></i>{t("dashboard.navProfile")}
                </Link>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
          <div>
            <p className="text-sm text-foreground-500">
              {t("dashboard.welcome")}, {profile?.full_name}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="font-heading text-2xl font-bold text-foreground-950">
                {t("dashboard.title")}
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                {roleLabel()}
              </span>
            </div>
          </div>
          {isEnrolled && learnerStatus !== "completed" && (
            <div className="flex items-center gap-2">
              <Link
                to="/dashboard/book"
                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-calendar-check-line mr-1.5"></i>
                {t("dashboard.bookAClass")}
              </Link>
            </div>
          )}
        </div>

        {loading && (
          <div className="animate-pulse space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-background-200 rounded-lg"></div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 h-64 bg-background-200 rounded-lg"></div>
              <div className="lg:col-span-2 h-64 bg-background-200 rounded-lg"></div>
            </div>
          </div>
        )}

        {!loading && fetchError && (
          <div className="max-w-lg mx-auto text-center py-16">
            <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
              <i className="ri-error-warning-line text-2xl text-accent-600"></i>
            </div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">{t("dashboard.fetchError")}</h2>
            <p className="text-sm text-foreground-500 mb-6">{fetchError}</p>
            <button
              onClick={fetchDashboard}
              className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-refresh-line mr-1.5"></i>
              {t("dashboard.retry")}
            </button>
          </div>
        )}

        {!loading && !fetchError && data && (
          <>
            {learnerStatus === "paused" && (
              <div className="max-w-xl mx-auto text-center py-16">
                <div className="w-20 h-20 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-6">
                  <i className="ri-pause-circle-line text-3xl"></i>
                </div>
                <h2 className="font-heading text-2xl font-bold text-foreground-950 mb-3">
                  {t("dashboard.pausedTitle")}
                </h2>
                <p className="text-sm text-foreground-600 mb-4 leading-relaxed max-w-md mx-auto">
                  {t("dashboard.pausedSimpleDesc")}
                </p>
                <p className="text-xs text-foreground-400">
                  {t("dashboard.contactAdminToReactivate")}
                </p>
              </div>
            )}

            {learnerStatus !== "paused" && isEnrolled && (
              <>
                {/* My Course Card - always visible when enrolled */}
                {data.enrollment && (
                  <div className="mb-6 p-5 rounded-xl bg-background-50 border border-background-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-700">
                        <i className="ri-book-open-line text-xl"></i>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground-400 uppercase tracking-wider">{t("dashboard.navCourses")}</p>
                        <h3 className="font-heading text-lg font-bold text-foreground-950">{data.enrollment.course_name || t("dashboard.navCourses")}</h3>
                        {data.enrollment.course_level && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary-100 text-secondary-700 whitespace-nowrap mt-1">
                            {data.enrollment.course_level}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        to="/courses"
                        className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-book-open-line mr-1.5"></i>
                        {t("dashboard.viewAllCourses")}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Course progress bar */}
                {data.statsData.courseTotalSprints > 0 && (
                  <div className="mb-6">
                    <CourseProgressBar
                      completedSprints={data.statsData.completedSprints}
                      totalSprints={data.statsData.courseTotalSprints}
                      courseName={data.enrollment?.course_name || null}
                      courseLevel={data.enrollment?.course_level || null}
                    />
                  </div>
                )}

                {/* Sprint content */}
                {data.currentSprint ? (
                  <>
                    <div className="mb-8">
                      <StatsOverview stats={data.statsData} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      <div className="lg:col-span-3">
                        <SprintProgress
                          sprintId={data.currentSprint.id}
                          sprintNumber={data.currentSprint.sprint_number}
                          status={data.currentSprint.status}
                          sessions={data.sessions}
                          courseId={data.enrollment?.course_id || null}
                          onStartSprint={handleStartSprint}
                          isStarting={startingSprint}
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <UpcomingLessons lessons={data.upcomingLessons} materials={data.classMaterials} />
                      </div>
                    </div>
                  </>
                ) : learnerStatus === "completed" ? (
                  /* 🎉 Course completed — celebration screen */
                  <div className="max-w-2xl mx-auto text-center py-8">
                    {/* Trophy with glow */}
                    <div className="relative inline-block mb-6">
                      <div className="absolute inset-0 w-24 h-24 mx-auto rounded-full bg-accent-100/60 blur-xl"></div>
                      <div className="relative w-24 h-24 mx-auto flex items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-500 text-background-50 shadow-[0_8px_32px_rgba(var(--accent-500),0.25)]">
                        <i className="ri-trophy-line text-4xl"></i>
                      </div>
                    </div>

                    <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground-950 mb-2">
                      {t("dashboard.courseCompletedTitle")}
                    </h2>
                    <p className="text-sm text-foreground-500 mb-2 max-w-md mx-auto leading-relaxed">
                      {t("dashboard.courseCompletedDesc", { courseName: data.enrollment?.course_name || t("dashboard.courseFallbackName"), courseLevel: data.enrollment?.course_level || "" })}
                    </p>
                    <p className="text-sm text-foreground-600 mb-8 max-w-lg mx-auto leading-relaxed">
                      {t("dashboard.courseCompletedSessionsNote", { sprints: data.statsData.totalSprints, sessions: data.statsData.totalSprints * 3 })}
                    </p>

                    {/* Stats cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8 max-w-lg mx-auto">
                      <div className="bg-background-50 border border-background-200 rounded-xl p-4 text-center">
                        <div className="w-9 h-9 mx-auto flex items-center justify-center rounded-full bg-accent-100 text-accent-600 mb-2">
                          <i className="ri-stack-line text-lg"></i>
                        </div>
                        <span className="block text-xl font-bold text-foreground-950">{data.statsData.completedSprints}/{data.statsData.totalSprints}</span>
                        <span className="text-[11px] text-foreground-400">{t("dashboard.statsSprintsCompleted")}</span>
                      </div>
                      <div className="bg-background-50 border border-background-200 rounded-xl p-4 text-center">
                        <div className="w-9 h-9 mx-auto flex items-center justify-center rounded-full bg-primary-100 text-primary-600 mb-2">
                          <i className="ri-calendar-check-line text-lg"></i>
                        </div>
                        <span className="block text-xl font-bold text-foreground-950">{data.statsData.totalSprints * 3}</span>
                        <span className="text-[11px] text-foreground-400">{t("dashboard.statsTotalSessions")}</span>
                      </div>
                      <div className="bg-background-50 border border-background-200 rounded-xl p-4 text-center">
                        <div className="w-9 h-9 mx-auto flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600 mb-2">
                          <i className="ri-fire-line text-lg"></i>
                        </div>
                        <span className="block text-xl font-bold text-foreground-950">{data.statsData.currentStreak}</span>
                        <span className="text-[11px] text-foreground-400">{t("dashboard.statsConsecutiveSprints")}</span>
                      </div>
                      <div className="bg-background-50 border border-background-200 rounded-xl p-4 text-center">
                        <div className="w-9 h-9 mx-auto flex items-center justify-center rounded-full bg-accent-100 text-accent-600 mb-2">
                          <i className="ri-percent-line text-lg"></i>
                        </div>
                        <span className="block text-xl font-bold text-foreground-950">{data.statsData.completionRate}%</span>
                        <span className="text-[11px] text-foreground-400">{t("dashboard.statsCompletionRatePct")}</span>
                      </div>
                    </div>

                    {/* Study period info */}
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-background-50 border border-background-200 text-sm text-foreground-600 mb-6">
                      <i className="ri-calendar-line text-foreground-400"></i>
                      <span>
                        {t("dashboard.completedStartLabel")} {new Date(data.statsData.enrolledSince).toLocaleDateString("vi-VN", { month: "long", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="text-foreground-300">|</span>
                      <span>
                        {t("dashboard.completedEndLabel")} {new Date(data.completedSprints[data.completedSprints.length - 1]?.completed_at || data.statsData.enrolledSince).toLocaleDateString("vi-VN", { month: "long", day: "numeric", year: "numeric" })}
                      </span>
                    </div>

                    {/* CTA buttons */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                      <Link
                        to="/courses"
                        className="inline-flex items-center px-6 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-compass-3-line mr-1.5"></i>
                        {t("dashboard.exploreNewCourses")}
                      </Link>
                      <Link
                        to="/profile"
                        className="inline-flex items-center px-6 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-award-line mr-1.5"></i>
                        {t("dashboard.viewCertificate")}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-lg mx-auto text-center py-12">
                    {/* If there's a most recent completed sprint, show link to Sprint Complete */}
                    {data.completedSprints.length > 0 ? (
                      <>
                        <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
                          <i className="ri-trophy-line text-2xl"></i>
                        </div>
                        <h3 className="font-heading text-lg font-bold text-foreground-950 mb-2">
                          {t("dashboard.sprintNCompleted", { n: data.completedSprints[data.completedSprints.length - 1].sprint_number })}
                        </h3>
                        <p className="text-sm text-foreground-500 mb-6 leading-relaxed">
                          {t("dashboard.sprintNCompletedDesc")}
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                          <Link
                            to={`/dashboard/sprint/${data.completedSprints[data.completedSprints.length - 1].id}/complete`}
                            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                          >
                            <i className="ri-trophy-line mr-1.5"></i>
                            {t("dashboard.viewSprintRecap")}
                          </Link>
                          <Link
                            to="/dashboard"
                            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                          >
                            <i className="ri-dashboard-line mr-1.5"></i>
                            {t("dashboard.backToDashboardCta")}
                          </Link>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-primary-100 text-primary-600 mb-4">
                          <i className="ri-hourglass-line text-2xl"></i>
                        </div>
                        <h3 className="font-heading text-lg font-bold text-foreground-950 mb-2">
                          {t("dashboard.waitingForSprint")}
                        </h3>
                        <p className="text-sm text-foreground-500 mb-6 leading-relaxed">
                          {t("dashboard.waitingForSprintDesc")}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* Other available courses */}
                {otherCourses.length > 0 && (
                  <section className="mt-10">
                    <div className="flex items-center justify-between mb-5">
                      <h2 className="font-heading text-lg font-bold text-foreground-950 flex items-center gap-2">
                        <i className="ri-compass-3-line text-accent-500"></i>
                        {t("dashboard.exploreMoreCoursesSection")}
                      </h2>
                      <Link
                        to="/courses"
                        className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer"
                      >
                        {t("dashboard.viewAll")} <i className="ri-arrow-right-line ml-1"></i>
                      </Link>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {otherCourses.map((course) => {
                        const totalSessions = course.total_sprints * 3;
                        return (
                          <article
                            key={course.id}
                            className="bg-background-50 border border-background-200 rounded-xl p-5 hover:border-primary-300 transition-all duration-200 group"
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                                {course.level}
                              </span>
                              <span className="text-xs text-foreground-400 flex items-center gap-1">
                                <i className="ri-repeat-line"></i>
                                {t("dashboard.sprintSessionsFormat", { sprints: course.total_sprints, sessions: totalSessions })}
                              </span>
                            </div>
                            <h3 className="font-heading text-base font-bold text-foreground-950 mb-2 group-hover:text-primary-600 transition-colors">
                              {course.name}
                            </h3>
                            <p className="text-sm text-foreground-600 leading-relaxed mb-4 line-clamp-2">
                              {course.description}
                            </p>
                            <Link
                              to={`/courses/${course.id}`}
                              className="inline-flex items-center text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors cursor-pointer"
                            >
                              {t("dashboard.viewDetail")} <i className="ri-arrow-right-line ml-1"></i>
                            </Link>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}

            {learnerStatus !== "paused" && !isEnrolled && (
              <div className="max-w-2xl mx-auto text-center py-16">
                <div className="w-20 h-20 mx-auto flex items-center justify-center rounded-2xl bg-primary-100 text-primary-600 mb-6">
                  <i className="ri-compass-3-line text-3xl"></i>
                </div>
                <h2 className="font-heading text-2xl font-bold text-foreground-950 mb-3">
                  {t("dashboard.emptyTitle")}
                </h2>
                <p className="text-sm text-foreground-600 mb-8 leading-relaxed max-w-md mx-auto">
                  {t("dashboard.emptyDesc")}
                </p>
                <Link
                  to="/courses"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-rocket-line"></i>
                  {t("dashboard.emptyCta")}
                </Link>
              </div>
            )}
          </>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-[slideUp_0.3s_ease-out]">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
              toast.type === "success"
                ? "bg-primary-600 text-background-50"
                : "bg-accent-600 text-background-50"
            }`}
          >
            <i className={toast.type === "success" ? "ri-check-line" : "ri-close-line"}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardRedirect() {
  const { profile, loading } = useAuth();

  if (loading || !profile) return null;

  if (profile.role === "vietnamese_teacher" || profile.role === "foreign_teacher") {
    return <Navigate to="/teacher/dashboard" replace />;
  }
  if (profile.role === "admin") {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <DashboardContent />;
}

export default function Dashboard() {
  return (
    <AuthGuard allowedRoles={["learner", "vietnamese_teacher", "foreign_teacher", "admin"]}>
      <DashboardRedirect />
    </AuthGuard>
  );
}