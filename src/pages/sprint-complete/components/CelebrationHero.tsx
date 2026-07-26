import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface CelebrationHeroProps {
  sprintNumber: number;
  courseName: string;
  courseLevel: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  totalSessions: number;
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const startDay = startDate.getUTCDate();
  const startMonth = monthNames[startDate.getUTCMonth()];
  const endDay = endDate.getUTCDate();
  const endMonth = monthNames[endDate.getUTCMonth()];

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} – ${endDay}, ${endDate.getUTCFullYear()}`;
  }
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${endDate.getUTCFullYear()}`;
}

export default function CelebrationHero({
  sprintNumber,
  courseName,
  courseLevel,
  startDate,
  endDate,
  durationDays,
  totalSessions,
}: CelebrationHeroProps) {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden rounded-lg bg-gradient-to-br from-background-50 via-primary-50/40 to-accent-50/30 border border-background-200">
      {/* Decorative circles */}
      <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-primary-100/30 -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-accent-100/40 translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/3 w-24 h-24 rounded-full bg-secondary-100/30 -translate-y-1/2 pointer-events-none"></div>

      <div className="relative px-6 md:px-10 py-10 md:py-14 text-center">
        {/* Trophy icon */}
        <div className="w-20 h-20 mx-auto mb-5 flex items-center justify-center rounded-full bg-accent-100">
          <i className="ri-trophy-line text-4xl text-accent-600"></i>
        </div>

        <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground-950 mb-2">
          {t("complete.congratulations")}
        </h1>
        <p className="text-lg text-foreground-600 mb-1">
          {t("complete.sprintCompleted")} {sprintNumber}
        </p>
        <p className="text-sm text-foreground-500 mb-6">
          {courseName} · {courseLevel}
        </p>

        {/* Stats row */}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
          <div className="flex flex-col items-center">
            <span className="text-xs font-medium text-foreground-400 uppercase tracking-wider mb-1">{t("complete.duration")}</span>
            <span className="text-2xl font-bold text-foreground-950">{durationDays}</span>
            <span className="text-xs text-foreground-500">{t("complete.days")}</span>
          </div>
          <div className="w-px h-10 bg-background-200 hidden sm:block"></div>
          <div className="flex flex-col items-center">
            <span className="text-xs font-medium text-foreground-400 uppercase tracking-wider mb-1">{t("complete.sessionsCompleted")}</span>
            <span className="text-2xl font-bold text-foreground-950">{totalSessions}/{totalSessions}</span>
            <span className="text-xs text-foreground-500">{t("complete.sessions")}</span>
          </div>
          <div className="w-px h-10 bg-background-200 hidden sm:block"></div>
          <div className="flex flex-col items-center">
            <span className="text-xs font-medium text-foreground-400 uppercase tracking-wider mb-1">{t("complete.period")}</span>
            <span className="text-sm font-semibold text-foreground-700 whitespace-nowrap">
              {formatDateRange(startDate, endDate)}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center px-6 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            <i className="ri-dashboard-line mr-1.5"></i>
            {t("complete.backToDashboard")}
          </Link>
        </div>
      </div>
    </section>
  );
}