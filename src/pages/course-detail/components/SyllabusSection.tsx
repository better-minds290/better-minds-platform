import { useState } from "react";
import { useTranslation } from "react-i18next";

interface SyllabusTopic {
  id: string;
  title: string;
  description: string;
  topics: string[];
  estimated_hours: number;
}

interface SyllabusSectionProps {
  units: SyllabusTopic[];
}

export default function SyllabusSection({ units }: SyllabusSectionProps) {
  const { t } = useTranslation();
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);

  const toggleUnit = (unitId: string) => {
    setExpandedUnit((prev) => (prev === unitId ? null : unitId));
  };

  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 py-10 md:py-14">
      <div className="mb-8">
        <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground-950 mb-2">
          {t("course.syllabusTitle")}
        </h2>
        <p className="text-sm text-foreground-500">
          {t("course.syllabusSubtitle")}
        </p>
      </div>

      <div className="space-y-3">
        {units.map((unit, index) => {
          const isOpen = expandedUnit === unit.id;
          return (
            <div
              key={unit.id}
              className="bg-background-50 border border-background-200/70 rounded-xl overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => toggleUnit(unit.id)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer hover:bg-background-100/60 transition-colors duration-150"
              >
                {/* Unit number badge */}
                <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-700 text-sm font-bold shrink-0">
                  {String(index + 1).padStart(2, "0")}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground-900 truncate">
                    {unit.title}
                  </h3>
                  <p className="text-xs text-foreground-500 mt-0.5 line-clamp-1">
                    {unit.description}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-foreground-400 whitespace-nowrap">
                    <i className="ri-time-line"></i>
                    {unit.estimated_hours}h
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-foreground-400 whitespace-nowrap">
                    <i className="ri-list-check"></i>
                    {unit.topics.length} {t("course.topics")}
                  </span>
                  <div
                    className={`w-7 h-7 flex items-center justify-center rounded-md transition-transform duration-300 ${
                      isOpen ? "rotate-180 bg-primary-100 text-primary-600" : "text-foreground-400"
                    }`}
                  >
                    <i className="ri-arrow-down-s-line text-lg"></i>
                  </div>
                </div>
              </button>

              {/* Expanded content */}
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  isOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="px-5 pb-5 pt-1 border-t border-background-200/50 mx-5">
                  <p className="text-sm text-foreground-600 mb-4 leading-relaxed">
                    {unit.description}
                  </p>
                  {unit.topics.length > 0 && (
                    <ul className="space-y-2">
                      {unit.topics.map((topic, tIdx) => (
                        <li
                          key={tIdx}
                          className="flex items-start gap-3 text-sm text-foreground-700"
                        >
                          <span className="mt-0.5 w-5 h-5 flex items-center justify-center shrink-0 rounded-full bg-accent-100 text-accent-600 text-[10px] font-bold">
                            {String(tIdx + 1).padStart(2, "0")}
                          </span>
                          <span className="leading-relaxed">{topic}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4 flex items-center gap-4 text-xs text-foreground-400">
                    <span className="inline-flex items-center gap-1">
                      <i className="ri-time-line"></i>
                      ~{unit.estimated_hours} {t("course.hours")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <i className="ri-list-check"></i>
                      {unit.topics.length} {t("course.topics")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}