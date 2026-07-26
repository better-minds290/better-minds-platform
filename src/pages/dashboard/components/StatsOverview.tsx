import { useTranslation } from "react-i18next";

interface StatsData {
  totalSprints: number;
  completedSprints: number;
  currentStreak: number;
  completionRate: number;
  enrolledSince: string;
}

export default function StatsOverview({ stats }: { stats: StatsData }) {
  const { t } = useTranslation();

  const statCards = [
    {
      icon: "ri-stack-line",
      value: stats.totalSprints,
      label: t("dashboard.totalSprints"),
      suffix: t("dashboard.sprints"),
      color: "bg-primary-100",
      iconColor: "text-primary-600",
    },
    {
      icon: "ri-check-double-line",
      value: stats.completedSprints,
      label: t("dashboard.completedSprints"),
      suffix: t("dashboard.sprints"),
      color: "bg-accent-100",
      iconColor: "text-accent-600",
    },
    {
      icon: "ri-fire-line",
      value: stats.currentStreak,
      label: t("dashboard.currentStreak"),
      suffix: t("dashboard.days"),
      color: "bg-secondary-100",
      iconColor: "text-secondary-600",
    },
    {
      icon: "ri-percent-line",
      value: stats.completionRate,
      label: t("dashboard.completionRate"),
      suffix: "%",
      color: "bg-accent-100",
      iconColor: "text-accent-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((card) => (
        <div
          key={card.label}
          className="bg-background-50 border border-background-200 rounded-lg p-4 md:p-5"
        >
          <div className={`w-9 h-9 flex items-center justify-center rounded-lg ${card.color} mb-3`}>
            <i className={`${card.icon} text-base ${card.iconColor}`}></i>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-foreground-950 tabular-nums">
              {card.value}
            </span>
            <span className="text-xs text-foreground-400">{card.suffix}</span>
          </div>
          <p className="text-xs text-foreground-500 mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}