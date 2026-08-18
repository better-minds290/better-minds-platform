import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";

interface StudentInfo {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  courses: { courseId: string; courseName: string; level: string; sprintCount: number; completedSessions: number; activeSessions: number }[];
}

export default function StudentsTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(false);
    try {
      const supabase = getSupabase();

      // 1. Get all sprint_sessions for this teacher
      const { data: sessionsData, error: sessionsErr } = await supabase
        .from("sprint_sessions")
        .select(`
          id, sprint_id, session_number, status,
          sprint:learning_sprints!sprint_id(
            id, sprint_number,
            enrollment:enrollments!learning_sprints_enrollment_id_fkey(
              learner_id,
              course:courses!enrollments_course_id_fkey(id, name, level)
            )
          )
        `)
        .eq("teacher_id", profile.id);

      if (sessionsErr) throw sessionsErr;

      if (!sessionsData || sessionsData.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      // 2. Build student → course → sessions map
      const studentMap: Record<string, {
        courses: Record<string, { courseName: string; level: string; sprintIds: Set<string>; completed: number; active: number }>;
      }> = {};

      sessionsData.forEach((s: any) => {
        const learnerId = s.sprint?.enrollment?.learner_id;
        const courseData = s.sprint?.enrollment?.course;
        if (!learnerId || !courseData) return;

        if (!studentMap[learnerId]) {
          studentMap[learnerId] = { courses: {} };
        }

        if (!studentMap[learnerId].courses[courseData.id]) {
          studentMap[learnerId].courses[courseData.id] = {
            courseName: courseData.name || t("teacher.unknownCourseName"),
            level: courseData.level || "",
            sprintIds: new Set(),
            completed: 0,
            active: 0,
          };
        }

        studentMap[learnerId].courses[courseData.id].sprintIds.add(s.sprint_id);
        if (s.status === "completed") {
          studentMap[learnerId].courses[courseData.id].completed++;
        } else {
          studentMap[learnerId].courses[courseData.id].active++;
        }
      });

      // 3. Fetch profiles for all students
      const learnerIds = Object.keys(studentMap);
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, avatar_url")
        .in("id", learnerIds);

      const profileLookup: Record<string, any> = {};
      (profilesData || []).forEach((p: any) => {
        profileLookup[p.id] = p;
      });

      // 4. Build final student list
      const result: StudentInfo[] = learnerIds.map((lid) => {
        const p = profileLookup[lid] || {};
        const courses = Object.entries(studentMap[lid].courses).map(([cid, cdata]) => ({
          courseId: cid,
          courseName: cdata.courseName,
          level: cdata.level,
          sprintCount: cdata.sprintIds.size,
          completedSessions: cdata.completed,
          activeSessions: cdata.active,
        }));
        return {
          id: lid,
          full_name: p.full_name || t("teacher.unknownName"),
          email: p.email || "",
          phone: p.phone || "",
          avatar_url: p.avatar_url || null,
          courses,
        };
      });

      setStudents(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      if (search.trim() === "") return true;
      const q = search.toLowerCase();
      return (
        student.full_name.toLowerCase().includes(q) ||
        student.email.toLowerCase().includes(q)
      );
    });
  }, [students, search]);

  const selectedStudentData = selectedStudent
    ? students.find((s) => s.id === selectedStudent)
    : null;

  const totalUniqueStudents = students.length;
  const totalCompletedSessions = students.reduce((sum, s) => sum + s.courses.reduce((cs, c) => cs + c.completedSessions, 0), 0);
  const totalActiveSessions = students.reduce((sum, s) => sum + s.courses.reduce((cs, c) => cs + c.activeSessions, 0), 0);

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-background-50 border border-background-200/70"></div>
          ))}
        </div>
        <div className="h-10 w-full max-w-sm rounded-lg bg-background-100"></div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-background-50 border border-background-200/70"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-error-warning-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-700 font-medium mb-1">{t("teacher.fetchError")}</p>
        <button
          onClick={fetchData}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line"></i>
          {t("teacher.retry")}
        </button>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-group-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-900 font-semibold mb-1">{t("teacher.noStudentsYet")}</p>
        <p className="text-xs text-foreground-500">{t("teacher.noStudentsYetDesc")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div className="p-4 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600">
              <i className="ri-group-line"></i>
            </div>
          </div>
          <p className="text-xl font-heading font-bold text-foreground-950">{totalUniqueStudents}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.totalStudents")}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600">
              <i className="ri-check-double-line"></i>
            </div>
          </div>
          <p className="text-xl font-heading font-bold text-foreground-950">{totalCompletedSessions}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.completedSessions")}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600">
              <i className="ri-time-line"></i>
            </div>
          </div>
          <p className="text-xl font-heading font-bold text-foreground-950">{totalActiveSessions}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.pendingSessions")}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-5">
        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("teacher.searchStudents")}
          className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-background-200 bg-background-50 text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
      </div>

      {/* Empty search result */}
      {filteredStudents.length === 0 ? (
        <div className="p-10 rounded-xl bg-background-50 border border-background-200/70 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
            <i className="ri-user-search-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500 font-medium">{t("teacher.noStudents")}</p>
        </div>
      ) : (
        <>
          {/* Table header - desktop */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold text-foreground-400 uppercase tracking-wider">
            <div className="col-span-3">{t("teacher.name")}</div>
            <div className="col-span-3">{t("teacher.email")}</div>
            <div className="col-span-2">{t("teacher.phone")}</div>
            <div className="col-span-3">{t("teacher.enrolledCourses")}</div>
            <div className="col-span-1"></div>
          </div>

          <div className="space-y-2">
            {filteredStudents.map((student) => {
              const isSelected = selectedStudent === student.id;
              return (
                <div key={student.id}>
                  <div
                    onClick={() => setSelectedStudent(isSelected ? null : student.id)}
                    className={`grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-center p-4 rounded-xl border cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? "border-primary-200 bg-primary-50/30"
                        : "border-background-200/70 bg-background-50 hover:border-background-300"
                    }`}
                  >
                    <div className="md:col-span-3 flex items-center gap-3">
                      <div className="w-9 h-9 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-sm shrink-0">
                        {student.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 truncate">{student.full_name}</p>
                        <p className="text-xs text-foreground-400">
                          {student.courses.length} {t("teacher.coursesCount")}
                        </p>
                      </div>
                    </div>

                    <div className="md:col-span-3">
                      <span className="md:hidden text-xs font-medium text-foreground-400 mr-1">{t("teacher.email")}:</span>
                      <span className="text-sm text-foreground-600 truncate block">{student.email}</span>
                    </div>

                    <div className="md:col-span-2">
                      <span className="md:hidden text-xs font-medium text-foreground-400 mr-1">{t("teacher.phone")}:</span>
                      <span className="text-sm text-foreground-600">{student.phone || "-"}</span>
                    </div>

                    <div className="md:col-span-3">
                      <span className="md:hidden text-xs font-medium text-foreground-400 mr-1">{t("teacher.enrolledCourses")}:</span>
                      <div className="flex flex-wrap gap-1">
                        {student.courses.slice(0, 2).map((c) => (
                          <span key={c.courseId} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                            {c.courseName}
                          </span>
                        ))}
                        {student.courses.length > 2 && (
                          <span className="text-[11px] text-foreground-400">+{student.courses.length - 2}</span>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-1 text-right">
                      {isSelected ? (
                        <i className="ri-arrow-up-s-line text-foreground-300"></i>
                      ) : (
                        <i className="ri-arrow-down-s-line text-foreground-300"></i>
                      )}
                    </div>
                  </div>

                  {/* Expanded student detail */}
                  {isSelected && selectedStudentData && (
                    <div className="mx-4 mb-2 p-4 rounded-b-xl bg-background-50 border border-t-0 border-primary-200/50">
                      <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-3">
                        {t("teacher.enrolledCourses")}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {selectedStudentData.courses.map((c) => (
                          <div key={c.courseId} className="p-4 rounded-lg bg-background-50 border border-background-200/70">
                            <p className="text-sm font-semibold text-foreground-900 mb-2">{c.courseName}</p>
                            <div className="space-y-1.5 text-xs text-foreground-500">
                              <div className="flex items-center gap-1.5">
                                <i className="ri-bar-chart-line text-foreground-300"></i>
                                <span>{c.level}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <i className="ri-stack-line text-foreground-300"></i>
                                <span>{c.sprintCount} {t("dashboard.sprints")}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <i className="ri-check-line text-foreground-300"></i>
                                <span>{c.completedSessions} {t("teacher.completed").toLowerCase()}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <i className="ri-time-line text-foreground-300"></i>
                                <span>{c.activeSessions} {t("teacher.activeSessions")}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-3 border-t border-background-200/70 flex items-center gap-4 text-xs text-foreground-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <i className="ri-mail-line"></i>
                          {selectedStudentData.email}
                        </span>
                        {selectedStudentData.phone && (
                          <span className="flex items-center gap-1">
                            <i className="ri-phone-line"></i>
                            {selectedStudentData.phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <i className="ri-stack-line"></i>
                          {selectedStudentData.courses.length} {t("teacher.coursesCount")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-foreground-400">
            {t("teacher.studentsTotalFooter", { count: filteredStudents.length })}
          </p>
        </>
      )}
    </div>
  );
}