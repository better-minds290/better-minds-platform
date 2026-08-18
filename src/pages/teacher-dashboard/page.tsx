import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import AuthGuard from "@/components/base/AuthGuard";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import OverviewTab from "./components/OverviewTab";
import SprintSessionsTab from "./components/SprintSessionsTab";
import FeedbackTab from "./components/FeedbackTab";
import AvailabilityTab from "./components/AvailabilityTab";
import ReportsTab from "./components/ReportsTab";
import NotificationBell from "@/components/feature/NotificationBell";
import { vietnamTodayStr } from "@/lib/datetime";

type TabKey = "overview" | "sessions" | "feedback" | "availability" | "reports";

function TeacherDashboardContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlTab = searchParams.get("tab");
  const validTabs: TabKey[] = ["overview", "sessions", "feedback", "availability", "reports"];
  const initialTab: TabKey = validTabs.includes(urlTab as TabKey) ? (urlTab as TabKey) : "overview";

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const todayStr = vietnamTodayStr();

  const handleTabChange = (tab: TabKey) => {
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

  const roleLabel = () => {
    switch (profile?.role) {
      case "vietnamese_teacher":
        return t("dashboard.roleVNTeacher");
      case "foreign_teacher":
        return t("dashboard.roleForeignTeacher");
      case "admin":
        return t("dashboard.roleAdmin");
      default:
        return t("dashboard.roleTeacher");
    }
  };

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview", label: t("teacher.navOverview"), icon: "ri-dashboard-line" },
    { key: "sessions", label: t("teacher.navSessions"), icon: "ri-calendar-check-line" },
    { key: "feedback", label: t("teacher.navFeedback"), icon: "ri-chat-1-line" },
    { key: "availability", label: t("teacher.navAvailability"), icon: "ri-timer-line" },
    { key: "reports", label: t("teacher.navReports"), icon: "ri-bar-chart-line" },
  ];

  return (
    <div className="min-h-screen bg-background-50">
      <header className="bg-background-50 border-b border-background-200/70 sticky top-0 z-40">
        <div className="w-full px-4 md:px-6">
          <div className="flex items-center justify-between h-16 gap-3">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer flex-shrink-0 whitespace-nowrap">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center bg-background-100 rounded-full p-0.5 min-w-0 flex-1 overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleTabChange(tab.key)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                      activeTab === tab.key
                        ? "bg-background-50 text-foreground-950 shadow-sm"
                        : "text-foreground-500 hover:text-foreground-700"
                    }`}
                  >
                    <i className={`${tab.icon} text-base`}></i>
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Link
                to="/teacher/profile"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
                title={t("teacherProfile.title")}
              >
                <i className="ri-user-settings-line text-base"></i>
              </Link>
              <NotificationBell />
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-background-200/70">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-sm">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || "T"}
                </div>
                <span className="text-sm font-medium text-foreground-700 hidden lg:inline truncate max-w-[10rem]">
                  {profile?.full_name}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("teacher.signOut")}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile tab bar - horizontal scroll */}
      <div className="md:hidden px-4 pt-3 pb-1 bg-background-50 border-b border-background-100 overflow-x-auto">
        <div className="flex items-center bg-background-100 rounded-full p-0.5 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`flex items-center justify-center gap-1 px-3 py-2 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                activeTab === tab.key
                  ? "bg-background-50 text-foreground-950 shadow-sm"
                  : "text-foreground-500"
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <div className="mb-6">
          <p className="text-sm text-foreground-500">
            {t("teacher.welcome")}, {profile?.full_name}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="font-heading text-2xl font-bold text-foreground-950">
              {t("teacher.title")}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
              {roleLabel()}
            </span>
          </div>
        </div>

        {activeTab === "overview" && <OverviewTab todayStr={todayStr} />}
        {activeTab === "sessions" && <SprintSessionsTab />}
        {activeTab === "feedback" && <FeedbackTab />}
        {activeTab === "availability" && <AvailabilityTab />}
        {activeTab === "reports" && <ReportsTab />}
      </main>
    </div>
  );
}

export default function TeacherDashboard() {
  return (
    <AuthGuard allowedRoles={["vietnamese_teacher", "foreign_teacher", "admin"]}>
      <TeacherDashboardContent />
    </AuthGuard>
  );
}