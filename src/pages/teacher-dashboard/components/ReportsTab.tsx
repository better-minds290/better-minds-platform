import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";

interface StudentReport {
  learner_id: string;
  learner_name: string;
  learner_email: string;
  course_name: string;
  current_sprint: number;
  total_sprints: number;
  completed_sprints: number;
  avg_rating: number;
}

interface TeacherReport {
  teacher_id: string;
  teacher_name: string;
  total_sessions: number;
  completed_sessions: number;
  avg_rating_given: number;
  total_feedbacks: number;
}

export default function ReportsTab() {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [studentReports, setStudentReports] = useState<StudentReport[]>([]);
  const [teacherReports, setTeacherReports] = useState<TeacherReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"students" | "teachers">("students");
  const [selectedCourse, setSelectedCourse] = useState<string>("all");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch student reports
      const { data: enrollments, error: enrollErr } = await supabase
        .from("enrollments")
        .select("id, learner_id, course_id, status")
        .eq("status", "active");

      if (!enrollErr && enrollments) {
        const reports: StudentReport[] = [];

        for (const enrollment of enrollments) {
          // Get learner profile
          const { data: learner } = await supabase
            .from("profiles")
            .select("full_name, email, is_active")
            .eq("id", enrollment.learner_id)
            .maybeSingle();

          // Get course name
          const { data: course } = await supabase
            .from("courses")
            .select("name")
            .eq("id", enrollment.course_id)
            .maybeSingle();

          // Get all sprints for this enrollment
          const { data: sprints } = await supabase
            .from("learning_sprints")
            .select("id, sprint_number, status")
            .eq("enrollment_id", enrollment.id);

          const totalSprints = (sprints || []).length;
          const completedSprints = (sprints || []).filter((s: any) => s.status === "completed").length;

          // Find current sprint (lowest sprint_number that is not completed)
          const pendingSprints = (sprints || [])
            .filter((s: any) => s.status !== "completed")
            .sort((a: any, b: any) => a.sprint_number - b.sprint_number);

          const currentSprint = pendingSprints.length > 0 ? pendingSprints[0].sprint_number : 0;

          // Get average rating across all sprint sessions
          let avgRating = 0;
          let ratingCount = 0;
          if (sprints) {
            for (const sprint of sprints) {
              const { data: sessions } = await supabase
                .from("sprint_sessions")
                .select("completion_rating, completed_at")
                .eq("sprint_id", sprint.id)
                .not("completion_rating", "is", null);

              (sessions || []).forEach((s: any) => {
                avgRating += s.completion_rating;
                ratingCount++;
              });
            }
          }

          const avg = ratingCount > 0 ? Math.round((avgRating / ratingCount) * 10) / 10 : 0;

          reports.push({
            learner_id: enrollment.learner_id,
            learner_name: learner?.full_name || "Unknown",
            learner_email: learner?.email || "",
            course_name: course?.name || "",
            current_sprint: currentSprint,
            total_sprints: totalSprints,
            completed_sprints: completedSprints,
            avg_rating: avg,
          });
        }

        setStudentReports(reports);
      }

      // Fetch teacher reports
      const { data: teachers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["vietnamese_teacher", "foreign_teacher"]);

      if (teachers) {
        const tReports: TeacherReport[] = [];

        for (const teacher of teachers) {
          const { data: sessions } = await supabase
            .from("sprint_sessions")
            .select("completion_rating, teacher_feedback, status")
            .eq("teacher_id", teacher.id);

          const completed = (sessions || []).filter((s: any) => s.status === "completed");
          const withRatings = completed.filter((s: any) => s.completion_rating);

          let avgRating = 0;
          withRatings.forEach((s: any) => { avgRating += s.completion_rating; });

          const withFeedback = completed.filter((s: any) => s.teacher_feedback);

          tReports.push({
            teacher_id: teacher.id,
            teacher_name: teacher.full_name || "Unknown",
            total_sessions: (sessions || []).length,
            completed_sessions: completed.length,
            avg_rating_given: withRatings.length > 0 ? Math.round((avgRating / withRatings.length) * 10) / 10 : 0,
            total_feedbacks: withFeedback.length,
          });
        }

        setTeacherReports(tReports);
      }
    } catch (err) {
      console.error("Reports fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Derive unique course list + filtered reports
  const courseOptions = useMemo(() => {
    const courses = [...new Set(studentReports.map((r) => r.course_name).filter(Boolean))];
    return courses.sort((a, b) => a.localeCompare(b));
  }, [studentReports]);

  const filteredReports = useMemo(() => {
    if (selectedCourse === "all") return studentReports;
    return studentReports.filter((r) => r.course_name === selectedCourse);
  }, [studentReports, selectedCourse]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
          <p className="text-sm text-foreground-400">{t("teacher.reportsLoading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="font-heading text-lg font-bold text-foreground-950 mb-1">{t("teacher.reportsTitle")}</h3>
        <p className="text-sm text-foreground-500">{t("teacher.reportsSubtitle")}</p>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-1 mb-6 bg-background-100 rounded-full p-0.5 w-fit">
        <button
          type="button"
          onClick={() => setActiveView("students")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeView === "students" ? "bg-background-50 text-foreground-950 shadow-sm" : "text-foreground-500 hover:text-foreground-700"
          }`}
        >
          <i className="ri-user-line mr-1.5"></i>
          {t("teacher.reportsStudents")}
        </button>
        <button
          type="button"
          onClick={() => setActiveView("teachers")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
            activeView === "teachers" ? "bg-background-50 text-foreground-950 shadow-sm" : "text-foreground-500 hover:text-foreground-700"
          }`}
        >
          <i className="ri-user-voice-line mr-1.5"></i>
          {t("teacher.reportsTeachers")}
        </button>
      </div>

      {/* Students Table */}
      {activeView === "students" && (
        <>
          {/* Course filter */}
          {courseOptions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-xs font-medium text-foreground-500 flex items-center gap-1">
                <i className="ri-filter-3-line"></i>
                {t("reports.filterByCourse")}
              </span>
              <div className="flex items-center flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedCourse("all")}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                    selectedCourse === "all"
                      ? "bg-primary-500 text-background-50"
                      : "bg-background-100 text-foreground-500 hover:bg-background-200"
                  }`}
                >
                  {t("reports.filterAll")}
                  <span className="ml-1 opacity-70">({studentReports.length})</span>
                </button>
                {courseOptions.map((course) => {
                  const count = studentReports.filter((r) => r.course_name === course).length;
                  return (
                    <button
                      key={course}
                      type="button"
                      onClick={() => setSelectedCourse(course)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                        selectedCourse === course
                          ? "bg-primary-500 text-background-50"
                          : "bg-background-100 text-foreground-500 hover:bg-background-200"
                      }`}
                    >
                      {course}
                      <span className="ml-1 opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>
              {selectedCourse !== "all" && (
                <span className="text-xs text-foreground-400">
                  {t("reports.showingLearners", { filtered: filteredReports.length, total: studentReports.length })}
                </span>
              )}
            </div>
          )}

        <div className="rounded-xl border border-background-200/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-background-200/70 bg-background-100/50">
                  <th className="text-left p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColStudent")}</th>
                  <th className="text-left p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColCourse")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("reports.currentSprint")}</th>
                  <th className="text-left p-3 text-xs font-semibold text-foreground-500 uppercase" style={{ minWidth: 180 }}>{t("teacher.reportsColProgress")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColAvgRating")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColHistory")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-100">
                {filteredReports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-sm text-foreground-400">
                      {selectedCourse !== "all"
                        ? t("reports.noLearnersInCourse", { course: selectedCourse })
                        : t("teacher.reportsNoStudentData")}
                    </td>
                  </tr>
                ) : (
                  filteredReports.map((r) => (
                    <tr key={r.learner_id} className="hover:bg-background-50/50 transition-colors">
                      <td className="p-3">
                        <p className="font-semibold text-foreground-900">{r.learner_name}</p>
                        <p className="text-xs text-foreground-400">{r.learner_email}</p>
                      </td>
                      <td className="p-3 text-foreground-600">{r.course_name}</td>
                      <td className="p-3 text-center">
                        {r.current_sprint > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                            Sprint {r.current_sprint}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary-100 text-secondary-700">
                            {t("teacher.reportsAllDone")}
                          </span>
                        )}
                      </td>
                      <td className="p-3" style={{ minWidth: 180 }}>
                        {r.total_sprints > 0 ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-foreground-700 tabular-nums whitespace-nowrap">
                                {r.completed_sprints}/{r.total_sprints} sprint
                              </span>
                              <span className={`text-[11px] font-bold tabular-nums whitespace-nowrap ${
                                r.completed_sprints === r.total_sprints
                                  ? "text-accent-600"
                                  : r.completed_sprints >= r.total_sprints / 2
                                    ? "text-primary-600"
                                    : "text-foreground-500"
                              }`}>
                                {Math.round((r.completed_sprints / r.total_sprints) * 100)}%
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-background-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ease-out ${
                                  r.completed_sprints === r.total_sprints
                                    ? "bg-accent-500"
                                    : r.completed_sprints >= r.total_sprints / 2
                                      ? "bg-primary-500"
                                      : r.completed_sprints > 0
                                        ? "bg-accent-400"
                                        : "bg-background-300"
                                }`}
                                style={{ width: `${r.total_sprints > 0 ? Math.round((r.completed_sprints / r.total_sprints) * 100) : 0}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-foreground-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {r.avg_rating > 0 ? (
                          <span className="inline-flex items-center gap-1 text-foreground-700 font-semibold">
                            <i className="ri-star-fill text-accent-500 text-xs"></i>
                            {r.avg_rating}/5
                          </span>
                        ) : (
                          <span className="text-foreground-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <Link
                          to={`/dashboard/history?learner=${r.learner_id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-history-line"></i>
                          {t("reports.viewHistory")}
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* Teachers Table */}
      {activeView === "teachers" && (
        <div className="rounded-xl border border-background-200/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-background-200/70 bg-background-100/50">
                  <th className="text-left p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColTeacher")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColTotalSessions")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColCompletedSessions")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColAvgRatingGiven")}</th>
                  <th className="text-center p-3 text-xs font-semibold text-foreground-500 uppercase">{t("teacher.reportsColFeedbacks")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-100">
                {teacherReports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-sm text-foreground-400">
                      {t("teacher.reportsNoTeacherData")}
                    </td>
                  </tr>
                ) : (
                  teacherReports.map((r) => (
                    <tr key={r.teacher_id} className="hover:bg-background-50/50 transition-colors">
                      <td className="p-3">
                        <p className="font-semibold text-foreground-900">{r.teacher_name}</p>
                      </td>
                      <td className="p-3 text-center text-foreground-600">{r.total_sessions}</td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-100 text-accent-700">
                          {r.completed_sessions}/{r.total_sessions}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {r.avg_rating_given > 0 ? (
                          <span className="inline-flex items-center gap-1 text-foreground-700 font-semibold">
                            <i className="ri-star-fill text-accent-500 text-xs"></i>
                            {r.avg_rating_given}/5
                          </span>
                        ) : (
                          <span className="text-foreground-400">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary-100 text-secondary-700">
                          {r.total_feedbacks}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}