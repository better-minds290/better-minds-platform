import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import { Link } from "react-router-dom";
import { deriveLearnerLifecycle, type LearnerLifecycleStatus } from "@/lib/learnerLifecycle";
import { formatVietnamDate } from "@/lib/datetime";

interface LearnerData {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  created_at: string;
  enrolledClass: string;
  enrollment_id: string | null;
  enrollment_status: string;
  missed_deadlines: number;
  course_name: string;
  status: LearnerLifecycleStatus;
}

interface ToastState {
  visible: boolean;
  type: "success" | "error";
  message: string;
}

export default function AdminLearners() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [learners, setLearners] = useState<LearnerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetModal, setResetModal] = useState<{ open: boolean; enrollmentId: string; learnerName: string; missedCount: number } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, type: "success", message: "" });

  const [pwModal, setPwModal] = useState<{ open: boolean; userId: string; userName: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwResetting, setPwResetting] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{ open: boolean; userId: string; userName: string; email: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [completeModal, setCompleteModal] = useState<{
    open: boolean;
    enrollmentId: string;
    learnerName: string;
    courseName: string;
  } | null>(null);
  const [completing, setCompleting] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ visible: true, type, message });
    setTimeout(() => setToast({ visible: false, type: "success", message: "" }), 4000);
  };

  const fetchLearners = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabase();

      const [profilesRes, classEnrollRes, enrollRes, classesRes, coursesRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("role", "learner").order("created_at", { ascending: false }),
        supabase.from("class_enrollments").select("student_id, class_id"),
        supabase.from("enrollments").select("id, learner_id, course_id, status, missed_deadlines"),
        supabase.from("classes").select("id, name"),
        supabase.from("courses").select("id, name"),
      ]);

      if (profilesRes.error || !profilesRes.data || profilesRes.data.length === 0) {
        setLearners([]);
        return;
      }

      const classMap = new Map<string, string>();
      (classesRes.data || []).forEach((c) => classMap.set(c.id, c.name));

      const courseMap = new Map<string, string>();
      (coursesRes.data || []).forEach((c) => courseMap.set(c.id, c.name));

      const studentClass = new Map<string, string>();
      (classEnrollRes.data || []).forEach((ce) => {
        const className = classMap.get(ce.class_id) || "-";
        studentClass.set(ce.student_id, className);
      });

      // Prefer an active enrollment over completed when a learner has multiple rows
      const learnerEnrollment = new Map<string, { id: string; status: string; missed: number; courseName: string }>();
      (enrollRes.data || []).forEach((en) => {
        const existing = learnerEnrollment.get(en.learner_id);
        const nextStatus = en.status || "";
        const preferNext =
          !existing ||
          (nextStatus === "active" || nextStatus === "paused") ||
          (existing.status === "completed" && nextStatus !== "completed");
        if (!preferNext) return;
        learnerEnrollment.set(en.learner_id, {
          id: en.id,
          status: nextStatus,
          missed: en.missed_deadlines || 0,
          courseName: courseMap.get(en.course_id) || "-",
        });
      });

      const merged: LearnerData[] = profilesRes.data.map((p) => {
        const enr = learnerEnrollment.get(p.id);
        const className = studentClass.get(p.id) || "-";
        const enrollStatus = enr?.status || "";
        const status = deriveLearnerLifecycle(enr ? [enrollStatus] : []);

        return {
          id: p.id,
          full_name: p.full_name || "Unknown",
          email: p.email || "",
          phone: p.phone || "",
          role: p.role || "learner",
          created_at: p.created_at || "",
          enrolledClass: className,
          enrollment_id: enr?.id || null,
          enrollment_status: enrollStatus || status,
          missed_deadlines: enr?.missed || 0,
          course_name: enr?.courseName || "-",
          status,
        };
      });

      setLearners(merged);
    } catch (err) {
      console.error("Failed to fetch learners:", err);
      setLearners([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLearners();
  }, [fetchLearners]);

  const handleReset = async () => {
    if (!resetModal) return;
    setResetting(true);
    try {
      const supabase = getSupabase();
      const { error: fnError } = await supabase.functions.invoke("reset-learner", {
        body: { enrollment_id: resetModal.enrollmentId },
      });

      if (fnError) {
        showToast("error", t("auth.adminResetFailed"));
      } else {
        showToast("success", resetModal.learnerName + t("auth.adminResetSuccess"));
        setResetModal(null);
        // Refresh the list
        await fetchLearners();
      }
    } catch {
      showToast("error", t("auth.adminResetFailed"));
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const { data, error: fnError } = await supabase.functions.invoke("admin-delete-learner", {
        body: { user_id: deleteModal.userId },
      });

      if (fnError) {
        showToast("error", fnError.message || t("auth.adminDeleteLearnerFailed"));
        return;
      }
      if (data?.error) {
        showToast("error", data.error);
        return;
      }

      showToast("success", deleteModal.userName + t("auth.adminDeleteLearnerSuccess"));
      setDeleteModal(null);
      await fetchLearners();
    } catch (err) {
      console.error("Delete learner error:", err);
      showToast("error", err instanceof Error ? err.message : t("auth.adminDeleteLearnerFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleMarkCompleted = async () => {
    if (!completeModal) return;
    setCompleting(true);
    try {
      const supabase = getSupabase();
      const { data, error: fnError } = await supabase.functions.invoke("mark-learner-completed", {
        body: { enrollment_id: completeModal.enrollmentId },
      });

      if (fnError) {
        showToast("error", fnError.message || t("auth.adminMarkCompletedFailed"));
        return;
      }
      if (data?.error) {
        showToast("error", data.error);
        return;
      }

      showToast("success", t("auth.adminMarkCompletedSuccess", { name: completeModal.learnerName }));
      setCompleteModal(null);
      await fetchLearners();
    } catch (err) {
      console.error("Mark completed error:", err);
      showToast("error", err instanceof Error ? err.message : t("auth.adminMarkCompletedFailed"));
    } finally {
      setCompleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!pwModal || !newPassword.trim()) return;
    if (newPassword.length < 8) {
      showToast("error", t("auth.passwordTooShort"));
      return;
    }
    setPwResetting(true);
    try {
      const supabase = getSupabase();
      const { error: fnError } = await supabase.functions.invoke("admin-reset-password", {
        body: { user_id: pwModal.userId, new_password: newPassword.trim() },
      });

      if (fnError) {
        showToast("error", t("auth.adminResetPasswordFailed"));
      } else {
        showToast("success", pwModal.userName + t("auth.adminResetPasswordSuccess"));
        setPwModal(null);
        setNewPassword("");
      }
    } catch {
      showToast("error", t("auth.adminResetPasswordFailed"));
    } finally {
      setPwResetting(false);
    }
  };

  const filtered = learners.filter((l) => {
    const matchSearch =
      !search ||
      l.full_name.toLowerCase().includes(search.toLowerCase()) ||
      l.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const getStatusBadge = (status: LearnerLifecycleStatus) => {
    switch (status) {
      case "active":
        return "bg-accent-100 text-accent-700";
      case "completed":
        return "bg-secondary-100 text-secondary-700";
      default:
        return "bg-background-200 text-foreground-500";
    }
  };

  const getStatusLabel = (status: LearnerLifecycleStatus) => {
    if (status === "active") return t("auth.adminActive");
    if (status === "completed") return t("auth.adminCompleted");
    return t("auth.adminPending");
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    return formatVietnamDate(dateStr, { month: "short", day: "numeric", year: "numeric" }, "en-US");
  };

  return (
    <div>
      {/* Toast */}
      {toast.visible && (
        <div
          className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 ${
            toast.type === "success"
              ? "bg-accent-500 text-background-50"
              : "bg-accent-50 text-accent-700 border border-accent-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <i className={toast.type === "success" ? "ri-check-line" : "ri-error-warning-line"}></i>
            {toast.message}
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl w-full max-w-md mx-4 shadow-xl border border-background-200 overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 mx-auto mb-4">
                <i className="ri-refresh-line text-xl"></i>
              </div>
              <h3 className="text-lg font-bold text-foreground-950 text-center">
                {t("auth.adminResetConfirm")}
              </h3>
              <p className="text-xs text-foreground-500 text-center mt-1">{resetModal.learnerName}</p>
              <div className="mt-5 p-4 rounded-xl bg-background-100">
                <p className="text-sm text-foreground-700">
                  {t("auth.adminResetLearnerDesc")}
                </p>
                <ul className="mt-3 space-y-1.5">
                  <li className="flex items-center gap-2 text-xs text-foreground-600">
                    <i className="ri-check-line text-accent-600"></i>
                    {t("auth.adminResetDesc1")}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-foreground-600">
                    <i className="ri-check-line text-accent-600"></i>
                    {t("auth.adminResetDesc2")}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-foreground-600">
                    <i className="ri-check-line text-accent-600"></i>
                    {t("auth.adminResetDesc3")}
                  </li>
                </ul>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setResetModal(null)}
                  disabled={resetting}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-700 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {t("auth.adminCancel")}
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {resetting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                      {t("auth.adminResetting")}
                    </>
                  ) : (
                    t("auth.adminResetConfirm")
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark Completed Confirmation Modal */}
      {completeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl w-full max-w-md mx-4 shadow-xl border border-background-200 overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-700 mx-auto mb-4">
                <i className="ri-checkbox-circle-line text-xl"></i>
              </div>
              <h3 className="text-lg font-bold text-foreground-950 text-center">
                {t("auth.adminMarkCompletedTitle")}
              </h3>
              <p className="text-xs text-foreground-500 text-center mt-1">{completeModal.learnerName}</p>
              <div className="mt-5 p-4 rounded-xl bg-background-100">
                <p className="text-sm text-foreground-700">
                  {t("auth.adminMarkCompletedDesc", { course: completeModal.courseName })}
                </p>
                <ul className="mt-3 space-y-1.5">
                  <li className="flex items-center gap-2 text-xs text-foreground-600">
                    <i className="ri-check-line text-secondary-600"></i>
                    {t("auth.adminMarkCompletedKeepHistory")}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-foreground-600">
                    <i className="ri-check-line text-secondary-600"></i>
                    {t("auth.adminMarkCompletedKeepLogin")}
                  </li>
                  <li className="flex items-center gap-2 text-xs text-foreground-600">
                    <i className="ri-close-line text-accent-600"></i>
                    {t("auth.adminMarkCompletedStopOps")}
                  </li>
                </ul>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setCompleteModal(null)}
                  disabled={completing}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-700 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {t("auth.adminCancel")}
                </button>
                <button
                  onClick={handleMarkCompleted}
                  disabled={completing}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-secondary-500 text-background-50 hover:bg-secondary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {completing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                      {t("auth.adminMarkCompleting")}
                    </>
                  ) : (
                    t("auth.adminMarkCompletedConfirm")
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl w-full max-w-md mx-4 shadow-xl border border-background-200 overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 mx-auto mb-4">
                <i className="ri-delete-bin-line text-xl"></i>
              </div>
              <h3 className="text-lg font-bold text-foreground-950 text-center">
                {t("auth.adminDeleteLearnerTitle")}
              </h3>
              <p className="text-xs text-foreground-500 text-center mt-1">{deleteModal.userName}</p>
              <p className="text-xs text-foreground-400 text-center">{deleteModal.email}</p>
              <div className="mt-5 p-4 rounded-xl bg-accent-50 border border-accent-200">
                <p className="text-sm text-accent-800 font-medium">
                  {t("auth.adminDeleteLearnerWarning")}
                </p>
                <ul className="mt-3 space-y-1.5">
                  <li className="flex items-start gap-2 text-xs text-accent-700">
                    <i className="ri-close-circle-line mt-0.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteLearnerDesc1")}
                  </li>
                  <li className="flex items-start gap-2 text-xs text-accent-700">
                    <i className="ri-close-circle-line mt-0.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteLearnerDesc2")}
                  </li>
                  <li className="flex items-start gap-2 text-xs text-accent-700">
                    <i className="ri-close-circle-line mt-0.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteLearnerDesc3")}
                  </li>
                  <li className="flex items-start gap-2 text-xs text-accent-700">
                    <i className="ri-information-line mt-0.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteLearnerDesc4")}
                  </li>
                </ul>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setDeleteModal(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-700 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {t("auth.adminCancel")}
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-600 text-background-50 hover:bg-accent-700 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                      {t("auth.adminDeleteLearnerDeleting")}
                    </>
                  ) : (
                    t("auth.adminDeleteLearnerConfirm")
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {pwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl w-full max-w-md mx-4 shadow-xl border border-background-200 overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-600 mx-auto mb-4">
                <i className="ri-key-2-line text-xl"></i>
              </div>
              <h3 className="text-lg font-bold text-foreground-950 text-center">
                {t("auth.adminResetPasswordTitle")}
              </h3>
              <p className="text-xs text-foreground-500 text-center mt-1">{pwModal.userName}</p>
              <div className="mt-5 p-4 rounded-xl bg-background-100">
                <p className="text-sm text-foreground-700">
                  {t("auth.adminResetPasswordDesc")}
                </p>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                    {t("auth.adminResetPasswordLabel")}
                  </label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("auth.adminResetPasswordPlaceholder")}
                    className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all"
                  />
                  <p className="mt-1.5 text-xs text-foreground-400">
                    {t("auth.adminResetPasswordHint")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => { setPwModal(null); setNewPassword(""); }}
                  disabled={pwResetting}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-700 hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {t("auth.adminCancel")}
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={pwResetting || newPassword.length < 8}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {pwResetting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                      {t("auth.adminResetPasswordResetting")}
                    </>
                  ) : (
                    t("auth.adminResetPasswordButton")
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8">
        <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
          {t("auth.adminLearnerManagement")}
        </h2>
        <p className="text-sm text-foreground-500">{t("auth.adminLearnerSubtitle")}</p>
      </div>

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
          <option value="pending">{t("auth.adminPending")}</option>
          <option value="active">{t("auth.adminActive")}</option>
          <option value="completed">{t("auth.adminCompleted")}</option>
        </select>
      </div>

      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchLearners}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-foreground-400">{t("auth.adminLoadingLearners")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-4">
            <i className="ri-user-search-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.adminNoLearners")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-background-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background-100/70">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminName")}
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminEmail")}
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden md:table-cell">
                  {t("auth.adminPhone")}
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden lg:table-cell">
                  {t("auth.adminEnrolledClass")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminMissed")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminStatus")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-background-200">
              {filtered.map((learner) => (
                <tr key={learner.id} className="hover:bg-background-50/70 transition-colors duration-150">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-xs flex-shrink-0">
                        {learner.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground-900 whitespace-nowrap">
                        {learner.full_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-foreground-600">{learner.email}</td>
                  <td className="px-5 py-3.5 text-foreground-600 hidden md:table-cell">{learner.phone || "-"}</td>
                  <td className="px-5 py-3.5 text-foreground-600 hidden lg:table-cell">{learner.enrolledClass}</td>
                  <td className="px-5 py-3.5 text-center">
                    {learner.missed_deadlines > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-bold bg-accent-50 text-accent-600 border border-accent-200">
                        {learner.missed_deadlines}
                      </span>
                    ) : (
                      <span className="text-foreground-400 text-xs">0</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getStatusBadge(learner.status)}`}
                    >
                      {getStatusLabel(learner.status)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {/* Assign Session quick-link */}
                      {learner.enrollment_id && learner.status === "active" && (
                        <Link
                          to={`/admin?tab=assign&learnerId=${learner.id}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium bg-primary-100 text-primary-700 hover:bg-primary-200 border border-primary-200 transition-colors cursor-pointer"
                          title={t("auth.adminAssignLearner")}
                        >
                          <i className="ri-user-follow-line"></i>
                        </Link>
                      )}
                      <button
                        onClick={() =>
                          setPwModal({ open: true, userId: learner.id, userName: learner.full_name })
                        }
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 border border-secondary-200 transition-colors cursor-pointer"
                        title={t("auth.adminResetPassword")}
                      >
                        <i className="ri-key-2-line"></i>
                      </button>
                      {learner.status === "active" && learner.enrollment_id && (
                        <button
                          onClick={() =>
                            setCompleteModal({
                              open: true,
                              enrollmentId: learner.enrollment_id!,
                              learnerName: learner.full_name,
                              courseName: learner.course_name,
                            })
                          }
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium bg-secondary-50 text-secondary-700 hover:bg-secondary-100 border border-secondary-200 transition-colors cursor-pointer"
                          title={t("auth.adminMarkCompleted")}
                        >
                          <i className="ri-checkbox-circle-line"></i>
                        </button>
                      )}
                      {learner.missed_deadlines > 0 && learner.enrollment_id && learner.status === "active" && (
                        <button
                          onClick={() =>
                            setResetModal({
                              open: true,
                              enrollmentId: learner.enrollment_id!,
                              learnerName: learner.full_name,
                              missedCount: learner.missed_deadlines,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 border border-accent-200 transition-colors cursor-pointer whitespace-nowrap"
                          title={t("auth.adminResetLearner")}
                        >
                          <i className="ri-refresh-line"></i>
                          {t("auth.adminResetMissed")}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setDeleteModal({
                            open: true,
                            userId: learner.id,
                            userName: learner.full_name,
                            email: learner.email,
                          })
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 border border-accent-200 transition-colors cursor-pointer whitespace-nowrap"
                        title={t("auth.adminDeleteLearnerTitle")}
                      >
                        <i className="ri-delete-bin-line text-base"></i>
                        {t("auth.adminDeleteLearner")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-foreground-400">
        {filtered.length} / {learners.length} {t("auth.adminLearners").toLowerCase()}
      </p>
    </div>
  );
}