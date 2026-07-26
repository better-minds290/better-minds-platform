import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import i18n from "@/i18n";

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: Array<"learner" | "vietnamese_teacher" | "foreign_teacher" | "admin">;
}

export default function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const { user, profile, loading } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    if (profile && profile.role === "foreign_teacher" && i18n.language !== "en") {
      i18n.changeLanguage("en");
    }
  }, [profile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
          <p className="text-sm text-foreground-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Block deactivated users
  if (profile && profile.is_active === false) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-accent-100">
            <i className="ri-user-unfollow-line text-2xl text-accent-600"></i>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">
            {t("auth.accountDeactivatedTitle")}
          </h2>
          <p className="text-sm text-foreground-500 mb-6">
            {t("auth.accountDeactivatedDesc")}
          </p>
          <button
            onClick={async () => {
              const supabase = (await import("@/lib/supabase")).getSupabase();
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            {t("auth.backToHome")}
          </button>
        </div>
      </div>
    );
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-accent-100">
            <i className="ri-shield-check-line text-2xl text-accent-600"></i>
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">
            Access Restricted
          </h2>
          <p className="text-sm text-foreground-500 mb-6">
            You do not have permission to access this page. Please contact an administrator if you believe this is an error.
          </p>
          <a
            href="/"
            className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}