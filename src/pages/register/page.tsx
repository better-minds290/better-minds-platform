import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/login", { replace: true });
    }, 5000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center rounded-full bg-accent-100">
          <i className="ri-shield-user-line text-3xl text-accent-600"></i>
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-3">
          {t("auth.registerPageTitle")}
        </h1>
        <p className="text-sm text-foreground-500 mb-2 leading-relaxed">
          {t("auth.registrationDisabled")}
        </p>
        <p className="text-xs text-foreground-400 mb-8">
          {t("auth.registerPageRedirect")}
        </p>
        <Link
          to="/login"
          className="inline-flex items-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
        >
          {t("auth.registerPageGoToLogin")}
        </Link>
      </div>
    </div>
  );
}