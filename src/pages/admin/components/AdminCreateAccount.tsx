import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

export default function AdminCreateAccount() {
  const { t } = useTranslation();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("learner");
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  const handleCreateAccount = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreateSuccess(false);

    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setCreateError(t("auth.adminAllFieldsRequired"));
      return;
    }
    if (password.length < 8) {
      setCreateError(t("auth.passwordTooShort"));
      return;
    }

    setCreateLoading(true);
    try {
      const supabase = (await import("@/lib/supabase")).getSupabase();
      const { data, error: funcError } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          role: selectedRole,
        },
      });

      if (funcError) {
        setCreateError(funcError.message || t("auth.adminCreateError"));
        return;
      }

      if (data?.error) {
        setCreateError(data.error);
        return;
      }

      setCreateSuccess(true);
      setFullName("");
      setEmail("");
      setPassword("");
      setSelectedRole("learner");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("auth.adminCreateError"));
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
          {t("auth.adminCreateTitle")}
        </h2>
        <p className="text-sm text-foreground-500">{t("auth.adminCreateSubtitle")}</p>
      </div>

      <div className="max-w-lg">
        {createError && (
          <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-start gap-2.5">
            <i className="ri-error-warning-line text-base flex-shrink-0 mt-0.5"></i>
            <span>{createError}</span>
          </div>
        )}

        {createSuccess && (
          <div className="mb-6 p-3.5 rounded-lg bg-accent-100 border border-accent-300/60 text-sm text-accent-800 flex items-start gap-2.5">
            <i className="ri-checkbox-circle-line text-base flex-shrink-0 mt-0.5 text-accent-600"></i>
            <span>{t("auth.adminCreateSuccess")}</span>
          </div>
        )}

        <form onSubmit={handleCreateAccount} className="space-y-5">
          <div>
            <label
              htmlFor="create-role"
              className="block text-sm font-medium text-foreground-700 mb-1.5"
            >
              {t("auth.adminRoleLabel")}
            </label>
            <select
              id="create-role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-4 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
            >
              <option value="learner">{t("auth.adminRoleLearner")}</option>
              <option value="vietnamese_teacher">{t("auth.adminRoleVNTeacher")}</option>
              <option value="foreign_teacher">{t("auth.adminRoleForeignTeacher")}</option>
              <option value="admin">{t("auth.adminRoleAdmin")}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="create-name"
              className="block text-sm font-medium text-foreground-700 mb-1.5"
            >
              {t("auth.fullNameLabel")}
            </label>
            <div className="relative">
              <i className="ri-user-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
              <input
                id="create-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("auth.fullNamePlaceholder")}
                className="w-full pl-10 pr-4 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-email"
              className="block text-sm font-medium text-foreground-700 mb-1.5"
            >
              {t("auth.emailLabel")}
            </label>
            <div className="relative">
              <i className="ri-mail-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
              <input
                id="create-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.emailPlaceholder")}
                className="w-full pl-10 pr-4 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-password"
              className="block text-sm font-medium text-foreground-700 mb-1.5"
            >
              {t("auth.passwordLabel")}
            </label>
            <div className="relative">
              <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
              <input
                id="create-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.adminPasswordPlaceholder")}
                className="w-full pl-10 pr-4 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
            </div>
            <p className="mt-1 text-xs text-foreground-400">
              {t("auth.adminPasswordHint")}
            </p>
          </div>

          <button
            type="submit"
            disabled={createLoading}
            className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {createLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin mr-2"></div>
                {t("auth.adminCreating")}
              </>
            ) : (
              <>
                <i className="ri-user-add-line mr-2"></i>
                {t("auth.adminCreateAccount")}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}