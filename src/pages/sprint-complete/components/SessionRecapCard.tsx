import { useTranslation } from "react-i18next";
import { formatVietnamDateTime } from "@/lib/datetime";

interface RecapSession {
  id: string;
  session_number: number;
  session_type: string;
  teacher_name: string | null;
  scheduled_at: string | null;
  status: string;
  completed_at: string | null;
  feedback: string | null;
  lesson_summary: string | null;
  completion_rating: number | null;
  materials?: Array<{
    id: string;
    title: string | null;
    file_name: string;
    file_url: string;
    file_type: string;
    file_size: number;
    description: string | null;
    created_at: string;
  }>;
}

interface SessionRecapCardProps {
  session: RecapSession;
  index: number;
  total: number;
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) return "";
  return formatVietnamDateTime(isoString, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }, "en-US");
}

function getSessionTypeIcon(type: string): string {
  switch (type) {
    case "self_study": return "ri-book-open-line";
    case "vietnamese_teacher": return "ri-user-voice-line";
    case "foreign_teacher": return "ri-global-line";
    default: return "ri-calendar-line";
  }
}

function getSessionTypeColor(type: string): string {
  switch (type) {
    case "self_study": return "bg-primary-100 text-primary-700";
    case "vietnamese_teacher": return "bg-secondary-100 text-secondary-700";
    case "foreign_teacher": return "bg-accent-100 text-accent-700";
    default: return "bg-background-200 text-foreground-600";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string): string {
  if (fileType.includes("pdf")) return "ri-file-pdf-line";
  if (fileType.includes("image")) return "ri-image-line";
  if (fileType.includes("word") || fileType.includes("document")) return "ri-file-word-line";
  if (fileType.includes("sheet") || fileType.includes("excel")) return "ri-file-excel-line";
  if (fileType.includes("presentation") || fileType.includes("powerpoint")) return "ri-file-ppt-line";
  if (fileType.includes("video")) return "ri-video-line";
  if (fileType.includes("audio")) return "ri-music-line";
  if (fileType.includes("zip") || fileType.includes("rar") || fileType.includes("archive")) return "ri-file-zip-line";
  return "ri-file-text-line";
}

export default function SessionRecapCard({ session, index, total }: SessionRecapCardProps) {
  const { t } = useTranslation();

  const getSessionLabel = (type: string): string => {
    switch (type) {
      case "self_study": return t("complete.selfStudy");
      case "vietnamese_teacher": return t("complete.vietnameseTeacher");
      case "foreign_teacher": return t("complete.foreignTeacher");
      default: return type;
    }
  };

  const isSessionOne = session.session_number === 1;
  const materials = session.materials || [];

  let parsedSummary: Record<string, unknown> | null = null;
  if (session.lesson_summary) {
    try {
      parsedSummary = JSON.parse(session.lesson_summary);
    } catch {
      parsedSummary = null;
    }
  }

  return (
    <div className="bg-background-50 border border-background-200 rounded-lg overflow-hidden">
      {/* Session header */}
      <div className="flex items-center gap-4 p-5 border-b border-background-100">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 ${getSessionTypeColor(session.session_type)}`}>
            <i className={`${getSessionTypeIcon(session.session_type)} text-lg`}></i>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground-900 whitespace-nowrap">
                {t("complete.session")} {session.session_number}: {getSessionLabel(session.session_type)}
              </h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                <i className="ri-check-line mr-1 text-[10px]"></i>
                {t("complete.completed")}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {session.teacher_name && (
                <span className="text-xs text-foreground-500 whitespace-nowrap">
                  <i className="ri-user-line mr-1"></i>
                  {session.teacher_name}
                </span>
              )}
              {session.scheduled_at && (
                <span className="text-xs text-foreground-400 whitespace-nowrap">
                  <i className="ri-time-line mr-1"></i>
                  {formatDateTime(session.scheduled_at)}
                </span>
              )}
              {session.completed_at && (
                <span className="text-xs text-foreground-400 whitespace-nowrap">
                  <i className="ri-check-double-line mr-1"></i>
                  {formatDateTime(session.completed_at)}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Step indicator */}
        <div className="hidden sm:flex items-center gap-1 text-xs font-medium text-foreground-400 whitespace-nowrap">
          {index + 1} {t("complete.of")} {total}
        </div>
      </div>

      {/* Session body */}
      <div className="p-5 space-y-4">
        {/* Self-Study: parsed summary */}
        {session.session_type === "self_study" && parsedSummary && (
          <div className="space-y-3">
            {parsedSummary.what_learned && (
              <div>
                <h4 className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                  {t("complete.whatILearned")}
                </h4>
                <p className="text-sm text-foreground-700 leading-relaxed">
                  {String(parsedSummary.what_learned)}
                </p>
              </div>
            )}
            {parsedSummary.questions && String(parsedSummary.questions).trim() && (
              <div>
                <h4 className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                  {t("complete.questionsForTeacher")}
                </h4>
                <p className="text-sm text-foreground-600 italic leading-relaxed">
                  {String(parsedSummary.questions)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Teacher feedback — hidden for Session 1 */}
        {!isSessionOne && session.feedback && (
          <div className="p-4 rounded-md bg-secondary-50 border border-secondary-200/50">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-secondary-200">
                <i className="ri-chat-1-line text-xs text-secondary-600"></i>
              </div>
              <h4 className="text-sm font-semibold text-secondary-700">
                {t("complete.teacherFeedback")}
                {session.teacher_name ? ` — ${session.teacher_name}` : ""}
              </h4>
            </div>
            <p className="text-sm text-foreground-700 leading-relaxed ml-8">
              {session.feedback}
            </p>
          </div>
        )}

        {/* Session 1: no-feedback notice */}
        {isSessionOne && (
          <div className="p-3 rounded-md bg-background-100 border border-background-200">
            <p className="text-xs text-foreground-500 italic flex items-center gap-1.5">
              <i className="ri-information-line"></i>
              {t("complete.sessionOneNote")}
            </p>
          </div>
        )}

        {/* Rating — hidden for Session 1 */}
        {!isSessionOne && session.completion_rating && session.completion_rating > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground-500">{t("complete.rating")}:</span>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <i
                  key={star}
                  className={`text-sm ${
                    star <= session.completion_rating!
                      ? "ri-star-fill text-secondary-400"
                      : "ri-star-line text-foreground-300"
                  }`}
                ></i>
              ))}
            </div>
            <span className="text-sm font-bold text-foreground-900">{session.completion_rating}/5</span>
          </div>
        )}

        {/* Class Materials */}
        {materials.length > 0 && (
          <div className="p-4 rounded-md bg-background-100 border border-background-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-primary-200">
                <i className="ri-folder-line text-xs text-primary-600"></i>
              </div>
              <h4 className="text-sm font-semibold text-foreground-700">
                {t("complete.sessionMaterialsTitle")}
              </h4>
              <span className="text-xs text-foreground-400">({materials.length})</span>
            </div>
            <div className="space-y-2 ml-8">
              {materials.map((mat) => (
                <a
                  key={mat.id}
                  href={mat.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-2.5 rounded-md bg-background-50 border border-background-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors cursor-pointer group"
                >
                  <div className="w-8 h-8 flex items-center justify-center rounded-md bg-primary-100 text-primary-600 flex-shrink-0">
                    <i className={`${getFileIcon(mat.file_type)} text-sm`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-800 group-hover:text-primary-700 transition-colors truncate">
                      {mat.title || mat.file_name}
                    </p>
                    <p className="text-xs text-foreground-400 flex items-center gap-2">
                      <span>{mat.file_name}</span>
                      <span>·</span>
                      <span>{formatFileSize(mat.file_size)}</span>
                    </p>
                  </div>
                  <div className="w-7 h-7 flex items-center justify-center rounded-full bg-background-200 group-hover:bg-primary-100 transition-colors flex-shrink-0">
                    <i className="ri-download-line text-xs text-foreground-500 group-hover:text-primary-600"></i>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* No materials notice — only for sessions that would typically have them */}
        {materials.length === 0 && session.session_type !== "self_study" && (
          <div className="p-3 rounded-md bg-background-100 border border-background-200 border-dashed">
            <p className="text-xs text-foreground-400 italic flex items-center gap-1.5">
              <i className="ri-file-forbid-line"></i>
              {t("complete.noMaterialsNote")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}