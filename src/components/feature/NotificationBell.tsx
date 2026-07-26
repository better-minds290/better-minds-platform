import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";

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
  return t("notifications.daysAgo", { count: diffDays });
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "feedback": return "ri-chat-1-line";
    case "deadline": return "ri-timer-line";
    case "material": return "ri-folder-line";
    case "reminder": return "ri-notification-3-line";
    case "auto_pause": return "ri-pause-circle-line";
    case "class": return "ri-calendar-check-line";
    case "system": return "ri-rocket-line";
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
    case "system": return "text-accent-600 bg-accent-100";
    default: return "text-foreground-600 bg-background-100";
  }
}

export default function NotificationBell() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const supabase = getSupabase();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at, action_url, related_schedule_id")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      const items = (data || []) as NotificationItem[];
      setNotifications(items);
      setUnreadCount(items.filter((n) => !n.is_read).length);
    } catch {
      // Silent fail — bell just shows empty
    }
  }, [profile?.id, supabase]);

  useEffect(() => {
    fetchNotifications();
    // Poll every 15 seconds
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        bellRef.current &&
        !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Silent
    }
  };

  const markAllRead = async () => {
    try {
      const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
      if (unreadIds.length === 0) return;
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", unreadIds);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // Silent
    }
  };

  const recentFive = notifications.slice(0, 5);

  if (!profile) return null;

  return (
    <div className="relative">
      <button
        ref={bellRef}
        onClick={() => setOpen(!open)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-colors cursor-pointer"
        aria-label={t("notifications.bellTitle")}
      >
        <i className="ri-notification-3-line text-lg"></i>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent-500 text-background-50 text-[10px] font-bold px-1 leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={dropdownRef}
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-background-50 border border-background-200 rounded-xl shadow-lg z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-background-100">
            <h3 className="text-sm font-semibold text-foreground-900">
              {t("notifications.bellTitle")}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          {/* List */}
          {recentFive.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="w-10 h-10 mx-auto flex items-center justify-center rounded-full bg-background-100 mb-3">
                <i className="ri-notification-off-line text-lg text-foreground-400"></i>
              </div>
              <p className="text-sm text-foreground-500">{t("notifications.empty")}</p>
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              {recentFive.map((notif) => {
                const notificationContent = (
                  <div
                    className={`flex items-start gap-3 px-4 py-3 border-b border-background-50 last:border-0 transition-colors hover:bg-background-50 cursor-pointer ${
                      !notif.is_read ? "bg-primary-50/40" : ""
                    }`}
                    onClick={() => !notif.is_read && markAsRead(notif.id)}
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-full shrink-0 ${getTypeColor(notif.type)}`}>
                      <i className={`${getTypeIcon(notif.type)} text-sm`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-foreground-900 truncate">
                          {notif.title}
                        </p>
                        {!notif.is_read && (
                          <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0"></span>
                        )}
                      </div>
                      <p className="text-xs text-foreground-500 mt-0.5 line-clamp-2">
                        {notif.message}
                      </p>
                      <p className="text-[10px] text-foreground-400 mt-1">
                        {getRelativeTime(notif.created_at, t)}
                      </p>
                    </div>
                  </div>
                );

                if (notif.action_url) {
                  return (
                    <Link
                      key={notif.id}
                      to={notif.action_url}
                      onClick={(e) => {
                        if (!notif.is_read) {
                          markAsRead(notif.id);
                        }
                        setOpen(false);
                      }}
                    >
                      {notificationContent}
                    </Link>
                  );
                }

                return (
                  <div key={notif.id}>
                    {notificationContent}
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center py-2.5 border-t border-background-100 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-background-50 transition-colors cursor-pointer"
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}