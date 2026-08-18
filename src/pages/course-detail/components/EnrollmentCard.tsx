import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatVietnamDate } from "@/lib/datetime";

interface EnrollmentCardProps {
  isEnrolled: boolean;
  enrollmentStatus: string | null;
  enrolledDate: string | null;
  isActive: boolean;
  onEnrollClick: () => void;
}

export default function EnrollmentCard({
  isEnrolled,
  enrollmentStatus,
  enrolledDate,
  isActive,
  onEnrollClick,
}: EnrollmentCardProps) {
  const { t } = useTranslation();

  const formatDate = (iso: string | null): string => {
    if (!iso) return "—";
    return formatVietnamDate(iso, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }, "en-US");
  };

  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14">
      <div className="bg-background-50 border border-background-200/70 rounded-2xl overflow-hidden">
        <div className="p-6 md:p-8">
          {isEnrolled ? (
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              {/* Left: Enrollment details */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-accent-100 text-accent-600 shrink-0">
                  <i className="ri-bookmark-line text-2xl"></i>
                </div>
                <div>
                  <h3 className="font-heading text-lg font-semibold text-foreground-950 mb-1">
                    {isActive
                      ? t("course.enrolledActive")
                      : t("course.enrolledTitle")}
                  </h3>
                  <p className="text-sm text-foreground-600 leading-relaxed mb-3">
                    {isActive
                      ? t("course.enrolledActiveDesc")
                      : t("course.enrolledDesc")}
                  </p>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-foreground-500 whitespace-nowrap">
                      <i className="ri-calendar-line text-foreground-400"></i>
                      {t("course.enrolledSince")}:{" "}
                      <strong className="text-foreground-700 font-medium">
                        {formatDate(enrolledDate)}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-dashboard-line"></i>
                  {t("course.goToDashboard")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              {/* Left: Not enrolled message */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-primary-100 text-primary-600 shrink-0">
                  <i className="ri-rocket-line text-2xl"></i>
                </div>
                <div>
                  <h3 className="font-heading text-lg font-semibold text-foreground-950 mb-1">
                    {t("course.notEnrolledTitle")}
                  </h3>
                  <p className="text-sm text-foreground-600 leading-relaxed">
                    {t("course.notEnrolledDesc")}
                  </p>
                </div>
              </div>

              {/* Right: Enroll button */}
              <button
                className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                onClick={onEnrollClick}
              >
                <i className="ri-add-circle-line"></i>
                {t("course.enrollNow")}
              </button>
            </div>
          )}
        </div>

        {/* What you get section */}
        {isEnrolled && (
          <div className="border-t border-background-200/70 px-6 md:px-8 py-5 bg-background-50">
            <div className="flex flex-wrap gap-3">
              {[
                { icon: "ri-book-open-line", textKey: "course.perkSelfStudy" },
                { icon: "ri-user-line", textKey: "course.perkVNTeacher" },
                { icon: "ri-global-line", textKey: "course.perkForeignTeacher" },
                { icon: "ri-feedback-line", textKey: "course.perkFeedback" },
                { icon: "ri-award-line", textKey: "course.perkCertificate" },
              ].map((perk) => (
                <div
                  key={perk.textKey}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-100 text-xs font-medium text-foreground-600 whitespace-nowrap"
                >
                  <i className={`${perk.icon} text-foreground-400`}></i>
                  {t(perk.textKey)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}