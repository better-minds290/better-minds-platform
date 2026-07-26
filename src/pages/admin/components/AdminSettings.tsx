import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface DeadlineSlot {
  session1_hours: number;
  session2_hours: number;
  session3_hours: number;
}

interface DeadlineConfig {
  commitment_2: DeadlineSlot;
  commitment_3: DeadlineSlot;
  commitment_4: DeadlineSlot;
}

interface MissedThresholdSetting {
  count: number;
}

const DEFAULT_DEADLINE_CONFIG: DeadlineConfig = {
  commitment_2: { session1_hours: 72, session2_hours: 72, session3_hours: 72 },
  commitment_3: { session1_hours: 48, session2_hours: 48, session3_hours: 48 },
  commitment_4: { session1_hours: 36, session2_hours: 36, session3_hours: 36 },
};

const DEFAULT_MISSED_THRESHOLD = 2;

const commitmentLabels: Record<keyof DeadlineConfig, string> = {
  commitment_2: "2 sessions/week (Light)",
  commitment_3: "3 sessions/week (Standard)",
  commitment_4: "4 sessions/week (Intensive)",
};

const commitmentKeys = Object.keys(commitmentLabels) as (keyof DeadlineConfig)[];

export default function AdminSettings() {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deadlineConfig, setDeadlineConfig] = useState<DeadlineConfig>(DEFAULT_DEADLINE_CONFIG);
  const [missedThreshold, setMissedThreshold] = useState<number>(DEFAULT_MISSED_THRESHOLD);
  const [originalDeadlineConfig, setOriginalDeadlineConfig] = useState<DeadlineConfig>(DEFAULT_DEADLINE_CONFIG);
  const [originalMissedThreshold, setOriginalMissedThreshold] = useState<number>(DEFAULT_MISSED_THRESHOLD);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", ["default_deadline_config", "missed_deadline_pause_threshold"]);

      if (error) throw error;

      let fetchedDeadline = DEFAULT_DEADLINE_CONFIG;
      let fetchedThreshold = DEFAULT_MISSED_THRESHOLD;

      if (data) {
        for (const row of data) {
          if (row.key === "default_deadline_config" && row.value) {
            fetchedDeadline = row.value as DeadlineConfig;
          }
          if (row.key === "missed_deadline_pause_threshold" && row.value) {
            fetchedThreshold = ((row.value as MissedThresholdSetting).count) || DEFAULT_MISSED_THRESHOLD;
          }
        }
      }

      setDeadlineConfig(fetchedDeadline);
      setOriginalDeadlineConfig(fetchedDeadline);
      setMissedThreshold(fetchedThreshold);
      setOriginalMissedThreshold(fetchedThreshold);
    } catch {
      setErrorMsg(t("auth.adminSettingsLoadError"));
      setDeadlineConfig(DEFAULT_DEADLINE_CONFIG);
      setMissedThreshold(DEFAULT_MISSED_THRESHOLD);
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleHourChange = (
    commitment: keyof DeadlineConfig,
    session: keyof DeadlineSlot,
    value: string
  ) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return;
    setDeadlineConfig((prev) => ({
      ...prev,
      [commitment]: { ...prev[commitment], [session]: num },
    }));
  };

  const hasChanges =
    JSON.stringify(deadlineConfig) !== JSON.stringify(originalDeadlineConfig) ||
    missedThreshold !== originalMissedThreshold;

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const updates = [
        {
          key: "default_deadline_config",
          value: deadlineConfig,
        },
        {
          key: "missed_deadline_pause_threshold",
          value: { count: missedThreshold },
        },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from("system_settings")
          .upsert(update, { onConflict: "key" });

        if (error) throw error;
      }

      setOriginalDeadlineConfig({ ...deadlineConfig });
      setOriginalMissedThreshold(missedThreshold);
      setSuccessMsg(t("auth.adminSettingsSaveSuccess"));

      setTimeout(() => setSuccessMsg(""), 4000);
    } catch {
      setErrorMsg(t("auth.adminSettingsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDeadlineConfig({ ...originalDeadlineConfig });
    setMissedThreshold(originalMissedThreshold);
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-8 h-8 mx-auto border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
        <p className="mt-4 text-sm text-foreground-400">{t("auth.adminSettingsLoading")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-sm text-foreground-500 mb-1">{t("auth.adminSettingsSubtitle")}</p>
        <h2 className="font-heading text-xl font-bold text-foreground-950">
          {t("auth.adminSettings")}
        </h2>
      </div>

      {successMsg && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-primary-50 border border-primary-200 text-primary-800 text-sm animate-in fade-in">
          <i className="ri-checkbox-circle-line mr-2"></i>
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-accent-50 border border-accent-200 text-accent-800 text-sm animate-in fade-in">
          <i className="ri-error-warning-line mr-2"></i>
          {errorMsg}
          <button
            onClick={fetchSettings}
            className="ml-3 underline cursor-pointer hover:text-accent-900"
          >
            {t("dashboard.retry")}
          </button>
        </div>
      )}

      <div className="space-y-8">
        {/* Section 1: Default Deadline Configuration */}
        <div className="p-6 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600 flex-shrink-0">
              <i className="ri-timer-line text-lg"></i>
            </div>
            <div>
              <h3 className="font-heading text-base font-semibold text-foreground-950 mb-1">
                {t("auth.adminSettingsDeadlineTitle")}
              </h3>
              <p className="text-sm text-foreground-500 leading-relaxed">
                {t("auth.adminSettingsDeadlineDesc")}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {commitmentKeys.map((key) => {
              const cfg = deadlineConfig[key];
              return (
                <div
                  key={key}
                  className="p-4 rounded-lg bg-background-100 border border-background-200"
                >
                  <p className="text-sm font-semibold text-foreground-900 mb-3">
                    {commitmentLabels[key]}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(["session1_hours", "session2_hours", "session3_hours"] as (keyof DeadlineSlot)[]).map(
                      (sess, idx) => (
                        <div key={sess}>
                          <label className="block text-xs text-foreground-500 mb-1.5">
                            {t("auth.adminSettingsSession", { num: idx + 1 })}
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              min={1}
                              max={240}
                              value={cfg[sess]}
                              onChange={(e) => handleHourChange(key, sess, e.target.value)}
                              className="w-full px-3 py-2 pr-12 rounded-md border border-background-300 bg-background-50 text-sm text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 transition-colors"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-foreground-400 pointer-events-none">
                              {t("auth.adminSettingsHours")}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 2: Missed Deadline Policy */}
        <div className="p-6 rounded-xl bg-background-50 border border-background-200">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600 flex-shrink-0">
              <i className="ri-alert-line text-lg"></i>
            </div>
            <div>
              <h3 className="font-heading text-base font-semibold text-foreground-950 mb-1">
                {t("auth.adminSettingsMissedTitle")}
              </h3>
              <p className="text-sm text-foreground-500 leading-relaxed">
                {t("auth.adminSettingsMissedDesc")}
              </p>
            </div>
          </div>

          <div className="max-w-xs">
            <label className="block text-sm font-medium text-foreground-700 mb-2">
              {t("auth.adminSettingsMissedLabel")}
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMissedThreshold((prev) => Math.max(1, prev - 1))}
                className="w-9 h-9 flex items-center justify-center rounded-md border border-background-300 bg-background-50 text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                disabled={missedThreshold <= 1}
              >
                <i className="ri-subtract-line"></i>
              </button>
              <div className="w-16 h-11 flex items-center justify-center rounded-md border border-background-300 bg-background-100">
                <span className="text-lg font-bold text-foreground-950">{missedThreshold}</span>
              </div>
              <button
                onClick={() => setMissedThreshold((prev) => Math.min(10, prev + 1))}
                className="w-9 h-9 flex items-center justify-center rounded-md border border-background-300 bg-background-50 text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer"
                disabled={missedThreshold >= 10}
              >
                <i className="ri-add-line"></i>
              </button>
              <span className="text-sm text-foreground-500">
                {t("auth.adminSettingsMissedUnit")}
              </span>
            </div>
            <p className="mt-3 text-xs text-foreground-400 leading-relaxed">
              {t("auth.adminSettingsMissedHint", { count: missedThreshold })}
            </p>
          </div>
        </div>

        {/* Section 3: Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-background-100 border border-background-200">
            <div className="w-8 h-8 flex items-center justify-center rounded-md bg-primary-100 text-primary-600 mb-2">
              <i className="ri-information-line"></i>
            </div>
            <p className="text-sm font-medium text-foreground-900 mb-1">
              {t("auth.adminSettingsInfo1Title")}
            </p>
            <p className="text-xs text-foreground-500 leading-relaxed">
              {t("auth.adminSettingsInfo1Desc")}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-background-100 border border-background-200">
            <div className="w-8 h-8 flex items-center justify-center rounded-md bg-accent-100 text-accent-600 mb-2">
              <i className="ri-shield-check-line"></i>
            </div>
            <p className="text-sm font-medium text-foreground-900 mb-1">
              {t("auth.adminSettingsInfo2Title")}
            </p>
            <p className="text-xs text-foreground-500 leading-relaxed">
              {t("auth.adminSettingsInfo2Desc")}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-background-100 border border-background-200">
            <div className="w-8 h-8 flex items-center justify-center rounded-md bg-secondary-100 text-secondary-600 mb-2">
              <i className="ri-history-line"></i>
            </div>
            <p className="text-sm font-medium text-foreground-900 mb-1">
              {t("auth.adminSettingsInfo3Title")}
            </p>
            <p className="text-xs text-foreground-500 leading-relaxed">
              {t("auth.adminSettingsInfo3Desc")}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary-500 text-background-50 text-sm font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                {t("auth.adminSettingsSaving")}
              </>
            ) : (
              <>
                <i className="ri-save-line"></i>
                {t("auth.adminSettingsSave")}
              </>
            )}
          </button>
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-background-100 text-foreground-600 text-sm font-medium hover:bg-background-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            <i className="ri-arrow-go-back-line"></i>
            {t("profile.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}