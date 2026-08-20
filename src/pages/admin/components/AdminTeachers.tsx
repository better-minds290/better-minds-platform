import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import { getCurrentWeekRangeYmd } from "@/lib/datetime";
import {
  buildTeachingSessionUnits,
  fetchTeacherAvailabilityPatterns,
  fetchTeacherUnavailableDatesForWeek,
  fetchTeacherWeeklyWorkloadSource,
  formatDecimalHours,
  summarizeWeeklyAvailabilityHoursByTeacher,
  summarizeWeeklyClassStatsByTeacher,
} from "@/lib/teacherHours";

interface TeacherData {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  created_at: string;
  availabilityHoursThisWeek: number;
  classesThisWeek: number;
  completedClassesThisWeek: number;
  is_active: boolean;
}

interface ToastState {
  visible: boolean;
  type: "success" | "error";
  message: string;
}

export default function AdminTeachers() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [teachers, setTeachers] = useState<TeacherData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [pwModal, setPwModal] = useState<{ open: boolean; userId: string; userName: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwResetting, setPwResetting] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; userId: string; userName: string; email: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, type: "success", message: "" });

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ visible: true, type, message });
    setTimeout(() => setToast({ visible: false, type: "success", message: "" }), 4000);
  };

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const supabase = getSupabase();
      const weekRange = getCurrentWeekRangeYmd();

      const profilesRes = await supabase
        .from("profiles")
        .select("*")
        .in("role", ["vietnamese_teacher", "foreign_teacher"])
        .order("created_at", { ascending: false });

      if (profilesRes.error || !profilesRes.data || profilesRes.data.length === 0) {
        setTeachers([]);
        return;
      }

      const teacherIds = profilesRes.data.map((p) => p.id);

      const [workloadSource, availabilityPatterns, unavailableDates] = await Promise.all([
        fetchTeacherWeeklyWorkloadSource(supabase, weekRange),
        fetchTeacherAvailabilityPatterns(supabase, teacherIds),
        fetchTeacherUnavailableDatesForWeek(supabase, teacherIds, weekRange),
      ]);

      const units = buildTeachingSessionUnits(workloadSource);
      const availabilityByTeacher = summarizeWeeklyAvailabilityHoursByTeacher(
        availabilityPatterns,
        teacherIds,
        weekRange,
        unavailableDates
      );
      const classStatsByTeacher = summarizeWeeklyClassStatsByTeacher(units, teacherIds, weekRange);

      const merged: TeacherData[] = profilesRes.data.map((p) => {
        const classStats = classStatsByTeacher.get(p.id) || {
          classesThisWeek: 0,
          completedClassesThisWeek: 0,
        };

        return {
          id: p.id,
          full_name: p.full_name || "Unknown",
          email: p.email || "",
          phone: p.phone || "",
          role: p.role || "vietnamese_teacher",
          created_at: p.created_at || "",
          availabilityHoursThisWeek: availabilityByTeacher.get(p.id) || 0,
          classesThisWeek: classStats.classesThisWeek,
          completedClassesThisWeek: classStats.completedClassesThisWeek,
          is_active: p.is_active !== false,
        };
      });

      setTeachers(merged);
    } catch (err) {
      console.error("Failed to fetch teachers:", err);
      setTeachers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  const filtered = teachers.filter((teacher) => {
    const matchSearch =
      !search ||
      teacher.full_name.toLowerCase().includes(search.toLowerCase()) ||
      teacher.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || teacher.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleToggleActive = async (teacherId: string, currentActive: boolean) => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: !currentActive })
        .eq("id", teacherId);

      if (error) throw error;

      showToast("success", currentActive ? t("auth.adminTeacherDeactivated") : t("auth.adminTeacherActivated"));
      fetchTeachers();
    } catch (err) {
      console.error("Toggle teacher active error:", err);
      showToast("error", t("auth.adminTeacherToggleFailed"));
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

  const handleDeleteAccount = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      const supabase = getSupabase();
      const { data, error: fnError } = await supabase.functions.invoke("admin-delete-teacher", {
        body: { user_id: deleteModal.userId },
      });

      if (fnError) {
        showToast("error", fnError.message || t("auth.adminDeleteTeacherFailed"));
        return;
      }
      if (data?.error) {
        showToast("error", data.error);
        return;
      }

      showToast("success", deleteModal.userName + t("auth.adminDeleteTeacherSuccess"));
      setDeleteModal(null);
      await fetchTeachers();
    } catch (err) {
      console.error("Delete teacher error:", err);
      showToast("error", err instanceof Error ? err.message : t("auth.adminDeleteTeacherFailed"));
    } finally {
      setDeleting(false);
    }
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

      {/* Delete Teacher Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-background-50 rounded-2xl w-full max-w-md mx-4 shadow-xl border border-background-200 overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 mx-auto mb-4">
                <i className="ri-user-unfollow-line text-xl"></i>
              </div>
              <h3 className="text-lg font-bold text-foreground-950 text-center">
                {t("auth.adminDeleteTeacherTitle")}
              </h3>
              <p className="text-xs text-foreground-500 text-center mt-1">{deleteModal.userName}</p>
              <p className="text-xs text-foreground-400 text-center">{deleteModal.email}</p>
              <div className="mt-5 p-4 rounded-xl bg-accent-50 border border-accent-200">
                <p className="text-sm font-medium text-accent-800 mb-2">
                  {t("auth.adminDeleteTeacherWarning")}
                </p>
                <ul className="space-y-1.5 text-xs text-accent-700">
                  <li className="flex items-start gap-1.5">
                    <i className="ri-checkbox-blank-circle-fill text-[6px] mt-1.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteTeacherDesc1")}
                  </li>
                  <li className="flex items-start gap-1.5">
                    <i className="ri-checkbox-blank-circle-fill text-[6px] mt-1.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteTeacherDesc2")}
                  </li>
                  <li className="flex items-start gap-1.5">
                    <i className="ri-checkbox-blank-circle-fill text-[6px] mt-1.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteTeacherDesc3")}
                  </li>
                  <li className="flex items-start gap-1.5">
                    <i className="ri-checkbox-blank-circle-fill text-[6px] mt-1.5 flex-shrink-0"></i>
                    {t("auth.adminDeleteTeacherDesc4")}
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
                      {t("auth.adminDeleteTeacherDeleting")}
                    </>
                  ) : (
                    t("auth.adminDeleteTeacherConfirm")
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
          {t("auth.adminTeacherManagement")}
        </h2>
        <p className="text-sm text-foreground-500">{t("auth.adminTeacherSubtitle")}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("auth.adminSearchTeachers")}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
        >
          <option value="all">{t("auth.adminAllRoles")}</option>
          <option value="vietnamese_teacher">{t("dashboard.roleVNTeacher")}</option>
          <option value="foreign_teacher">{t("dashboard.roleForeignTeacher")}</option>
        </select>
      </div>

      {error && (
        <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-center gap-2.5">
          <i className="ri-error-warning-line text-base flex-shrink-0"></i>
          <span>{error}</span>
          <button
            onClick={fetchTeachers}
            className="ml-auto text-accent-700 font-medium hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-sm text-foreground-400">Loading teachers...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-4">
            <i className="ri-user-search-line text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.adminNoTeachers")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-background-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background-100/70">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminName")}
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider hidden md:table-cell">
                  {t("auth.adminEmail")}
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminRole")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminAvailabilityHoursThisWeek")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminClassesThisWeek")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminCompletedClassesThisWeek")}
                </th>
                <th className="text-center px-5 py-3.5 text-xs font-semibold text-foreground-500 uppercase tracking-wider">
                  {t("auth.adminActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-background-200">
              {filtered.map((teacher) => (
                <tr key={teacher.id} className="hover:bg-background-50/70 transition-colors duration-150">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary-100 text-secondary-700 font-semibold text-xs flex-shrink-0">
                        {teacher.full_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground-900 whitespace-nowrap">
                        {teacher.full_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-foreground-600 hidden md:table-cell">{teacher.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                      teacher.role === "foreign_teacher"
                        ? "bg-accent-100 text-accent-700"
                        : "bg-secondary-100 text-secondary-700"
                    }`}>
                      {t(teacher.role === "foreign_teacher" ? "dashboard.roleForeignTeacher" : "dashboard.roleVNTeacher")}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center text-foreground-900 font-medium">
                    {formatDecimalHours(teacher.availabilityHoursThisWeek)}
                  </td>
                  <td className="px-5 py-3.5 text-center text-foreground-900 font-medium">
                    {teacher.classesThisWeek}
                  </td>
                  <td className="px-5 py-3.5 text-center text-foreground-900 font-medium">
                    {teacher.completedClassesThisWeek}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() =>
                          setPwModal({ open: true, userId: teacher.id, userName: teacher.full_name })
                        }
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 border border-secondary-200 transition-colors cursor-pointer"
                        title={t("auth.adminResetPassword")}
                      >
                        <i className="ri-key-2-line"></i>
                      </button>
                      <button
                        onClick={() => handleToggleActive(teacher.id, teacher.is_active)}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          teacher.is_active
                            ? "bg-accent-50 text-accent-600 hover:bg-accent-100 border border-accent-200"
                            : "bg-accent-50 text-accent-600 hover:bg-accent-100 border border-accent-200"
                        }`}
                        title={teacher.is_active ? t("auth.adminTeacherDeactivateTitle") : t("auth.adminTeacherActivateTitle")}
                      >
                        <i className={teacher.is_active ? "ri-toggle-fill text-base" : "ri-toggle-line text-base"}></i>
                        {teacher.is_active ? t("auth.adminActivate") : t("auth.adminDeactivate")}
                      </button>
                      <button
                        onClick={() =>
                          setDeleteModal({
                            open: true,
                            userId: teacher.id,
                            userName: teacher.full_name,
                            email: teacher.email,
                          })
                        }
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium bg-accent-50 text-accent-700 hover:bg-accent-100 border border-accent-200 transition-colors cursor-pointer"
                        title={t("auth.adminDeleteTeacherTitle")}
                      >
                        <i className="ri-delete-bin-line"></i>
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
        {filtered.length} / {teachers.length} {t("auth.adminTeachers").toLowerCase()}
      </p>
    </div>
  );
}