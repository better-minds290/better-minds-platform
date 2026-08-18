import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatVietnamDate } from "@/lib/datetime";

interface SprintSessionSummary {
  session_number: number;
  session_type: string;
  teacher_name: string | null;
  status: string;
  completed_at: string | null;
  feedback: string | null;
}

interface SprintEntry {
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

interface SprintTimelineProps {
  sprints: SprintEntry[];
  courseName: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return formatVietnamDate(iso, {
    month: "short",
    day: "numeric",
  }, "en-US");
}

function formatDateRange(
  createdAt: string | null,
  completedAt: string | null
): string {
  if (!createdAt) return "TBD";
  const start = formatDate(createdAt);
  const end = completedAt ? formatDate(completedAt) : "Now";
  return `${start} — ${end}`;
}

function sessionTypeLabel(
  sessionType: string,
  t: (key: string) => string
): string {
  switch (sessionType) {
    case "self_study":
      return t("course.sessionSelfStudy");
    case "vietnamese_teacher":
      return t("course.sessionVNTeacher");
    case "foreign_teacher":
      return t("course.sessionForeignTeacher");
    default:
      return sessionType;
  }
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-accent-500";
    case "in_progress":
      return "bg-primary-500 ring-2 ring-primary-200";
    case "locked":
      return "bg-foreground-300";
    default:
      return "bg-foreground-300";
  }
}

export default function SprintTimeline({
  sprints,
  courseName,
}: SprintTimelineProps) {
  const { t } = useTranslation();

  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14 bg-background-100/50">
      <div className="mb-8">
        <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground-950 mb-2">
          {t("course.timelineTitle")}
        </h2>
        <p className="text-sm text-foreground-500">
          {t("course.timelineSubtitle")}
        </p>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-3 bottom-3 w-px bg-background-300 hidden sm:block"></div>

        <div className="space-y-6">
          {sprints.map((sprint, idx) => {
            const isCompleted = sprint.status === "completed";
            const isActive = sprint.status === "active";
            const isPending = sprint.status === "pending";
            // A pending sprint is locked if the previous sprint is NOT completed
            const isLocked = isPending && idx > 0 && sprints[idx - 1].status !== "completed";

            return (
              <div key={sprint.id} className="relative flex gap-5">
                {/* Timeline dot */}
                <div className="relative z-10 shrink-0 hidden sm:block">
                  <div
                    className={`w-10 h-10 flex items-center justify-center rounded-full border-2 text-sm font-bold ${
                      isCompleted
                        ? "bg-accent-500 text-background-50 border-accent-500"
                        : isActive
                          ? "bg-primary-500 text-background-50 border-primary-500 ring-4 ring-primary-100"
                          : isLocked
                            ? "bg-background-50 text-foreground-300 border-foreground-200"
                            : "bg-background-50 text-foreground-400 border-foreground-300"
                    }`}
                  >
                    {isCompleted ? (
                      <i className="ri-check-line"></i>
                    ) : isLocked ? (
                      <i className="ri-lock-line text-sm"></i>
                    ) : (
                      sprint.sprint_number
                    )}
                  </div>
                </div>

                {/* Sprint card */}
                <div
                  className={`flex-1 rounded-xl border p-5 transition-all ${
                    isActive
                      ? "bg-background-50 border-primary-300 shadow-[0_0_0_1px_rgba(var(--primary-500),0.1)]"
                      : isCompleted
                        ? "bg-background-50 border-background-200/70"
                        : isLocked
                          ? "bg-background-100/80 border-background-200/40 opacity-60"
                          : "bg-background-50 border-background-200/50 opacity-70"
                  }`}
                >
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`sm:hidden w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold ${
                        isLocked ? "bg-background-200 text-foreground-400" : "bg-background-100 text-foreground-500"
                      }`}>
                        {isLocked ? <i className="ri-lock-line text-xs"></i> : sprint.sprint_number}
                      </span>
                      <h3 className="font-heading text-base font-semibold text-foreground-950">
                        {t("course.sprint")} {sprint.sprint_number}
                      </h3>
                      {isCompleted && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                          <i className="ri-check-line text-xs"></i>
                          {t("course.sprintCompleted")}
                        </span>
                      )}
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse"></span>
                          {t("course.sprintActive")}
                        </span>
                      )}
                      {isLocked && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-foreground-100 text-foreground-400 whitespace-nowrap">
                          <i className="ri-lock-line text-xs"></i>
                          {t("course.sprintLocked")}
                        </span>
                      )}
                      {isPending && !isLocked && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-foreground-100 text-foreground-500 whitespace-nowrap">
                          {t("course.sprintUpcoming")}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-foreground-400 whitespace-nowrap">
                      {isLocked ? t("course.completePreviousFirst") : formatDateRange(sprint.created_at, sprint.completed_at)}
                    </span>
                  </div>

                  {/* Session pipeline */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    {sprint.sessions.map((session) => (
                      <div
                        key={session.session_number}
                        className={`flex-1 flex items-center gap-3 p-3 rounded-lg ${
                          isLocked ? "bg-background-200/50" : "bg-background-100/70"
                        }`}
                      >
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isLocked ? "bg-foreground-300" : sessionStatusColor(session.status)
                          }`}
                        ></div>
                        <div className="min-w-0">
                          <p className={`text-xs font-medium whitespace-nowrap ${
                            isLocked ? "text-foreground-400" : "text-foreground-700"
                          }`}>
                            {sessionTypeLabel(session.session_type, t)}
                          </p>
                          <p className="text-[11px] text-foreground-400 mt-0.5">
                            {isLocked ? "🔒 " + t("course.locked") : session.teacher_name || t("course.noTeacher")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Link to sprint completion if done */}
                  {isCompleted && (
                    <div className="mt-3 pt-3 border-t border-background-200/50">
                      <Link
                        to={`/dashboard/sprint/${sprint.id}/complete`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-eye-line"></i>
                        {t("course.viewRecap")}
                        <i className="ri-arrow-right-line text-[10px]"></i>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}