import { useState, useEffect, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface TeacherLiveLessonProps {
  sessionId: string;
  sprintId: string;
  sessionNumber: number;
  sessionType: string;
  sessionTitle: string | null;
  scheduledAt: string | null;
  status: string;
  feedback: string | null;
  lessonSummary: string | null;
  onStatusChange?: () => void;
}

interface StudentInfo {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  course_name: string;
  course_level: string;
  grade: number | null;
  teacher_feedback: string | null;
  attendanceId: string | null;
}

export default function TeacherLiveLesson({
  sessionId,
  sprintId,
  sessionNumber,
  sessionType,
  sessionTitle,
  scheduledAt,
  status: initialStatus,
  feedback: initialFeedback,
  lessonSummary: initialLessonSummary,
  onStatusChange,
}: TeacherLiveLessonProps) {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [meetingLink, setMeetingLink] = useState<string>("");
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [currentFeedback, setCurrentFeedback] = useState(initialFeedback || "");
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Array<{ file_name: string; file_path: string; file_size?: number }>>([]);
  const [lessonSummary, setLessonSummary] = useState<string | null>(initialLessonSummary || null);

  const isSessionOne = sessionNumber === 1;

  const sessionLabel = sessionType === "vietnamese_teacher" || sessionType === "live_session"
    ? t("liveLesson.liveSessionLabel")
    : t("session.foreignTeacher");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch session data
      const { data: sessionData } = await supabase
        .from("sprint_sessions")
        .select("meeting_link, teacher_notes, completion_rating, teacher_feedback, status, teacher_id, class_id, lesson_summary")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionData) {
        let link = (sessionData as any).meeting_link || "";
        setCurrentStatus((sessionData as any).status || initialStatus);
        setCurrentFeedback((sessionData as any).teacher_feedback || "");
        setLessonSummary((sessionData as any).lesson_summary || null);

        // Auto-transition active → awaiting_feedback when scheduled time has passed
        if ((sessionData as any).status === "active" && scheduledAt) {
          const scheduledTime = new Date(scheduledAt).getTime();
          if (Date.now() > scheduledTime) {
            const { error: transitionErr } = await supabase
              .from("sprint_sessions")
              .update({ status: "awaiting_feedback" })
              .eq("id", sessionId);
            if (!transitionErr) {
              setCurrentStatus("awaiting_feedback");
            }
          }
        }

        // Auto-transition in_progress → awaiting_feedback when 1 hour has passed since scheduled time
        if ((sessionData as any).status === "in_progress" && scheduledAt) {
          const oneHourAfter = new Date(scheduledAt).getTime() + 60 * 60 * 1000;
          if (Date.now() > oneHourAfter) {
            const { error: transitionErr } = await supabase
              .from("sprint_sessions")
              .update({ status: "awaiting_feedback" })
              .eq("id", sessionId);
            if (!transitionErr) {
              setCurrentStatus("awaiting_feedback");
            }
          }
        }

        if (!link && (sessionData as any).teacher_id) {
          const { data: teacherProfile } = await supabase
            .from("profiles")
            .select("default_meeting_link")
            .eq("id", (sessionData as any).teacher_id)
            .maybeSingle();
          if (teacherProfile?.default_meeting_link) {
            link = teacherProfile.default_meeting_link;
          }
        }

        setMeetingLink(link);

        // Session 1 has no class_id — skip student/attendance loading
        if (!isSessionOne) {
          // Fetch students and their grading status
          const classId = (sessionData as any).class_id;
          if (classId) {
            // Get class_schedule
            const { data: schedule } = await supabase
              .from("class_schedules")
              .select("id")
              .eq("class_id", classId)
              .maybeSingle();

            const scheduleId = schedule?.id;

            // Get enrolled students
            const { data: enrollments } = await supabase
              .from("class_enrollments")
              .select("student_id")
              .eq("class_id", classId);

            if (enrollments && enrollments.length > 0) {
              const studentIds = enrollments.map((e: any) => e.student_id);

              // Get student profiles
              const { data: profiles } = await supabase
                .from("profiles")
                .select("id, full_name, email, phone, avatar_url")
                .in("id", studentIds);

              // Get attendance records with grades
              const { data: attendance } = await supabase
                .from("session_attendance")
                .select("id, student_id, grade, teacher_feedback")
                .eq("schedule_id", scheduleId);

              const attendanceMap: Record<string, { id: string; grade: number | null; teacher_feedback: string | null }> = {};
              (attendance || []).forEach((a: any) => {
                attendanceMap[a.student_id] = {
                  id: a.id,
                  grade: a.grade,
                  teacher_feedback: a.teacher_feedback,
                };
              });

              // Fetch sprint info for course name
              const { data: sprintData } = await supabase
                .from("learning_sprints")
                .select("enrollment_id")
                .eq("id", sprintId)
                .maybeSingle();

              let courseName = "";
              let courseLevel = "";

              if (sprintData?.enrollment_id) {
                const { data: enroll } = await supabase
                  .from("enrollments")
                  .select("course_id")
                  .eq("id", sprintData.enrollment_id)
                  .maybeSingle();

                if (enroll?.course_id) {
                  const { data: course } = await supabase
                    .from("courses")
                    .select("name, level")
                    .eq("id", enroll.course_id)
                    .maybeSingle();
                  courseName = course?.name || "";
                  courseLevel = course?.level || "";
                }
              }

              const studentList: StudentInfo[] = (profiles || []).map((p: any) => ({
                id: p.id,
                full_name: p.full_name,
                email: p.email,
                phone: p.phone || null,
                avatar_url: p.avatar_url || null,
                course_name: courseName,
                course_level: courseLevel,
                grade: attendanceMap[p.id]?.grade || null,
                teacher_feedback: attendanceMap[p.id]?.teacher_feedback || null,
                attendanceId: attendanceMap[p.id]?.id || null,
              }));

              setStudents(studentList);
            }
          }
        }
      }

      // Fetch materials
      const { data: sprintInfo } = await supabase
        .from("learning_sprints")
        .select("sprint_number, enrollment_id")
        .eq("id", sprintId)
        .maybeSingle();

      if (sprintInfo) {
        const { data: enrollData } = await supabase
          .from("enrollments")
          .select("course_id")
          .eq("id", sprintInfo.enrollment_id)
          .maybeSingle();

        if (enrollData?.course_id && sprintInfo.sprint_number) {
          const { data: templateData } = await supabase
            .from("course_sprint_templates")
            .select("sessions_data")
            .eq("course_id", enrollData.course_id)
            .eq("sprint_number", sprintInfo.sprint_number)
            .maybeSingle();

          if (templateData?.sessions_data) {
            const sessData = (templateData.sessions_data as any[]).find(
              (s: any) => s.session_number === sessionNumber
            );
            setMaterials(sessData?.materials || []);
          }
        }
      }
    } catch (err) {
      console.error("Teacher live lesson fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, sprintId, sessionNumber, supabase, initialStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);



  if (loading) {
    return (
      <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-8 animate-pulse space-y-6">
        <div className="h-7 w-48 bg-background-200 rounded"></div>
        <div className="h-32 bg-background-200 rounded-lg"></div>
        <div className="h-40 bg-background-200 rounded-lg"></div>
      </div>
    );
  }

  const isCompleted = currentStatus === "completed";
  const isAwaitingFeedback = currentStatus === "awaiting_feedback";

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2">
          <i className="ri-check-line"></i>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-md bg-accent-100 text-accent-700 text-sm flex items-center gap-2">
          <i className="ri-error-warning-line"></i>
          {errorMsg}
        </div>
      )}

      {/* Session Title Banner — shows the lesson name set by admin */}
      {sessionTitle && (
        <div className="bg-background-50 border border-background-200 rounded-lg px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600 flex-shrink-0">
            <i className="ri-book-2-line text-lg"></i>
          </div>
          <p className="text-base font-semibold text-foreground-900">{sessionTitle}</p>
        </div>
      )}

      {/* Top Row: Student Info + Meeting Link */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-background-50 border border-background-200 rounded-lg p-5">
          <h4 className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-3">
            <i className="ri-user-line mr-1.5"></i>
            {isSessionOne ? t("liveLesson.studentInfo") : t("liveLesson.studentCount", { count: students.length })}
          </h4>
          {isSessionOne ? (
            <div className="text-sm text-foreground-500 py-2">
              <i className="ri-information-line text-foreground-400 mr-1.5"></i>
              {t("liveLesson.selfStudyTeacherInfo")}
            </div>
          ) : students.length > 0 ? (
            <div className="space-y-3">
              {students.map((student) => (
                <div key={student.id} className="flex items-start gap-3 p-3 rounded-lg bg-background-50/50 border border-background-100">
                  <div className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 shrink-0">
                    {student.avatar_url ? (
                      <img src={student.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold">
                        {student.full_name?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground-900 truncate">{student.full_name}</p>
                    <p className="text-xs text-foreground-500 truncate">{student.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {student.course_name && (
                        <span className="text-xs text-foreground-400">{student.course_name}</span>
                      )}
                      {student.grade !== null ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                          <i className="ri-star-fill text-[10px]"></i>
                          {student.grade}/5
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-foreground-500 py-3 text-center">
              <i className="ri-user-search-line text-foreground-400 mr-1.5"></i>
              {t("liveLesson.noStudentInfo")}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-background-50 border border-background-200 rounded-lg p-5">
          <h4 className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-3">
            <i className="ri-links-line mr-1.5"></i>
            {isSessionOne ? t("liveLesson.selfStudyInfoTitle") : "Meeting Link"}
          </h4>
          {isSessionOne ? (
            <div className="text-sm text-foreground-600">
              {isCompleted ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-100 text-accent-700 text-xs font-semibold">
                  <i className="ri-checkbox-circle-fill"></i>
                  {t("liveLesson.studentCompletedLabel")}
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                  <i className="ri-time-line"></i>
                  {t("liveLesson.waitingForStudentSummary")}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                disabled={isCompleted}
                className="w-full px-4 py-2.5 rounded-md border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {!isCompleted && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { error } = await supabase
                          .from("sprint_sessions")
                          .update({ meeting_link: meetingLink })
                          .eq("id", sessionId);
                        if (error) throw error;
                        setSuccessMsg(t("liveLesson.meetingLinkSaved"));
                        setTimeout(() => setSuccessMsg(null), 2500);
                      } catch (err: any) {
                        setErrorMsg(err?.message || t("liveLesson.linkSaveError"));
                        setTimeout(() => setErrorMsg(null), 3000);
                      }
                    }}
                    className="inline-flex items-center px-3 py-2 rounded-md text-xs font-medium bg-secondary-500 text-background-50 hover:bg-secondary-600 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-save-line mr-1"></i>
                    {t("liveLesson.saveLink")}
                  </button>
                  {meetingLink && (
                    <a
                      href={meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-3 py-2 rounded-md text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-external-link-line mr-1"></i>
                      {t("liveLesson.goToClass")}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Session Materials */}
      {materials.length > 0 && (
        <div className="bg-background-50 border border-background-200 rounded-lg p-5 md:p-6">
          <h4 className="font-heading text-base font-bold text-foreground-950 mb-4">
            <i className="ri-folder-line mr-1.5 text-foreground-400"></i>
            {t("liveLesson.sessionMaterialsTitle")}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {materials.map((mat, idx) => (
              <a
                key={idx}
                href={mat.file_path}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-background-50 border border-background-200/70 hover:border-secondary-300 hover:bg-secondary-50/50 transition-all duration-150 cursor-pointer group"
              >
                <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600 shrink-0 group-hover:bg-secondary-200 transition-colors">
                  <i className="ri-file-line text-base"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground-800 truncate group-hover:text-foreground-950 transition-colors">
                    {mat.file_name}
                  </p>
                  {mat.file_size && (
                    <p className="text-xs text-foreground-400 mt-0.5">
                      {(mat.file_size / 1024).toFixed(0)} KB
                    </p>
                  )}
                </div>
                <i className="ri-external-link-line text-foreground-300 group-hover:text-primary-500 transition-colors shrink-0"></i>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Lesson Summary — Session 1 only (read-only for teacher) */}
      {isSessionOne && lessonSummary && (
        <div className="bg-background-50 border border-background-200 rounded-lg p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-heading text-base font-bold text-foreground-950">
              <i className="ri-file-text-line mr-1.5 text-foreground-400"></i>
              {t("liveLesson.studentLessonSummaryTitle")}
            </h4>
            {isCompleted && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-accent-100 text-accent-700 whitespace-nowrap">
                <i className="ri-check-line"></i>
                {t("liveLesson.statusCompletedLabel")}
              </span>
            )}
          </div>
          <div className="p-4 rounded-lg bg-primary-50/50 border border-primary-200">
            <p className="text-sm text-foreground-800 whitespace-pre-wrap leading-relaxed">{lessonSummary}</p>
          </div>
          {currentFeedback && currentFeedback.startsWith("Câu hỏi:") && (
            <div className="mt-4 p-4 rounded-lg bg-secondary-50/50 border border-secondary-200">
              <h5 className="text-xs font-semibold text-secondary-700 uppercase tracking-wider mb-2">
                <i className="ri-question-line mr-1"></i>
                {t("liveLesson.studentQuestionsTitle")}
              </h5>
              <p className="text-sm text-foreground-700 whitespace-pre-wrap">{currentFeedback.replace("Câu hỏi: ", "")}</p>
            </div>
          )}
        </div>
      )}

      {/* Feedback Navigation — Sessions 2 & 3 only */}
      {!isSessionOne && (
        <div className="bg-background-50 border border-background-200 rounded-lg p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-heading text-base font-bold text-foreground-950">
              <i className="ri-star-line mr-1.5 text-foreground-400"></i>
              {t("liveLesson.gradingSectionTitle")}
            </h4>
            <div className="flex items-center gap-2">
              {isCompleted ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-accent-100 text-accent-700 whitespace-nowrap">
                  <i className="ri-check-double-line"></i>
                  {t("liveLesson.statusCompletedLabel")}
                </span>
              ) : isAwaitingFeedback ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-secondary-100 text-secondary-700 whitespace-nowrap">
                  <i className="ri-time-line"></i>
                  {t("liveLesson.statusAwaitingFeedbackLabel")}
                </span>
              ) : currentStatus === "active" || currentStatus === "in_progress" ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 whitespace-nowrap">
                  <i className="ri-play-circle-line"></i>
                  {t("liveLesson.statusOngoingLabel")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-background-200 text-foreground-500 whitespace-nowrap">
                  <i className="ri-calendar-line"></i>
                  {t("liveLesson.statusUpcomingLabel")}
                </span>
              )}
            </div>
          </div>

          {isAwaitingFeedback ? (
            <div className="p-4 rounded-lg bg-secondary-50 border border-secondary-200">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-secondary-800 mb-1">
                  {t("liveLesson.timeToGradeTitle")}
                  </p>
                  <p className="text-xs text-secondary-600">
                    <Trans
                      i18nKey="liveLesson.timeToGradeDesc"
                      values={{ count: students.length }}
                      components={{ strong: <strong className="font-semibold" /> }}
                    />
                  </p>
                </div>
                <a
                  href="/teacher/dashboard?tab=feedback"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md text-sm font-semibold bg-secondary-500 text-background-50 hover:bg-secondary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer shrink-0"
                >
                  <i className="ri-arrow-right-line"></i>
                  {t("liveLesson.goToFeedbackTab")}
                </a>
              </div>
            </div>
          ) : isCompleted ? (
            students.length > 0 ? (
              <div className="space-y-2">
                {students.map((student) => (
                  <div key={student.id} className="flex items-center justify-between p-3 rounded-lg bg-accent-50/30 border border-accent-200">
                    <span className="text-sm font-semibold text-foreground-900">{student.full_name}</span>
                    {student.grade !== null ? (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-accent-100 text-accent-700 whitespace-nowrap">
                        <i className="ri-star-fill text-[10px]"></i>
                        {student.grade}/5
                      </span>
                    ) : (
                      <span className="text-xs text-foreground-400">{t("liveLesson.noGradeYetLabel")}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-100 mb-2">
                  <i className="ri-user-search-line text-lg text-foreground-400"></i>
                </div>
                <p className="text-sm text-foreground-500">{t("liveLesson.noStudentInfo")}</p>
              </div>
            )
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-foreground-500">
                <i className="ri-information-line mr-1.5 text-foreground-400"></i>
                <Trans
                  i18nKey="liveLesson.gradingOpensLater"
                  components={{ strong: <strong className="font-semibold" /> }}
                />
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}