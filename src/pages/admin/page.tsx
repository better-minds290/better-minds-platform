import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import AuthGuard from "@/components/base/AuthGuard";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminOverview from "./components/AdminOverview";
import AdminLearners from "./components/AdminLearners";
import AdminTeachers from "./components/AdminTeachers";
import AdminCourses from "./components/AdminCourses";
import AdminClasses from "./components/AdminClasses";
import AdminSprints from "./components/AdminSprints";
import AdminCreateAccount from "./components/AdminCreateAccount";
import AdminReports from "./components/AdminReports";
import AdminAssignLearner from "./components/AdminAssignLearner";
import AdminBroadcast from "./components/AdminBroadcast";
import AdminLearnerAttendance from "./components/AdminLearnerAttendance";
import AdminCalendar from "./components/AdminCalendar";

type AdminTab = "overview" | "learners" | "teachers" | "courses" | "classes" | "sprints" | "reports" | "create" | "assign" | "broadcast" | "calendar" | "attendance";

const tabs: { key: AdminTab; icon: string; labelKey: string }[] = [
  { key: "overview", icon: "ri-dashboard-line", labelKey: "auth.adminOverview" },
  { key: "learners", icon: "ri-user-line", labelKey: "auth.adminLearners" },
  { key: "teachers", icon: "ri-team-line", labelKey: "auth.adminTeachers" },
  { key: "courses", icon: "ri-book-open-line", labelKey: "auth.adminCourses" },
  { key: "classes", icon: "ri-building-2-line", labelKey: "auth.adminClasses" },
  { key: "sprints", icon: "ri-run-line", labelKey: "auth.adminSprints" },
  { key: "reports", icon: "ri-bar-chart-line", labelKey: "auth.adminReports" },
  { key: "create", icon: "ri-user-add-line", labelKey: "auth.adminCreateAccountNav" },
  { key: "assign", icon: "ri-user-follow-line", labelKey: "auth.adminAssignLearner" },
  { key: "broadcast", icon: "ri-notification-3-line", labelKey: "auth.adminBroadcast" },
  { key: "calendar", icon: "ri-calendar-schedule-line", labelKey: "auth.adminCalendar" },
  { key: "attendance", icon: "ri-alert-line", labelKey: "auth.adminLearnerAttendance" },
];

function AdminDashboardContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlTab = searchParams.get("tab");
  const validTabs: AdminTab[] = tabs.map((t) => t.key);
  const initialTab: AdminTab = validTabs.includes(urlTab as AdminTab) ? (urlTab as AdminTab) : "overview";

  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const assignLearnerId = searchParams.get("learnerId") || undefined;

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
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

  return (
    <div className="min-h-screen bg-background-50">
      <header className="bg-background-50 border-b border-background-200 sticky top-0 z-40">
        <div className="w-full px-4 md:px-6">
          <div className="flex items-center justify-between h-16 gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden w-9 h-9 flex items-center justify-center rounded-md text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                aria-label="Toggle menu"
              >
                <i className={mobileMenuOpen ? "ri-close-line text-lg" : "ri-menu-line text-lg"}></i>
              </button>
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer whitespace-nowrap">
                Better Minds
              </Link>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-sm">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || "A"}
                </div>
                <span className="text-sm font-medium text-foreground-700 hidden xl:inline truncate max-w-[10rem]">
                  {profile?.full_name}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("auth.adminSignOut")}</span>
              </button>
            </div>
          </div>
          {/* Desktop tab bar — second row to avoid horizontal page overflow */}
          <nav className="hidden lg:flex items-center gap-1 pb-3 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex-shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  activeTab === tab.key
                    ? "text-primary-600 bg-primary-50"
                    : "text-foreground-500 hover:text-foreground-700 hover:bg-background-100"
                }`}
              >
                <i className={tab.icon}></i>
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="lg:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-0.5 px-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => { handleTabChange(tab.key); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium cursor-pointer transition-colors ${
                      activeTab === tab.key
                        ? "text-primary-600 bg-primary-50 font-semibold"
                        : "text-foreground-600 hover:bg-background-100"
                    }`}
                  >
                    <i className={tab.icon}></i>
                    {t(tab.labelKey)}
                  </button>
                ))}
              </nav>
            </div>
          )}
          {/* Compact horizontal tabs below lg when menu closed */}
          {!mobileMenuOpen && (
            <div className="lg:hidden flex items-center gap-1 pb-3 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    activeTab === tab.key
                      ? "text-primary-600 bg-primary-50"
                      : "text-foreground-500 hover:text-foreground-700"
                  }`}
                >
                  <i className={tab.icon}></i>
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <div className="mb-8">
          <p className="text-sm text-foreground-500">
            {t("auth.adminWelcomeBack")}, {profile?.full_name}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="font-heading text-2xl font-bold text-foreground-950">
              {t("auth.adminDashboard")}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 whitespace-nowrap">
              {t("dashboard.roleAdmin")}
            </span>
          </div>
        </div>

        {activeTab === "overview" && <AdminOverview />}
        {activeTab === "learners" && <AdminLearners />}
        {activeTab === "teachers" && <AdminTeachers />}
        {activeTab === "courses" && <AdminCourses />}
        {activeTab === "classes" && <AdminClasses />}
        {activeTab === "sprints" && <AdminSprints />}
        {activeTab === "reports" && <AdminReports />}
        {activeTab === "create" && <AdminCreateAccount />}
        {activeTab === "assign" && <AdminAssignLearner preselectedLearnerId={assignLearnerId} />}
        {activeTab === "broadcast" && <AdminBroadcast />}
        {activeTab === "calendar" && <AdminCalendar />}
        {activeTab === "attendance" && <AdminLearnerAttendance />}
      </main>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <AuthGuard allowedRoles={["admin"]}>
      <AdminDashboardContent />
    </AuthGuard>
  );
}