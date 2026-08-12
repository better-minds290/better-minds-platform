import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import TeacherHonorSection from "./TeacherHonorSection";

interface TeacherWorkHour {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  teacherRole: string;
  totalHours: number;
  completedSessions: number;
  totalSessions: number;
}

interface LearnerSprint {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  totalSprints: number;
  completedSprints: number;
  activeSprints: number;
}

interface LearnerRating {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  avgRating: number;
  totalRated: number;
}

interface AbsenceSummaryRow {
  key: string;
  learnerId: string;
  learnerName: string;
  courseName: string;
  absenceCount: number;
  unresolvedCount: number;
  latestStatus: "unresolved" | "resolved";
  latestDate: string | null;
}

const ABSENCE_LIMIT = 5;

export default function AdminReports() {
  const { t } = useTranslation();
  const [teacherHours, setTeacherHours] = useState<TeacherWorkHour[]>([]);
  const [learnerSprints, setLearnerSprints] = useState<LearnerSprint[]>([]);
  const [learnerRatings, setLearnerRatings] = useState<LearnerRating[]>([]);
  const [absenceSummary, setAbsenceSummary] = useState<AbsenceSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTeacher, setSearchTeacher] = useState("");
  const [searchSprint, setSearchSprint] = useState("");
  const [searchRating, setSearchRating] = useState("");
  const [searchAbsence, setSearchAbsence] = useState("");

  const [sortTeacherKey, setSortTeacherKey] = useState<"name" | "hours">("hours");
  const [sortTeacherDir, setSortTeacherDir] = useState<"asc" | "desc">("desc");
  const [sortSprintKey, setSortSprintKey] = useState<"name" | "completed">("completed");
  const [sortSprintDir, setSortSprintDir] = useState<"asc" | "desc">("desc");
  const [sortRatingKey, setSortRatingKey] = useState<"name" | "rating">("rating");
  const [sortRatingDir, setSortRatingDir] = useState<"asc" | "desc">("desc");
  const [sortAbsenceKey, setSortAbsenceKey] = useState<"name" | "absences">("absences");
  const [sortAbsenceDir, setSortAbsenceDir] = useState<"asc" | "desc">("desc");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabase();

      // ── Fetch teacher profiles ──
      const { data: teacherProfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", ["vietnamese_teacher", "foreign_teacher"]);

      const teacherMap = new Map<string, { name: string; email: string; role: string }>();
      (teacherProfiles || []).forEach((p) =>
        teacherMap.set(p.id, { name: p.full_name || "Unknown", email: p.email || "", role: p.role })
      );

      // ── Fetch learner profiles (active only for operational reports) ──
      const { data: learnerProfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email, is_active")
        .eq("role", "learner");

      const activeLearnerIds = new Set<string>();
      const learnerMap = new Map<string, { name: string; email: string }>();
      (learnerProfiles || []).forEach((p) => {
        if (p.is_active === false) return;
        activeLearnerIds.add(p.id);
        learnerMap.set(p.id, { name: p.full_name || "Unknown", email: p.email || "" });
      });

      // ── Fetch all sprint_sessions (completed and total) ──
      const { data: sessions } = await supabase
        .from("sprint_sessions")
        .select("id, sprint_id, teacher_id, status, completion_rating");

      const allSessions = sessions || [];

      // ── Teacher working hours ──
      const teacherSessionMap = new Map<string, { completed: number; total: number }>();
      teacherProfiles?.forEach((tp) => {
        teacherSessionMap.set(tp.id, { completed: 0, total: 0 });
      });

      allSessions.forEach((s) => {
        if (!s.teacher_id) return;
        const entry = teacherSessionMap.get(s.teacher_id) || { completed: 0, total: 0 };
        entry.total++;
        if (s.status === "completed") entry.completed++;
        teacherSessionMap.set(s.teacher_id, entry);
      });

      const teacherHoursList: TeacherWorkHour[] = Array.from(teacherSessionMap.entries())
        .map(([teacherId, v]) => {
          const profile = teacherMap.get(teacherId) || { name: "Unknown", email: "", role: "" };
          return {
            teacherId,
            teacherName: profile.name,
            teacherEmail: profile.email,
            teacherRole: profile.role,
            totalHours: v.completed,
            completedSessions: v.completed,
            totalSessions: v.total,
          };
        });

      setTeacherHours(teacherHoursList);

      // ── Fetch learning_sprints ──
      const { data: sprints } = await supabase
        .from("learning_sprints")
        .select("id, enrollment_id, status, sprint_number");

      const allSprints = sprints || [];

      // ── Fetch enrollments ──
      const enrollmentIds = [...new Set(allSprints.map((s) => s.enrollment_id))];
      const { data: enrollments } = await supabase
        .from("enrollments")
        .select("id, learner_id, status");

      const enrollmentLearnerMap = new Map<string, string>();
      (enrollments || []).forEach((e) => enrollmentLearnerMap.set(e.id, e.learner_id));

      // ── Learner sprints completed ──
      const learnerSprintMap = new Map<string, { total: number; completed: number; active: number }>();
      activeLearnerIds.forEach((id) => {
        learnerSprintMap.set(id, { total: 0, completed: 0, active: 0 });
      });

      allSprints.forEach((sp) => {
        const learnerId = enrollmentLearnerMap.get(sp.enrollment_id);
        if (!learnerId || !activeLearnerIds.has(learnerId)) return;
        const entry = learnerSprintMap.get(learnerId) || { total: 0, completed: 0, active: 0 };
        entry.total++;
        if (sp.status === "completed") entry.completed++;
        if (sp.status === "active") entry.active++;
        learnerSprintMap.set(learnerId, entry);
      });

      const learnerSprintsList: LearnerSprint[] = Array.from(learnerSprintMap.entries())
        .map(([learnerId, v]) => {
          const profile = learnerMap.get(learnerId) || { name: "Unknown", email: "" };
          return {
            learnerId,
            learnerName: profile.name,
            learnerEmail: profile.email,
            totalSprints: v.total,
            completedSprints: v.completed,
            activeSprints: v.active,
          };
        });

      setLearnerSprints(learnerSprintsList);

      // ── Learner average ratings ──
      const sprintIdToEnrollment = new Map<string, string>();
      allSprints.forEach((sp) => sprintIdToEnrollment.set(sp.id, sp.enrollment_id));

      const learnerRatingMap = new Map<string, { ratings: number[] }>();
      activeLearnerIds.forEach((id) => {
        learnerRatingMap.set(id, { ratings: [] });
      });

      allSessions.forEach((s) => {
        if (typeof s.completion_rating !== "number" || s.completion_rating < 1) return;
        const enrollmentId = sprintIdToEnrollment.get(s.sprint_id);
        if (!enrollmentId) return;
        const learnerId = enrollmentLearnerMap.get(enrollmentId);
        if (!learnerId || !activeLearnerIds.has(learnerId)) return;
        const entry = learnerRatingMap.get(learnerId) || { ratings: [] };
        entry.ratings.push(s.completion_rating);
        learnerRatingMap.set(learnerId, entry);
      });

      const learnerRatingsList: LearnerRating[] = Array.from(learnerRatingMap.entries())
        .map(([learnerId, v]) => {
          const profile = learnerMap.get(learnerId) || { name: "Unknown", email: "" };
          return {
            learnerId,
            learnerName: profile.name,
            learnerEmail: profile.email,
            avgRating:
              v.ratings.length > 0
                ? Math.round((v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length) * 10) / 10
                : 0,
            totalRated: v.ratings.length,
          };
        });

      setLearnerRatings(learnerRatingsList);

      // ── Absence summary (cumulative from learner_attendance, never reset) ──
      const { data: absenceRows } = await supabase
        .from("learner_attendance")
        .select("id, learner_id, enrollment_id, course_name, learner_name, resolved, date, created_at")
        .eq("type", "absent_session")
        .order("created_at", { ascending: false });

      const absenceAgg = new Map<
        string,
        {
          learnerId: string;
          learnerName: string;
          courseName: string;
          absenceCount: number;
          unresolvedCount: number;
          latestStatus: "unresolved" | "resolved";
          latestDate: string | null;
        }
      >();

      (absenceRows || []).forEach((row) => {
        if (!row.learner_id || !activeLearnerIds.has(row.learner_id)) return;
        const courseName = row.course_name || t("reports.absenceUnknownCourse");
        const key = `${row.learner_id}|${row.enrollment_id || courseName}`;
        const profile = learnerMap.get(row.learner_id);
        const existing = absenceAgg.get(key);
        if (!existing) {
          absenceAgg.set(key, {
            learnerId: row.learner_id,
            learnerName: profile?.name || row.learner_name || "Unknown",
            courseName,
            absenceCount: 1,
            unresolvedCount: row.resolved ? 0 : 1,
            latestStatus: row.resolved ? "resolved" : "unresolved",
            latestDate: row.date || row.created_at || null,
          });
        } else {
          existing.absenceCount += 1;
          if (!row.resolved) existing.unresolvedCount += 1;
        }
      });

      const absenceList: AbsenceSummaryRow[] = Array.from(absenceAgg.entries()).map(([key, v]) => ({
        key,
        ...v,
      }));
      setAbsenceSummary(absenceList);
    } catch (err) {
      console.error("Failed to fetch reports:", err);
      setError(t("reports.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
        <p className="mt-4 text-sm text-foreground-400">{t("reports.loading")}</p>
      </div>
    );
  }

  // ── Sort helpers ──
  const handleSort = (
    key: string,
    setKey: (k: any) => void,
    setDir: (d: "asc" | "desc") => void,
    currentKey: string,
    currentDir: string
  ) => {
    if (currentKey === key) {
      setDir(currentDir === "asc" ? "desc" : "asc");
    } else {
      setKey(key as any);
      setDir("desc");
    }
  };

  const filteredTeachers = teacherHours
    .filter(
      (t) =>
        !searchTeacher ||
        t.teacherName.toLowerCase().includes(searchTeacher.toLowerCase()) ||
        t.teacherEmail.toLowerCase().includes(searchTeacher.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortTeacherKey === "name") cmp = a.teacherName.localeCompare(b.teacherName);
      else if (sortTeacherKey === "hours") cmp = a.totalHours - b.totalHours;
      return sortTeacherDir === "asc" ? cmp : -cmp;
    });

  const filteredSprints = learnerSprints
    .filter(
      (l) =>
        !searchSprint ||
        l.learnerName.toLowerCase().includes(searchSprint.toLowerCase()) ||
        l.learnerEmail.toLowerCase().includes(searchSprint.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortSprintKey === "name") cmp = a.learnerName.localeCompare(b.learnerName);
      else if (sortSprintKey === "completed") cmp = a.completedSprints - b.completedSprints;
      return sortSprintDir === "asc" ? cmp : -cmp;
    });

  const filteredRatings = learnerRatings
    .filter(
      (l) =>
        !searchRating ||
        l.learnerName.toLowerCase().includes(searchRating.toLowerCase()) ||
        l.learnerEmail.toLowerCase().includes(searchRating.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortRatingKey === "name") cmp = a.learnerName.localeCompare(b.learnerName);
      else if (sortRatingKey === "rating") cmp = a.avgRating - b.avgRating;
      return sortRatingDir === "asc" ? cmp : -cmp;
    });

  const filteredAbsences = absenceSummary
    .filter(
      (row) =>
        !searchAbsence ||
        row.learnerName.toLowerCase().includes(searchAbsence.toLowerCase()) ||
        row.courseName.toLowerCase().includes(searchAbsence.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortAbsenceKey === "name") cmp = a.learnerName.localeCompare(b.learnerName);
      else if (sortAbsenceKey === "absences") cmp = a.absenceCount - b.absenceCount;
      return sortAbsenceDir === "asc" ? cmp : -cmp;
    });

  // ── Summary stats ──
  const totalTeacherHours = teacherHours.reduce((sum, t) => sum + t.totalHours, 0);
  const totalCompletedSprints = learnerSprints.reduce((sum, l) => sum + l.completedSprints, 0);
  const criticalAbsences = absenceSummary.filter((r) => r.absenceCount >= ABSENCE_LIMIT).length;
  const allRatings = learnerRatings.flatMap((l) => (l.avgRating > 0 ? [l.avgRating] : []));
  const systemAvgRating =
    allRatings.length > 0
      ? Math.round((allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 10) / 10
      : 0;

  const ratingDistribution = [0, 0, 0, 0, 0]; // 1-5 stars (count of learners)
  learnerRatings.forEach((l) => {
    const r = Math.round(l.avgRating);
    if (r >= 1 && r <= 5) ratingDistribution[r - 1]++;
  });

  const roleLabel = (role: string) => {
    if (role === "vietnamese_teacher") return t("reports.roleVN");
    if (role === "foreign_teacher") return t("reports.roleForeign");
    return role;
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
              {t("reports.title")}
            </h2>
            <p className="text-sm text-foreground-500">
              {t("reports.subtitle")}
            </p>
          </div>
          <button
            onClick={fetchReports}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <i className="ri-refresh-line"></i>
            {t("reports.refresh")}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchReports}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("reports.retry")}
          </button>
        </div>
      )}

      {/* ═══════════ SECTION 0: Teacher Honor / Vinh Danh ═══════════ */}
      <TeacherHonorSection />

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-5 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600">
              <i className="ri-time-line text-base"></i>
            </div>
          </div>
          <p className="text-xs text-foreground-400 mb-0.5">{t("reports.summaryTeacherHours")}</p>
          <p className="font-heading text-2xl font-bold text-foreground-950">{totalTeacherHours}</p>
          <p className="text-xs text-foreground-400 mt-1">{t("reports.teacherCount", { count: teacherHours.length })}</p>
        </div>
        <div className="p-5 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600">
              <i className="ri-run-line text-base"></i>
            </div>
          </div>
          <p className="text-xs text-foreground-400 mb-0.5">{t("reports.summarySprintCompleted")}</p>
          <p className="font-heading text-2xl font-bold text-foreground-950">{totalCompletedSprints}</p>
          <p className="text-xs text-foreground-400 mt-1">{t("reports.learnerCount", { count: learnerSprints.length })}</p>
        </div>
        <div className="p-5 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600">
              <i className="ri-star-line text-base"></i>
            </div>
          </div>
          <p className="text-xs text-foreground-400 mb-0.5">{t("reports.summaryAvgRating")}</p>
          <p className="font-heading text-2xl font-bold text-foreground-950">
            {systemAvgRating > 0 ? systemAvgRating.toFixed(1) : "-"}
          </p>
          <p className="text-xs text-foreground-400 mt-1">{t("reports.outOfScale")}</p>
        </div>
        <div className="p-5 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-100 text-accent-700">
              <i className="ri-user-unfollow-line text-base"></i>
            </div>
          </div>
          <p className="text-xs text-foreground-400 mb-0.5">{t("reports.summaryCriticalAbsences")}</p>
          <p className="font-heading text-2xl font-bold text-foreground-950">{criticalAbsences}</p>
          <p className="text-xs text-foreground-400 mt-1">
            {t("reports.absenceTrackedLearners", { count: absenceSummary.length })}
          </p>
        </div>
      </div>

      {/* ═══════════ Absence Summary ═══════════ */}
      <div className="mb-10">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h3 className="font-heading text-base font-bold text-foreground-900">
              {t("reports.sectionAbsenceSummary")}
            </h3>
            <p className="text-xs text-foreground-500 mt-0.5">{t("reports.absenceSummaryHint")}</p>
          </div>
          <div className="relative">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text"
              value={searchAbsence}
              onChange={(e) => setSearchAbsence(e.target.value)}
              placeholder={t("reports.searchAbsence")}
              className="pl-9 pr-3 py-2 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
            />
          </div>
        </div>

        {filteredAbsences.length === 0 ? (
          <div className="p-8 rounded-xl border border-background-200 bg-background-50 text-center text-sm text-foreground-400">
            {t("reports.noAbsenceData")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-background-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background-100/70">
                  <th
                    className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider cursor-pointer"
                    onClick={() =>
                      handleSort("name", setSortAbsenceKey, setSortAbsenceDir, sortAbsenceKey, sortAbsenceDir)
                    }
                  >
                    {t("reports.colLearner")}
                    {sortAbsenceKey === "name" && (
                      <i className={`ri-arrow-${sortAbsenceDir === "asc" ? "up" : "down"}-s-line ml-1`}></i>
                    )}
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                    {t("reports.colCourse")}
                  </th>
                  <th
                    className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider cursor-pointer"
                    onClick={() =>
                      handleSort("absences", setSortAbsenceKey, setSortAbsenceDir, sortAbsenceKey, sortAbsenceDir)
                    }
                  >
                    {t("reports.colAbsences")}
                    {sortAbsenceKey === "absences" && (
                      <i className={`ri-arrow-${sortAbsenceDir === "asc" ? "up" : "down"}-s-line ml-1`}></i>
                    )}
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                    {t("reports.colAbsenceStatus")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200">
                {filteredAbsences.map((row) => {
                  const isCritical = row.absenceCount >= ABSENCE_LIMIT;
                  return (
                    <tr key={row.key} className="hover:bg-background-50/70 transition-colors duration-150">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 flex items-center justify-center rounded-full font-semibold text-xs flex-shrink-0 ${
                            isCritical ? "bg-accent-100 text-accent-700" : "bg-secondary-100 text-secondary-700"
                          }`}>
                            {row.learnerName.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-foreground-900 whitespace-nowrap">{row.learnerName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-foreground-600">{row.courseName}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`font-bold ${isCritical ? "text-accent-700" : "text-foreground-900"}`}>
                          {row.absenceCount} / {ABSENCE_LIMIT}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {isCritical ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent-100 text-accent-800">
                            {t("reports.absenceStatusCritical")}
                          </span>
                        ) : row.unresolvedCount > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-800">
                            {t("reports.absenceStatusUnresolved")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                            {t("reports.absenceStatusNormal")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-foreground-400">
          {t("reports.countFilteredAbsences", {
            filtered: filteredAbsences.length,
            total: absenceSummary.length,
          })}
        </p>
      </div>

      {/* ═══════════ SECTION 1: Teacher Working Hours ═══════════ */}
      <div className="mb-10">
        <h3 className="font-heading text-base font-semibold text-foreground-950 mb-4 flex items-center gap-2">
          <i className="ri-time-line text-primary-500"></i>
          {t("reports.sectionTeacherHours")}
        </h3>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text"
              value={searchTeacher}
              onChange={(e) => setSearchTeacher(e.target.value)}
              placeholder={t("reports.searchTeacher")}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
            />
          </div>
        </div>

        {filteredTeachers.length === 0 ? (
          <div className="text-center py-12 rounded-xl bg-background-50 border border-background-200">
            <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-200 text-foreground-400 mb-3">
              <i className="ri-user-search-line text-xl"></i>
            </div>
            <p className="text-sm text-foreground-500">{t("reports.noTeacherData")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-background-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background-100/70">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                    {t("reports.colTeacher")}
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden md:table-cell">
                    {t("reports.colRole")}
                  </th>
                  <th
                    className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider cursor-pointer hover:text-foreground-700 transition-colors"
                    onClick={() =>
                      handleSort("hours", setSortTeacherKey, setSortTeacherDir, sortTeacherKey, sortTeacherDir)
                    }
                  >
                    <span className="flex items-center justify-center gap-1">
                      {t("reports.colHoursDone")}
                      {sortTeacherKey === "hours" && (
                        <i
                          className={
                            sortTeacherDir === "asc" ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"
                          }
                        ></i>
                      )}
                    </span>
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden sm:table-cell">
                    {t("reports.colCompleted")}
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden sm:table-cell">
                    {t("reports.colTotal")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200">
                {filteredTeachers.map((teacher) => (
                  <tr
                    key={teacher.teacherId}
                    className="hover:bg-background-50/70 transition-colors duration-150"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-xs flex-shrink-0">
                          {teacher.teacherName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground-900 text-sm whitespace-nowrap truncate max-w-[140px]">
                            {teacher.teacherName}
                          </p>
                          <p className="text-xs text-foreground-500 truncate max-w-[140px]">
                            {teacher.teacherEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                        {roleLabel(teacher.teacherRole)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-sm font-bold text-primary-600">{teacher.totalHours}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center hidden sm:table-cell">
                      <span className="text-sm font-semibold text-foreground-900">
                        {teacher.completedSessions}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center hidden sm:table-cell">
                      <span className="text-sm text-foreground-600">{teacher.totalSessions}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-foreground-400">
          {t("reports.countFilteredTeachers", { filtered: filteredTeachers.length, total: teacherHours.length })}
        </p>
      </div>

      {/* ═══════════ SECTION 2: Learner Sprints Completed ═══════════ */}
      <div className="mb-10">
        <h3 className="font-heading text-base font-semibold text-foreground-950 mb-4 flex items-center gap-2">
          <i className="ri-run-line text-secondary-500"></i>
          {t("reports.sectionSprintCompleted")}
        </h3>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text"
              value={searchSprint}
              onChange={(e) => setSearchSprint(e.target.value)}
              placeholder={t("reports.searchLearner")}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-secondary-400 focus:ring-2 focus:ring-secondary-400/20 transition-all duration-200"
            />
          </div>
        </div>

        {filteredSprints.length === 0 ? (
          <div className="text-center py-12 rounded-xl bg-background-50 border border-background-200">
            <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-200 text-foreground-400 mb-3">
              <i className="ri-user-search-line text-xl"></i>
            </div>
            <p className="text-sm text-foreground-500">{t("reports.noLearnerData")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-background-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background-100/70">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                    {t("reports.colLearner")}
                  </th>
                  <th
                    className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider cursor-pointer hover:text-foreground-700 transition-colors"
                    onClick={() =>
                      handleSort(
                        "completed",
                        setSortSprintKey,
                        setSortSprintDir,
                        sortSprintKey,
                        sortSprintDir
                      )
                    }
                  >
                    <span className="flex items-center justify-center gap-1">
                      {t("reports.colSprintDone")}
                      {sortSprintKey === "completed" && (
                        <i
                          className={
                            sortSprintDir === "asc" ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"
                          }
                        ></i>
                      )}
                    </span>
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden md:table-cell">
                    {t("reports.colActive")}
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                    {t("reports.colTotalSprint")}
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden lg:table-cell">
                    {t("reports.colProgress")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200">
                {filteredSprints.map((learner) => (
                  <tr
                    key={learner.learnerId}
                    className="hover:bg-background-50/70 transition-colors duration-150"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-700 font-semibold text-xs flex-shrink-0">
                          {learner.learnerName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground-900 text-sm whitespace-nowrap truncate max-w-[140px]">
                            {learner.learnerName}
                          </p>
                          <p className="text-xs text-foreground-500 truncate max-w-[140px]">
                            {learner.learnerEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-sm font-bold text-secondary-600">
                        {learner.completedSprints}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center hidden md:table-cell">
                      <span className="text-sm font-semibold text-foreground-900">
                        {learner.activeSprints}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-sm text-foreground-600">{learner.totalSprints}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center hidden lg:table-cell">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-20 h-2 rounded-full bg-background-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-secondary-500 transition-all duration-500"
                            style={{
                              width: `${
                                learner.totalSprints > 0
                                  ? (learner.completedSprints / learner.totalSprints) * 100
                                  : 0
                              }%`,
                            }}
                          ></div>
                        </div>
                        <span className="text-xs text-foreground-500">
                          {learner.totalSprints > 0
                            ? Math.round((learner.completedSprints / learner.totalSprints) * 100)
                            : 0}
                          %
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-foreground-400">
          {t("reports.countFilteredLearners", { filtered: filteredSprints.length, total: learnerSprints.length })}
        </p>
      </div>

      {/* ═══════════ SECTION 3: Learner Average Ratings ═══════════ */}
      <div>
        <h3 className="font-heading text-base font-semibold text-foreground-950 mb-4 flex items-center gap-2">
          <i className="ri-star-line text-accent-500"></i>
          {t("reports.sectionAvgRating")}
        </h3>

        {/* Rating distribution summary */}
        <div className="grid grid-cols-5 gap-2 mb-6">
          {[5, 4, 3, 2, 1].map((star) => (
            <div
              key={star}
              className="p-3 rounded-xl bg-background-50 border border-background-200 text-center"
            >
              <div className="flex items-center justify-center gap-0.5 mb-1">
                {Array.from({ length: star }, (_, i) => (
                  <i key={i} className="ri-star-fill text-secondary-400 text-xs"></i>
                ))}
              </div>
              <p className="text-xl font-bold text-foreground-950">{ratingDistribution[star - 1]}</p>
              <p className="text-xs text-foreground-400">{t("reports.learnerCount", { count: 0 })}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text"
              value={searchRating}
              onChange={(e) => setSearchRating(e.target.value)}
              placeholder={t("reports.searchLearner")}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 transition-all duration-200"
            />
          </div>
        </div>

        {filteredRatings.length === 0 ? (
          <div className="text-center py-12 rounded-xl bg-background-50 border border-background-200">
            <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-200 text-foreground-400 mb-3">
              <i className="ri-user-search-line text-xl"></i>
            </div>
            <p className="text-sm text-foreground-500">{t("reports.noLearnerData")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-background-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background-100/70">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                    {t("reports.colLearner")}
                  </th>
                  <th
                    className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider cursor-pointer hover:text-foreground-700 transition-colors"
                    onClick={() =>
                      handleSort(
                        "rating",
                        setSortRatingKey,
                        setSortRatingDir,
                        sortRatingKey,
                        sortRatingDir
                      )
                    }
                  >
                    <span className="flex items-center justify-center gap-1">
                      {t("reports.colRating")}
                      {sortRatingKey === "rating" && (
                        <i
                          className={
                            sortRatingDir === "asc" ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"
                          }
                        ></i>
                      )}
                    </span>
                  </th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden sm:table-cell">
                    {t("reports.colTimesRated")}
                  </th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden md:table-cell">
                    {t("reports.colVisual")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200">
                {filteredRatings.map((learner) => (
                  <tr
                    key={learner.learnerId}
                    className="hover:bg-background-50/70 transition-colors duration-150"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-xs flex-shrink-0">
                          {learner.learnerName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground-900 text-sm whitespace-nowrap truncate max-w-[140px]">
                            {learner.learnerName}
                          </p>
                          <p className="text-xs text-foreground-500 truncate max-w-[140px]">
                            {learner.learnerEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {learner.avgRating > 0 ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-sm font-bold text-foreground-900">
                            {learner.avgRating.toFixed(1)}
                          </span>
                          <div className="flex items-center">
                            {Array.from({ length: 5 }, (_, i) => (
                              <i
                                key={i}
                                className={`text-xs ${
                                  i < Math.round(learner.avgRating)
                                    ? "ri-star-fill text-secondary-400"
                                    : "ri-star-line text-foreground-300"
                                }`}
                              ></i>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-foreground-400">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center hidden sm:table-cell">
                      <span className="text-sm text-foreground-600">
                        {learner.totalRated > 0 ? learner.totalRated : "-"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      {learner.avgRating > 0 ? (
                        <div className="w-20 h-2 rounded-full bg-background-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent-500 transition-all duration-500"
                            style={{ width: `${(learner.avgRating / 5) * 100}%` }}
                          ></div>
                        </div>
                      ) : (
                        <span className="text-xs text-foreground-400">{t("reports.noRating")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-foreground-400">
          {t("reports.countFilteredLearners", { filtered: filteredRatings.length, total: learnerRatings.length })}
        </p>
      </div>
    </div>
  );
}