import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface TeacherHonor {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  teacherRole: string;
  completedSessions: number;
}

function getDateRange(
  period: "monthly" | "quarterly" | "yearly",
  year: number,
  month: number,
  quarter: number
): { start: string; end: string } {
  if (period === "monthly") {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (period === "quarterly") {
    const startMonth = (quarter - 1) * 3;
    const start = new Date(Date.UTC(year, startMonth, 1));
    const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

const MEDAL_COLORS: Record<number, { border: string; bg: string; badge: string; text: string; icon: string; glow: string }> = {
  1: { border: "border-accent-400/70", bg: "bg-accent-50/80", badge: "bg-accent-100 text-accent-700", text: "text-accent-700", icon: "ri-vip-crown-fill text-accent-500", glow: "" },
  2: { border: "border-foreground-400/70", bg: "bg-foreground-50/80", badge: "bg-foreground-100 text-foreground-600", text: "text-foreground-600", icon: "ri-medal-fill text-foreground-400", glow: "" },
  3: { border: "border-secondary-400/70", bg: "bg-secondary-50/80", badge: "bg-secondary-100 text-secondary-700", text: "text-secondary-700", icon: "ri-medal-fill text-secondary-500", glow: "" },
};

function roleLabel(role: string, tf: any) {
  if (role === "vietnamese_teacher") return tf("honor.roleVN");
  if (role === "foreign_teacher") return tf("honor.roleForeign");
  return role;
}

function PodiumCard({ teacher, rank, height, tr }: { teacher: TeacherHonor; rank: number; height: string; tr: any }) {
  const colors = MEDAL_COLORS[rank] || MEDAL_COLORS[3];

  return (
    <div className={`flex flex-col items-center ${height}`}>
      <div
        className={`relative flex flex-col items-center w-full max-w-[180px] p-5 rounded-2xl border ${colors.border} ${colors.bg} ${colors.glow} transition-all duration-500 animate-[podiumRise_0.6s_ease-out]`}
        style={{ animationDelay: `${(rank - 1) * 0.15}s` }}
      >
        {/* Rank badge */}
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${rank === 1 ? "bg-accent-500 text-background-50" : rank === 2 ? "bg-foreground-400 text-background-50" : "bg-secondary-500 text-background-50"} text-xs font-bold`}>
            {rank}
          </span>
        </div>

        {/* Crown/sparkle for #1 */}
        {rank === 1 && (
          <>
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-[sparkleFloat_2s_ease-in-out_infinite]">
              <i className="ri-sparkling-fill text-accent-400 text-lg"></i>
            </div>
            <div className="absolute -top-6 -left-1 animate-[sparkleFloat_2.5s_ease-in-out_infinite_0.3s]">
              <i className="ri-sparkling-fill text-accent-300 text-xs"></i>
            </div>
            <div className="absolute -top-6 -right-1 animate-[sparkleFloat_2.5s_ease-in-out_infinite_0.7s]">
              <i className="ri-sparkling-fill text-accent-300 text-xs"></i>
            </div>
          </>
        )}

        {/* Medal icon */}
        <div className="w-10 h-10 flex items-center justify-center mb-2">
          <i className={`${colors.icon} text-xl`}></i>
        </div>

        {/* Avatar */}
        <div className={`w-12 h-12 flex items-center justify-center rounded-full font-bold text-sm mb-2.5 ${
          rank === 1 ? "bg-accent-500 text-background-50" : rank === 2 ? "bg-foreground-400 text-background-50" : "bg-secondary-500 text-background-50"
        }`}>
          {teacher.teacherName.charAt(0).toUpperCase()}
        </div>

        {/* Name */}
        <p className="font-semibold text-sm text-foreground-900 text-center leading-tight mb-1 whitespace-nowrap truncate max-w-full">
          {teacher.teacherName}
        </p>

        {/* Role badge */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.badge} mb-3 whitespace-nowrap`}>
          {roleLabel(teacher.teacherRole, tr)}
        </span>

        {/* Stats */}
        <div className="text-center">
          <p className={`text-lg font-bold ${colors.text}`}>{teacher.completedSessions}</p>
          <p className="text-[10px] text-foreground-400 leading-tight">{tr("honor.sessionsCompleted")}</p>
        </div>
      </div>
    </div>
  );
}

export default function TeacherHonorSection() {
  const { t } = useTranslation();
  const now = new Date();
  const MONTHS = t("honor.months", { returnObjects: true }) as unknown as string[];
  const QUARTERS = t("honor.quarters", { returnObjects: true }) as unknown as { label: string; value: number }[];
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedQuarter, setSelectedQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [teachers, setTeachers] = useState<TeacherHonor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");

  const fetchHonorData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabase();
      const { start, end } = getDateRange(period, selectedYear, selectedMonth, selectedQuarter);

      const { data: teacherProfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", ["vietnamese_teacher", "foreign_teacher"]);

      const teacherMap = new Map<string, { name: string; email: string; role: string }>();
      (teacherProfiles || []).forEach((p) =>
        teacherMap.set(p.id, { name: p.full_name || "Unknown", email: p.email || "", role: p.role })
      );

      const { data: sessions } = await supabase
        .from("sprint_sessions")
        .select("teacher_id")
        .eq("status", "completed")
        .gte("completed_at", start)
        .lte("completed_at", end);

      const countMap = new Map<string, number>();
      (sessions || []).forEach((s) => {
        if (!s.teacher_id) return;
        countMap.set(s.teacher_id, (countMap.get(s.teacher_id) || 0) + 1);
      });

      const honorList: TeacherHonor[] = Array.from(countMap.entries())
        .map(([teacherId, count]) => {
          const profile = teacherMap.get(teacherId) || { name: "Unknown", email: "", role: "" };
          return {
            teacherId,
            teacherName: profile.name,
            teacherEmail: profile.email,
            teacherRole: profile.role,
            completedSessions: count,
          };
        })
        .sort((a, b) => b.completedSessions - a.completedSessions || a.teacherName.localeCompare(b.teacherName));

      setTeachers(honorList);
    } catch (err) {
      console.error("Failed to fetch honor data:", err);
      setError(t("honor.loadError"));
    } finally {
      setLoading(false);
    }
  }, [period, selectedYear, selectedMonth, selectedQuarter]);

  useEffect(() => {
    fetchHonorData();
  }, [fetchHonorData]);

  const top3 = teachers.slice(0, 3);
  const rest = teachers.slice(3);
  const totalSessions = teachers.reduce((sum, t) => sum + t.completedSessions, 0);

  const periodLabel =
    period === "monthly"
      ? t("honor.periodMonth", { month: selectedMonth, year: selectedYear })
      : period === "quarterly"
      ? t("honor.periodQuarter", { quarter: selectedQuarter, year: selectedYear })
      : t("honor.periodYear", { year: selectedYear });

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="mb-10">
      <style>{`
        @keyframes podiumRise {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes sparkleFloat {
          0%, 100% { opacity: 0.4; transform: translateY(0) scale(1); }
          50% { opacity: 1; transform: translateY(-6px) scale(1.3); }
        }
        @keyframes honorGlow {
          0%, 100% { box-shadow: 0 0 15px rgba(63,169,188,0.25); }
          50% { box-shadow: 0 0 35px rgba(63,169,188,0.5); }
        }
        @keyframes honorGlowSilver {
          0%, 100% { box-shadow: 0 0 10px rgba(107,123,141,0.15); }
          50% { box-shadow: 0 0 25px rgba(107,123,141,0.35); }
        }
        @keyframes honorGlowBronze {
          0%, 100% { box-shadow: 0 0 10px rgba(107,123,141,0.2); }
          50% { box-shadow: 0 0 25px rgba(107,123,141,0.4); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
      `}</style>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold text-foreground-950 flex items-center gap-2">
              <i className="ri-trophy-line text-secondary-500"></i>
              {t("honor.title")}
            </h3>
            <p className="text-sm text-foreground-500 mt-0.5">
              {t("honor.subtitle", { period: periodLabel.toLowerCase() })}
            </p>
          </div>
          <button
            onClick={fetchHonorData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <i className="ri-refresh-line"></i>
            {t("honor.refresh")}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-xl bg-background-50 border border-background-200">
        {/* Period type */}
        <div className="flex items-center bg-background-100 rounded-lg p-1">
          {(["monthly", "quarterly", "yearly"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                period === p
                  ? "bg-background-50 text-foreground-900 shadow-sm"
                  : "text-foreground-500 hover:text-foreground-700"
              }`}
            >
              {p === "monthly" ? t("honor.periodMonthly") : p === "quarterly" ? t("honor.periodQuarterly") : t("honor.periodYearly")}
            </button>
          ))}
        </div>

        {/* Year selector */}
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-background-50 border border-background-200 text-foreground-700 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 cursor-pointer"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {/* Month selector */}
        {period === "monthly" && (
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-background-50 border border-background-200 text-foreground-700 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 cursor-pointer"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        )}

        {/* Quarter selector */}
        {period === "quarterly" && (
          <select
            value={selectedQuarter}
            onChange={(e) => setSelectedQuarter(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-background-50 border border-background-200 text-foreground-700 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 cursor-pointer"
          >
            {QUARTERS.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        )}

        {/* Stats summary */}
        <div className="ml-auto flex items-center gap-4 text-xs text-foreground-500">
          <span>
            <strong className="text-foreground-700">{teachers.length}</strong> {t("honor.teacherCount", { count: teachers.length }).replace(/^\d+\s/, "")}
          </span>
          <span>
            <strong className="text-foreground-700">{totalSessions}</strong> {t("honor.totalSessions", { count: totalSessions }).replace(/^\d+\s/, "")}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchHonorData}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("honor.retry")}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 mx-auto border-2 border-secondary-400/30 border-t-secondary-400 rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-foreground-400">{t("honor.loading")}</p>
        </div>
      ) : teachers.length === 0 ? (
        <div className="text-center py-16 rounded-xl bg-background-50 border border-background-200">
          <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-200 text-foreground-400 mb-3">
            <i className="ri-emotion-sad-line text-xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("honor.empty", { period: periodLabel.toLowerCase() })}</p>
        </div>
      ) : (
        <>
          {/* ── Podium Top 3 ── */}
          <div className="flex items-end justify-center gap-3 sm:gap-5 mb-8 px-2">
            {/* #2 - Left */}
            {top3.length >= 2 && (
              <PodiumCard teacher={top3[1]} rank={2} height="pt-6" tr={t} />
            )}

            {/* #1 - Center (tallest) */}
            {top3.length >= 1 && (
              <div
                className="flex flex-col items-center relative animate-[honorGlow_3s_ease-in-out_infinite] rounded-2xl"
              >
                <PodiumCard teacher={top3[0]} rank={1} height="" tr={t} />
              </div>
            )}

            {/* #3 - Right */}
            {top3.length >= 3 && (
              <PodiumCard teacher={top3[2]} rank={3} height="pt-10" tr={t} />
            )}

            {/* If only 1 teacher, it appears in center already */}
            {top3.length === 1 && (
              <>
                <div className="hidden sm:block w-[180px]"></div>
                <div className="hidden sm:block w-[180px]"></div>
              </>
            )}
          </div>

          {/* ── Rankings 4+ ── */}
          {rest.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowAll(!showAll)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-50 border border-background-200 text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                {showAll ? (
                  <>
                    <i className="ri-arrow-up-s-line"></i>
                    {t("honor.collapse", { count: rest.length })}
                  </>
                ) : (
                  <>
                    <i className="ri-arrow-down-s-line"></i>
                    {t("honor.expand", { count: rest.length })}
                  </>
                )}
              </button>

              {showAll && (
                <div className="mt-4 overflow-x-auto rounded-xl border border-background-200 animate-[podiumRise_0.4s_ease-out]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-background-100/70">
                        <th className="text-center px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider w-16">
                          {t("honor.colRank")}
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                          {t("honor.colTeacher")}
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden sm:table-cell">
                          {t("honor.colRole")}
                        </th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                          {t("honor.colSessions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-background-200">
                      {teachers.map((teacher, idx) => (
                        <tr
                          key={teacher.teacherId}
                          className="hover:bg-background-50/70 transition-colors duration-150"
                        >
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                              idx === 0 ? "bg-accent-500 text-background-50" :
                              idx === 1 ? "bg-foreground-400 text-background-50" :
                              idx === 2 ? "bg-secondary-500 text-background-50" :
                              "bg-background-200 text-foreground-600"
                            }`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-7 h-7 flex items-center justify-center rounded-full font-semibold text-[11px] flex-shrink-0 ${
                                idx === 0 ? "bg-accent-100 text-accent-700" :
                                idx === 1 ? "bg-foreground-100 text-foreground-600" :
                                idx === 2 ? "bg-secondary-100 text-secondary-700" :
                                "bg-background-200 text-foreground-500"
                              }`}>
                                {teacher.teacherName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-foreground-900 text-sm whitespace-nowrap truncate max-w-[150px]">
                                  {teacher.teacherName}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                              {roleLabel(teacher.teacherRole, t)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm font-bold text-foreground-900">{teacher.completedSessions}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}