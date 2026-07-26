import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface StatsData {
  totalLearners: number;
  totalTeachers: number;
  activeSprints: number;
  completedSprints: number;
  completionRate: number;
  newThisMonth: number;
  sessionsCompleted: number;
  activeLearners: number;
  teacherUtilization: number;
  recentLearners: {
    id: string;
    full_name: string;
    created_at: string;
    status: string;
  }[];
}

export default function AdminOverview() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);

    try {
      const supabase = getSupabase();

      const [profilesRes, sprintsRes, sessionsRes, enrollRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, role, created_at"),
        supabase.from("learning_sprints").select("id, status, enrollment_id, created_at"),
        supabase.from("sprint_sessions").select("id, status, teacher_id"),
        supabase.from("enrollments").select("id, learner_id, status, course_id, enrolled_at"),
      ]);

      const profiles = profilesRes.data || [];
      const sprints = sprintsRes.data || [];
      const sessions = sessionsRes.data || [];
      const enrollments = enrollRes.data || [];

      const totalLearners = profiles.filter((p) => p.role === "learner").length;
      const totalTeachers = profiles.filter((p) => p.role === "vietnamese_teacher" || p.role === "foreign_teacher").length;
      const activeSprints = sprints.filter((s) => s.status === "active").length;
      const completedSprints = sprints.filter((s) => s.status === "completed").length;
      const totalSprints = activeSprints + completedSprints + sprints.filter((s) => s.status === "expired").length;
      const completionRate = totalSprints > 0
        ? Math.round((completedSprints / totalSprints) * 100)
        : 0;

      const activeLearners = enrollments.filter((e) => e.status === "active").length;
      const sessionsCompleted = sessions.filter((s) => s.status === "completed").length;

      // Teacher utilization: teachers with assigned sessions / total teachers
      const teacherIdsWithSessions = new Set(sessions.filter((s) => s.teacher_id).map((s) => s.teacher_id));
      const teacherUtilization = totalTeachers > 0
        ? Math.round((teacherIdsWithSessions.size / totalTeachers) * 100)
        : 0;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const newThisMonth = profiles.filter((p) => p.role === "learner" && p.created_at >= monthStart).length;

      // Recent learners (last 5 joined)
      const recentLearners = profiles
        .filter((p) => p.role === "learner")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          full_name: p.full_name || "Unknown",
          created_at: p.created_at,
          status: enrollments.some((e) => e.learner_id === p.id && e.status === "active")
            ? "active"
            : "pending",
        }));

      setStats({
        totalLearners,
        totalTeachers,
        activeSprints,
        completedSprints,
        completionRate,
        newThisMonth,
        sessionsCompleted,
        activeLearners,
        teacherUtilization,
        recentLearners,
      });
    } catch (err) {
      console.error("Failed to fetch stats:", err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
        <p className="mt-4 text-sm text-foreground-400">{t("auth.adminLoadingStats")}</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const statCards = [
    { key: "totalLearners", icon: "ri-user-line", value: stats.totalLearners.toString(), color: "bg-primary-100 text-primary-600" },
    { key: "totalTeachers", icon: "ri-team-line", value: stats.totalTeachers.toString(), color: "bg-secondary-100 text-secondary-600" },
    { key: "activeSprints", icon: "ri-run-line", value: stats.activeSprints.toString(), color: "bg-accent-100 text-accent-600" },
    { key: "completionRate", icon: "ri-trophy-line", value: `${stats.completionRate}%`, color: "bg-primary-100 text-primary-600" },
    { key: "newThisMonth", icon: "ri-user-add-line", value: stats.newThisMonth.toString(), color: "bg-secondary-100 text-secondary-600" },
    { key: "sessionsCompleted", icon: "ri-check-double-line", value: stats.sessionsCompleted.toString(), color: "bg-accent-100 text-accent-600" },
  ];

  const activePct = stats.totalLearners > 0
    ? Math.round((stats.activeLearners / stats.totalLearners) * 100)
    : 0;

  return (
    <div>
      <div className="mb-8">
        <p className="text-sm text-foreground-500 mb-1">{t("auth.adminPlatformAnalytics")}</p>
        <h2 className="font-heading text-xl font-bold text-foreground-950">
          {t("auth.adminOverview")}
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {statCards.map((stat) => (
          <div
            key={stat.key}
            className="p-5 rounded-xl bg-background-50 border border-background-200 hover:border-background-300 transition-all duration-200"
          >
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${stat.color} mb-3`}>
              <i className={`${stat.icon} text-lg`}></i>
            </div>
            <p className="text-xs text-foreground-400 mb-1">{t(`auth.admin${stat.key.charAt(0).toUpperCase() + stat.key.slice(1)}`)}</p>
            <p className="font-heading text-2xl font-bold text-foreground-950">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-heading text-base font-semibold text-foreground-950">
              {t("auth.adminRecentActivity")}
            </h3>
            <span className="text-xs text-primary-500 font-medium cursor-pointer hover:text-primary-600 transition-colors">
              {t("auth.adminViewAll")}
            </span>
          </div>
          <div className="space-y-3">
            {stats.recentLearners.map((learner, idx) => (
              <div key={learner.id} className="flex items-center gap-3 py-2">
                <div className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-xs flex-shrink-0">
                  {learner.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground-900 truncate">{learner.full_name}</p>
                  <p className="text-xs text-foreground-500 truncate">
                    {learner.status === "active" ? `${t("auth.adminJoined")}` : `${t("auth.adminStatusLabel")}`}
                    {new Date(learner.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                {idx === 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                    {t("auth.adminNew")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 rounded-xl bg-background-50 border border-background-200">
          <h3 className="font-heading text-base font-semibold text-foreground-950 mb-5">
            {t("auth.adminPlatformSummary")}
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-foreground-600">{t("auth.adminActiveLearners")}</span>
                <span className="text-sm font-semibold text-foreground-950">{stats.activeLearners} / {stats.totalLearners}</span>
              </div>
              <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-500"
                  style={{ width: `${activePct}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-foreground-600">{t("auth.adminCompletionRate")}</span>
                <span className="text-sm font-semibold text-foreground-950">{stats.completionRate}%</span>
              </div>
              <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-500 rounded-full transition-all duration-500"
                  style={{ width: `${stats.completionRate}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-foreground-600">{t("auth.adminTeacherUtilization")}</span>
                <span className="text-sm font-semibold text-foreground-950">{stats.teacherUtilization}%</span>
              </div>
              <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary-500 rounded-full transition-all duration-500"
                  style={{ width: `${stats.teacherUtilization}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}