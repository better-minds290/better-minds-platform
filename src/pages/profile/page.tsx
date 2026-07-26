import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import { getSupabase } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

interface ProfileData {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
}

interface EnrollmentSettings {
  enrollmentId: string | null;
  courseName: string;
  enrolledAt: string;
  status: string;
}

function ProfileContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const supabase = getSupabase();

  const [profileData, setProfileData] = useState<ProfileData>({
    fullName: "",
    email: "",
    phone: "",
    role: "",
    createdAt: "",
  });
  const [enrollmentSettings, setEnrollmentSettings] = useState<EnrollmentSettings>({
    enrollmentId: null,
    courseName: "",
    enrolledAt: "",
    status: "",
  });

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Editable form state
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    try {
      if (!profile?.id) {
        setLoading(false);
        return;
      }

      // Profile data
      const p: ProfileData = {
        fullName: profile.full_name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        role: profile.role || "",
        createdAt: profile.created_at || "",
      };
      setProfileData(p);
      setEditFullName(p.fullName);
      setEditPhone(p.phone);

      // Enrollment data
      const { data: enrollment, error: enrollError } = await supabase
        .from("enrollments")
        .select("id, study_commitment, preferred_time, auto_sprint_mode, status, enrolled_at, courses(name)")
        .eq("learner_id", profile.id)
        .maybeSingle();

      if (enrollError && !enrollError.message.includes("No rows found")) {
        throw enrollError;
      }

      if (enrollment) {
        const courseName = (enrollment as Record<string, unknown>).courses && typeof (enrollment as Record<string, unknown>).courses === "object"
          ? ((enrollment as Record<string, unknown>).courses as { name?: string }).name || "English Level B1"
          : "English Level B1";

        setEnrollmentSettings({
          enrollmentId: enrollment.id,
          courseName,
          enrolledAt: enrollment.enrolled_at || "",
          status: enrollment.status || "",
        });
      }
    } catch (err) {
      console.error("Profile fetch error:", err);
      setFetchError(t("profile.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [supabase, t, profile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSaveAll = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      // Save profile info
      if (profile?.id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            full_name: editFullName.trim(),
            phone: editPhone.trim() || null,
          })
          .eq("id", profile.id);

        if (profileError) {
          console.error("Profile update error:", profileError);
          throw new Error(t("profile.saveError"));
        }
      }

      // Update local state
      setProfileData((prev) => ({
        ...prev,
        fullName: editFullName.trim(),
        phone: editPhone.trim() || "",
      }));

      setSaveSuccess(t("profile.saveSuccess"));
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("profile.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      const basePath = (__BASE_PATH__ as string) || "/";
      const prefix = basePath === "/" ? "" : basePath;
      window.location.href = `${prefix}/login`;
    }
  };

  const formatDate = (iso: string): string => {
    if (!iso) return "--";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const hasChanges =
    editFullName.trim() !== profileData.fullName ||
    editPhone.trim() !== profileData.phone;

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
        <div className="w-full px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden w-9 h-9 flex items-center justify-center rounded-md text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                aria-label="Toggle menu"
              >
                <i className={mobileMenuOpen ? "ri-close-line text-lg" : "ri-menu-line text-lg"}></i>
              </button>
              <Link to="/dashboard" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to="/dashboard"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("profile.navDashboard")}
                </Link>
                <Link
                  to="/courses"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("profile.navCourses")}
                </Link>
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-primary-600 bg-primary-50 whitespace-nowrap cursor-default">
                  {t("profile.title")}
                </span>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <span className="text-sm font-medium text-foreground-700 hidden lg:inline">
                  {profile?.full_name}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                title={t("profile.signOut")}
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("profile.signOut")}</span>
              </button>
            </div>
          </div>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <Link
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-dashboard-line mr-2"></i>{t("profile.navDashboard")}
                </Link>
                <Link
                  to="/courses"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-book-open-line mr-2"></i>{t("profile.navCourses")}
                </Link>
                <span className="px-3 py-2.5 rounded-md text-sm font-semibold text-primary-600 bg-primary-50 cursor-default">
                  <i className="ri-user-settings-line mr-2"></i>{t("profile.title")}
                </span>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-foreground-400 mb-6">
          <Link to="/dashboard" className="hover:text-foreground-600 transition-colors cursor-pointer">
            {t("profile.navDashboard")}
          </Link>
          <i className="ri-arrow-right-s-line text-xs"></i>
          <span className="text-foreground-600 font-medium">{t("profile.title")}</span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-background-200 rounded-md w-48"></div>
            <div className="h-48 bg-background-200 rounded-lg"></div>
            <div className="h-64 bg-background-200 rounded-lg"></div>
            <div className="h-32 bg-background-200 rounded-lg"></div>
          </div>
        )}

        {/* Error */}
        {!loading && fetchError && (
          <div className="max-w-lg mx-auto text-center py-16">
            <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-accent-100 mb-4">
              <i className="ri-error-warning-line text-2xl text-accent-600"></i>
            </div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">{t("profile.fetchError")}</h2>
            <p className="text-sm text-foreground-500 mb-6">{fetchError}</p>
            <button
              onClick={fetchProfile}
              className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-refresh-line mr-1.5"></i>
              {t("profile.retry")}
            </button>
          </div>
        )}

        {/* Loaded content */}
        {!loading && !fetchError && (
          <>
            {/* Page title */}
            <div className="mb-8">
              <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-1">
                {t("profile.title")}
              </h1>
              <p className="text-sm text-foreground-500">
                {t("profile.subtitle")}
              </p>
            </div>

            {/* Success banner */}
            {saveSuccess && (
              <div className="mb-6 flex items-center gap-2 p-4 rounded-lg bg-accent-100/70 border border-accent-200 text-accent-800 text-sm">
                <i className="ri-check-line text-accent-600"></i>
                {saveSuccess}
              </div>
            )}

            {/* Error banner */}
            {saveError && (
              <div className="mb-6 flex items-center gap-2 p-4 rounded-lg bg-accent-50 border border-accent-200 text-accent-700 text-sm">
                <i className="ri-error-warning-line text-accent-500"></i>
                {saveError}
              </div>
            )}

            <div className="space-y-6">
              {/* Personal Info Section */}
              <section className="bg-background-50 border border-background-200 rounded-lg p-5 md:p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600">
                    <i className="ri-user-line text-lg"></i>
                  </div>
                  <div>
                    <h2 className="font-heading text-base font-bold text-foreground-950">
                      {t("profile.personalInfo")}
                    </h2>
                    <p className="text-xs text-foreground-500">{t("profile.personalInfoDesc")}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Full Name */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                      {t("profile.fullName")}
                    </label>
                    <input
                      type="text"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-md border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                      placeholder={t("profile.fullNamePlaceholder")}
                    />
                  </div>

                  {/* Email (read-only) */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                      {t("profile.email")}
                    </label>
                    <input
                      type="email"
                      value={profileData.email}
                      readOnly
                      className="w-full px-3 py-2.5 rounded-md border border-background-200 bg-background-100 text-sm text-foreground-500 cursor-not-allowed"
                    />
                    <p className="text-xs text-foreground-400 mt-1">{t("profile.emailReadOnly")}</p>
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                      {t("profile.phone")}
                    </label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-md border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                      placeholder={t("profile.phonePlaceholder")}
                    />
                  </div>

                  {/* Role + Member since */}
                  <div className="flex flex-col sm:flex-row gap-4 pt-1">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-md bg-background-100 border border-background-200">
                      <span className="text-xs text-foreground-500 whitespace-nowrap">{t("profile.role")}:</span>
                      <span className="text-sm font-medium text-foreground-800 whitespace-nowrap">
                        {profileData.role === "learner" ? t("profile.roleLearner") : profileData.role}
                      </span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-md bg-background-100 border border-background-200">
                      <span className="text-xs text-foreground-500 whitespace-nowrap">{t("profile.memberSince")}:</span>
                      <span className="text-sm font-medium text-foreground-800 whitespace-nowrap">
                        {formatDate(profileData.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Enrolled Course Section */}
              {enrollmentSettings.enrollmentId && (
                <section className="bg-background-50 border border-background-200 rounded-lg p-5 md:p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600">
                      <i className="ri-book-open-line text-lg"></i>
                    </div>
                    <div>
                      <h2 className="font-heading text-base font-bold text-foreground-950">
                        Khóa Học Của Bạn
                      </h2>
                      <p className="text-xs text-foreground-500">Khóa học bạn đang theo học</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-background-100 border border-background-200">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground-900">{enrollmentSettings.courseName}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-foreground-500">
                          <span className="flex items-center gap-1">
                            <i className="ri-calendar-line"></i>
                            Đã đăng ký: {formatDate(enrollmentSettings.enrolledAt)}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            enrollmentSettings.status === "active" ? "bg-accent-100 text-accent-700" :
                            enrollmentSettings.status === "paused" ? "bg-accent-50 text-accent-600" :
                            "bg-secondary-100 text-secondary-700"
                          }`}>
                            {enrollmentSettings.status === "active" ? "Đang học" :
                             enrollmentSettings.status === "paused" ? "Tạm dừng" :
                             enrollmentSettings.status === "completed" ? "Đã xong" : enrollmentSettings.status}
                          </span>
                        </div>
                      </div>
                      <Link
                        to="/dashboard"
                        className="inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-dashboard-line mr-1.5"></i>
                        Vào Bảng Điều Khiển
                      </Link>
                    </div>
                  </div>
                </section>
              )}

              {/* No enrollment state */}
              {!enrollmentSettings.enrollmentId && (
                <section className="bg-background-50 border border-background-200 rounded-lg p-8 text-center">
                  <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-full bg-background-200 mb-4">
                    <i className="ri-book-open-line text-xl text-foreground-400"></i>
                  </div>
                  <h3 className="font-heading text-base font-bold text-foreground-950 mb-1">
                    {t("profile.noEnrollment")}
                  </h3>
                  <p className="text-sm text-foreground-500 mb-4 max-w-sm mx-auto">
                    {t("profile.noEnrollmentDesc")}
                  </p>
                  <Link
                    to="/courses"
                    className="inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-compass-3-line mr-1.5"></i>
                    {t("profile.browseCourses")}
                  </Link>
                </section>
              )}

              {/* Save Button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditFullName(profileData.fullName);
                    setEditPhone(profileData.phone);
                    setSaveError(null);
                    setSaveSuccess(null);
                  }}
                  disabled={!hasChanges || saving}
                  className="inline-flex items-center px-4 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:text-foreground-800 hover:bg-background-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                >
                  {t("profile.reset")}
                </button>
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={!hasChanges || saving}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                >
                  {saving ? (
                    <>
                      <i className="ri-loader-4-line animate-spin"></i>
                      {t("profile.saving")}
                    </>
                  ) : (
                    <>
                      <i className="ri-check-line"></i>
                      {t("profile.saveChanges")}
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard allowedRoles={["learner"]}>
      <ProfileContent />
    </AuthGuard>
  );
}