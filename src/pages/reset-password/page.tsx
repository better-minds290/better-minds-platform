import { useState, useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { updatePassword, isAuthenticated } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);

  useEffect(() => {
    const hash = window.location.hash;
    const hasRecoveryToken = hash.includes("type=recovery") || hash.includes("access_token=");

    if (!hasRecoveryToken && !isAuthenticated) {
      setError(t("auth.resetPasswordExpiredToken"));
      setCheckingToken(false);
      return;
    }

    const timer = setTimeout(() => {
      setCheckingToken(false);
    }, 800);

    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  const validate = (): boolean => {
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return false;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordsDontMatch"));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 2500);
    } else {
      setError(result.error || t("auth.registerError"));
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-accent-100">
            <i className="ri-shield-check-line text-3xl text-accent-600"></i>
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-3">
            {t("auth.resetPasswordSuccess")}
          </h1>
          <p className="text-sm text-foreground-500 mb-8">
            {t("auth.resetPasswordSuccessDesc")}
          </p>
          <Link
            to="/login"
            className="inline-flex items-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {t("auth.loginLink")}
          </Link>
        </div>
      </div>
    );
  }

  if (checkingToken) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-500 rounded-full animate-spin"></div>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.resetPasswordVerifying")}</p>
        </div>
      </div>
    );
  }

  if (error && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-accent-100/80">
            <i className="ri-error-warning-line text-3xl text-accent-600"></i>
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-3">
            {t("auth.resetPasswordInvalidLink")}
          </h1>
          <p className="text-sm text-foreground-500 mb-8">{error}</p>
          <Link
            to="/login"
            className="inline-flex items-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {t("auth.resetPasswordBackToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-bold text-foreground-950 mb-2">
            {t("auth.resetPasswordTitle")}
          </h1>
          <p className="text-sm text-foreground-500">{t("auth.resetPasswordSubtitle")}</p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-start gap-2.5">
            <i className="ri-error-warning-line text-base flex-shrink-0 mt-0.5"></i>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="reset-password"
              className="block text-sm font-medium text-foreground-700 mb-1.5"
            >
              {t("auth.passwordLabel")}
            </label>
            <div className="relative">
              <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
              <input
                id="reset-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.resetPasswordPlaceholder")}
                autoComplete="new-password"
                autoFocus
                className="w-full pl-10 pr-12 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                tabIndex={-1}
              >
                <i className={`text-base ${showPassword ? "ri-eye-off-line" : "ri-eye-line"}`}></i>
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="reset-confirm"
              className="block text-sm font-medium text-foreground-700 mb-1.5"
            >
              {t("auth.confirmPasswordLabel")}
            </label>
            <div className="relative">
              <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
              <input
                id="reset-confirm"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                autoComplete="new-password"
                className="w-full pl-10 pr-12 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                tabIndex={-1}
              >
                <i className={`text-base ${showConfirmPassword ? "ri-eye-off-line" : "ri-eye-line"}`}></i>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin mr-2"></div>
                {t("auth.resetPasswordUpdating")}
              </>
            ) : (
              t("auth.resetPasswordButton")
            )}
          </button>
        </form>
      </div>
    </div>
  );
}