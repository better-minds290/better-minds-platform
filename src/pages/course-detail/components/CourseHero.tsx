import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface CourseHeroProps {
  name: string;
  level: string;
  description: string;
  totalSprints: number;
  totalHours: number;
  isEnrolled: boolean;
  onEnrollClick: () => void;
}

const TRUNCATE_LENGTH = 160;

function truncateDescription(text: string): string {
  if (!text) return "";
  if (text.length <= TRUNCATE_LENGTH) return text;
  return text.slice(0, TRUNCATE_LENGTH).trimEnd() + "...";
}

export default function CourseHero({
  name,
  level,
  description,
  totalSprints,
  totalHours,
  isEnrolled,
  onEnrollClick,
}: CourseHeroProps) {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden bg-background-50">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 50%, oklch(var(--primary-500)) 0%, transparent 50%), radial-gradient(circle at 80% 20%, oklch(var(--accent-500)) 0%, transparent 50%)",
        }}
      />
      <div className="relative max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-foreground-500 mb-6">
          <Link
            to="/dashboard"
            className="hover:text-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t("course.breadcrumbDashboard")}
          </Link>
          <i className="ri-arrow-right-s-line text-xs"></i>
          <Link
            to="/courses"
            className="text-foreground-400 hover:text-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t("course.breadcrumbCourses")}
          </Link>
          <i className="ri-arrow-right-s-line text-xs"></i>
          <span className="text-foreground-700 font-medium truncate">
            {name}
          </span>
        </nav>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          {/* Left: Course info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 whitespace-nowrap">
                {level}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-500 whitespace-nowrap">
                <i className="ri-time-line"></i>
                {totalHours}h total
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-500 whitespace-nowrap">
                <i className="ri-flag-line"></i>
                {totalSprints} {t("course.sprints")}
              </span>
            </div>

            <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground-950 mb-4">
              {name}
            </h1>

            <p className="text-sm text-foreground-600 leading-relaxed max-w-2xl">
              {truncateDescription(description)}
            </p>
          </div>

          {/* Right: Enroll CTA */}
          <div className="shrink-0 lg:pt-0 pt-0">
            {isEnrolled ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold bg-accent-500 text-background-50 hover:bg-accent-600 transition-all duration-200 whitespace-nowrap cursor-pointer shadow-lg shadow-accent-500/20"
              >
                <i className="ri-dashboard-line text-lg"></i>
                {t("course.joinNow")}
              </Link>
            ) : (
              <button
                onClick={onEnrollClick}
                className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold bg-primary-500 text-background-50 hover:bg-primary-600 transition-all duration-200 whitespace-nowrap cursor-pointer shadow-lg shadow-primary-500/20 animate-pulse"
              >
                <i className="ri-add-circle-line text-lg"></i>
                {t("course.enrollNow")}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}