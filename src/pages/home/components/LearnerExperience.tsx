import { useTranslation } from "react-i18next";

const features = [
  { key: "feature1", icon: "ri-road-map-line" },
  { key: "feature2", icon: "ri-calendar-check-line" },
  { key: "feature3", icon: "ri-speed-up-line" },
  { key: "feature4", icon: "ri-heart-line" },
];

export default function LearnerExperience() {
  const { t } = useTranslation();

  return (
    <section id="for-learners" className="w-full py-16 md:py-24 bg-background-50">
      <div className="w-full max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-16">
          <div className="lg:w-5/12">
            <span className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold bg-accent-100 text-accent-700 mb-4">
              {t("learner.label")}
            </span>
            <h2 className="font-heading text-2xl md:text-4xl font-bold text-foreground-950 mb-4">
              {t("learner.title")}
            </h2>
            <p className="text-sm md:text-base text-foreground-600 leading-relaxed">
              {t("learner.subtitle")}
            </p>
          </div>

          <div className="lg:w-7/12 grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
            {features.map((feature, idx) => (
              <div
                key={feature.key}
                className={`bg-background-100 rounded-lg p-5 md:p-6 ${
                  idx === 0 ? "sm:col-span-2" : ""
                }`}
              >
                <div className="w-10 h-10 rounded-md bg-primary-100 flex items-center justify-center mb-3">
                  <i className={`${feature.icon} text-lg text-primary-600`}></i>
                </div>
                <h3 className="font-heading text-base md:text-lg font-semibold text-foreground-900 mb-2">
                  {t(`learner.${feature.key}Title`)}
                </h3>
                <p className="text-sm text-foreground-600 leading-relaxed">
                  {t(`learner.${feature.key}Desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}