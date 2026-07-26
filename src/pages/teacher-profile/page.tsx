import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import { getSupabase } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

interface TeacherProfileData {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  defaultMeetingLink: string;
  avatarUrl: string;
  createdAt: string;
}

function TeacherProfileContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const supabase = getSupabase();
  const navigate = useNavigate();

  const [profileData, setProfileData] = useState<TeacherProfileData>({
    fullName: "",
    email: "",
    phone: "",
    role: "",
    defaultMeetingLink: "",
    avatarUrl: "",
    createdAt: "",
  });
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editMeetingLink, setEditMeetingLink] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      if (!profile?.id) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email, phone, role, default_meeting_link, avatar_url, created_at")
        .eq("id", profile.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const p: TeacherProfileData = {
          fullName: data.full_name || "",
          email: data.email || "",
          phone: data.phone || "",
          role: data.role || "",
          defaultMeetingLink: data.default_meeting_link || "",
          avatarUrl: data.avatar_url || "",
          createdAt: data.created_at || "",
        };
        setProfileData(p);
        setEditFullName(p.fullName);
        setEditPhone(p.phone);
        setEditMeetingLink(p.defaultMeetingLink);
        setEditAvatarUrl(p.avatarUrl);
      }
    } catch (err) {
      console.error("Teacher profile fetch error:", err);
      setFetchError(t("profile.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [supabase, t, profile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: editFullName.trim(),
          phone: editPhone.trim() || null,
          default_meeting_link: editMeetingLink.trim() || null,
          avatar_url: editAvatarUrl.trim() || null,
        })
        .eq("id", profile!.id);

      if (error) throw error;

      setProfileData((prev) => ({
        ...prev,
        fullName: editFullName.trim(),
        phone: editPhone.trim() || "",
        defaultMeetingLink: editMeetingLink.trim(),
        avatarUrl: editAvatarUrl.trim(),
      }));
      setSaveSuccess(t("profile.saveSuccess"));
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch {
      setSaveError(t("profile.saveError"));
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

  const hasChanges =
    editFullName.trim() !== profileData.fullName ||
    editPhone.trim() !== profileData.phone ||
    editMeetingLink.trim() !== profileData.defaultMeetingLink ||
    editAvatarUrl.trim() !== profileData.avatarUrl;

  const roleLabel = () => {
    switch (profileData.role) {
      case "vietnamese_teacher": return t("dashboard.roleVNTeacher");
      case "foreign_teacher": return t("dashboard.roleForeignTeacher");
      case "admin": return t("dashboard.roleAdmin");
      default: return profileData.role;
    }
  };

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-background-50 border-b border-background-200/70 sticky top-0 z-40">
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
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to="/teacher/dashboard"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <i className="ri-dashboard-line mr-1.5"></i>
                  {t("teacher.navOverview")}
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200/70">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-sm">
                  {profileData.fullName?.charAt(0)?.toUpperCase() || "T"}
                </div>
                <span className="text-sm font-medium text-foreground-700 hidden lg:inline">
                  {profileData.fullName}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("teacher.signOut")}</span>
              </button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200/70 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <Link
                  to="/teacher/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-dashboard-line mr-2"></i>{t("teacher.navOverview")}
                </Link>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-foreground-400 mb-6">
          <Link to="/teacher/dashboard" className="hover:text-foreground-600 transition-colors cursor-pointer">
            {t("teacher.navOverview")}
          </Link>
          <i className="ri-arrow-right-s-line text-xs"></i>
          <span className="text-foreground-600 font-medium">{t("teacherProfile.title")}</span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-background-200 rounded-md w-48"></div>
            <div className="h-48 bg-background-200 rounded-lg"></div>
            <div className="h-40 bg-background-200 rounded-lg"></div>
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
            <div className="mb-8">
              <div className="flex items-center gap-3">
                <h1 className="font-heading text-2xl font-bold text-foreground-950">
                  {t("teacherProfile.title")}
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                  {roleLabel()}
                </span>
              </div>
              <p className="text-sm text-foreground-500 mt-1">
                {t("teacherProfile.subtitle")}
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
                      {t("teacherProfile.personalInfo")}
                    </h2>
                    <p className="text-xs text-foreground-500">{t("teacherProfile.personalInfoDesc")}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Avatar */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-2">
                      {t("teacherProfile.avatar")}
                    </label>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-bold text-xl overflow-hidden shrink-0">
                        {editAvatarUrl ? (
                          <img src={editAvatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          profileData.fullName?.charAt(0)?.toUpperCase() || "T"
                        )}
                      </div>
                      <input
                        type="url"
                        value={editAvatarUrl}
                        onChange={(e) => setEditAvatarUrl(e.target.value)}
                        className="flex-1 px-3 py-2.5 rounded-md border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                        placeholder={t("teacherProfile.avatarPlaceholder")}
                      />
                    </div>
                    <p className="text-xs text-foreground-400 mt-1.5">{t("teacherProfile.avatarHint")}</p>
                  </div>

                  {/* Full Name */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                      {t("teacherProfile.fullName")}
                    </label>
                    <input
                      type="text"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-md border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                      placeholder={t("teacherProfile.fullNamePlaceholder")}
                    />
                  </div>

                  {/* Email (read-only) */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                      {t("teacherProfile.email")}
                    </label>
                    <input
                      type="email"
                      value={profileData.email}
                      readOnly
                      className="w-full px-3 py-2.5 rounded-md border border-background-200 bg-background-100 text-sm text-foreground-500 cursor-not-allowed"
                    />
                    <p className="text-xs text-foreground-400 mt-1">{t("teacherProfile.emailReadOnly")}</p>
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                      {t("teacherProfile.phone")}
                    </label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-md border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                      placeholder={t("teacherProfile.phonePlaceholder")}
                    />
                  </div>
                </div>
              </section>

              {/* Default Meeting Link Section */}
              <section className="bg-background-50 border border-background-200 rounded-lg p-5 md:p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600">
                    <i className="ri-links-line text-lg"></i>
                  </div>
                  <div>
                    <h2 className="font-heading text-base font-bold text-foreground-950">
                      {t("teacherProfile.meetingLinkTitle")}
                    </h2>
                    <p className="text-xs text-foreground-500">{t("teacherProfile.meetingLinkDesc")}</p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-background-100/70 border border-background-200/70">
                  <label className="block text-sm font-medium text-foreground-700 mb-1.5">
                    {t("teacherProfile.defaultMeetingLink")}
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="url"
                      value={editMeetingLink}
                      onChange={(e) => setEditMeetingLink(e.target.value)}
                      className="flex-1 px-4 py-2.5 rounded-md border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                      placeholder="https://meet.google.com/xxx-xxxx-xxx"
                    />
                    {editMeetingLink && (
                      <a
                        href={editMeetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-4 py-2.5 rounded-md text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-external-link-line mr-1.5"></i>
                        {t("teacherProfile.testLink")}
                      </a>
                    )}
                  </div>

                  {/* How it works */}
                  <div className="mt-4 p-3 rounded-md bg-secondary-50/50 border border-secondary-200">
                    <div className="flex items-start gap-2">
                      <i className="ri-information-line text-secondary-500 mt-0.5 flex-shrink-0"></i>
                      <div>
                        <p className="text-xs font-medium text-foreground-800 mb-1">
                          {t("teacherProfile.howItWorks")}
                        </p>
                        <p className="text-xs text-foreground-500 leading-relaxed">
                          {t("teacherProfile.howItWorksDesc")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Benefits */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <div className="flex items-start gap-2 p-2 rounded-md">
                      <i className="ri-flashlight-line text-secondary-500 mt-0.5 flex-shrink-0"></i>
                      <div>
                        <p className="text-xs font-semibold text-foreground-800">{t("teacherProfile.benefit1Title")}</p>
                        <p className="text-[11px] text-foreground-500 leading-relaxed">{t("teacherProfile.benefit1Desc")}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded-md">
                      <i className="ri-refresh-line text-secondary-500 mt-0.5 flex-shrink-0"></i>
                      <div>
                        <p className="text-xs font-semibold text-foreground-800">{t("teacherProfile.benefit2Title")}</p>
                        <p className="text-[11px] text-foreground-500 leading-relaxed">{t("teacherProfile.benefit2Desc")}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded-md">
                      <i className="ri-edit-line text-secondary-500 mt-0.5 flex-shrink-0"></i>
                      <div>
                        <p className="text-xs font-semibold text-foreground-800">{t("teacherProfile.benefit3Title")}</p>
                        <p className="text-[11px] text-foreground-500 leading-relaxed">{t("teacherProfile.benefit3Desc")}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Save Button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditFullName(profileData.fullName);
                    setEditPhone(profileData.phone);
                    setEditMeetingLink(profileData.defaultMeetingLink);
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
                  onClick={handleSave}
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

export default function TeacherProfilePage() {
  return (
    <AuthGuard allowedRoles={["vietnamese_teacher", "foreign_teacher", "admin"]}>
      <TeacherProfileContent />
    </AuthGuard>
  );
}