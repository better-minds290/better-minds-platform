import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import { selectCurrentAdminSprint } from "@/lib/adminSprintSelection";
import { formatVietnamDate, formatVietnamDateTime } from "@/lib/datetime";

interface LearnerSprint {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  enrollmentId: string;
  enrollmentStatus: string;
  courseName: string;
  currentSprintId: string | null;
  sprintNumber: number | null;
  sprintStatus: string | null;
  deadlineS1: string | null;
  deadlineS2: string | null;
  deadlineS3: string | null;
  sprintCreatedAt: string | null;
  sprintCompletedAt: string | null;
  sessions: Array<{ id: string; sessionNumber: number; sessionType: string; status: string; completedAt: string | null }>;
  completedCount: number;
}

function formatDeadline(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const now = new Date();
  const diffHours = (d.getTime() - now.getTime()) / (1000 * 60 * 60);
  const formatted = formatVietnamDate(dateStr, { month: "short", day: "numeric", year: "numeric" }, "en-US");
  if (diffHours < 0) return formatted + " (Overdue)";
  if (diffHours <= 24) return formatted + " (" + Math.round(diffHours) + "h left)";
  return formatted;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return formatVietnamDateTime(dateStr, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }, "en-US");
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active": return "bg-accent-100 text-accent-700";
    case "completed": return "bg-primary-100 text-primary-700";
    case "expired": return "bg-secondary-100 text-secondary-700";
    case "pending": return "bg-background-200 text-foreground-500";
    default: return "bg-background-200 text-foreground-500";
  }
}

function getSprintStatusColor(status: string): string {
  switch (status) {
    case "active": return "bg-accent-100 text-accent-700";
    case "completed": return "bg-primary-100 text-primary-700";
    case "expired": return "bg-secondary-100 text-secondary-700";
    case "pending": return "bg-background-200 text-foreground-500";
    default: return "bg-background-200 text-foreground-500";
  }
}

function getSessionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    self_study: "Self-Study",
    vietnamese_teacher: "VN Teacher",
    foreign_teacher: "Foreign Teacher",
  };
  return labels[type] || type;
}

export default function AdminSprints() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sprintStatusFilter, setSprintStatusFilter] = useState<string>("all");
  const [learners, setLearners] = useState<LearnerSprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Extend Deadline modal
  const [extendModal, setExtendModal] = useState<{ open: boolean; sprintId: string; learnerName: string; sprintNumber: number } | null>(null);
  const [extendDays, setExtendDays] = useState(3);

  // Reset Learner modal
  const [resetModal, setResetModal] = useState<{ open: boolean; enrollmentId: string; learnerName: string } | null>(null);

  // Force Complete modal
  const [forceCompleteModal, setForceCompleteModal] = useState<{ open: boolean; sprintId: string; learnerName: string; sprintNumber: number } | null>(null);

  // Sprint Detail modal
  const [detailModal, setDetailModal] = useState<LearnerSprint | null>(null);

  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSprints = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabase();

      const { data: enrollments, error: enrollError } = await supabase
        .from("enrollments")
        .select("id, learner_id, course_id, status, study_commitment");

      if (enrollError) {
        console.error("Enrollments fetch error:", enrollError);
        setError("Failed to fetch enrollment data");
        setLoading(false);
        return;
      }

      if (!enrollments || enrollments.length === 0) {
        setLearners([]);
        setLoading(false);
        return;
      }

      const learnerIds = enrollments.map((e) => e.learner_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", learnerIds);

      const profileMap = new Map<string, { full_name: string; email: string }>();
      (profiles || []).forEach((p) => profileMap.set(p.id, { full_name: p.full_name || "Unknown", email: p.email || "" }));

      const enrollmentIds = enrollments.map((e) => e.id);
      const { data: allSprints } = await supabase
        .from("learning_sprints")
        .select("id, enrollment_id, sprint_number, status, deadline_session1, deadline_session2, deadline_session3, created_at, completed_at")
        .in("enrollment_id", enrollmentIds)
        .order("sprint_number", { ascending: true });

      // Fetch course names for enrollments
      const courseIds = [...new Set(enrollments.map((e) => e.course_id))];
      let courseMap = new Map<string, string>();
      if (courseIds.length > 0) {
        const { data: courses } = await supabase
          .from("courses")
          .select("id, name")
          .in("id", courseIds);
        (courses || []).forEach((c) => courseMap.set(c.id, c.name));
      }

      const sprintByEnrollment = new Map<string, Array<typeof allSprints[0]>>();
      (allSprints || []).forEach((s) => {
        const arr = sprintByEnrollment.get(s.enrollment_id) || [];
        arr.push(s);
        sprintByEnrollment.set(s.enrollment_id, arr);
      });

      const currentSprintIds = enrollments
        .map((enr) => {
          const sprints = sprintByEnrollment.get(enr.id) || [];
          return selectCurrentAdminSprint(sprints)?.id || null;
        })
        .filter((id): id is string => !!id);

      let sessionsBySprint = new Map<string, Array<{ id: string; sessionNumber: number; sessionType: string; status: string; completedAt: string | null }>>();

      if (currentSprintIds.length > 0) {
        const { data: sessions } = await supabase
          .from("sprint_sessions")
          .select("id, sprint_id, session_number, session_type, status, completed_at")
          .in("sprint_id", currentSprintIds)
          .order("session_number", { ascending: true });

        (sessions || []).forEach((s) => {
          const arr = sessionsBySprint.get(s.sprint_id) || [];
          arr.push({ id: s.id, sessionNumber: s.session_number, sessionType: s.session_type, status: s.status, completedAt: s.completed_at });
          sessionsBySprint.set(s.sprint_id, arr);
        });
      }

      const result: LearnerSprint[] = enrollments.map((enr) => {
        const profile = profileMap.get(enr.learner_id) || { full_name: "Unknown", email: "" };
        const sprints = sprintByEnrollment.get(enr.id) || [];
        const currentSprint = selectCurrentAdminSprint(sprints);
        const courseName = courseMap.get(enr.course_id) || "-";

        const sessions = currentSprint ? (sessionsBySprint.get(currentSprint.id) || []) : [];
        const completedCount = sessions.filter((s) => s.status === "completed").length;

        return {
          learnerId: enr.learner_id,
          learnerName: profile.full_name,
          learnerEmail: profile.email,
          enrollmentId: enr.id,
          enrollmentStatus: enr.status === "paused" ? "active" : (enr.status || "active"),
          courseName,
          currentSprintId: currentSprint?.id || null,
          sprintNumber: currentSprint?.sprint_number || null,
          sprintStatus: currentSprint?.status || null,
          deadlineS1: currentSprint?.deadline_session1 || null,
          deadlineS2: currentSprint?.deadline_session2 || null,
          deadlineS3: currentSprint?.deadline_session3 || null,
          sprintCreatedAt: currentSprint?.created_at || null,
          sprintCompletedAt: currentSprint?.completed_at || null,
          sessions,
          completedCount,
        };
      });

      setLearners(result);
    } catch (err) {
      console.error("Failed to fetch sprint data:", err);
      setError("Could not load sprint data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSprints();
  }, [fetchSprints]);

  const handleExtendDeadline = async () => {
    if (!extendModal) return;
    setActionLoading(true);

    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        showToast("error", "Not authenticated");
        return;
      }

      const { error: fnError } = await supabase.functions.invoke("extend-deadline", {
        body: { sprint_id: extendModal.sprintId, extend_days: extendDays },
      });

      if (fnError) {
        console.error("Extend deadline error:", fnError);
        showToast("error", "Failed to extend deadline");
      } else {
        showToast("success", "Deadline extended by " + extendDays + " days for Sprint " + extendModal.sprintNumber);
        setExtendModal(null);
        fetchSprints();
      }
    } catch (err) {
      console.error("Extend deadline error:", err);
      showToast("error", "Something went wrong");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetLearner = async () => {
    if (!resetModal) return;
    setActionLoading(true);

    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        showToast("error", "Not authenticated");
        return;
      }

      const { error: fnError } = await supabase.functions.invoke("reset-learner", {
        body: { enrollment_id: resetModal.enrollmentId },
      });

      if (fnError) {
        console.error("Reset learner error:", fnError);
        showToast("error", "Failed to reset learner");
      } else {
        showToast("success", resetModal.learnerName + " has been reset successfully");
        setResetModal(null);
        fetchSprints();
      }
    } catch (err) {
      console.error("Reset learner error:", err);
      showToast("error", "Something went wrong");
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceComplete = async () => {
    if (!forceCompleteModal) return;
    setActionLoading(true);

    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        showToast("error", "Not authenticated");
        return;
      }

      const { error: fnError } = await supabase.functions.invoke("force-complete-sprint", {
        body: { sprint_id: forceCompleteModal.sprintId },
      });

      if (fnError) {
        console.error("Force complete error:", fnError);
        showToast("error", "Failed to force complete sprint");
      } else {
        showToast("success", t("auth.adminForceCompleteSuccess"));
        setForceCompleteModal(null);
        fetchSprints();
      }
    } catch (err) {
      console.error("Force complete error:", err);
      showToast("error", "Something went wrong");
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = learners.filter((l) => {
    const matchSearch =
      !search ||
      l.learnerName.toLowerCase().includes(search.toLowerCase()) ||
      l.learnerEmail.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || l.enrollmentStatus === statusFilter;
    const matchSprintStatus = sprintStatusFilter === "all" || l.sprintStatus === sprintStatusFilter || (sprintStatusFilter === "none" && !l.sprintStatus);
    return matchSearch && matchStatus && matchSprintStatus;
  });

  const completedCount = learners.filter((l) => l.enrollmentStatus === "completed").length;
  const expiredCount = learners.filter((l) => l.sprintStatus === "expired").length;
  const activeCount = learners.filter((l) => l.enrollmentStatus === "active").length;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-5 py-3 rounded-lg text-sm font-medium shadow-lg transition-all duration-300 ${
          toast.type === "success" ? "bg-primary-500 text-background-50" : "bg-accent-500 text-background-50"
        }`}>
          <div className="flex items-center gap-2">
            <i className={toast.type === "success" ? "ri-check-line" : "ri-error-warning-line"}></i>
            {toast.message}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
              {t("auth.adminSprintsTitle")}
            </h2>
            <p className="text-sm text-foreground-500">{t("auth.adminSprintsSubtitle")}</p>
          </div>
          <button
            onClick={fetchSprints}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <i className="ri-refresh-line"></i>
            {t("auth.adminRefresh")}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">{t("auth.adminSprintsActive")}</p>
          <p className="font-heading text-2xl font-bold text-accent-700">{activeCount}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">{t("auth.adminSprintsExpired")}</p>
          <p className="font-heading text-2xl font-bold text-secondary-600">{expiredCount}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">{t("auth.adminCompleted")}</p>
          <p className="font-heading text-2xl font-bold text-primary-600">{completedCount}</p>
        </div>
        <div className="p-4 rounded-xl bg-background-50 border border-background-200">
          <p className="text-xs text-foreground-400 mb-1">Total</p>
          <p className="font-heading text-2xl font-bold text-foreground-700">{learners.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("auth.adminSearchLearners")}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
        >
          <option value="all">{t("auth.adminAllStatuses")}</option>
          <option value="active">{t("auth.adminActive")}</option>
          <option value="completed">{t("auth.adminCompleted")}</option>
        </select>
        <select
          value={sprintStatusFilter}
          onChange={(e) => setSprintStatusFilter(e.target.value)}
          className="px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
        >
          <option value="all">{t("auth.adminSprintStatusAll")}</option>
          <option value="active">{t("auth.adminSprintStatusActive")}</option>
          <option value="expired">{t("auth.adminSprintStatusExpired")}</option>
          <option value="pending">{t("auth.adminSprintStatusPending")}</option>
          <option value="completed">{t("auth.adminSprintStatusCompleted")}</option>
          <option value="none">No Sprint</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchSprints}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-foreground-400">Loading sprint data...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-4">
            <i className="ri-run-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.adminNoLearners")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-background-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background-100/70">
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminName")}
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden sm:table-cell">
                  Sprint
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminStatus")}
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden lg:table-cell">
                  Deadlines
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden sm:table-cell">
                  Sessions
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-background-200">
              {filtered.map((l) => (
                <tr key={l.enrollmentId} className="hover:bg-background-50/70 transition-colors duration-150">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setDetailModal(l)}
                      className="flex items-center gap-2.5 cursor-pointer group text-left w-full"
                    >
                      <div className={`w-8 h-8 flex items-center justify-center rounded-full font-semibold text-xs flex-shrink-0 ${
                        l.enrollmentStatus === "completed" ? "bg-secondary-100 text-secondary-700" : "bg-primary-100 text-primary-700"
                      }`}>
                        {l.learnerName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground-900 text-sm whitespace-nowrap truncate max-w-[120px] group-hover:text-primary-600 transition-colors">
                          {l.learnerName}
                        </p>
                        <p className="text-xs text-foreground-500 truncate max-w-[120px]">{l.learnerEmail}</p>
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {l.sprintNumber ? (
                      <div>
                        <span className="text-sm text-foreground-900 font-medium">Sprint {l.sprintNumber}</span>
                        {l.sprintStatus && (
                          <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getSprintStatusColor(l.sprintStatus)}`}>
                            {l.sprintStatus}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-foreground-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getStatusColor(l.enrollmentStatus)}`}>
                      {l.enrollmentStatus}
                    </span>
                    {/* Sprint status on mobile */}
                    {l.sprintStatus && (
                      <span className={`sm:hidden ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getSprintStatusColor(l.sprintStatus)}`}>
                        {l.sprintStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="text-xs space-y-0.5">
                      <div className={l.deadlineS1 && new Date(l.deadlineS1) < new Date() ? "text-accent-600" : "text-foreground-600"}>
                        S1: {formatDeadline(l.deadlineS1)}
                      </div>
                      <div className={l.deadlineS2 && new Date(l.deadlineS2) < new Date() ? "text-accent-600" : "text-foreground-600"}>
                        S2: {formatDeadline(l.deadlineS2)}
                      </div>
                      <div className={l.deadlineS3 && new Date(l.deadlineS3) < new Date() ? "text-accent-600" : "text-foreground-600"}>
                        S3: {formatDeadline(l.deadlineS3)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center hidden sm:table-cell">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      {l.sessions.map((s) => (
                        <span
                          key={s.sessionNumber}
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                            s.status === "completed"
                              ? "bg-primary-100 text-primary-700"
                              : s.status === "in_progress"
                              ? "bg-accent-100 text-accent-700 ring-1 ring-accent-300"
                              : "bg-background-200 text-foreground-400"
                          }`}
                          title={"S" + s.sessionNumber + ": " + s.status}
                        >
                          {s.sessionNumber}
                        </span>
                      ))}
                      {l.sessions.length === 0 && <span className="text-xs text-foreground-400">-</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* View Detail button */}
                      <button
                        onClick={() => setDetailModal(l)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-background-100 text-foreground-500 hover:bg-background-200 hover:text-foreground-700 transition-colors cursor-pointer"
                        title={t("auth.adminSprintDetail")}
                      >
                        <i className="ri-information-line text-sm"></i>
                      </button>
                      {l.currentSprintId && (l.sprintStatus === "active" || l.sprintStatus === "expired") && (
                        <>
                          <button
                            onClick={() => setExtendModal({
                              open: true,
                              sprintId: l.currentSprintId!,
                              learnerName: l.learnerName,
                              sprintNumber: l.sprintNumber!,
                            })}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer"
                            title={t("auth.adminExtendDeadline")}
                          >
                            <i className="ri-timer-line text-sm"></i>
                          </button>
                          <button
                            onClick={() => setForceCompleteModal({
                              open: true,
                              sprintId: l.currentSprintId!,
                              learnerName: l.learnerName,
                              sprintNumber: l.sprintNumber!,
                            })}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer"
                            title={t("auth.adminForceComplete")}
                          >
                            <i className="ri-check-double-line text-sm"></i>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-foreground-400">
        {filtered.length} / {learners.length} learners
      </p>

      {/* Extend Deadline Modal */}
      {extendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setExtendModal(null)}></div>
          <div className="relative z-10 bg-background-50 rounded-2xl border border-background-200 w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-secondary-100 text-secondary-600">
                <i className="ri-timer-line text-lg"></i>
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-foreground-950">
                  {t("auth.adminExtendDeadline")}
                </h3>
                <p className="text-xs text-foreground-500">
                  {extendModal.learnerName} — Sprint {extendModal.sprintNumber}
                </p>
              </div>
            </div>

            <label className="block text-sm font-medium text-foreground-700 mb-2">
              {t("auth.adminExtendDays")}
            </label>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setExtendDays(Math.max(1, extendDays - 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
              >
                <i className="ri-subtract-line"></i>
              </button>
              <input
                type="number"
                value={extendDays}
                onChange={(e) => setExtendDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-center px-3 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
                min={1}
                max={30}
              />
              <button
                onClick={() => setExtendDays(Math.min(30, extendDays + 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
              >
                <i className="ri-add-line"></i>
              </button>
              <span className="text-sm text-foreground-500">{t("auth.adminDays")}</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setExtendModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleExtendDeadline}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ...
                  </span>
                ) : (
                  t("auth.adminExtendConfirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Learner Modal */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setResetModal(null)}></div>
          <div className="relative z-10 bg-background-50 rounded-2xl border border-background-200 w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-100 text-primary-600">
                <i className="ri-restart-line text-lg"></i>
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-foreground-950">
                  {t("auth.adminResetLearner")}
                </h3>
                <p className="text-xs text-foreground-500">{resetModal.learnerName}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-accent-50 border border-accent-200 mb-5">
              <p className="text-sm text-accent-800">
                {t("auth.adminResetLearnerDesc")}
              </p>
              <ul className="mt-2 text-xs text-accent-700 space-y-1 list-disc list-inside">
                <li>{t("auth.adminResetDesc1")}</li>
                <li>{t("auth.adminResetDesc2")}</li>
                <li>{t("auth.adminResetDesc3")}</li>
              </ul>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setResetModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleResetLearner}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ...
                  </span>
                ) : (
                  t("auth.adminResetConfirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force Complete Modal */}
      {forceCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setForceCompleteModal(null)}></div>
          <div className="relative z-10 bg-background-50 rounded-2xl border border-background-200 w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-secondary-100 text-secondary-600">
                <i className="ri-check-double-line text-lg"></i>
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-foreground-950">
                  {t("auth.adminForceCompleteConfirm")}
                </h3>
                <p className="text-xs text-foreground-500">
                  {forceCompleteModal.learnerName} — Sprint {forceCompleteModal.sprintNumber}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-secondary-50 border border-secondary-200 mb-5">
              <div className="flex items-start gap-2">
                <i className="ri-error-warning-line text-secondary-600 mt-0.5"></i>
                <p className="text-sm text-secondary-800">
                  {t("auth.adminForceCompleteDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setForceCompleteModal(null)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t("auth.adminCancel")}
              </button>
              <button
                onClick={handleForceComplete}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-secondary-600 text-background-50 hover:bg-secondary-700 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ...
                  </span>
                ) : (
                  t("auth.adminForceCompleteConfirm")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sprint Detail Modal */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 overflow-y-auto">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailModal(null)}></div>
          <div className="relative z-10 bg-background-50 rounded-2xl border border-background-200 w-full max-w-2xl mx-4 mb-16">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-background-200">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl font-bold text-sm ${
                  detailModal.enrollmentStatus === "completed" ? "bg-secondary-100 text-secondary-700" : "bg-primary-100 text-primary-700"
                }`}>
                  {detailModal.learnerName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-heading text-base font-bold text-foreground-950">
                    {t("auth.adminSprintDetail")}
                  </h3>
                  <p className="text-sm text-foreground-500">{detailModal.learnerName}</p>
                </div>
              </div>
              <button
                onClick={() => setDetailModal(null)}
                className="w-8 h-8 flex items-center justify-center rounded-md text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
              >
                <i className="ri-close-line"></i>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Key info grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-background-100">
                  <p className="text-xs text-foreground-400 mb-0.5">{t("auth.adminSprintDetailLearner")}</p>
                  <p className="text-sm font-semibold text-foreground-900 truncate">{detailModal.learnerName}</p>
                  <p className="text-xs text-foreground-500 truncate">{detailModal.learnerEmail}</p>
                </div>
                <div className="p-3 rounded-lg bg-background-100">
                  <p className="text-xs text-foreground-400 mb-0.5">{t("auth.adminSprintDetailEnrollment")}</p>
                  <p className="text-sm font-semibold text-foreground-900">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(detailModal.enrollmentStatus)}`}>
                      {detailModal.enrollmentStatus}
                    </span>
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-background-100">
                  <p className="text-xs text-foreground-400 mb-0.5">Sprint</p>
                  <p className="text-sm font-semibold text-foreground-900">
                    {detailModal.sprintNumber ? `Sprint ${detailModal.sprintNumber}` : "N/A"}
                  </p>
                  {detailModal.sprintStatus && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium mt-0.5 ${getSprintStatusColor(detailModal.sprintStatus)}`}>
                      {detailModal.sprintStatus}
                    </span>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-background-100">
                  <p className="text-xs text-foreground-400 mb-0.5">{t("auth.adminSprintDetailCourse")}</p>
                  <p className="text-sm font-semibold text-foreground-900">{detailModal.courseName}</p>
                  <p className="text-xs text-foreground-500">{detailModal.completedCount}/3 sessions done</p>
                </div>
              </div>

              {/* Timeline */}
              <div className="p-4 rounded-lg border border-background-200">
                <h4 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
                  <i className="ri-time-line text-foreground-400"></i>
                  {t("auth.adminSprintDetailCreated")}
                </h4>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-foreground-500">{formatDate(detailModal.sprintCreatedAt)}</span>
                  {detailModal.sprintCompletedAt && (
                    <>
                      <i className="ri-arrow-right-line text-foreground-400"></i>
                      <span className="text-foreground-500">{formatDate(detailModal.sprintCompletedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Deadlines */}
              <div className="p-4 rounded-lg border border-background-200">
                <h4 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
                  <i className="ri-timer-line text-foreground-400"></i>
                  {t("auth.adminSprintDetailDeadline")}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className={`p-3 rounded-lg text-xs ${detailModal.deadlineS1 && new Date(detailModal.deadlineS1) < new Date() ? "bg-accent-50 border border-accent-200" : "bg-background-100"}`}>
                    <span className="font-semibold text-foreground-700">Session 1</span>
                    <p className={`mt-0.5 ${detailModal.deadlineS1 && new Date(detailModal.deadlineS1) < new Date() ? "text-accent-600" : "text-foreground-500"}`}>
                      {formatDeadline(detailModal.deadlineS1)}
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg text-xs ${detailModal.deadlineS2 && new Date(detailModal.deadlineS2) < new Date() ? "bg-accent-50 border border-accent-200" : "bg-background-100"}`}>
                    <span className="font-semibold text-foreground-700">Session 2</span>
                    <p className={`mt-0.5 ${detailModal.deadlineS2 && new Date(detailModal.deadlineS2) < new Date() ? "text-accent-600" : "text-foreground-500"}`}>
                      {formatDeadline(detailModal.deadlineS2)}
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg text-xs ${detailModal.deadlineS3 && new Date(detailModal.deadlineS3) < new Date() ? "bg-accent-50 border border-accent-200" : "bg-background-100"}`}>
                    <span className="font-semibold text-foreground-700">Session 3</span>
                    <p className={`mt-0.5 ${detailModal.deadlineS3 && new Date(detailModal.deadlineS3) < new Date() ? "text-accent-600" : "text-foreground-500"}`}>
                      {formatDeadline(detailModal.deadlineS3)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Sessions detail */}
              <div className="p-4 rounded-lg border border-background-200">
                <h4 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
                  <i className="ri-list-check text-foreground-400"></i>
                  {t("auth.adminSprintDetailSessions")}
                </h4>
                {detailModal.sessions.length === 0 ? (
                  <p className="text-xs text-foreground-400">No sessions data available</p>
                ) : (
                  <div className="space-y-2">
                    {detailModal.sessions.map((s) => (
                      <div key={s.sessionNumber} className="flex items-center justify-between p-3 rounded-lg bg-background-100">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold ${
                            s.status === "completed" ? "bg-primary-100 text-primary-700"
                              : s.status === "in_progress" ? "bg-accent-100 text-accent-700 ring-1 ring-accent-300"
                              : "bg-background-200 text-foreground-400"
                          }`}>
                            {s.sessionNumber}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground-800">{getSessionTypeLabel(s.sessionType)}</p>
                            <p className="text-xs text-foreground-500 capitalize">{s.status.replace("_", " ")}</p>
                          </div>
                        </div>
                        {s.completedAt && (
                          <span className="text-xs text-foreground-400">{formatDate(s.completedAt)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-background-200 flex-wrap">
              {detailModal.currentSprintId && (detailModal.sprintStatus === "active" || detailModal.sprintStatus === "expired") && (
                <>
                  <button
                    onClick={() => {
                      setExtendModal({
                        open: true,
                        sprintId: detailModal.currentSprintId!,
                        learnerName: detailModal.learnerName,
                        sprintNumber: detailModal.sprintNumber!,
                      });
                      setDetailModal(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <i className="ri-timer-line"></i>
                    {t("auth.adminExtendDeadline")}
                  </button>
                  <button
                    onClick={() => {
                      setForceCompleteModal({
                        open: true,
                        sprintId: detailModal.currentSprintId!,
                        learnerName: detailModal.learnerName,
                        sprintNumber: detailModal.sprintNumber!,
                      });
                      setDetailModal(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <i className="ri-check-double-line"></i>
                    {t("auth.adminForceComplete")}
                  </button>
                </>
              )}
              <button
                onClick={() => setDetailModal(null)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t("auth.adminClose")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}