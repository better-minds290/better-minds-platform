import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import { formatVietnamDate } from "@/lib/datetime";

interface AttendanceRecord {
  id: string;
  learner_id: string;
  learner_name: string;
  enrollment_id: string | null;
  related_sprint_id: string | null;
  related_session_id: string | null;
  related_class_schedule_id: string | null;
  class_id: string | null;
  sprint_number: number | null;
  session_number: number | null;
  type: string;
  date: string;
  course_name: string;
  note: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

type FilterType = "all" | "sprint_unlock_late" | "absent_session";
type ResolvedFilter = "all" | "unresolved" | "resolved";

export default function AdminLearnerAttendance() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>("unresolved");
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<string | null>(null);
  const [detectResultType, setDetectResultType] = useState<"error" | "success" | "none" | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [forceCompleting, setForceCompleting] = useState<string | null>(null);
  const [forceCompleteResult, setForceCompleteResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reopening, setReopening] = useState<string | null>(null);
  const [reopenResult, setReopenResult] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [unlockResult, setUnlockResult] = useState<string | null>(null);

  const supabase = getSupabase();

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data, error } = await supabase
        .from("learner_attendance")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setRecords(data || []);
    } catch (err: any) {
      setFetchError(err?.message || t("auth.adminAttendanceLoadError"));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleDetectSprintLate = async () => {
    setDetecting(true);
    setDetectResult(null);
    setDetectResultType(null);
    try {
      const { data, error } = await supabase.functions.invoke("detect-sprint-late", {
        body: {},
      });

      if (error) throw new Error(error.message);

      const recorded = data?.total_recorded || 0;
      const checked = data?.total_checked || 0;

      if (recorded > 0) {
        setDetectResult(t("auth.adminAttendanceDetected", { count: recorded, total: checked }));
        setDetectResultType("success");
        fetchRecords();
      } else {
        setDetectResult(t("auth.adminAttendanceDetectedNone", { count: checked }));
        setDetectResultType("none");
      }
    } catch (err: any) {
      setDetectResult(t("auth.adminAttendanceDetectError", { msg: err?.message || t("auth.adminAttendanceLoadError") }));
      setDetectResultType("error");
    } finally {
      setDetecting(false);
      setTimeout(() => { setDetectResult(null); setDetectResultType(null); }, 6000);
    }
  };

  const handleResolve = async (recordId: string) => {
    setResolving(recordId);
    try {
      const { error } = await supabase
        .from("learner_attendance")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: "admin",
        })
        .eq("id", recordId);

      if (error) throw error;

      setRecords((prev) =>
        prev.map((r) =>
          r.id === recordId
            ? { ...r, resolved: true, resolved_at: new Date().toISOString(), resolved_by: "admin" }
            : r
        )
      );
    } catch (err: any) {
      console.error("Failed to resolve:", err);
    } finally {
      setResolving(null);
    }
  };

  const handleForceComplete = async (recordId: string, sprintId: string) => {
    if (!confirm(t("auth.adminAttendanceFCConfirm"))) return;

    setForceCompleting(recordId);
    setForceCompleteResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("force-complete-sprint", {
        body: { sprint_id: sprintId },
      });

      if (error) throw new Error(error.message);

      if (data?.success) {
        setForceCompleteResult("✅ " + (data.message || t("auth.adminAttendanceFCSuccess")));
        // Auto-resolve the attendance record too
        await supabase
          .from("learner_attendance")
          .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolved_by: "admin",
          })
          .eq("id", recordId);

        setRecords((prev) =>
          prev.map((r) =>
            r.id === recordId
              ? { ...r, resolved: true, resolved_at: new Date().toISOString(), resolved_by: "admin" }
              : r
          )
        );
      } else {
        setForceCompleteResult("❌ " + (data?.error || t("auth.adminAttendanceFCError")));
      }
    } catch (err: any) {
      setForceCompleteResult("❌ " + (err?.message || t("auth.adminAttendanceFCFailed")));
    } finally {
      setForceCompleting(null);
      setTimeout(() => setForceCompleteResult(null), 6000);
    }
  };

  const handleReopen = async (recordId: string, learnerName: string) => {
    if (!confirm(t("auth.adminAttendanceReopenConfirm", { name: learnerName }))) return;

    setReopening(recordId);
    setReopenResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("record-learner-attendance", {
        body: { action: "reopen_absent", attendance_id: recordId },
      });

      if (error) throw new Error(error.message);

      if (data?.success) {
        setReopenResult("✅ " + t("auth.adminAttendanceReopenSuccess", { name: learnerName }));
        fetchRecords();
      } else {
        setReopenResult("❌ " + (data?.error || t("auth.adminAttendanceFCError")));
      }
    } catch (err: any) {
      setReopenResult("❌ " + (err?.message || t("auth.adminAttendanceReopenFailed")));
    } finally {
      setReopening(null);
      setTimeout(() => setReopenResult(null), 8000);
    }
  };

  const handleUnlockSprint = async (recordId: string, sprintId: string | null, learnerName: string) => {
    if (!sprintId) {
      setUnlockResult("❌ " + t("auth.adminAttendanceUnlockNoSprint"));
      setTimeout(() => setUnlockResult(null), 6000);
      return;
    }
    if (!confirm(t("auth.adminAttendanceUnlockConfirm", { name: learnerName }))) return;

    setUnlocking(recordId);
    setUnlockResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("sprint-continuity", {
        body: { action: "unlock_now", sprint_id: sprintId },
      });

      if (error) throw new Error(error.message);

      if (data?.success || data?.already_active) {
        setUnlockResult("✅ " + t("auth.adminAttendanceUnlockSuccess", { name: learnerName }));
        // Auto-resolve the attendance record
        await supabase
          .from("learner_attendance")
          .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolved_by: "admin",
          })
          .eq("id", recordId);
        fetchRecords();
      } else {
        setUnlockResult("❌ " + (data?.error || t("auth.adminAttendanceFCError")));
      }
    } catch (err: any) {
      setUnlockResult("❌ " + (err?.message || t("auth.adminAttendanceUnlockFailed")));
    } finally {
      setUnlocking(null);
      setTimeout(() => setUnlockResult(null), 8000);
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (resolvedFilter === "unresolved" && r.resolved) return false;
      if (resolvedFilter === "resolved" && !r.resolved) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.learner_name.toLowerCase().includes(q) &&
          !r.course_name.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [records, typeFilter, resolvedFilter, search]);

  const unresolvedCount = records.filter((r) => !r.resolved).length;
  const sprintLateCount = records.filter((r) => r.type === "sprint_unlock_late" && !r.resolved).length;
  const noShowCount = records.filter((r) => r.type === "absent_session" && !r.resolved).length;

  const formatDate = (dateStr: string) => {
    try {
      return formatVietnamDate(dateStr, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }, "vi-VN");
    } catch {
      return dateStr;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "sprint_unlock_late": return t("auth.adminAttendanceTypeSprintLate");
      case "absent_session": return t("auth.adminAttendanceTypeAbsentSession");
      default: return type;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "sprint_unlock_late": return "ri-run-line";
      case "absent_session": return "ri-user-unfollow-line";
      default: return "ri-error-warning-line";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "sprint_unlock_late": return "bg-secondary-100 text-secondary-700 border-secondary-200";
      case "absent_session": return "bg-accent-100 text-accent-700 border-accent-200";
      default: return "bg-background-100 text-foreground-600 border-background-200";
    }
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
        <p className="mt-4 text-sm text-foreground-400">{t("auth.adminAttendanceLoading")}</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-error-warning-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-700 font-medium mb-1">{fetchError}</p>
        <button
          onClick={fetchRecords}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line"></i>
          {t("auth.adminAttendanceRetry")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm text-foreground-500 mb-1">{t("auth.adminAttendanceSubtitle")}</p>
            <h2 className="font-heading text-xl font-bold text-foreground-950">
              {t("auth.adminAttendanceTitle")}
            </h2>
          </div>
          <button
            onClick={handleDetectSprintLate}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-secondary-500 text-background-50 dark:text-foreground-950 hover:bg-secondary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {detecting ? (
              <>
                <i className="ri-loader-4-line animate-spin"></i>
                {t("auth.adminAttendanceScanning")}
              </>
            ) : (
              <>
                <i className="ri-search-line"></i>
                {t("auth.adminAttendanceScanLate")}
              </>
            )}
          </button>
        </div>

        {detectResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm flex items-center gap-2 ${
            detectResultType === "error"
              ? "bg-accent-100 text-accent-700"
              : detectResultType === "none"
                ? "bg-background-100 text-foreground-700"
                : "bg-secondary-100 text-secondary-700"
          }`}>
            <i className={
              detectResultType === "error"
                ? "ri-error-warning-line"
                : detectResultType === "none"
                  ? "ri-information-line"
                  : "ri-alert-line"
            }></i>
            {detectResult}
          </div>
        )}

        {forceCompleteResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm flex items-center gap-2 ${
            forceCompleteResult.startsWith("✅")
              ? "bg-secondary-100 text-secondary-700"
              : "bg-accent-100 text-accent-700"
          }`}>
            <i className={forceCompleteResult.startsWith("✅") ? "ri-check-double-line" : "ri-error-warning-line"}></i>
            {forceCompleteResult}
          </div>
        )}

        {reopenResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm flex items-center gap-2 ${
            reopenResult.startsWith("✅")
              ? "bg-secondary-100 text-secondary-700"
              : "bg-accent-100 text-accent-700"
          }`}>
            <i className={reopenResult.startsWith("✅") ? "ri-refresh-line" : "ri-error-warning-line"}></i>
            {reopenResult}
          </div>
        )}

        {unlockResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm flex items-center gap-2 ${
            unlockResult.startsWith("✅")
              ? "bg-secondary-100 text-secondary-700"
              : "bg-accent-100 text-accent-700"
          }`}>
            <i className={unlockResult.startsWith("✅") ? "ri-key-2-line" : "ri-error-warning-line"}></i>
            {unlockResult}
          </div>
        )}
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div
          onClick={() => setResolvedFilter("unresolved")}
          className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
            resolvedFilter === "unresolved"
              ? "border-accent-300 bg-accent-50/60"
              : "border-background-200/70 bg-background-50 hover:border-accent-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-accent-100 text-accent-600">
              <i className="ri-alert-line text-lg"></i>
            </div>
            <span className="text-2xl font-heading font-bold text-accent-600">{unresolvedCount}</span>
          </div>
          <p className="text-sm font-semibold text-foreground-900">{t("auth.adminAttendanceStatsUnresolved")}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("auth.adminAttendanceStatsUnresolvedHint")}</p>
        </div>
        <div
          onClick={() => { setTypeFilter("sprint_unlock_late"); setResolvedFilter("unresolved"); }}
          className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
            typeFilter === "sprint_unlock_late"
              ? "border-secondary-300 bg-secondary-50/60"
              : "border-background-200/70 bg-background-50 hover:border-secondary-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-secondary-100 text-secondary-600">
              <i className="ri-run-line text-lg"></i>
            </div>
            <span className="text-2xl font-heading font-bold text-secondary-600">{sprintLateCount}</span>
          </div>
          <p className="text-sm font-semibold text-foreground-900">{t("auth.adminAttendanceStatsSprintLate")}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("auth.adminAttendanceStatsSprintLateHint")}</p>
        </div>
        <div
          onClick={() => { setTypeFilter("absent_session"); setResolvedFilter("unresolved"); }}
          className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
            typeFilter === "absent_session"
              ? "border-accent-300 bg-accent-50/60"
              : "border-background-200/70 bg-background-50 hover:border-accent-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-accent-100 text-accent-600">
              <i className="ri-user-unfollow-line text-lg"></i>
            </div>
            <span className="text-2xl font-heading font-bold text-accent-600">{noShowCount}</span>
          </div>
          <p className="text-sm font-semibold text-foreground-900">{t("auth.adminAttendanceStatsAbsent")}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("auth.adminAttendanceStatsAbsentHint")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("auth.adminAttendanceSearchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 px-1 py-1 rounded-full bg-background-100">
          {(["all", "sprint_unlock_late", "absent_session"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                typeFilter === f
                  ? "bg-primary-500 text-background-50 dark:text-foreground-950"
                  : "text-foreground-500 hover:text-foreground-700"
              }`}
            >
              {f === "all" ? t("auth.adminAttendanceFilterAll") : f === "sprint_unlock_late" ? t("auth.adminAttendanceFilterSprintLate") : t("auth.adminAttendanceFilterAbsent")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 px-1 py-1 rounded-full bg-background-100">
          {(["unresolved", "resolved", "all"] as ResolvedFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setResolvedFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                resolvedFilter === f
                  ? "bg-primary-500 text-background-50 dark:text-foreground-950"
                  : "text-foreground-500 hover:text-foreground-700"
              }`}
            >
              {f === "all" ? t("auth.adminAttendanceFilterAll") : f === "unresolved" ? t("auth.adminAttendanceFilterUnresolved") : t("auth.adminAttendanceFilterResolved")}
            </button>
          ))}
        </div>
      </div>

      {/* Records Table */}
      {filteredRecords.length === 0 ? (
        <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
            <i className="ri-check-double-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-900 font-semibold mb-1">{t("auth.adminAttendanceEmpty")}</p>
          <p className="text-xs text-foreground-500">
            {resolvedFilter === "unresolved" ? t("auth.adminAttendanceEmptyUnresolved") : t("auth.adminAttendanceEmptyFiltered")}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-background-200/70 overflow-hidden bg-background-50">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-background-200/70 bg-background-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColLearner")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColCourse")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColType")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColDetail")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColDate")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColStatus")}</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground-500 whitespace-nowrap">{t("auth.adminAttendanceColAction")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    className={`border-b border-background-100 transition-colors ${
                      record.resolved ? "" : "bg-accent-50/20"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/dashboard/history?learner=${record.learner_id}`}
                        className="flex items-center gap-2 group cursor-pointer"
                      >
                        <div className="w-7 h-7 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-[11px] flex-shrink-0">
                          {record.learner_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-foreground-900 group-hover:text-primary-600 transition-colors truncate max-w-[140px]">
                          {record.learner_name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-foreground-600 truncate max-w-[120px] block">
                        {record.course_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${getTypeColor(record.type)}`}>
                        <i className={`${getTypeIcon(record.type)} text-[10px]`}></i>
                        {getTypeLabel(record.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground-500 whitespace-nowrap">
                        {record.type === "sprint_unlock_late" && record.sprint_number
                          ? t("auth.adminAttendanceSprintNum", { num: record.sprint_number })
                          : record.type === "absent_session" && record.session_number
                            ? t("auth.adminAttendanceDetailSeparator", {
                                session: t("auth.adminAttendanceSessionNum", { num: record.session_number }),
                                sprint: record.sprint_number ? t("auth.adminAttendanceSprintNum", { num: record.sprint_number }) : "",
                              })
                            : t("auth.adminAttendanceNone")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground-500 whitespace-nowrap">
                        {formatDate(record.date)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {record.resolved ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                          <i className="ri-check-line"></i>
                          {t("auth.adminAttendanceStatusResolved")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
                          <i className="ri-time-line"></i>
                          {t("auth.adminAttendanceStatusPending")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {!record.resolved ? (
                        <div className="flex items-center justify-center gap-1.5">
                          {record.type === "sprint_unlock_late" && record.related_sprint_id && (
                            <button
                              onClick={() => handleUnlockSprint(record.id, record.related_sprint_id, record.learner_name)}
                              disabled={unlocking === record.id || resolving === record.id || forceCompleting === record.id || reopening === record.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-secondary-500 text-background-50 dark:text-foreground-950 hover:bg-secondary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                              title={t("auth.adminAttendanceActionUnlockTitle")}
                            >
                              {unlocking === record.id ? (
                                <i className="ri-loader-4-line animate-spin text-[10px]"></i>
                              ) : (
                                <i className="ri-key-2-line text-[10px]"></i>
                              )}
                              {t("auth.adminAttendanceActionUnlock")}
                            </button>
                          )}
                          {record.type === "absent_session" && record.related_session_id && (
                            <button
                              onClick={() => handleReopen(record.id, record.learner_name)}
                              disabled={reopening === record.id || resolving === record.id || forceCompleting === record.id || unlocking === record.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-secondary-500 text-background-50 dark:text-foreground-950 hover:bg-secondary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                              title={t("auth.adminAttendanceActionReopenTitle")}
                            >
                              {reopening === record.id ? (
                                <i className="ri-loader-4-line animate-spin text-[10px]"></i>
                              ) : (
                                <i className="ri-refresh-line text-[10px]"></i>
                              )}
                              {t("auth.adminAttendanceActionReopen")}
                            </button>
                          )}
                          {record.related_sprint_id && (
                            <button
                              onClick={() => handleForceComplete(record.id, record.related_sprint_id!)}
                              disabled={forceCompleting === record.id || resolving === record.id || reopening === record.id || unlocking === record.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-accent-500 text-background-50 dark:text-foreground-950 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                              title={t("auth.adminAttendanceActionFCTitle")}
                            >
                              {forceCompleting === record.id ? (
                                <i className="ri-loader-4-line animate-spin text-[10px]"></i>
                              ) : (
                                <i className="ri-rocket-line text-[10px]"></i>
                              )}
                              {t("auth.adminAttendanceActionFC")}
                            </button>
                          )}
                          <button
                            onClick={() => handleResolve(record.id)}
                            disabled={resolving === record.id || forceCompleting === record.id || reopening === record.id || unlocking === record.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-primary-500 text-background-50 dark:text-foreground-950 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                          >
                            {resolving === record.id ? (
                              <i className="ri-loader-4-line animate-spin text-[10px]"></i>
                            ) : (
                              <i className="ri-check-line text-[10px]"></i>
                            )}
                            {t("auth.adminAttendanceStatusResolved")}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-foreground-400">
                          {record.resolved_at ? formatDate(record.resolved_at) : t("auth.adminAttendanceNone")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-foreground-400">
        {t("auth.adminAttendanceSummary", { count: filteredRecords.length, total: records.length })}
      </div>
    </div>
  );
}