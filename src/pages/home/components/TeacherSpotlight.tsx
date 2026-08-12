import { useTranslation } from "react-i18next";

const benefits = [
  { key: "benefit1", icon: "ri-time-line" },
  { key: "benefit2", icon: "ri-timer-line" },
  { key: "benefit3", icon: "ri-computer-line" },
  { key: "benefit4", icon: "ri-team-line" },
];

export default function TeacherSpotlight() {
  const { t } = useTranslation();

  return (
    <section id="for-teachers" className="w-full py-16 md:py-24 bg-background-100">
      <div className="w-full max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-16 items-center">
          <div className="lg:w-1/2">
            <span className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 mb-4">
              {t("teacher.label")}
            </span>
            <h2 className="font-heading text-2xl md:text-4xl font-bold text-foreground-950 mb-5 leading-tight">
              {t("teacher.title")}
            </h2>
            <p className="text-sm md:text-base text-foreground-600 leading-relaxed mb-8">
              {t("teacher.subtitle")}
            </p>
            <div className="space-y-4">
              {benefits.map((benefit) => (
                <div key={benefit.key} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-accent-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className={`${benefit.icon} text-xs text-accent-600`}></i>
                  </div>
                  <span className="text-sm text-foreground-700">
                    {t(`teacher.${benefit.key}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:w-1/2">
            <div className="bg-accent-700 rounded-2xl p-8 md:p-10 relative overflow-hidden">
              <div className="absolute top-6 left-6">
                <span className="text-xs font-medium text-accent-200/70 uppercase tracking-wider">
                  {t("teacher.cardTitle")}
                </span>
              </div>
              <div className="absolute top-6 right-6 flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-300/60"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-accent-300/60"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-accent-300/60"></span>
              </div>

              <div className="mt-10 mb-8">
                <p className="text-lg md:text-xl text-background-50 leading-relaxed font-heading italic">
                  &ldquo;{t("teacher.cardDesc")}&rdquo;
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-accent-500 flex items-center justify-center">
                    <span className="text-background-50 font-heading text-lg font-bold">S</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-background-50">{t("teacher.cardName")}</p>
                    <p className="text-xs text-accent-200/70">{t("teacher.cardRole")}</p>
                  </div>
                </div>
                <a
                  href="https://forms.gle/xcqKyYQM5XmqVEKB8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 rounded-md text-xs font-medium bg-background-50/15 text-background-50 hover:bg-background-50/25 transition-colors duration-200 cursor-pointer whitespace-nowrap"
                >
                  {t("teacher.joinUs")} <i className="ri-arrow-right-line ml-1.5"></i>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}