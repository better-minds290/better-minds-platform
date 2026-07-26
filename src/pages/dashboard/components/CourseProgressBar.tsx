import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface CourseProgressBarProps {
  completedSprints: number;
  totalSprints: number;
  courseName: string | null;
  courseLevel: string | null;
}

export default function CourseProgressBar({
  completedSprints,
  totalSprints,
  courseName,
  courseLevel,
}: CourseProgressBarProps) {
  const { t } = useTranslation();
  const [animatedWidth, setAnimatedWidth] = useState(0);

  const percentage = totalSprints > 0 ? Math.round((completedSprints / totalSprints) * 100) : 0;
  const clampedPercentage = Math.min(100, Math.max(0, percentage));

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedWidth(clampedPercentage), 150);
    return () => clearTimeout(timer);
  }, [clampedPercentage]);

  const getProgressColor = (pct: number): string => {
    if (pct >= 100) return "bg-accent-500";
    if (pct >= 50) return "bg-primary-500";
    if (pct >= 25) return "bg-accent-400";
    return "bg-primary-400";
  };

  const getLabel = (pct: number): string => {
    if (pct >= 100) return "dashboard.progressComplete";
    if (pct >= 50) return "dashboard.progressHalfway";
    if (pct > 0) return "dashboard.progressStarted";
    return "dashboard.progressJustStarted";
  };

  if (totalSprints === 0) return null;

  return (
    <div className="bg-background-50 border border-background-200 rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-1">
            {t("dashboard.courseProgress")}
          </p>
          <h3 className="font-heading text-base font-bold text-foreground-950">
            {courseName || t("dashboard.yourCourse")}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {courseLevel && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary-100 text-secondary-700 whitespace-nowrap">
              {courseLevel}
            </span>
          )}
          <span className="text-sm font-medium text-foreground-600 whitespace-nowrap">
            <strong className="text-foreground-950 tabular-nums">{completedSprints}</strong>
            <span className="text-foreground-400"> / {totalSprints}</span>
            <span className="text-foreground-400 ml-1">{t("dashboard.sprints")}</span>
          </span>
        </div>
      </div>

      {/* Progress bar track */}
      <div className="relative">
        <div className="w-full h-3 rounded-full bg-background-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${getProgressColor(clampedPercentage)}`}
            style={{ width: `${animatedWidth}%` }}
          />
        </div>

        {/* Percentage badge */}
        <div
          className="absolute top-1/2 -translate-y-1/2 transition-all duration-1000 ease-out"
          style={{ left: `calc(${animatedWidth}% - 22px)` }}
        >
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
            clampedPercentage >= 100
              ? "bg-accent-500 text-background-50"
              : clampedPercentage >= 30
                ? "bg-primary-500 text-background-50"
                : "bg-background-200 text-foreground-600"
          }`}>
            {clampedPercentage}%
          </span>
        </div>
      </div>

      {/* Milestone markers */}
      <div className="flex justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${clampedPercentage >= 25 ? "bg-primary-400" : "bg-background-300"}`}></div>
          <span className="text-[11px] text-foreground-400">25%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${clampedPercentage >= 50 ? "bg-primary-500" : "bg-background-300"}`}></div>
          <span className="text-[11px] text-foreground-400">50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${clampedPercentage >= 75 ? "bg-accent-400" : "bg-background-300"}`}></div>
          <span className="text-[11px] text-foreground-400">75%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${clampedPercentage >= 100 ? "bg-accent-500" : "bg-background-300"}`}></div>
          <span className="text-[11px] text-foreground-400">100%</span>
        </div>
      </div>

      {/* Motivational label */}
      <p className="text-xs text-foreground-500 mt-3 text-center">
        {t(getLabel(clampedPercentage))}
        {clampedPercentage > 0 && clampedPercentage < 100 && (
          <span className="ml-1 font-semibold text-foreground-700">
            — {totalSprints - completedSprints} {t("dashboard.sprintsToGo")}
          </span>
        )}
      </p>
    </div>
  );
}