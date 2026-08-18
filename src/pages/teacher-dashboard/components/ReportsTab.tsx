import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import {
  fetchStudentReportsForTeacher,
  fetchTeacherComparisonReports,
  type StudentReport,
  type TeacherReport,
} from "@/lib/teacherReports";

export default function ReportsTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const supabase = getSupabase();

  const [studentReports, setStudentReports] = useState<StudentReport[]>([]);
  const [teacherReports, setTeacherReports] = useState<TeacherReport[]>([]);
  const [studentLoading, setStudentLoading] = useState(true);
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [activeView, setActiveView] = useState<"students" | "teachers">("students");
  const [selectedCourse, setSelectedCourse] = useState<string>("all");
  const teacherReportsLoadedRef = useRef(false);

  const unknownName = t("teacher.unknownName");

  const fetchStudentReports = useCallback(async () => {
    if (!profile?.id) {
      setStudentReports([]);
      setStudentLoading(false);
      return;
    }

    setStudentLoading(true);
    try {
      const reports = await fetchStudentReportsForTeacher(supabase, profile.id, unknownName);
      setStudentReports(reports);
    } catch (err) {
      console.error("Reports fetch error:", err);
      setStudentReports([]);
    } finally {
      setStudentLoading(false);
    }
  }, [supabase, profile?.id, unknownName]);

  const fetchTeacherReports = useCallback(async () => {
    if (teacherReportsLoadedRef.current) return;

    setTeacherLoading(true);
    try {
      const reports = await fetchTeacherComparisonReports(supabase, unknownName);
      setTeacherReports(reports);
      teacherReportsLoadedRef.current = true;
    } catch (err) {
      console.error("Teacher comparison fetch error:", err);
      setTeacherReports([]);
    } finally {
      setTeacherLoading(false);
    }
  }, [supabase, unknownName]);

  useEffect(() => {
    fetchStudentReports();
  }, [fetchStudentReports]);

  useEffect(() => {
    if (activeView === "teachers") {
      fetchTeacherReports();
    }
  }, [activeView, fetchTeacherReports]);

  const courseOptions = useMemo(() => {
    const courses = [...new Set(studentReports.map((r) => r.course_name).filter(Boolean))];
    return courses.sort((a, b) => a.localeCompare(b));
  }, [studentReports]);

  const filteredReports = useMemo(() => {
    if (selectedCourse === "all") return studentReports;
    return studentReports.filter((r) => r.course_name === selectedCourse);
  }, [studentReports, selectedCourse]);

  if (studentLoading) {
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
                    <tr key={`${r.learner_id}-${r.course_name}`} className="hover:bg-background-50/50 transition-colors">
                      <td className="p-3">
                        <p className="font-semibold text-foreground-900">{r.learner_name}</p>
                        <p className="text-xs text-foreground-400">{r.learner_email}</p>
                      </td>
                      <td className="p-3 text-foreground-600">{r.course_name}</td>
                      <td className="p-3 text-center">
                        {r.current_sprint > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                            {t("teacher.reportsSprintBadge", { n: r.current_sprint })}
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
                                {t("teacher.reportsProgressSprints", { completed: r.completed_sprints, total: r.total_sprints })}
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
        teacherLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
              <p className="text-sm text-foreground-400">{t("teacher.reportsLoading")}</p>
            </div>
          </div>
        ) : (
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
        )
      )}
    </div>
  );
}
