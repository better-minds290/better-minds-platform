import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getRedirectPath } from "@/lib/authLogic";
import i18n from "@/i18n";

type SelectedRole = "learner" | "teacher" | null;

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, changePassword, isAuthenticated, profile } = useAuth();

  const [selectedRole, setSelectedRole] = useState<SelectedRole>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [changeEmail, setChangeEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changeError, setChangeError] = useState("");
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeSuccess, setChangeSuccess] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [signInSuccess, setSignInSuccess] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || "/dashboard";
  const fromRef = useRef(from);
  fromRef.current = from;

  // Redirect if already authenticated and profile loaded
  useEffect(() => {
    if (isChangingPassword) return;
    if (isAuthenticated && profile) {
      if (profile.role === "foreign_teacher" && i18n.language !== "en") {
        i18n.changeLanguage("en").then(() => {
          const redirectPath = getRedirectPath(profile.role);
          navigate(redirectPath, { replace: true });
        });
      } else {
        const redirectPath = getRedirectPath(profile.role);
        navigate(redirectPath, { replace: true });
      }
    }
  }, [isAuthenticated, profile, navigate, isChangingPassword]);

  const validate = (): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError(t("auth.invalidEmail"));
      return false;
    }
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return false;
    }
    return true;
  };

  const handleBackToRoleSelect = () => {
    setSelectedRole(null);
    setError("");
    setEmail("");
    setPassword("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setLoading(true);
    const result = await signIn(email, password);
    setLoading(false);

    if (result.success) {
      setSignInSuccess(true);
    } else {
      setError(result.error || t("auth.loginError"));
    }
  };

  const handleChangePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setChangeError("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!changeEmail.trim() || !currentPassword || !newPassword || !confirmNewPassword) {
      setChangeError(t("auth.fieldRequired"));
      return;
    }
    if (!emailRegex.test(changeEmail)) {
      setChangeError(t("auth.invalidEmail"));
      return;
    }
    if (newPassword.length < 8) {
      setChangeError(t("auth.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setChangeError(t("auth.passwordsDontMatch"));
      return;
    }

    setChangeLoading(true);
    setIsChangingPassword(true);
    const result = await changePassword(changeEmail.trim(), currentPassword, newPassword);
    setIsChangingPassword(false);
    setChangeLoading(false);

    if (result.success) {
      setChangeSuccess(true);
    } else if (result.error === "wrong_current_password") {
      setChangeError(t("auth.wrongCurrentPassword"));
    } else {
      setChangeError(result.error || t("auth.registerError"));
    }
  };

  const closeChangePasswordForm = () => {
    setShowChangePasswordForm(false);
    setChangeEmail("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setChangeError("");
    setChangeSuccess(false);
    setIsChangingPassword(false);
  };

  // Rendered role label
  const roleLabel = selectedRole === "learner" ? t("auth.loginAsLearner") : t("auth.loginAsTeacher");

  // ========================
  // CHANGE PASSWORD VIEW
  // ========================
  if (showChangePasswordForm) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <button
            onClick={closeChangePasswordForm}
            className="inline-flex items-center text-sm text-foreground-500 hover:text-primary-600 mb-10 transition-colors duration-200 cursor-pointer group"
          >
            <i className="ri-arrow-left-line mr-1.5 group-hover:-translate-x-0.5 transition-transform"></i>
            {t("auth.backToLogin")}
          </button>

          {changeSuccess ? (
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-accent-100">
                <i className="ri-shield-check-line text-3xl text-accent-600"></i>
              </div>
              <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-3">
                {t("auth.changePasswordSuccess")}
              </h1>
              <p className="text-sm text-foreground-500 mb-8">
                {t("auth.changePasswordSuccessDesc")}
              </p>
              <button
                onClick={closeChangePasswordForm}
                className="inline-flex items-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                {t("auth.backToLogin")}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h1 className="font-heading text-3xl font-bold text-foreground-950 mb-2">
                  {t("auth.changePasswordTitle")}
                </h1>
                <p className="text-sm text-foreground-500">
                  {t("auth.changePasswordSubtitle")}
                </p>
              </div>

              {changeError && (
                <div className="mb-6 p-3.5 rounded-lg bg-accent-100/80 border border-accent-300/60 text-sm text-accent-800 flex items-start gap-2.5">
                  <i className="ri-error-warning-line text-base flex-shrink-0 mt-0.5"></i>
                  <span>{changeError}</span>
                </div>
              )}

              <form onSubmit={handleChangePasswordSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="change-email"
                    className="block text-sm font-medium text-foreground-700 mb-1.5"
                  >
                    {t("auth.emailLabel")}
                  </label>
                  <div className="relative">
                    <i className="ri-mail-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
                    <input
                      id="change-email"
                      type="email"
                      value={changeEmail}
                      onChange={(e) => setChangeEmail(e.target.value)}
                      placeholder={t("auth.emailPlaceholder")}
                      autoComplete="email"
                      autoFocus
                      className="w-full pl-10 pr-4 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="change-current-password"
                    className="block text-sm font-medium text-foreground-700 mb-1.5"
                  >
                    {t("auth.currentPasswordLabel")}
                  </label>
                  <div className="relative">
                    <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
                    <input
                      id="change-current-password"
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder={t("auth.currentPasswordPlaceholder")}
                      autoComplete="current-password"
                      className="w-full pl-10 pr-12 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                      tabIndex={-1}
                    >
                      <i className={`text-base ${showCurrentPassword ? "ri-eye-off-line" : "ri-eye-line"}`}></i>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="change-new-password"
                    className="block text-sm font-medium text-foreground-700 mb-1.5"
                  >
                    {t("auth.newPasswordLabel")}
                  </label>
                  <div className="relative">
                    <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
                    <input
                      id="change-new-password"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t("auth.newPasswordPlaceholder")}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-12 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                      tabIndex={-1}
                    >
                      <i className={`text-base ${showNewPassword ? "ri-eye-off-line" : "ri-eye-line"}`}></i>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="change-confirm-password"
                    className="block text-sm font-medium text-foreground-700 mb-1.5"
                  >
                    {t("auth.confirmPasswordLabel")}
                  </label>
                  <div className="relative">
                    <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
                    <input
                      id="change-confirm-password"
                      type={showConfirmNewPassword ? "text" : "password"}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder={t("auth.confirmPasswordPlaceholder")}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-12 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                      tabIndex={-1}
                    >
                      <i className={`text-base ${showConfirmNewPassword ? "ri-eye-off-line" : "ri-eye-line"}`}></i>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={changeLoading}
                  className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  {changeLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin mr-2"></div>
                      {t("auth.changePasswordUpdating")}
                    </>
                  ) : (
                    t("auth.changePasswordButton")
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  // ========================
  // ROLE SELECTION VIEW
  // ========================
  if (!selectedRole) {
    return (
      <div className="min-h-screen bg-background-50 flex">
        {/* Left illustration */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
          <img
            src="https://public.readdy.ai/ai/img_res/edited_b046bfe9fa3e6064c5b8c4c78e9b0980_42fe10d6.jpg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/25 via-transparent to-accent-500/15"></div>
          <div className="relative z-10 flex flex-col justify-center px-16">
            <Link to="/" className="inline-flex items-center gap-2 mb-12 group cursor-pointer">
              <span className="font-heading text-3xl font-bold text-background-50 drop-shadow-sm">
                Better Minds
              </span>
            </Link>
              <blockquote className="border-l-2 border-background-50/40 pl-6">
            <p className="font-heading text-2xl text-background-50 leading-relaxed drop-shadow-sm">
              “{t("auth.loginQuoteLearner")}”
            </p>
            <footer className="mt-4 text-sm text-background-50/80">
              — {t("auth.loginQuoteAuthor")}
            </footer>
          </blockquote>
          </div>
        </div>

        {/* Right: Role selection */}
        <div className="flex-1 flex items-center justify-center px-4 md:px-8 py-12">
          <div className="w-full max-w-lg">
            <Link
              to="/"
              className="inline-flex items-center text-sm text-foreground-500 hover:text-primary-600 mb-10 transition-colors duration-200 cursor-pointer group"
            >
              <i className="ri-arrow-left-line mr-1.5 group-hover:-translate-x-0.5 transition-transform"></i>
              {t("auth.backHome")}
            </Link>

            <div className="mb-10">
              <h1 className="font-heading text-3xl font-bold text-foreground-950 mb-2">
                {t("auth.loginRoleTitle")}
              </h1>
              <p className="text-sm text-foreground-500">{t("auth.loginRoleSubtitle")}</p>
            </div>

            <div className="grid grid-cols-1 gap-5">
              {/* Learner Card */}
              <button
                onClick={() => setSelectedRole("learner")}
                className="group relative w-full text-left p-6 rounded-2xl border-2 border-background-200 bg-background-50 hover:border-primary-400 hover:bg-background-100/80 transition-all duration-300 cursor-pointer overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.06] group-hover:opacity-[0.10] transition-opacity duration-300">
                  <div className="w-full h-full rounded-bl-[80px] bg-primary-500"></div>
                </div>
                <div className="relative flex items-start gap-5">
                  <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-primary-100 text-primary-600 group-hover:bg-primary-200 group-hover:scale-105 transition-all duration-300 shrink-0">
                    <i className="ri-book-open-line text-2xl"></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading text-lg font-bold text-foreground-900 mb-1.5 group-hover:text-primary-700 transition-colors">
                      {t("auth.loginLearnerTab")}
                    </h3>
                    <p className="text-sm text-foreground-500 leading-relaxed">
                      {t("auth.loginLearnerDesc")}
                    </p>
                  </div>
                  <div className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-background-300 group-hover:border-primary-400 group-hover:bg-primary-50 transition-all duration-300 shrink-0 self-center">
                    <i className="ri-arrow-right-line text-foreground-400 group-hover:text-primary-600 transition-colors text-sm"></i>
                  </div>
                </div>
              </button>

              {/* Teacher Card */}
              <button
                onClick={() => setSelectedRole("teacher")}
                className="group relative w-full text-left p-6 rounded-2xl border-2 border-background-200 bg-background-50 hover:border-accent-400 hover:bg-background-100/80 transition-all duration-300 cursor-pointer overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.06] group-hover:opacity-[0.10] transition-opacity duration-300">
                  <div className="w-full h-full rounded-bl-[80px] bg-accent-500"></div>
                </div>
                <div className="relative flex items-start gap-5">
                  <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 group-hover:bg-accent-200 group-hover:scale-105 transition-all duration-300 shrink-0">
                    <i className="ri-presentation-line text-2xl"></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading text-lg font-bold text-foreground-900 mb-1.5 group-hover:text-accent-700 transition-colors">
                      {t("auth.loginTeacherTab")}
                    </h3>
                    <p className="text-sm text-foreground-500 leading-relaxed">
                      {t("auth.loginTeacherDesc")}
                    </p>
                  </div>
                  <div className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-background-300 group-hover:border-accent-400 group-hover:bg-accent-50 transition-all duration-300 shrink-0 self-center">
                    <i className="ri-arrow-right-line text-foreground-400 group-hover:text-accent-600 transition-colors text-sm"></i>
                  </div>
                </div>
              </button>
            </div>

            <p className="mt-8 text-center text-sm text-foreground-400">
              {t("auth.registrationDisabled")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ========================
  // LOGIN FORM VIEW
  // ========================
  const isLearner = selectedRole === "learner";

  // Show loading after successful sign-in while profile loads
  if (signInSuccess) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-primary-100">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          </div>
          <p className="text-sm text-foreground-500">{t("auth.signingIn")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-50 flex">
      {/* Left illustration — changes based on role */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {isLearner ? (
          <img
            src="https://public.readdy.ai/ai/img_res/edited_1a053d909b293eecce0e55c260a35d6a_7fe14e1e.jpg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <img
            src="https://public.readdy.ai/ai/img_res/edited_b8fb432308c719d6c1f3d26f9ae9f2a1_338ebffb.jpg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className={`absolute inset-0 bg-gradient-to-br ${isLearner ? "from-primary-500/20 via-transparent to-primary-500/10" : "from-accent-500/20 via-transparent to-accent-500/10"}`}></div>
        <div className="relative z-10 flex flex-col justify-center px-16">
          <Link to="/" className="inline-flex items-center gap-2 mb-12 group cursor-pointer">
            <span className="font-heading text-3xl font-bold text-background-50 drop-shadow-sm">
              Better Minds
            </span>
          </Link>
          <blockquote className="border-l-2 border-background-50/40 pl-6">
            <p className="font-heading text-2xl text-background-50 leading-relaxed drop-shadow-sm">
              {isLearner
                ? `“${t("auth.loginQuoteLearner")}”`
                : `“${t("auth.loginQuoteTeacher")}”`
              }
            </p>
            <footer className="mt-4 text-sm text-background-50/80">
              — {t("auth.loginQuoteAuthor")}
            </footer>
          </blockquote>
        </div>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 py-12">
        <div className="w-full max-w-md">
          {/* Back to role select */}
          <button
            onClick={handleBackToRoleSelect}
            className="inline-flex items-center text-sm text-foreground-500 hover:text-foreground-700 mb-6 transition-colors duration-200 cursor-pointer group"
          >
            <i className="ri-arrow-left-line mr-1.5 group-hover:-translate-x-0.5 transition-transform"></i>
            {t("auth.switchRole")}
          </button>

          {/* Role badge */}
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-8 ${
            isLearner
              ? "bg-primary-100 text-primary-700"
              : "bg-accent-100 text-accent-700"
          }`}>
            <div className={`w-2 h-2 rounded-full ${isLearner ? "bg-primary-500" : "bg-accent-500"}`}></div>
            {roleLabel}
          </div>

          <div className="mb-8">
            <h1 className="font-heading text-3xl font-bold text-foreground-950 mb-2">
              {isLearner ? t("auth.loginAsLearner") : t("auth.loginAsTeacher")}
            </h1>
            <p className="text-sm text-foreground-500">
              {t("auth.loginSubtitle")}
            </p>
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
                htmlFor="login-email"
                className="block text-sm font-medium text-foreground-700 mb-1.5"
              >
                {t("auth.emailLabel")}
              </label>
              <div className="relative">
                <i className="ri-mail-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                  autoComplete="email"
                  autoFocus
                  className="w-full pl-10 pr-4 py-3 text-sm bg-background-50 border border-background-300 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-foreground-700 mb-1.5"
              >
                {t("auth.passwordLabel")}
              </label>
              <div className="relative">
                <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-base"></i>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                  autoComplete="current-password"
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

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-400/20 cursor-pointer"
                />
                <span className="text-sm text-foreground-500">{t("auth.rememberMe")}</span>
              </label>
              <button
                type="button"
                onClick={() => setShowChangePasswordForm(true)}
                className="text-sm text-primary-600 hover:text-primary-700 transition-colors cursor-pointer"
              >
                {t("auth.changePassword")}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold text-background-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer ${
                isLearner
                  ? "bg-primary-500 hover:bg-primary-600"
                  : "bg-accent-500 hover:bg-accent-600"
              }`}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin mr-2"></div>
                  {t("auth.loggingIn")}
                </>
              ) : (
                t("auth.loginButton")
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-foreground-400">
            {t("auth.registrationDisabled")}
          </p>

          <div className="mt-8 pt-6 border-t border-background-200">
            <p className="text-xs text-center text-foreground-400">
              {t("auth.termsFooter")}{" "}
              <a href="#" className="text-primary-600 hover:text-primary-700 cursor-pointer">
                {t("auth.termsOfService")}
              </a>{" "}
              and{" "}
              <a href="#" className="text-primary-600 hover:text-primary-700 cursor-pointer">
                {t("auth.privacyPolicy")}
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}