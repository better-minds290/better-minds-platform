import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import NotificationBell from "@/components/feature/NotificationBell";

interface CourseFromDB {
  id: string;
  name: string;
  description: string;
  level: string;
  is_active: boolean;
  total_sprints: number;
  teacher_name?: string;
}

const levelColors: Record<string, { bg: string; text: string }> = {
  "A1": { bg: "bg-accent-100", text: "text-accent-700" },
  "A2": { bg: "bg-secondary-100", text: "text-secondary-700" },
  "B1": { bg: "bg-primary-100", text: "text-primary-700" },
  "B1+": { bg: "bg-accent-100", text: "text-accent-700" },
  "B2": { bg: "bg-primary-100", text: "text-primary-700" },
};

const courseCardColors: Record<string, { border: string; accent: string; iconBg: string; iconText: string }> = {
  "accent": { border: "border-accent-200 hover:border-accent-300", accent: "bg-accent-500", iconBg: "bg-accent-100", iconText: "text-accent-600" },
  "secondary": { border: "border-secondary-200 hover:border-secondary-300", accent: "bg-secondary-500", iconBg: "bg-secondary-100", iconText: "text-secondary-600" },
  "primary": { border: "border-primary-200 hover:border-primary-300", accent: "bg-primary-500", iconBg: "bg-primary-100", iconText: "text-primary-600" },
};

function getCardColor(level: string): typeof courseCardColors.primary {
  const base = level.toUpperCase();
  if (base.startsWith("A")) return courseCardColors.secondary;
  if (base.startsWith("B") && level.includes("+")) return courseCardColors.accent;
  if (base.startsWith("B")) return courseCardColors.primary;
  return courseCardColors.accent;
}

export default function CoursesPage() {
  const { t } = useTranslation();
  const supabase = getSupabase();
  const { isAuthenticated, profile } = useAuth();
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [courses, setCourses] = useState<CourseFromDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCourses() {
      setLoading(true);
      setFetchError(null);

      try {
        const { data: courseRows, error } = await supabase
          .from("courses")
          .select("id, name, description, level, is_active, total_sprints, teacher_id")
          .order("level", { ascending: true });

        if (error) throw error;
        if (cancelled) return;

        const coursesWithTeachers: CourseFromDB[] = [];

        for (const c of courseRows || []) {
          let teacherName = "";
          if (c.teacher_id) {
            const { data: profileData } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", c.teacher_id)
              .maybeSingle();
            teacherName = profileData?.full_name || "";
          }

          coursesWithTeachers.push({
            id: c.id,
            name: c.name,
            description: c.description || "",
            level: c.level,
            is_active: c.is_active ?? true,
            total_sprints: c.total_sprints || 24,
            teacher_name: teacherName,
          });
        }

        if (!cancelled) setCourses(coursesWithTeachers);
      } catch (err) {
        console.error("Courses fetch error:", err);
        if (!cancelled) setFetchError(t("dashboard.fetchError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCourses();
    return () => { cancelled = true; };
  }, [supabase, t]);

  const filteredCourses = filter === "active"
    ? courses.filter((c) => c.is_active)
    : courses;

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
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-primary-600 bg-primary-50 whitespace-nowrap cursor-default">
                  {t("nav.forLearners")}
                </span>
                {isAuthenticated ? (
                  <Link to="/dashboard" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer">
                    {t("nav.dashboard")}
                  </Link>
                ) : (
                  <Link to="/login" className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer">
                    {t("nav.login")}
                  </Link>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <NotificationBell />
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-600 hover:text-foreground-800 hover:bg-background-100 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                  >
                    <i className="ri-arrow-left-line mr-1.5"></i>
                    {t("course.goToDashboard")}
                  </Link>
                  <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200">
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm">
                      {profile?.full_name?.charAt(0)?.toUpperCase() || "U"}
                    </div>
                    <span className="text-sm font-medium text-foreground-700 hidden lg:inline">
                      {profile?.full_name}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Link to="/login" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer">
                    {t("nav.login")}
                  </Link>
                  <Link to="/register" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer">
                    {t("nav.getStarted")}
                  </Link>
                </>
              )}
            </div>
          </div>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <span className="px-3 py-2.5 rounded-md text-sm font-semibold text-primary-600 bg-primary-50 cursor-default">
                  <i className="ri-book-open-line mr-2"></i>{t("nav.forLearners")}
                </span>
                {isAuthenticated ? (
                  <Link to="/dashboard" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer">
                    <i className="ri-dashboard-line mr-2"></i>{t("nav.dashboard")}
                  </Link>
                ) : (
                  <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer">
                    <i className="ri-login-box-line mr-2"></i>{t("nav.login")}
                  </Link>
                )}
              </nav>
            </div>
          )}
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="w-full py-16 md:py-20 bg-background-50">
          <div className="w-full max-w-7xl mx-auto px-4 md:px-6">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 mb-4">
                {t("nav.forLearners")}
              </span>
              <h1 className="font-heading text-3xl md:text-5xl font-bold text-foreground-950 mb-4 leading-tight">
                {t("courses.title")}
              </h1>
              <p className="text-sm md:text-base text-foreground-600 leading-relaxed">
                {t("courses.subtitle")}
              </p>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center justify-center gap-2 mb-10">
              <button
                onClick={() => setFilter("all")}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  filter === "all"
                    ? "bg-primary-500 text-background-50"
                    : "bg-background-100 text-foreground-600 hover:bg-background-200"
                }`}
              >
                {t("courses.filterAll")}
              </button>
              <button
                onClick={() => setFilter("active")}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  filter === "active"
                    ? "bg-accent-500 text-background-50"
                    : "bg-background-100 text-foreground-600 hover:bg-background-200"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-accent-400"></span>
                  {t("courses.filterActive")}
                </span>
              </button>
            </div>

            {/* Loading */}
            {loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-80 bg-background-200 rounded-xl"></div>
                ))}
              </div>
            )}

            {/* Error */}
            {!loading && fetchError && (
              <div className="text-center py-16">
                <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
                  <i className="ri-error-warning-line text-2xl text-accent-600"></i>
                </div>
                <p className="text-sm text-foreground-500 mb-6">{fetchError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-refresh-line mr-1.5"></i>
                  {t("dashboard.retry")}
                </button>
              </div>
            )}

            {/* Course Grid */}
            {!loading && !fetchError && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredCourses.map((course) => {
                    const cardColor = getCardColor(course.level);
                    const levelColor = levelColors[course.level] || levelColors.B1;
                    const totalSessions = course.total_sprints * 3;

                    return (
                      <article
                        key={course.id}
                        className={`relative flex flex-col bg-background-50 border ${cardColor.border} rounded-xl overflow-hidden transition-all duration-300 group`}
                      >
                        {/* Top accent bar */}
                        <div className={`h-1.5 w-full ${cardColor.accent}`}></div>

                        {/* Badge row */}
                        <div className="px-5 pt-5 pb-0 flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${levelColor.bg} ${levelColor.text} whitespace-nowrap`}>
                            {course.level}
                          </span>
                          {!course.is_active && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-background-200 text-foreground-500 whitespace-nowrap">
                              {t("courses.comingSoon")}
                            </span>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 px-5 pt-3 pb-5">
                          <h3 className="font-heading text-lg font-bold text-foreground-950 mb-2 group-hover:text-primary-600 transition-colors duration-200">
                            {course.name}
                          </h3>
                          <p className="text-sm text-foreground-600 leading-relaxed mb-4 line-clamp-3">
                            {course.description}
                          </p>

                          {/* Stats row */}
                          <div className="flex items-center gap-4 text-xs text-foreground-500 mb-4">
                            <span className="flex items-center gap-1">
                              <i className="ri-repeat-line"></i>
                              {t("courses.sprintsLabel", { count: course.total_sprints })}
                            </span>
                            <span className="flex items-center gap-1">
                              <i className="ri-calendar-check-line"></i>
                              {t("courses.sessionsLabel", { count: totalSessions })}
                            </span>
                          </div>

                          {/* Instructor */}
                          {course.teacher_name && (
                            <div className="flex items-center gap-2 mb-4">
                              <div className={`w-6 h-6 flex items-center justify-center rounded-full ${cardColor.iconBg} ${cardColor.iconText} text-xs font-bold`}>
                                {course.teacher_name.charAt(0)}
                              </div>
                              <span className="text-xs text-foreground-500">
                                {t("courses.instructorLabel")}: <span className="font-medium text-foreground-700">{course.teacher_name}</span>
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Action */}
                        <div className="px-5 pb-5">
                          <Link
                            to={`/courses/${course.id}`}
                            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap cursor-pointer ${
                              course.is_active
                                ? "bg-primary-500 text-background-50 hover:bg-primary-600"
                                : "bg-background-200 text-foreground-400 cursor-not-allowed pointer-events-none"
                            }`}
                          >
                            {course.is_active ? (
                              <>
                                {t("courses.viewCourse")}
                                <i className="ri-arrow-right-line"></i>
                              </>
                            ) : (
                              <>
                                {t("courses.comingSoon")}
                                <i className="ri-time-line"></i>
                              </>
                            )}
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {/* Empty state */}
                {filteredCourses.length === 0 && (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-200 text-foreground-400 mb-4">
                      <i className="ri-inbox-line text-2xl"></i>
                    </div>
                    <p className="text-sm text-foreground-500">{t("course.noCoursesMatchFilter")}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="w-full py-16 bg-background-100">
          <div className="w-full max-w-7xl mx-auto px-4 md:px-6 text-center">
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground-950 mb-3">
              {t("cta.title")}
            </h2>
            <p className="text-sm text-foreground-600 mb-6 max-w-lg mx-auto leading-relaxed">
              {t("cta.subtitle")}
            </p>
            <a
              href="https://forms.gle/MH9EnrMrfhZr3roaA"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              {t("cta.button")}
              <i className="ri-arrow-right-line"></i>
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-secondary-900 text-background-100 py-8">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-background-400">
            © 2026 Better Minds. A non-profit initiative.
          </p>
          <Link to="/" className="text-xs text-background-400 hover:text-background-200 transition-colors cursor-pointer">
            {t("nav.home")}
          </Link>
        </div>
      </footer>
    </div>
  );
}