import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import LessonSummaryForm from "./LessonSummaryForm";

interface LearnerLiveLessonProps {
  sessionId: string;
  sprintId: string;
  sessionNumber: number;
  sessionType: string;
  sessionTitle: string | null;
  teacherId: string | null;
  scheduledAt: string | null;
  status: string;
  teacherFeedback: string | null;
  completionRating: number | null;
  lessonSummary: string | null;
}

interface MaterialData {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
}

interface TeacherInfo {
  full_name: string;
  avatar_url: string | null;
}

export default function LearnerLiveLesson({
  sessionId,
  sprintId,
  sessionNumber,
  sessionType,
  sessionTitle,
  teacherId,
  scheduledAt,
  status: initialStatus,
  teacherFeedback: initialTeacherFeedback,
  completionRating: initialCompletionRating,
  lessonSummary: initialLessonSummary,
}: LearnerLiveLessonProps) {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [materials, setMaterials] = useState<MaterialData[]>([]);
  const [teacherInfo, setTeacherInfo] = useState<TeacherInfo | null>(null);
  const [meetingLink, setMeetingLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"materials" | "feedback" | "summary">("materials");
  const [teacherFeedback, setTeacherFeedback] = useState<string | null>(initialTeacherFeedback || null);
  const [completionRating, setCompletionRating] = useState<number | null>(initialCompletionRating || null);
  const [allSessions, setAllSessions] = useState<Array<{id: string; session_number: number; status: string}>>([]);
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [currentSummary, setCurrentSummary] = useState(initialLessonSummary || null);

  const isSessionOne = sessionNumber === 1;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch session data
      const { data: sessionData } = await supabase
        .from("sprint_sessions")
        .select("meeting_link, teacher_feedback, completion_rating, status, lesson_summary, class_id")
        .eq("id", sessionId)
        .maybeSingle();

      let meetingLink: string | null = null;

      if (sessionData) {
        meetingLink = (sessionData as any).meeting_link || null;
        setCurrentStatus((sessionData as any).status || initialStatus);
        setTeacherFeedback((sessionData as any).teacher_feedback || initialTeacherFeedback || null);
        setCompletionRating((sessionData as any).completion_rating || initialCompletionRating || null);
        setCurrentSummary((sessionData as any).lesson_summary || initialLessonSummary || null);

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

        // For sessions 2 & 3: fetch personal grade & feedback from session_attendance
        if (sessionNumber >= 2 && (sessionData as any).class_id) {
          const { data: schedule } = await supabase
            .from("class_schedules")
            .select("id")
            .eq("class_id", (sessionData as any).class_id)
            .maybeSingle();

          if (schedule?.id) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { data: attendance } = await supabase
                .from("session_attendance")
                .select("grade, teacher_feedback")
                .eq("schedule_id", schedule.id)
                .eq("student_id", user.id)
                .maybeSingle();

              if (attendance) {
                if (attendance.grade !== null) setCompletionRating(attendance.grade);
                if (attendance.teacher_feedback) setTeacherFeedback(attendance.teacher_feedback);
              }
            }
          }
        }
      }

      // Fetch all sessions in this sprint for navigation
      const { data: sprintSessionsData } = await supabase
        .from("sprint_sessions")
        .select("id, session_number, status")
        .eq("sprint_id", sprintId)
        .order("session_number");
      setAllSessions(sprintSessionsData || []);

      // 2. Fetch sprint info for course_id
      const { data: sprintData } = await supabase
        .from("learning_sprints")
        .select("sprint_number, enrollment:enrollments!learning_sprints_enrollment_id_fkey(course_id)")
        .eq("id", sprintId)
        .maybeSingle();

      const courseId = (sprintData as any)?.enrollment?.course_id;
      const sprintNumber = (sprintData as any)?.sprint_number;

      // 3. Fallback: teacher's default_meeting_link
      if (!meetingLink && teacherId) {
        const { data: teacherProfile } = await supabase
          .from("profiles")
          .select("default_meeting_link")
          .eq("id", teacherId)
          .maybeSingle();

        if (teacherProfile?.default_meeting_link) {
          meetingLink = teacherProfile.default_meeting_link;
        }
      }

      setMeetingLink(meetingLink);

      // 4. Fetch materials from course_sprint_templates
      let allMaterials: MaterialData[] = [];

      if (courseId && sprintNumber) {
        const { data: templateData } = await supabase
          .from("course_sprint_templates")
          .select("sessions_data")
          .eq("course_id", courseId)
          .eq("sprint_number", sprintNumber)
          .maybeSingle();

        if (templateData?.sessions_data) {
          const sessionsArr = templateData.sessions_data as any[];
          const currentSessionConfig = sessionsArr.find((s: any) => s.session_number === sessionNumber);
          if (currentSessionConfig?.materials && Array.isArray(currentSessionConfig.materials)) {
            const sprintMats: MaterialData[] = currentSessionConfig.materials.map((m: any) => ({
              id: `sprint-${m.file_path || m.file_name}`,
              title: m.file_name,
              description: null,
              file_name: m.file_name,
              file_url: m.file_path,
              file_type: (m.file_name || "").split(".").pop() || "",
            }));
            allMaterials = [...allMaterials, ...sprintMats];
          }
        }
      }

      // Also fetch class_materials
      if (courseId) {
        const { data: classData } = await supabase
          .from("classes")
          .select("id")
          .eq("course_id", courseId)
          .maybeSingle();

        if (classData) {
          const { data: mats } = await supabase
            .from("class_materials")
            .select("*")
            .eq("class_id", classData.id)
            .order("created_at", { ascending: false });

          allMaterials = [...allMaterials, ...((mats || []) as MaterialData[])];
        }
      }

      setMaterials(allMaterials);

      // 5. Fetch teacher info
      if (teacherId) {
        const { data: tData } = await supabase
          .from("profiles")
          .select("full_name, avatar_url")
          .eq("id", teacherId)
          .maybeSingle();

        if (tData) setTeacherInfo(tData as TeacherInfo);
      }
    } catch (err) {
      console.error("Learner live lesson fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, sprintId, sessionNumber, teacherId, supabase, initialStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isCompleted = currentStatus === "completed";
  const isAwaitingFeedback = currentStatus === "awaiting_feedback";
  const sessionLabel = sessionType === "vietnamese_teacher" || sessionType === "live_session"
    ? t("liveLesson.liveSessionLabel")
    : t("session.foreignTeacher");

  if (loading) {
    return (
      <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-8 animate-pulse space-y-6">
        <div className="h-7 w-56 bg-background-200 rounded"></div>
        <div className="h-40 bg-background-200 rounded-lg"></div>
        <div className="h-32 bg-background-200 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Session Title Banner — shows the lesson name set by admin */}
      {sessionTitle && (
        <div className="bg-background-50 border border-background-200 rounded-lg px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600 flex-shrink-0">
            <i className="ri-book-2-line text-lg"></i>
          </div>
          <p className="text-base font-semibold text-foreground-900">{sessionTitle}</p>
        </div>
      )}

      {/* Meeting Link Card - only for live sessions (not session 1) */}
      {!isSessionOne && (
        <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-primary-100 flex-shrink-0">
                <i className="ri-vidicon-line text-xl text-primary-600"></i>
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-foreground-950 mb-1">
                  {t("liveLesson.joinTitle")}
                </h3>
                <p className="text-sm text-foreground-500">
                  {isCompleted
                    ? t("liveLesson.sessionEnded")
                    : isAwaitingFeedback
                      ? t("liveLesson.awaitingFeedbackDesc")
                      : t("liveLesson.joinDesc")}
                </p>
                {teacherInfo && (
                  <p className="text-sm text-foreground-600 mt-1.5 flex items-center gap-1.5">
                    <i className="ri-user-line text-foreground-400"></i>
                    {teacherInfo.full_name}
                  </p>
                )}
                {scheduledAt && (
                  <p className="text-sm text-foreground-500 mt-1 flex items-center gap-1.5">
                    <i className="ri-time-line text-foreground-400"></i>
                    {new Date(scheduledAt).toLocaleString("vi-VN", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
            </div>

            {meetingLink && !isCompleted && !isAwaitingFeedback ? (
              <a
                href={meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer shadow-sm"
              >
                <i className="ri-vidicon-fill text-lg"></i>
                {t("liveLesson.joinNow")}
                <i className="ri-external-link-line"></i>
              </a>
            ) : isAwaitingFeedback ? (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-secondary-100 text-secondary-700 text-sm whitespace-nowrap">
                <i className="ri-time-line"></i>
                {t("liveLesson.statusAwaitingFeedbackLabel")}
              </div>
            ) : isCompleted ? (
              <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-100 text-accent-700 text-sm font-semibold whitespace-nowrap">
                <i className="ri-checkbox-circle-fill"></i>
                {t("session.completed")}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-background-100 text-sm text-foreground-500 whitespace-nowrap">
                <i className="ri-time-line"></i>
                {t("liveLesson.linkNotAvailable")}
              </div>
            )}
          </div>
        </div>
      )}

      {isAwaitingFeedback && !isSessionOne && (
        <div className="p-5 rounded-lg bg-secondary-50 border border-secondary-200 flex items-start gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600 flex-shrink-0 mt-0.5">
            <i className="ri-time-line text-lg"></i>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-secondary-800 mb-1">{t("liveLesson.awaitingFeedbackBannerTitle")}</h4>
            <p className="text-sm text-secondary-600">{t("liveLesson.awaitingFeedbackBannerDesc")}</p>
          </div>
        </div>
      )}

      {/* Tabs: Materials | My Summary (S1) | Feedback (S2&3) */}
      <div className="bg-background-50 border border-background-200 rounded-lg overflow-hidden">
        <div className="flex items-center border-b border-background-200 bg-background-50 px-1 py-1 overflow-x-auto">
          {[
            { key: "materials" as const, icon: "ri-folder-line", label: t("liveLesson.tabMaterials") },
            ...(isSessionOne
              ? [{ key: "summary" as const, icon: "ri-file-text-line", label: t("session.mySummary") }]
              : [{ key: "feedback" as const, icon: "ri-chat-1-line", label: t("liveLesson.tabFeedback") }]),
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                activeTab === tab.key
                  ? "bg-background-100 text-foreground-950"
                  : "text-foreground-500 hover:text-foreground-700"
              }`}
            >
              <i className={`${tab.icon} text-base`}></i>
              {tab.label}
              {tab.key === "feedback" && teacherFeedback && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500 ml-0.5"></span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6 md:p-8">
          {/* Materials Tab */}
          {activeTab === "materials" && (
            <div>
              <h4 className="font-heading text-base font-bold text-foreground-950 mb-4">{t("liveLesson.classMaterials")}</h4>
              {materials.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-full bg-background-100 mb-3">
                    <i className="ri-folder-open-line text-xl text-foreground-400"></i>
                  </div>
                  <p className="text-sm text-foreground-500">{t("liveLesson.noMaterials")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {materials.map((mat) => (
                    <a
                      key={mat.id}
                      href={mat.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 p-4 rounded-lg border border-background-200 hover:border-background-300 hover:bg-background-50/50 transition-colors duration-150 cursor-pointer"
                    >
                      <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600 flex-shrink-0">
                        <i className={`text-lg ${mat.file_type?.includes("pdf") ? "ri-file-pdf-line" : mat.file_type?.includes("image") ? "ri-image-line" : "ri-file-text-line"}`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 truncate">{mat.title}</p>
                        {mat.description && (
                          <p className="text-xs text-foreground-500 mt-0.5 line-clamp-1">{mat.description}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-foreground-400">
                        <i className="ri-download-line"></i>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* My Summary Tab — Session 1 only */}
          {activeTab === "summary" && isSessionOne && (
            <div>
              <h4 className="font-heading text-base font-bold text-foreground-950 mb-4">{t("session.mySummary")}</h4>
              <LessonSummaryForm
                sessionId={sessionId}
                sprintId={sprintId}
                lessonSummary={currentSummary}
                status={currentStatus}
                onSubmitSuccess={fetchData}
              />
            </div>
          )}

          {/* Feedback Tab — Sessions 2 & 3 */}
          {activeTab === "feedback" && !isSessionOne && (
            <div>
              <h4 className="font-heading text-base font-bold text-foreground-950 mb-4">{t("liveLesson.teacherFeedback")}</h4>
              {teacherFeedback ? (
                <div className="p-5 rounded-lg bg-background-50 border border-background-200">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-100 flex-shrink-0">
                      <i className="ri-user-voice-line text-primary-600"></i>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground-900">
                        {teacherInfo?.full_name || sessionLabel}
                      </p>
                      <p className="text-xs text-foreground-400">
                        {t("liveLesson.yourTeacher")}
                      </p>
                    </div>
                    {completionRating !== null && (
                      <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700">
                        <i className="ri-star-fill text-[11px]"></i>
                        <span className="text-xs font-bold">{completionRating}/5</span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-foreground-800 whitespace-pre-wrap leading-relaxed">{teacherFeedback}</p>
                </div>
              ) : isCompleted ? (
                <div className="text-center py-10">
                  <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-full bg-background-100 mb-3">
                    <i className="ri-chat-1-line text-xl text-foreground-400"></i>
                  </div>
                  <p className="text-sm text-foreground-500">{t("liveLesson.noFeedbackYet")}</p>
                </div>
              ) : (
                <div className="text-center py-10">
                  <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-full bg-background-100 mb-3">
                    <i className="ri-time-line text-xl text-foreground-400"></i>
                  </div>
                  <p className="text-sm text-foreground-500">{t("liveLesson.feedbackAfterSession")}</p>
                  <p className="text-xs text-foreground-400 mt-1">{t("liveLesson.feedbackAfterSessionDesc")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Session roadmap mini */}
      <div className="bg-background-50 border border-background-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground-500">
            {t("liveLesson.sessionFlow")}
          </span>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((num, idx) => {
              const isCurrent = num === sessionNumber;
              const isPast = num < sessionNumber;
              const sessionInfo = allSessions.find(
                (s) => s.session_number === num
              );
              const isLocked = sessionInfo?.status === "locked";
              const circle = (
                <div
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${
                    isCurrent
                      ? "bg-primary-500 text-background-50 ring-2 ring-primary-200"
                      : isPast
                        ? "bg-accent-500 text-background-50"
                        : isLocked
                          ? "bg-background-200 text-foreground-400"
                          : "bg-secondary-400 text-background-50"
                  }`}
                >
                  {isPast ? (
                    <i className="ri-check-line text-[10px]"></i>
                  ) : isLocked ? (
                    <i className="ri-lock-line text-[10px]"></i>
                  ) : (
                    num
                  )}
                </div>
              );
              return (
                <div key={num} className="flex items-center">
                  {idx > 0 && (
                    <div className="w-6 h-0.5 bg-background-300 mr-1.5"></div>
                  )}
                  {sessionInfo && !isLocked ? (
                    <Link
                      to={`/dashboard/sprint/${sprintId}/session/${sessionInfo.id}`}
                      className={`flex items-center gap-1 group cursor-pointer ${
                        isCurrent ? "" : "hover:opacity-80"
                      }`}
                    >
                      {circle}
                      <span className={`text-[10px] transition-colors ${
                        isCurrent
                          ? "text-primary-600 font-semibold"
                          : "text-foreground-400 group-hover:text-primary-600"
                      }`}>
                        {num === 2 ? (sessionType === "vietnamese_teacher" ? t("liveLesson.liveRoadmapLabel") : t("liveLesson.foreignRoadmapLabel")) : num === 1 ? t("liveLesson.selfStudyRoadmapLabel") : t("liveLesson.foreignRoadmapLabel")}
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-1">
                      {circle}
                      <span className="text-[10px] text-foreground-400">
                        {num === 2 ? "Live" : num === 1 ? t("liveLesson.selfStudyRoadmapLabel") : "Foreign"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}