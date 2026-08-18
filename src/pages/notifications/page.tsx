import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import AuthGuard from "@/components/base/AuthGuard";
import NotificationBell from "@/components/feature/NotificationBell";
import { formatVietnamDate } from "@/lib/datetime";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  action_url: string | null;
  related_schedule_id: string | null;
}

function getRelativeTime(dateStr: string, t: (key: string, options?: any) => string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;

  if (diffMs < 60000) return t("notifications.justNow");
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return t("notifications.minutesAgo", { count: diffMin });
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return t("notifications.hoursAgo", { count: diffHrs });
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 1) return t("notifications.hoursAgo", { count: diffHrs });
  if (diffDays < 7) return t("notifications.daysAgo", { count: diffDays });

  return formatVietnamDate(dateStr, {
    month: "short",
    day: "numeric",
  }, "en-US");
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "feedback": return "ri-chat-1-line";
    case "deadline": return "ri-timer-line";
    case "material": return "ri-folder-line";
    case "reminder": return "ri-notification-3-line";
    case "auto_pause": return "ri-pause-circle-line";
    case "class": return "ri-calendar-check-line";
    default: return "ri-information-line";
  }
}

function getTypeColor(type: string): string {
  switch (type) {
    case "feedback": return "text-accent-600 bg-accent-100";
    case "deadline": return "text-secondary-600 bg-secondary-100";
    case "material": return "text-primary-600 bg-primary-100";
    case "reminder": return "text-accent-600 bg-accent-100";
    case "auto_pause": return "text-accent-600 bg-accent-100";
    case "class": return "text-primary-600 bg-primary-100";
    default: return "text-foreground-600 bg-background-100";
  }
}

function getTypeLabel(type: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    feedback: t("notifications.typeFeedback"),
    deadline: t("notifications.typeDeadline"),
    material: t("notifications.typeMaterial"),
    reminder: t("notifications.typeReminder"),
    system: t("notifications.typeSystem"),
    auto_pause: t("notifications.typeAutoPause"),
    class: t("notifications.typeClass"),
    session_complete: t("notifications.typeSessionComplete"),
  };
  return labels[type] || type;
}

function NotificationsContent() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const supabase = getSupabase();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at, action_url, related_schedule_id")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setNotifications((data || []) as NotificationItem[]);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      // Silent
    }
  };

  const markAllRead = async () => {
    try {
      const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
      if (unreadIds.length === 0) return;
      await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // Silent
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

  const filtered = notifications.filter((n) => {
    if (filter === "unread") return !n.is_read;
    if (filter === "read") return n.is_read;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const getDashboardPath = (): string => {
    if (!profile) return "/dashboard";
    switch (profile.role) {
      case "learner": return "/dashboard";
      case "vietnamese_teacher":
      case "foreign_teacher": return "/teacher/dashboard";
      case "admin": return "/admin/dashboard";
      default: return "/dashboard";
    }
  };

  return (
    <div className="min-h-screen bg-background-50">
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
              <Link to="/" className="font-heading text-xl font-bold text-primary-600 cursor-pointer">
                Better Minds
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to={getDashboardPath()}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {t("dashboard.navDashboard")}
                </Link>
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-primary-600 bg-primary-50 whitespace-nowrap">
                  {t("notifications.title")}
                </span>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <button
                onClick={handleSignOut}
                className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-logout-box-line"></i>
                <span className="hidden sm:inline ml-1.5">{t("dashboard.signOut")}</span>
              </button>
            </div>
          </div>
          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-background-200 bg-background-50 pb-3 pt-2">
              <nav className="flex flex-col gap-1 px-2">
                <Link
                  to={getDashboardPath()}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-dashboard-line mr-2"></i>{t("dashboard.navDashboard")}
                </Link>
                <span className="px-3 py-2.5 rounded-md text-sm font-semibold text-primary-600 bg-primary-50 cursor-default">
                  <i className="ri-notification-3-line mr-2"></i>{t("notifications.title")}
                </span>
              </nav>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-heading text-2xl font-bold text-foreground-950">{t("notifications.title")}</h1>
            <p className="text-sm text-foreground-500 mt-0.5">{t("notifications.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-check-double-line"></i>
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
              filter === "all" ? "bg-foreground-800 text-background-50" : "bg-background-100 text-foreground-600 hover:bg-background-200"
            }`}
          >
            {t("notifications.filterAll")} ({notifications.length})
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
              filter === "unread" ? "bg-primary-500 text-background-50" : "bg-background-100 text-foreground-600 hover:bg-background-200"
            }`}
          >
            {t("notifications.unread")} ({unreadCount})
          </button>
          <button
            onClick={() => setFilter("read")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
              filter === "read" ? "bg-accent-500 text-background-50" : "bg-background-100 text-foreground-600 hover:bg-background-200"
            }`}
          >
            {t("notifications.filterRead")} ({notifications.length - unreadCount})
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-background-50 border border-background-200/70"></div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
            <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
              <i className="ri-notification-off-line text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-900 font-semibold mb-1">{t("notifications.empty")}</p>
            <p className="text-xs text-foreground-500">{t("notifications.emptyDesc")}</p>
          </div>
        )}

        {/* Notification list */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((notif) => {
              const cardContent = (
                <div
                  className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
                    !notif.is_read
                      ? "border-primary-200/70 bg-primary-50/40 hover:bg-primary-50/70"
                      : "border-background-200/70 bg-background-50 hover:bg-background-50"
                  }`}
                >
                  <div className={`w-10 h-10 flex items-center justify-center rounded-full shrink-0 ${getTypeColor(notif.type)}`}>
                    <i className={`${getTypeIcon(notif.type)} text-base`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-foreground-900">{notif.title}</span>
                      {!notif.is_read && (
                        <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0"></span>
                      )}
                    </div>
                    <p className="text-sm text-foreground-600 leading-relaxed">{notif.message}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-background-100 text-foreground-500 whitespace-nowrap">
                        {getTypeLabel(notif.type, t)}
                      </span>
                      <span className="text-[10px] text-foreground-400">
                        {getRelativeTime(notif.created_at, t)}
                      </span>
                    </div>
                  </div>
                  {!notif.is_read && (
                    <button
                      onClick={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
                      className="text-xs text-foreground-400 hover:text-primary-600 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      title={t("notifications.markRead")}
                    >
                      <i className="ri-check-line"></i>
                    </button>
                  )}
                </div>
              );

              if (notif.action_url) {
                return (
                  <Link
                    key={notif.id}
                    to={notif.action_url}
                    onClick={() => !notif.is_read && markAsRead(notif.id)}
                    className="block cursor-pointer"
                  >
                    {cardContent}
                  </Link>
                );
              }

              return (
                <div
                  key={notif.id}
                  onClick={() => !notif.is_read && markAsRead(notif.id)}
                  className="cursor-pointer"
                >
                  {cardContent}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <AuthGuard allowedRoles={["learner", "vietnamese_teacher", "foreign_teacher", "admin"]}>
      <NotificationsContent />
    </AuthGuard>
  );
}