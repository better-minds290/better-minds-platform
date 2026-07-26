import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface LessonData {
  id: string;
  sprintId: string;
  sprintNumber: number;
  sessionNumber: number;
  sessionType: string;
  teacherName: string;
  scheduledAt: string;
  status: string;
  meetingLink: string | null;
  classId: string | null;
  courseName: string | null;
  courseLevel: string | null;
}

interface ClassMaterial {
  id: string;
  class_id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
}

function formatDateTime(isoString: string): { date: string; time: string; relative: string } {
  const date = new Date(isoString);
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const day = dayNames[date.getDay()];
  const month = monthNames[date.getMonth()];
  const dateNum = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  const dateStr = `${day}, ${month} ${dateNum}`;
  const timeStr = `${hours}:${minutes}`;

  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  let relative = "";
  if (diffDays === 0) relative = "Today";
  else if (diffDays === 1) relative = "Tomorrow";
  else if (diffDays < 7) relative = `in ${diffDays} days`;
  else relative = `in ${Math.ceil(diffDays / 7)} week${Math.ceil(diffDays / 7) > 1 ? "s" : ""}`;

  return { date: dateStr, time: timeStr, relative };
}

function getFileIcon(fileType: string): string {
  const ext = (fileType || "").toLowerCase();
  if (ext.includes("pdf")) return "ri-file-pdf-line";
  if (ext.includes("doc") || ext.includes("word")) return "ri-file-word-line";
  if (ext.includes("ppt") || ext.includes("presentation")) return "ri-file-ppt-line";
  if (ext.includes("image") || ext.includes("png") || ext.includes("jpg") || ext.includes("jpeg")) return "ri-image-line";
  if (ext.includes("audio") || ext.includes("mp3") || ext.includes("wav")) return "ri-music-line";
  if (ext.includes("video") || ext.includes("mp4")) return "ri-video-line";
  return "ri-file-line";
}

function getFileColor(fileType: string): string {
  const ext = (fileType || "").toLowerCase();
  if (ext.includes("pdf")) return "text-accent-500";
  if (ext.includes("doc") || ext.includes("word")) return "text-primary-500";
  if (ext.includes("ppt") || ext.includes("presentation")) return "text-secondary-500";
  if (ext.includes("image") || ext.includes("png") || ext.includes("jpg") || ext.includes("jpeg")) return "text-primary-400";
  if (ext.includes("audio") || ext.includes("mp3") || ext.includes("wav")) return "text-accent-400";
  return "text-foreground-400";
}

export default function UpcomingLessons({ lessons, materials }: { lessons: LessonData[]; materials: ClassMaterial[] }) {
  const { t } = useTranslation();

  const getTypeBadge = (sessionType: string): { icon: string; label: string; color: string } => {
    switch (sessionType) {
      case "self_study":
        return { icon: "ri-book-open-line", label: t("dashboard.selfStudy"), color: "bg-secondary-100 text-secondary-700" };
      case "live_session":
        return { icon: "ri-user-voice-line", label: t("dashboard.liveSession"), color: "bg-accent-100 text-accent-700" };
      case "vietnamese_teacher":
        return { icon: "ri-user-voice-line", label: t("dashboard.vietnameseTeacher"), color: "bg-primary-100 text-primary-700" };
      case "foreign_teacher":
        return { icon: "ri-global-line", label: t("dashboard.foreignTeacher"), color: "bg-accent-100 text-accent-700" };
      default:
        return { icon: "ri-calendar-line", label: t("dashboard.session"), color: "bg-background-200 text-foreground-600" };
    }
  };

  return (
    <div className="bg-background-50 border border-background-200 rounded-lg p-6 md:p-7">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-heading text-lg font-bold text-foreground-950">
          {t("dashboard.upcomingLessons")}
        </h2>
        <span className="text-xs text-foreground-400 bg-background-100 px-2.5 py-1 rounded-full whitespace-nowrap">
          {lessons.length} {t("dashboard.sessions")}
        </span>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-100 mb-3">
            <i className="ri-calendar-line text-xl text-foreground-400"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("dashboard.noUpcoming")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lessons.map((lesson) => {
            const { date, time, relative } = formatDateTime(lesson.scheduledAt);
            const badge = getTypeBadge(lesson.sessionType);
            const lessonMaterials = materials.filter((m) => m.class_id === lesson.classId);

            return (
              <div
                key={lesson.id}
                className="rounded-lg bg-background-50 border border-background-100 hover:border-background-200 transition-colors duration-200 group overflow-hidden"
              >
                <div className="flex items-start gap-3 p-4">
                  {/* Date block */}
                  <div className="flex-shrink-0 w-12 text-center pt-0.5">
                    <p className="text-xs font-semibold text-foreground-500 uppercase">{relative}</p>
                    <p className="text-base font-bold text-foreground-950 leading-tight">{time}</p>
                  </div>

                  {/* Lesson info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {lesson.courseName && (
                        <span className="text-xs font-semibold text-foreground-500 bg-background-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                          {lesson.courseName}
                          {lesson.courseLevel && <span className="ml-1 text-foreground-400">· {lesson.courseLevel}</span>}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-foreground-800 whitespace-nowrap">
                        Sprint {lesson.sprintNumber} · Session {lesson.sessionNumber}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${badge.color}`}>
                        <i className={`${badge.icon} text-[10px]`}></i>
                        {badge.label}
                      </span>
                    </div>
                    {lesson.teacherName && (
                      <p className="text-sm text-foreground-600 flex items-center gap-1.5">
                        <i className="ri-user-line text-xs text-foreground-400"></i>
                        {lesson.teacherName}
                      </p>
                    )}
                    {lesson.meetingLink && (
                      <a
                        href={lesson.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 mt-0.5 cursor-pointer"
                      >
                        <i className="ri-external-link-line"></i>
                        {t("liveLesson.joinNow")}
                      </a>
                    )}
                    <Link
                      to={`/dashboard/sprint/${lesson.sprintId}/session/${lesson.id}`}
                      className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-arrow-right-circle-line"></i>
                      Vào buổi học
                    </Link>
                  </div>
                </div>

                {/* Materials section */}
                {lessonMaterials.length > 0 && (
                  <div className="border-t border-background-100 bg-background-50 px-4 py-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <i className="ri-folder-line text-xs text-foreground-400"></i>
                      <span className="text-xs font-medium text-foreground-500">
                        {t("dashboard.lessonMaterials")}
                      </span>
                      <span className="text-[10px] text-foreground-300 ml-auto">{lessonMaterials.length} file{lessonMaterials.length > 1 ? "s" : ""}</span>
                    </div>
                    <div className="space-y-1.5">
                      {lessonMaterials.map((mat) => (
                        <a
                          key={mat.id}
                          href={mat.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-background-100 hover:bg-background-200 transition-colors cursor-pointer group/material"
                        >
                          <i className={`${getFileIcon(mat.file_type)} ${getFileColor(mat.file_type)} text-sm`}></i>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground-700 truncate group-hover/material:text-primary-600 transition-colors">
                              {mat.title || mat.file_name}
                            </p>
                            {mat.description && (
                              <p className="text-[11px] text-foreground-400 truncate mt-0.5">{mat.description}</p>
                            )}
                          </div>
                          <i className="ri-download-line text-xs text-foreground-400 group-hover/material:text-primary-500 transition-colors flex-shrink-0"></i>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}