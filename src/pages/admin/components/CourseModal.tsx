import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface CourseFormData {
  name: string;
  description: string;
  level: string;
  is_active: boolean;
  sessions_per_sprint: number;
  total_sprints: number;
  enrollment_password: string;
}

interface CourseModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (courseId?: string) => void;
  editCourse?: {
    id: string;
    name: string;
    description: string;
    level: string;
    is_active: boolean;
    deadline_config: Record<string, unknown> | null;
    enrollment_password?: string | null;
  } | null;
}

const DEFAULT_FORM: CourseFormData = {
  name: "",
  description: "",
  level: "",
  is_active: true,
  sessions_per_sprint: 3,
  total_sprints: 24,
  enrollment_password: "",
};

export default function CourseModal({ open, onClose, onSuccess, editCourse }: CourseModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CourseFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [levelError, setLevelError] = useState("");

  const isEdit = !!editCourse;

  useEffect(() => {
    if (open && editCourse) {
      const dc = (editCourse.deadline_config || {}) as Record<string, unknown>;
      setForm({
        name: editCourse.name || "",
        description: editCourse.description || "",
        level: editCourse.level || "",
        is_active: editCourse.is_active ?? true,
        sessions_per_sprint: (dc.sessions_per_sprint as number) || 3,
        total_sprints: (dc.total_sprints as number) || 24,
        enrollment_password: editCourse.enrollment_password || "",
      });
      setNameError("");
      setLevelError("");
      setError("");
    } else if (open) {
      setForm(DEFAULT_FORM);
      setNameError("");
      setLevelError("");
      setError("");
    }
  }, [open, editCourse]);

  const validate = (): boolean => {
    let valid = true;
    if (!form.name.trim()) {
      setNameError(t("auth.adminCourseRequiredName"));
      valid = false;
    } else {
      setNameError("");
    }
    if (!form.level.trim()) {
      setLevelError(t("auth.adminCourseRequiredLevel"));
      valid = false;
    } else {
      setLevelError("");
    }
    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setSaving(true);
    try {
      const supabase = getSupabase();

      const deadlineConfigPayload: Record<string, unknown> = {
        sessions_per_sprint: form.sessions_per_sprint,
        total_sprints: form.total_sprints,
      };

      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        level: form.level.trim(),
        is_active: form.is_active,
        total_sprints: form.total_sprints,
        deadline_config: deadlineConfigPayload,
        enrollment_password: form.enrollment_password.trim() || null,
      };

      if (isEdit) {
        const { error: updateErr } = await supabase
          .from("courses")
          .update(payload)
          .eq("id", editCourse.id);

        if (updateErr) throw updateErr;
      } else {
        const { data: newCourse, error: insertErr } = await supabase
          .from("courses")
          .insert(payload)
          .select("id")
          .single();

        if (insertErr) throw insertErr;

        onSuccess(newCourse?.id);
        onClose();
        return;
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error("Course save error:", err);
      setError(t("auth.adminCourseError"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const title = isEdit ? t("auth.adminEditCourse") : t("auth.adminCreateCourse");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      <div className="relative w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-background-50 rounded-2xl border border-background-200 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-background-200 bg-background-50 rounded-t-2xl">
          <h3 className="font-heading text-lg font-semibold text-foreground-950">
            {title}
          </h3>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-200 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminCourseName")} <span className="text-accent-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                if (nameError) setNameError("");
              }}
              placeholder={t("auth.adminCourseNamePlaceholder")}
              className={`w-full px-4 py-2.5 text-sm bg-background-50 border rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 transition-all duration-200 ${
                nameError
                  ? "border-accent-400 focus:border-accent-400 focus:ring-accent-400/20"
                  : "border-background-200 focus:border-primary-400 focus:ring-primary-400/20"
              }`}
            />
            {nameError && (
              <p className="mt-1 text-xs text-accent-500">{nameError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminCourseDescription")}
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t("auth.adminCourseDescriptionPlaceholder")}
              rows={3}
              maxLength={500}
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminCourseLevel")} <span className="text-accent-500">*</span>
            </label>
            <input
              type="text"
              value={form.level}
              onChange={(e) => {
                setForm((f) => ({ ...f, level: e.target.value }));
                if (levelError) setLevelError("");
              }}
              placeholder={t("auth.adminCourseLevelPlaceholder")}
              className={`w-full px-4 py-2.5 text-sm bg-background-50 border rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 transition-all duration-200 ${
                levelError
                  ? "border-accent-400 focus:border-accent-400 focus:ring-accent-400/20"
                  : "border-background-200 focus:border-primary-400 focus:ring-primary-400/20"
              }`}
            />
            {levelError && (
              <p className="mt-1 text-xs text-accent-500">{levelError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminCoursePasswordOptional")}
            </label>
            <input
              type="text"
              value={form.enrollment_password}
              onChange={(e) => setForm((f) => ({ ...f, enrollment_password: e.target.value }))}
              placeholder={t("auth.adminCoursePasswordPlaceholder")}
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
            />
            <p className="mt-1 text-xs text-foreground-400">
              {t("auth.adminCoursePasswordHint")}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminSprintConfig")}
            </label>
            <p className="text-xs text-foreground-400 mb-3">{t("auth.adminSprintConfigDesc")}</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground-600 mb-1">
                  {t("auth.adminCourseSessionsPerSprint")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={form.sessions_per_sprint}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sessions_per_sprint: Math.max(1, parseInt(e.target.value) || 3),
                    }))
                  }
                  className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-600 mb-1">
                  {t("auth.adminCourseTotalSprints")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={form.total_sprints}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      total_sprints: Math.max(1, parseInt(e.target.value) || 24),
                    }))
                  }
                  className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-foreground-400">
              {form.sessions_per_sprint} {t("auth.adminSessions").toLowerCase()} × {form.total_sprints} {t("auth.adminSprints").toLowerCase()} ={" "}
              <span className="font-medium text-foreground-600">
                {form.sessions_per_sprint * form.total_sprints} {t("auth.adminSessions").toLowerCase()} ({form.total_sprints} {form.total_sprints > 1 ? t("auth.adminWeeks") : t("auth.adminWeek")})
              </span>
            </p>
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <label className="text-sm font-medium text-foreground-800">
                {t("auth.adminCourseIsActive")}
              </label>
              <p className="text-xs text-foreground-400">
                {form.is_active ? t("auth.adminActive") : t("auth.adminDraft")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${
                form.is_active ? "bg-primary-500" : "bg-background-300"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  form.is_active ? "left-[calc(100%-1.375rem)]" : "left-0.5"
                }`}
              ></span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-accent-50 border border-accent-200 text-sm text-accent-700 flex items-center gap-2">
              <i className="ri-error-warning-line text-base flex-shrink-0"></i>
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground-700 bg-background-100 hover:bg-background-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {t("auth.adminCancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-background-50 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              )}
              {saving
                ? isEdit
                  ? t("auth.adminCourseUpdating")
                  : t("auth.adminCourseCreating")
                : isEdit
                  ? t("auth.adminSave")
                  : t("auth.adminCreateCourse")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}