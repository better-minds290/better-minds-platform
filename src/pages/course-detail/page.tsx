import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import CourseHero from "./components/CourseHero";
import SyllabusSection from "./components/SyllabusSection";
import SprintTimeline from "./components/SprintTimeline";
import EnrollmentCard from "./components/EnrollmentCard";
import EnrollmentModal from "./components/EnrollmentModal";

interface CourseData {
  id: string;
  name: string;
  description: string;
  level: string;
  is_active: boolean;
  total_sprints: number;
  total_hours: number;
  enrollment_password: string | null;
}

interface SprintSessionSummary {
  session_number: number;
  session_type: string;
  teacher_name: string | null;
  status: string;
  completed_at: string | null;
  feedback: string | null;
}

interface SprintEntryForTimeline {
  id: string;
  sprint_number: number;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  deadline_session1: string | null;
  deadline_session2: string | null;
  deadline_session3: string | null;
  sessions: SprintSessionSummary[];
}

interface SyllabusUnit {
  id: string;
  title: string;
  description: string;
  topics: string[];
  estimated_hours: number;
}

function generateSyllabus(totalSprints: number): SyllabusUnit[] {
  const unitCount = Math.min(totalSprints, 8);
  const allUnits: SyllabusUnit[] = [];

  for (let i = 1; i <= unitCount; i++) {
    allUnits.push({
      id: `sprint-${i}`,
      title: `Sprint ${i}`,
      description: "Nội dung đang được Admin cập nhật",
      topics: [],
      estimated_hours: 10,
    });
  }

  return allUnits;
}

function getTeacherNameForSession(sessionType: string): string | null {
  if (sessionType === "vietnamese_teacher") return "GV Việt Nam";
  if (sessionType === "foreign_teacher") return "GV Nước Ngoài";
  return null;
}

function CourseDetailContent() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { id: courseId } = useParams<{ id: string }>();
  const supabase = getSupabase();

  const [course, setCourse] = useState<CourseData | null>(null);
  const [syllabus, setSyllabus] = useState<SyllabusUnit[]>([]);
  const [syllabusLoading, setSyllabusLoading] = useState(false);
  const [sprints, setSprints] = useState<SprintEntryForTimeline[]>([]);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [enrollmentData, setEnrollmentData] = useState<{
    enrolledAt: string;
    totalSprints: number;
  } | null>(null);



  const fetchCourse = useCallback(async (silent = false) => {
    if (!courseId) return;
    if (!silent) setLoading(true);
    setFetchError(null);

    try {
      // Fetch course
      const { data: courseRow, error: courseErr } = await supabase
        .from("courses")
        .select("id, name, description, level, is_active, total_sprints, teacher_id, enrollment_password")
        .eq("id", courseId)
        .maybeSingle();

      if (courseErr) throw courseErr;
      if (!courseRow) {
        setFetchError(t("complete.notFound"));
        setLoading(false);
        return;
      }

      const totalSprints = courseRow.total_sprints || 24;
      const courseData: CourseData = {
        id: courseRow.id,
        name: courseRow.name,
        description: courseRow.description || "",
        level: courseRow.level,
        is_active: courseRow.is_active ?? true,
        total_sprints: totalSprints,
        total_hours: totalSprints * 10,
        enrollment_password: courseRow.enrollment_password || null,
      };
      setCourse(courseData);

      // Load syllabus from course_sprint_templates (admin-set sprint content) or generate defaults
      setSyllabusLoading(true);
      try {
        const { data: templateRows } = await supabase
          .from("course_sprint_templates")
          .select("id, sprint_number, title, objectives")
          .eq("course_id", courseId)
          .order("sprint_number", { ascending: true });

        if (templateRows && templateRows.length > 0) {
          // Only build syllabus from templates that have actual content
          const contentUnits: SyllabusUnit[] = templateRows
            .filter((row: Record<string, unknown>) => {
              const title = (row.title as string) || "";
              const objectives = (row.objectives as string) || "";
              // Only include if there's actual content (non-empty title or objectives)
              return title.trim().length > 0 || objectives.trim().length > 0;
            })
            .map((row: Record<string, unknown>, idx: number) => ({
              id: (row.id as string) || `template-${idx}`,
              title: (row.title as string) || `Sprint ${(row.sprint_number as number) || idx + 1}`,
              description: (row.objectives as string) || "",
              topics: (row.objectives as string)
                ? (row.objectives as string).split("\n").filter((line: string) => line.trim().length > 0)
                : [],
              estimated_hours: 10,
            }));
          if (contentUnits.length > 0) {
            setSyllabus(contentUnits);
          } else {
            // No real content — show minimal placeholders without fake data
            setSyllabus(templateRows.map((row: Record<string, unknown>, idx: number) => ({
              id: (row.id as string) || `template-${idx}`,
              title: `Sprint ${(row.sprint_number as number) || idx + 1}`,
              description: "Nội dung đang được cập nhật",
              topics: [],
              estimated_hours: 10,
            })));
          }
        } else {
          setSyllabus(generateSyllabus(totalSprints));
        }
      } catch {
        setSyllabus(generateSyllabus(totalSprints));
      } finally {
        setSyllabusLoading(false);
      }

      // Check enrollment (if user is logged in)
      if (profile?.id) {
        const { data: enrollment } = await supabase
          .from("enrollments")
          .select("id, status, enrolled_at")
          .eq("learner_id", profile.id)
          .eq("course_id", courseId)
          .eq("status", "active")
          .maybeSingle();

        if (enrollment) {
          setIsEnrolled(true);
          setEnrollmentData({
            enrolledAt: enrollment.enrolled_at,
            totalSprints,
          });

          // Fetch sprints
          const { data: sprintRows } = await supabase
            .from("learning_sprints")
            .select("id, sprint_number, status, created_at, completed_at, deadline_session1, deadline_session2, deadline_session3")
            .eq("enrollment_id", enrollment.id)
            .order("sprint_number", { ascending: true });

          if (sprintRows) {
            const sprintsWithSessions: SprintEntryForTimeline[] = [];

            for (const sprint of sprintRows) {
              const { data: sessionRows } = await supabase
                .from("sprint_sessions")
                .select("session_number, session_type, status, completed_at, feedback")
                .eq("sprint_id", sprint.id)
                .order("session_number", { ascending: true });

              sprintsWithSessions.push({
                id: sprint.id,
                sprint_number: sprint.sprint_number,
                status: sprint.status,
                created_at: sprint.created_at,
                completed_at: sprint.completed_at,
                deadline_session1: sprint.deadline_session1,
                deadline_session2: sprint.deadline_session2,
                deadline_session3: sprint.deadline_session3,
                sessions: (sessionRows || []).map((s) => ({
                  session_number: s.session_number,
                  session_type: s.session_type,
                  teacher_name: getTeacherNameForSession(s.session_type),
                  status: s.status,
                  completed_at: s.completed_at,
                  feedback: s.feedback,
                })),
              });
            }

            setSprints(sprintsWithSessions);
          }
        }
      }
    } catch (err) {
      console.error("Course detail fetch error:", err);
      setFetchError(t("dashboard.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [courseId, profile?.id, supabase, t]);

  useEffect(() => {
    fetchCourse();
  }, [fetchCourse]);

  const handleEnrollClick = () => {
    setIsModalOpen(true);
  };

  const handleEnrollSubmit = async (password?: string): Promise<{ success: boolean; error?: string }> => {
    if (!course) return { success: false, error: "Không tìm thấy khóa học." };

    try {
      const { data, error } = await supabase.functions.invoke("auto-generate-sprints", {
        body: {
          course_id: course.id,
          password: password || undefined,
        },
      });

      if (error) {
        console.error("Edge function invoke error:", error);
        return { success: false, error: "Lỗi kết nối. Vui lòng thử lại sau." };
      }

      if (!data || !data.success) {
        // If already enrolled, just refresh and close modal gracefully
        if (data?.already_enrolled) {
          await fetchCourse(true);
          return { success: true };
        }
        return { success: false, error: data?.error || "Đăng ký thất bại. Vui lòng thử lại." };
      }

      setEnrollmentData({
        enrolledAt: new Date().toISOString(),
        totalSprints: data.sprints_count || course.total_sprints,
      });
      setIsEnrolled(true);

      // Re-fetch to get sprints (silent mode - no skeleton flash)
      await fetchCourse(true);

      return { success: true };
    } catch (err: unknown) {
      console.error("Enrollment error:", err);
      const message = (err && typeof err === "object" && "message" in err)
        ? (err as { message: string }).message
        : "Lỗi không xác định. Vui lòng thử lại.";
      return { success: false, error: message };
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background-50">
        <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between h-16">
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">Better Minds</Link>
            </div>
          </div>
        </header>
        <main className="animate-pulse space-y-8 py-10">
          <div className="max-w-6xl mx-auto px-4 md:px-6 h-64 bg-background-200 rounded-xl"></div>
          <div className="max-w-6xl mx-auto px-4 md:px-6 h-96 bg-background-200 rounded-xl"></div>
        </main>
      </div>
    );
  }

  // Error or not found
  if (!course || fetchError) {
    return (
      <div className="min-h-screen bg-background-50">
        <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
          <div className="w-full px-4 md:px-6">
            <div className="flex items-center justify-between h-16">
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">Better Minds</Link>
              <Link to="/courses" className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors cursor-pointer">
                <i className="ri-arrow-left-line mr-1.5"></i>{t("course.breadcrumbCourses")}
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-16 text-center">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-background-200 mb-4">
            <i className="ri-error-warning-line text-2xl text-foreground-400"></i>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">{fetchError || t("course.notFound")}</h2>
          <p className="text-sm text-foreground-500 mb-6">{t("course.notFoundDesc")}</p>
          <Link
            to="/courses"
            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-line mr-1.5"></i>
            {t("course.browseCourses")}
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
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to="/dashboard"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("course.navDashboard")}
                </Link>
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-primary-600 bg-primary-50 whitespace-nowrap cursor-default">
                  {t("course.navCourses")}
                </span>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <Link
                to="/dashboard"
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-foreground-600 hover:text-foreground-800 hover:bg-background-100 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-arrow-left-line mr-1.5"></i>
                <span className="hidden sm:inline">{t("course.goToDashboard")}</span>
              </Link>
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <span className="text-sm font-medium text-foreground-700 hidden lg:inline">
                  {profile?.full_name}
                </span>
              </div>
            </div>
          </div>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <Link to="/dashboard" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer">
                  <i className="ri-dashboard-line mr-2"></i>{t("course.navDashboard")}
                </Link>
                <span className="px-3 py-2.5 rounded-md text-sm font-semibold text-primary-600 bg-primary-50 cursor-default">
                  <i className="ri-book-open-line mr-2"></i>{t("course.navCourses")}
                </span>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main>
        <CourseHero
          name={course.name}
          level={course.level}
          description={course.description}
          totalSprints={course.total_sprints}
          totalHours={course.total_hours}
          isEnrolled={isEnrolled}
          onEnrollClick={handleEnrollClick}
        />

        <SyllabusSection units={syllabus} />

        {sprints.length > 0 && (
          <SprintTimeline
            sprints={sprints}
            courseName={course.name}
          />
        )}

        <EnrollmentCard
          isEnrolled={isEnrolled}
          enrollmentStatus={isEnrolled ? "active" : null}
          enrolledDate={enrollmentData?.enrolledAt ?? null}
          isActive={isEnrolled}
          onEnrollClick={handleEnrollClick}
        />

        <EnrollmentModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          courseName={course.name}
          courseLevel={course.level}
          courseId={course.id}
          enrollmentPassword={course.enrollment_password}
          onEnroll={handleEnrollSubmit}
        />
      </main>
    </div>
  );
}

export default function CourseDetail() {
  return (
    <AuthGuard allowedRoles={["learner", "vietnamese_teacher", "foreign_teacher", "admin"]}>
      <CourseDetailContent />
    </AuthGuard>
  );
}