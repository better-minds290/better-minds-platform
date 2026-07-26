import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useRef, useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";

interface SessionData {
  id: string;
  session_number: number;
  session_type: string;
  teacher_name: string | null;
  scheduled_at: string | null;
  status: string;
  meeting_link: string | null;
  class_id: string | null;
}

interface SprintContentData {
  title: string;
  objectives: string;
  vocabulary: Array<{ word: string; definition: string; example: string }>;
  reading_material: string;
  exercises: Array<{ instruction: string; content: string }>;
  sessions_data?: Array<{
    session_number: number;
    title: string;
    description: string;
    materials: Array<{ file_name: string; file_path: string; file_size?: number }>;
  }>;
}

interface SprintProgressProps {
  sprintId: string;
  sprintNumber: number;
  status: string;
  sessions: SessionData[];
  courseId: string | null;
  onStartSprint?: () => void;
  isStarting?: boolean;
}

function getSessionIcon(sessionType: string, status: string): string {
  if (status === "completed") return "ri-checkbox-circle-fill";
  if (status === "awaiting_feedback") return "ri-time-line";
  if (status === "absent") return "ri-user-unfollow-line";
  if (status === "in_progress" || status === "active") return "ri-play-circle-fill";
  if (status === "locked") return "ri-lock-line";
  if (status === "available") return "ri-calendar-check-line";
  if (sessionType === "self_study") return "ri-book-open-line";
  if (sessionType === "live_session") return "ri-user-voice-line";
  return "ri-lock-line";
}

function getSessionColor(sessionType: string, status: string): string {
  if (status === "absent") return "text-accent-600 bg-accent-100";
  if (status === "completed") return "text-accent-600 bg-accent-100";
  if (status === "awaiting_feedback") return "text-secondary-600 bg-secondary-100";
  if (status === "in_progress" || status === "active") return "text-primary-600 bg-primary-100";
  if (status === "available") return "text-accent-700 bg-accent-100";
  if (status === "locked") return "text-foreground-400 bg-background-200";
  return "text-foreground-400 bg-background-200";
}

function formatSchedule(scheduledAt: string | null): string {
  if (!scheduledAt) return "";
  const date = new Date(scheduledAt);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = dayNames[date.getDay()];
  const month = monthNames[date.getMonth()];
  const dateNum = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}, ${month} ${dateNum} · ${hours}:${minutes}`;
}

export default function SprintProgress({ sprintId, sprintNumber, status, sessions, courseId, onStartSprint, isStarting }: SprintProgressProps) {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const prevStatusesRef = useRef<Map<string, string>>(new Map());
  const [justUnlockedIds, setJustUnlockedIds] = useState<Set<string>>(new Set());
  const [sprintContent, setSprintContent] = useState<SprintContentData | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    const newlyUnlocked = new Set<string>();
    sessions.forEach((s) => {
      const prevStatus = prevStatusesRef.current.get(s.id);
      const currentStatus = s.status;
      if (
        prevStatus === "locked" &&
        (currentStatus === "in_progress" || currentStatus === "active" || currentStatus === "available")
      ) {
        newlyUnlocked.add(s.id);
      }
      prevStatusesRef.current.set(s.id, currentStatus);
    });

    if (newlyUnlocked.size > 0) {
      setJustUnlockedIds(newlyUnlocked);
      const timer = setTimeout(() => setJustUnlockedIds(new Set()), 800);
      return () => clearTimeout(timer);
    }
  }, [sessions]);

  // Fetch sprint content from course_sprint_templates
  const fetchSprintContent = useCallback(async () => {
    if (!courseId) return;
    setContentLoading(true);
    try {
      const { data } = await supabase
        .from("course_sprint_templates")
        .select("title, objectives, vocabulary, reading_material, exercises, sessions_data")
        .eq("course_id", courseId)
        .eq("sprint_number", sprintNumber)
        .maybeSingle();

      if (data) {
        setSprintContent(data as SprintContentData);
      } else {
        setSprintContent(null);
      }
    } catch (err) {
      console.error("Failed to fetch sprint content:", err);
    } finally {
      setContentLoading(false);
    }
  }, [courseId, sprintNumber, supabase]);

  useEffect(() => {
    fetchSprintContent();
  }, [fetchSprintContent]);

  const getSessionLabel = (type: string): string => {
    if (type === "self_study") return t("dashboard.selfStudy");
    if (type === "live_session") return t("dashboard.liveSession");
    return type;
  };

  const activeSession = sessions.find((s) => s.status === "in_progress" || s.status === "active");
  const hasBookableSessions = sessions.some((s) => s.status === "available");
  const allSessionsCompleted = sessions.length === 3 && sessions.every((s) => s.status === "completed");

  const isPending = status === "pending" || status === "locked";

  return (
    <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-foreground-400 uppercase tracking-wider">
              {t("dashboard.sprint")} {sprintNumber}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
              status === "pending" || status === "locked" ? "bg-background-200 text-foreground-500" :
              status === "active" ? "bg-accent-100 text-accent-700" :
              status === "completed" ? "bg-accent-100 text-accent-700" :
              "bg-background-200 text-foreground-500"
            }`}>
              {status === "pending" || status === "locked" ? "Chờ Thứ 7" : status === "active" ? t("dashboard.active") : status}
            </span>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground-950">
            {sprintContent?.title || t("dashboard.sprintOverview")}
          </h2>
        </div>
      </div>

      {/* Sprint Content — from Admin */}
      {contentLoading ? (
        <div className="animate-pulse space-y-2 p-4 rounded-lg bg-background-100/50">
          <div className="h-4 bg-background-200 rounded w-3/4"></div>
          <div className="h-3 bg-background-200 rounded w-1/2"></div>
        </div>
      ) : sprintContent ? (
        <div className="p-4 rounded-lg bg-background-100/60 border border-background-200/70">
          {sprintContent.objectives && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                Mục tiêu học tập
              </p>
              <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">
                {sprintContent.objectives}
              </p>
            </div>
          )}

          {sprintContent.vocabulary && sprintContent.vocabulary.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">
                Từ vựng ({sprintContent.vocabulary.length} từ)
              </p>
              <div className="flex flex-wrap gap-2">
                {sprintContent.vocabulary.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-2.5 py-1 rounded-md bg-background-50 border border-background-200 text-xs font-medium text-foreground-700 whitespace-nowrap"
                    title={item.definition}
                  >
                    {item.word}
                  </span>
                ))}
              </div>
            </div>
          )}

          {sprintContent.reading_material && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                Tài liệu đọc
              </p>
              <div className="p-3 rounded-md bg-background-50 border border-background-200 text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                {sprintContent.reading_material}
              </div>
            </div>
          )}

          {sprintContent.exercises && sprintContent.exercises.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                Bài tập ({sprintContent.exercises.length} bài)
              </p>
              <div className="space-y-1.5">
                {sprintContent.exercises.map((ex, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm text-foreground-600">
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 text-[10px] font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="truncate">{ex.instruction}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Session Materials from Admin (sessions_data) */}
          {sprintContent.sessions_data && sprintContent.sessions_data.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">
                Tài liệu các buổi học
              </p>
              <div className="space-y-2">
                {sprintContent.sessions_data.map((sess) => (
                  <div key={sess.session_number} className="p-3 rounded-lg bg-background-50 border border-background-200">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-700 text-xs font-bold">
                        {sess.session_number}
                      </span>
                      <span className="text-sm font-semibold text-foreground-700">
                        {sess.title || `Buổi ${sess.session_number}`}
                      </span>
                    </div>
                    {sess.description && (
                      <p className="text-xs text-foreground-500 pl-8 mb-2 leading-relaxed">{sess.description}</p>
                    )}
                    {sess.materials && sess.materials.length > 0 ? (
                      <div className="space-y-1.5 pl-8">
                        {sess.materials.map((mat, mIdx) => (
                          <a
                            key={mIdx}
                            href={mat.file_path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 rounded-md bg-background-100 hover:bg-background-200 border border-background-200/70 transition-colors cursor-pointer group"
                          >
                            <i className="ri-file-line text-foreground-400 group-hover:text-primary-500 transition-colors"></i>
                            <span className="text-sm text-foreground-600 group-hover:text-primary-600 transition-colors truncate">
                              {mat.file_name}
                            </span>
                            {mat.file_size && (
                              <span className="text-xs text-foreground-400 flex-shrink-0 whitespace-nowrap">
                                {(mat.file_size / 1024).toFixed(0)} KB
                              </span>
                            )}
                            <i className="ri-external-link-line text-xs text-foreground-400 group-hover:text-primary-500 transition-colors ml-auto"></i>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-foreground-400 pl-8">Chưa có tài liệu</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Pending Sprint: Saturday unlock info */}
      {isPending && (
        <div className="p-5 rounded-lg bg-accent-50 border border-accent-200 text-center">
          <div className="w-14 h-14 mx-auto mb-3 flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600">
            <i className="ri-calendar-check-line text-2xl"></i>
          </div>
          <h3 className="font-heading text-base font-bold text-foreground-950 mb-1">
            Sprint {sprintNumber} Sẽ Mở Khóa Vào Thứ 7
          </h3>
          <p className="text-sm text-foreground-500 mb-4 max-w-sm mx-auto">
            Cả 3 buổi học sẽ được mở khóa cùng lúc vào Thứ 7. Hãy kiên nhẫn chờ nhé!
          </p>
          <button
            type="button"
            onClick={onStartSprint}
            disabled={isStarting}
            className="inline-flex items-center px-6 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 transition-colors duration-200 cursor-pointer whitespace-nowrap"
          >
            {isStarting ? (
              <>
                <div className="w-4 h-4 border-2 border-background-50 border-t-transparent rounded-full animate-spin mr-2"></div>
                Đang kiểm tra...
              </>
            ) : (
              <>
                <i className="ri-refresh-line mr-1.5"></i>
                Kiểm Tra Mở Khóa
              </>
            )}
          </button>
        </div>
      )}

      {/* Active session callout */}
      {!isPending && activeSession && (
        <div className="p-4 rounded-lg bg-primary-50 border border-primary-200/50 animate-fadeScaleIn">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-500">
              <i className="ri-arrow-right-line text-xs text-background-50"></i>
            </div>
            <span className="text-sm font-semibold text-primary-700">
              {t("dashboard.session")} {activeSession.session_number}: {getSessionLabel(activeSession.session_type)}
            </span>
          </div>
          <p className="text-sm text-primary-600 sm:ml-8">
            {activeSession.session_type === "self_study"
              ? t("dashboard.selfStudyActiveDesc")
              : t("dashboard.liveSessionActiveDesc")}
          </p>
          {activeSession.session_type === "self_study" && (
            <Link
              to={`/dashboard/sprint/${sprintId}/session/${activeSession.id}`}
              className="ml-0 sm:ml-8 mt-3 inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              <i className="ri-file-text-line mr-1.5"></i>
              {t("dashboard.submitSummary")}
            </Link>
          )}
          {(activeSession.session_type === "live_session" || activeSession.session_type === "vietnamese_teacher" || activeSession.session_type === "foreign_teacher") && (
            <div className="ml-0 sm:ml-8 mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Link
                to={`/dashboard/sprint/${sprintId}/session/${activeSession.id}`}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-vidicon-line mr-1.5"></i>
                {t("dashboard.joinSession")}
              </Link>
              {activeSession.meeting_link && (
                <a
                  href={activeSession.meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-external-link-line"></i>
                  {t("dashboard.joinDirectly")}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* "Book a session" prompt for available sessions */}
      {!isPending && hasBookableSessions && !activeSession && (
        <div className="p-4 rounded-lg bg-accent-50 border border-accent-200">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 flex items-center justify-center rounded-full bg-accent-500">
              <i className="ri-calendar-check-line text-xs text-background-50"></i>
            </div>
            <span className="text-sm font-semibold text-accent-800">{t("dashboard.bookYourSessions")}</span>
          </div>
          <p className="text-sm text-accent-700 sm:ml-8 mb-3">
            {t("dashboard.bookYourSessionsDesc")}
          </p>
          <div className="sm:ml-8">
            <Link
              to="/dashboard/book"
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              <i className="ri-calendar-line mr-1.5"></i>
              {t("dashboard.bookAClass")}
            </Link>
          </div>
        </div>
      )}

      {/* Session Pipeline */}
      <div className="space-y-2">
        {sessions.map((session) => {
          const isAbsent = session.status === "absent";
          const isCompleted = session.status === "completed";
          const isAwaitingFeedback = session.status === "awaiting_feedback";
          const isActive = session.status === "in_progress" || session.status === "active";
          const isAvailable = session.status === "available";
          const isLocked = session.status === "locked";
          const isUnlocking = justUnlockedIds.has(session.id);
          const iconColor = getSessionColor(session.session_type, session.status);

          return (
            <div
              key={session.id}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-500 ${
                isAbsent ? "bg-accent-50/40 border border-accent-200/50" :
                isActive ? "bg-primary-50 border border-primary-200/50" :
                isCompleted ? "bg-background-100/60" :
                isAwaitingFeedback ? "bg-secondary-50/60 border border-secondary-100/50" :
                isAvailable ? "bg-accent-50/60 border border-accent-100/50" :
                "bg-background-100/40"
              }`}
            >
              {/* Icon */}
              <div
                className={`w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 transition-all duration-500 ${iconColor} ${isActive ? "ring-2 ring-primary-200" : ""} ${isUnlocking ? "animate-[unlockPulse_0.7s_ease-out]" : ""}`}
              >
                <i
                  className={`${getSessionIcon(session.session_type, session.status)} text-base ${isUnlocking ? "animate-[unlockIconSwap_0.5s_ease-out]" : ""} transition-colors duration-500`}
                ></i>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold whitespace-nowrap ${
                    isAbsent ? "text-accent-700" :
                    isActive ? "text-primary-700" : isCompleted ? "text-accent-700" : isAwaitingFeedback ? "text-secondary-700" : isAvailable ? "text-accent-700" : isPending ? "text-foreground-400" : "text-foreground-500"
                  }`}>
                    {t("dashboard.session")} {session.session_number}
                  </span>
                  <span className="text-sm text-foreground-400 whitespace-nowrap">
                    {getSessionLabel(session.session_type)}
                  </span>
                  {isAbsent && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600 bg-accent-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <i className="ri-user-unfollow-line text-[10px]"></i>
                      Vắng học
                    </span>
                  )}
                  {session.scheduled_at && (
                    <span className="text-xs text-foreground-400 hidden sm:inline whitespace-nowrap">
                      · {formatSchedule(session.scheduled_at)}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex-shrink-0">
                {isAbsent && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-accent-50 text-accent-600 border border-accent-200 whitespace-nowrap">
                    <i className="ri-user-unfollow-line mr-1"></i>Vắng học
                  </span>
                )}
                {isCompleted && (
                  <Link
                    to={`/dashboard/sprint/${sprintId}/session/${session.id}`}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-background-200 text-foreground-500 hover:bg-background-300 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-eye-line mr-1"></i>Xem
                  </Link>
                )}
                {isAwaitingFeedback && (
                  <Link
                    to={`/dashboard/sprint/${sprintId}/session/${session.id}`}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-eye-line mr-1"></i>Xem
                  </Link>
                )}
                {isAvailable && (
                  <Link
                    to={session.session_type === "self_study" 
                      ? `/dashboard/sprint/${sprintId}/session/${session.id}`
                      : "/dashboard/book"
                    }
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-accent-100 text-accent-700 hover:bg-accent-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className={session.session_type === "self_study" ? "ri-file-text-line mr-1" : "ri-calendar-line mr-1"}></i>
                    {session.session_type === "self_study" ? "Nộp Bài" : t("dashboard.book")}
                  </Link>
                )}
                {isLocked && (
                  <span className="inline-flex items-center text-xs text-foreground-400">
                    <i className="ri-lock-line mr-1"></i>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* All sessions completed — link to Sprint Complete */}
      {allSessionsCompleted && (
        <div className="pt-4 border-t border-background-200">
          <Link
            to={`/dashboard/sprint/${sprintId}/complete`}
            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
          >
            <i className="ri-trophy-line mr-1.5"></i>
            View Sprint Summary
          </Link>
        </div>
      )}
    </div>
  );
}