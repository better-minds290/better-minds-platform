import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

export default function AdminBroadcast() {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetRole, setTargetRole] = useState<string>("all");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      showToast("error", t("auth.adminBroadcastValidation"));
      return;
    }

    setSending(true);
    setSentCount(null);

    try {
      const res = await supabase.functions.invoke("admin-broadcast-notifications", {
        body: {
          title: title.trim(),
          message: message.trim(),
          target_role: targetRole,
        },
      });

      if (res.error) {
        const errMsg = typeof res.error.context === "object" && res.error.context?.error
          ? res.error.context.error
          : res.error.message || t("auth.adminBroadcastFailed");
        throw new Error(errMsg);
      }

      const data = res.data as any;
      setSentCount(data.count || 0);
      showToast("success", data.message || t("auth.adminBroadcastSent"));
      setTitle("");
      setMessage("");
    } catch (err: any) {
      showToast("error", err.message || t("auth.adminBroadcastFailed"));
    } finally {
      setSending(false);
    }
  };

  const roleOptions = [
    { value: "all", label: t("auth.adminBroadcastAll"), icon: "ri-global-line", color: "bg-primary-500 text-background-50" },
    { value: "learners", label: t("auth.adminBroadcastLearners"), icon: "ri-user-line", color: "bg-accent-500 text-background-50" },
    { value: "teachers", label: t("auth.adminBroadcastTeachers"), icon: "ri-team-line", color: "bg-secondary-600 text-background-50" },
  ];

  const sentCountLabel = sentCount !== null
    ? t("auth.adminBroadcastSentCount", { count: sentCount })
    : "";

  return (
    <div>
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

      <div className="mb-8">
        <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
          {t("auth.adminBroadcastTitle")}
        </h2>
        <p className="text-sm text-foreground-500">{t("auth.adminBroadcastSubtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-3 bg-background-50 border border-background-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600">
              <i className="ri-notification-3-line text-lg"></i>
            </div>
            <div>
              <h3 className="font-heading text-base font-bold text-foreground-950">{t("auth.adminBroadcastNew")}</h3>
              <p className="text-xs text-foreground-500">{t("auth.adminBroadcastNewDesc")}</p>
            </div>
          </div>

          {/* Target select */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-foreground-700 mb-2">
              <i className="ri-user-line mr-1.5"></i>
              {t("auth.adminBroadcastSendTo")}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTargetRole(opt.value)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                    targetRole === opt.value
                      ? `${opt.color} border border-transparent`
                      : "bg-background-100 text-foreground-600 border border-background-200 hover:bg-background-200"
                  }`}
                >
                  <i className={opt.icon}></i>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="mb-5">
            <label htmlFor="broadcast-title" className="block text-sm font-medium text-foreground-700 mb-2">
              <i className="ri-heading mr-1.5"></i>
              {t("auth.adminBroadcastHeading")}
            </label>
            <input
              id="broadcast-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("auth.adminBroadcastHeadingPlaceholder")}
              maxLength={200}
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
            />
            <p className="text-xs text-foreground-400 mt-1">{t("auth.adminBroadcastCharCount", { current: title.length, max: 200 })}</p>
          </div>

          {/* Message */}
          <div className="mb-6">
            <label htmlFor="broadcast-message" className="block text-sm font-medium text-foreground-700 mb-2">
              <i className="ri-chat-1-line mr-1.5"></i>
              {t("auth.adminBroadcastContent")}
            </label>
            <textarea
              id="broadcast-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("auth.adminBroadcastContentPlaceholder")}
              maxLength={500}
              className="w-full px-4 py-3 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 resize-none"
            />
            <p className="text-xs text-foreground-400 mt-1">{t("auth.adminBroadcastCharCount", { current: message.length, max: 500 })}</p>
          </div>

          {/* Send button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !title.trim() || !message.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              {sending ? (
                <>
                  <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                  {t("auth.adminBroadcastSending")}
                </>
              ) : (
                <>
                  <i className="ri-send-plane-line"></i>
                  {t("auth.adminBroadcastSend")}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setTitle(""); setMessage(""); setSentCount(null); }}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
            >
              <i className="ri-close-line"></i>
              {t("auth.adminBroadcastClear")}
            </button>
          </div>
        </div>

        {/* Preview & History */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live Preview */}
          <div className="bg-background-50 border border-background-200 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
              <i className="ri-eye-line text-foreground-400"></i>
              {t("auth.adminBroadcastPreview")}
            </h4>
            {title || message ? (
              <div className="p-4 rounded-lg bg-background-100 border border-background-200">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 flex-shrink-0">
                    <i className="ri-notification-3-line text-sm"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground-900 mb-0.5">
                      {title || t("auth.adminBroadcastNoTitle")}
                    </p>
                    <p className="text-xs text-foreground-600 leading-relaxed">
                      {message || t("auth.adminBroadcastNoContent")}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-background-200 text-foreground-500 whitespace-nowrap">
                        {t("auth.adminBroadcastSystem")}
                      </span>
                      <span className="text-[10px] text-foreground-400">{t("auth.adminBroadcastJustNow")}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center rounded-lg bg-background-100">
                <i className="ri-notification-off-line text-2xl text-foreground-300 mb-2 block"></i>
                <p className="text-xs text-foreground-400">{t("auth.adminBroadcastEnterContent")}</p>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="bg-background-50 border border-background-200 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
              <i className="ri-information-line text-foreground-400"></i>
              {t("auth.adminBroadcastNotes")}
            </h4>
            <div className="space-y-2 text-xs text-foreground-600">
              <p className="flex items-start gap-2">
                <i className="ri-check-line text-accent-600 mt-0.5 flex-shrink-0"></i>
                {t("auth.adminBroadcastNote1")}
              </p>
              <p className="flex items-start gap-2">
                <i className="ri-check-line text-accent-600 mt-0.5 flex-shrink-0"></i>
                {t("auth.adminBroadcastNote2")}
              </p>
              <p className="flex items-start gap-2">
                <i className="ri-check-line text-accent-600 mt-0.5 flex-shrink-0"></i>
                {t("auth.adminBroadcastNote3")}
              </p>
            </div>
          </div>

          {/* Sent confirmation */}
          {sentCount !== null && (
            <div className="p-4 rounded-xl bg-accent-50 border border-accent-200">
              <div className="flex items-center gap-2 mb-1">
                <i className="ri-check-double-line text-accent-600"></i>
                <span className="text-sm font-semibold text-accent-800">{t("auth.adminBroadcastSent")}</span>
              </div>
              <p className="text-xs text-accent-600">
                {sentCountLabel}
                {targetRole === "learners" ? ` (${t("auth.adminBroadcastLearners")})` : targetRole === "teachers" ? ` (${t("auth.adminBroadcastTeachers")})` : ` (${t("auth.adminBroadcastAll")})`}.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}