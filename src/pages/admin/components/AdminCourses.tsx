import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import CourseModal from "./CourseModal";
import SprintContentModal from "./SprintContentModal";

interface CourseData {
  id: string;
  name: string;
  description: string;
  level: string;
  sessions: number;
  duration: string;
  students: number;
  status: "active" | "draft";
  created_at: string;
  is_active: boolean;
  deadline_config: Record<string, unknown> | null;
  enrollment_password?: string | null;
}

export default function AdminCourses() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [courses, setCourses] = useState<CourseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [sprintContentCourse, setSprintContentCourse] = useState<{ id: string; name: string } | null>(null);

  const EMPTY_SESSIONS = [
    { session_number: 1, title: "", description: "", materials: [] },
    { session_number: 2, title: "", description: "", materials: [] },
    { session_number: 3, title: "", description: "", materials: [] },
  ];

  const createSprintTemplates = async (courseId: string) => {
    const supabase = getSupabase();
    // Read total_sprints from the course
    const { data: courseData } = await supabase
      .from("courses")
      .select("total_sprints")
      .eq("id", courseId)
      .maybeSingle();
    const totalSprints = courseData?.total_sprints || 24;
    const templates = [];
    for (let i = 1; i <= totalSprints; i++) {
      templates.push({
        course_id: courseId,
        sprint_number: i,
        sessions_data: JSON.parse(JSON.stringify(EMPTY_SESSIONS)),
      });
    }
    const { error } = await supabase.from("course_sprint_templates").insert(templates);
    if (error) {
      console.error("Failed to create sprint templates:", error);
    }
  };

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabase();

      const [coursesRes, enrollRes] = await Promise.all([
        supabase.from("courses").select("*").order("created_at", { ascending: false }),
        supabase.from("enrollments").select("course_id, status"),
      ]);

      if (coursesRes.error || !coursesRes.data || coursesRes.data.length === 0) {
        setCourses([]);
        return;
      }

      const allEnrollments = enrollRes.data || [];

      const merged: CourseData[] = coursesRes.data.map((c) => {
        const activeEnrollments = allEnrollments.filter(
          (e) => e.course_id === c.id && e.status === "active"
        );

        const totalSprints = c.total_sprints || 24;
        const totalSessions = totalSprints * 3;

        return {
          id: c.id,
          name: c.name || "Untitled",
          description: c.description || "",
          level: c.level || "-",
          sessions: totalSessions,
          duration: totalSprints,
          students: activeEnrollments.length,
          status: c.is_active ? "active" : "draft",
          created_at: c.created_at || "",
          is_active: c.is_active ?? true,
          deadline_config: c.deadline_config,
          enrollment_password: c.enrollment_password,
        };
      });

      setCourses(merged);
    } catch (err) {
      console.error("Failed to fetch courses:", err);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const handleCreate = () => {
    setEditingCourse(null);
    setModalOpen(true);
  };

  const handleEdit = (course: CourseData) => {
    setEditingCourse(course);
    setModalOpen(true);
  };

  const handleModalSuccess = async (courseId?: string) => {
    showToast(
      "success",
      editingCourse ? t("auth.adminCourseUpdateSuccess") : t("auth.adminCourseCreateSuccess")
    );
    if (!editingCourse && courseId) {
      await createSprintTemplates(courseId);
    }
    fetchCourses();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const courseId = deleteTarget.id;

      // 1. Find all enrollments for this course
      const { data: enrollments, error: enrollErr } = await supabase
        .from("enrollments")
        .select("id")
        .eq("course_id", courseId);
      if (enrollErr) throw new Error(`Failed to fetch enrollments: ${enrollErr.message}`);

      if (enrollments && enrollments.length > 0) {
        const enrollmentIds = enrollments.map((e) => e.id);

        // 2. Find learning sprints & sessions for these enrollments
        const { data: sprints, error: sprintErr } = await supabase
          .from("learning_sprints")
          .select("id")
          .in("enrollment_id", enrollmentIds);
        if (sprintErr) throw new Error(`Failed to fetch sprints: ${sprintErr.message}`);

        const sprintIds = (sprints || []).map((s) => s.id);

        // 2a. Clean learner_attendance first (FK often blocks sprint/enrollment deletes)
        const { error: attByEnrollErr } = await supabase
          .from("learner_attendance")
          .delete()
          .in("enrollment_id", enrollmentIds);
        if (attByEnrollErr) {
          throw new Error(`Failed to delete learner attendance: ${attByEnrollErr.message}`);
        }

        if (sprintIds.length > 0) {
          const { data: sessions, error: sessFetchErr } = await supabase
            .from("sprint_sessions")
            .select("id")
            .in("sprint_id", sprintIds);
          if (sessFetchErr) throw new Error(`Failed to fetch sprint sessions: ${sessFetchErr.message}`);

          const sessionIds = (sessions || []).map((s) => s.id);

          if (sessionIds.length > 0) {
            const { error: attBySessionErr } = await supabase
              .from("learner_attendance")
              .delete()
              .in("related_session_id", sessionIds);
            if (attBySessionErr) {
              throw new Error(`Failed to delete session-linked attendance: ${attBySessionErr.message}`);
            }
          }

          const { error: attBySprintErr } = await supabase
            .from("learner_attendance")
            .delete()
            .in("related_sprint_id", sprintIds);
          if (attBySprintErr) {
            throw new Error(`Failed to delete sprint-linked attendance: ${attBySprintErr.message}`);
          }

          const { error: sessDelErr } = await supabase
            .from("sprint_sessions")
            .delete()
            .in("sprint_id", sprintIds);
          if (sessDelErr) throw new Error(`Failed to delete sprint sessions: ${sessDelErr.message}`);

          const { error: sprintDelErr } = await supabase
            .from("learning_sprints")
            .delete()
            .in("enrollment_id", enrollmentIds);
          if (sprintDelErr) throw new Error(`Failed to delete learning sprints: ${sprintDelErr.message}`);
        }

        // 3. Delete enrollments
        const { error: enrollDelErr } = await supabase
          .from("enrollments")
          .delete()
          .in("id", enrollmentIds);
        if (enrollDelErr) throw new Error(`Failed to delete enrollments: ${enrollDelErr.message}`);

        // 4. VERIFY enrollments are actually gone
        const { data: remaining, error: verifyErr } = await supabase
          .from("enrollments")
          .select("id")
          .eq("course_id", courseId);
        if (verifyErr) throw new Error(`Failed to verify enrollment cleanup: ${verifyErr.message}`);
        if (remaining && remaining.length > 0) {
          throw new Error(
            t("auth.adminCourseDeleteBlocked", { count: remaining.length })
          );
        }
      }

      // 5. Unlink classes from this course (keep class rosters intact)
      const { error: classUpdateErr } = await supabase
        .from("classes")
        .update({ course_id: null })
        .eq("course_id", courseId);
      if (classUpdateErr) {
        throw new Error(`Failed to unlink classes from course: ${classUpdateErr.message}`);
      }

      // 6. Delete sprint templates
      const { error: tmplDelErr } = await supabase
        .from("course_sprint_templates")
        .delete()
        .eq("course_id", courseId);
      if (tmplDelErr) {
        throw new Error(`Failed to delete sprint templates: ${tmplDelErr.message}`);
      }

      // 7. Finally delete the course
      const { error: courseDelErr } = await supabase
        .from("courses")
        .delete()
        .eq("id", courseId);
      if (courseDelErr) throw new Error(`Failed to delete course: ${courseDelErr.message}`);

      showToast("success", t("auth.adminCourseDeleteSuccess"));
      setDeleteTarget(null);
      fetchCourses();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Delete course error:", message);
      showToast("error", message || t("auth.adminCourseError"));
    } finally {
      setDeleting(false);
    }
  };

  const filtered = courses.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
            {t("auth.adminCourseManagement")}
          </h2>
          <p className="text-sm text-foreground-500">{t("auth.adminCourseSubtitle")}</p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-background-50 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-add-line text-base"></i>
          {t("auth.adminCreateCourse")}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("auth.adminSearchCourses")}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
        >
          <option value="all">{t("auth.adminAllStatuses")}</option>
          <option value="active">{t("auth.adminActive")}</option>
          <option value="draft">{t("auth.adminDraft")}</option>
        </select>
      </div>

      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchCourses}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-foreground-400">Loading courses...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-4">
            <i className="ri-book-open-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.adminNoCourses")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((course) => (
            <div
              key={course.id}
              className="group p-5 rounded-xl bg-background-50 border border-background-200 hover:border-background-300 transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading text-base font-semibold text-foreground-950 mb-0.5 truncate">
                    {course.name}
                  </h3>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                    course.status === "active"
                      ? "bg-accent-100 text-accent-700"
                      : "bg-background-200 text-foreground-500"
                  }`}>
                    {t(course.status === "active" ? "auth.adminActive" : "auth.adminDraft")}
                  </span>
                  {course.enrollment_password && (
                    <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 whitespace-nowrap" title={t("auth.adminCoursePasswordBadgeTitle")}>
                      <i className="ri-lock-line text-[10px]"></i>
                      {t("auth.adminCoursePasswordBadge")}
                    </span>
                  )}
                  {course.deadline_config && (course.deadline_config as Record<string, unknown>).deadline_overrides === true && (
                    <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                      <i className="ri-timer-flash-line text-[10px]"></i>
                      {t("auth.adminCourseDeadlineOverrideBadge")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-primary-100 text-primary-700 whitespace-nowrap">
                    {course.level}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={() => setSprintContentCourse({ id: course.id, name: course.name })}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent-100 text-foreground-400 hover:text-accent-700 transition-colors cursor-pointer"
                      title="Sprint Content"
                    >
                      <i className="ri-file-text-line text-sm"></i>
                    </button>
                    <button
                      onClick={() => handleEdit(course)}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-background-200 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                      title={t("auth.adminEdit")}
                    >
                      <i className="ri-pencil-line text-sm"></i>
                    </button>
                    <button
                      onClick={() => setDeleteTarget(course)}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent-50 text-foreground-400 hover:text-accent-500 transition-colors cursor-pointer"
                      title={t("auth.adminDelete")}
                    >
                      <i className="ri-delete-bin-line text-sm"></i>
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-sm text-foreground-500 mb-4 leading-relaxed">
                {course.description}
              </p>
              <div className="flex items-center gap-4 flex-wrap text-xs text-foreground-400">
                <span className="inline-flex items-center gap-1">
                  <i className="ri-calendar-line text-foreground-400"></i>
                  {course.sessions} {t("auth.adminSessions").toLowerCase()}
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-time-line text-foreground-400"></i>
                  {course.duration} {course.duration > 1 ? t("auth.adminWeeks") : t("auth.adminWeek")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-user-line text-foreground-400"></i>
                  {course.students} {t("auth.adminEnrolled").toLowerCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-foreground-400">
        {filtered.length} / {courses.length} {t("auth.adminCourses").toLowerCase()}
      </p>

      <CourseModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCourse(null);
        }}
        onSuccess={handleModalSuccess}
        editCourse={editingCourse}
      />

      <SprintContentModal
        open={!!sprintContentCourse}
        onClose={() => setSprintContentCourse(null)}
        courseId={sprintContentCourse?.id || ""}
        courseName={sprintContentCourse?.name || ""}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
            onClick={() => !deleting && setDeleteTarget(null)}
          ></div>
          <div className="relative w-full max-w-sm mx-4 bg-background-50 rounded-2xl border border-background-200 shadow-lg p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-11 h-11 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
              <i className="ri-delete-bin-line text-xl text-accent-500"></i>
            </div>
            <h3 className="text-center font-heading text-lg font-semibold text-foreground-950 mb-1.5">
              {t("auth.adminDeleteConfirmTitle")}
            </h3>
            <p className="text-center text-sm text-foreground-500 mb-6">
              {t("auth.adminDeleteConfirmMessage")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground-700 bg-background-100 hover:bg-background-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-background-50 bg-accent-500 hover:bg-accent-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deleting && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                )}
                {deleting ? "..." : t("auth.adminDeleteConfirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-lg text-sm font-medium shadow-lg animate-in slide-in-from-bottom-4 duration-300 max-w-xs ${
            toast.type === "success"
              ? "bg-primary-500 text-background-50"
              : "bg-accent-500 text-background-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <i className={toast.type === "success" ? "ri-check-line" : "ri-error-warning-line"}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}