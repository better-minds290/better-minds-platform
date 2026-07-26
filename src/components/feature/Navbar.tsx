import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import NotificationBell from "@/components/feature/NotificationBell";
import i18n from "@/i18n";

export default function Navbar() {
  const { t } = useTranslation();
  const { isAuthenticated, profile } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleLangChange = (lang: string) => {
      setCurrentLang(lang);
    };
    i18n.on("languageChanged", handleLangChange);
    return () => {
      i18n.off("languageChanged", handleLangChange);
    };
  }, []);

  const toggleLanguage = () => {
    const nextLang = currentLang === "vi" ? "en" : "vi";
    i18n.changeLanguage(nextLang);
  };

  const getDashboardPath = (): string => {
    if (!profile) return "/dashboard";
    switch (profile.role) {
      case "learner":
        return "/dashboard";
      case "vietnamese_teacher":
      case "foreign_teacher":
        return "/teacher/dashboard";
      case "admin":
        return "/admin/dashboard";
      default:
        return "/dashboard";
    }
  };

  const navLinks = [
    { key: "nav.forLearners", href: "#for-learners" },
    { key: "nav.forTeachers", href: "#for-teachers" },
  ];

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-background-50/95 backdrop-blur-md shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="w-full px-4 md:px-6">
        <div className="flex items-center justify-between h-16 md:h-18">
          <a href="/" className="flex items-center gap-2 group cursor-pointer">
            <span className="font-heading text-xl md:text-2xl font-bold text-primary-600 tracking-tight">
              Better Minds
            </span>
          </a>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.key}
                href={link.href}
                className="text-sm font-medium text-foreground-600 hover:text-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                {t(link.key)}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={toggleLanguage}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-background-100 text-foreground-700 hover:bg-background-200 border border-background-200/70 transition-all duration-200 whitespace-nowrap cursor-pointer"
              title={currentLang === "vi" ? t("language.switchToEn") : t("language.switchToVi")}
            >
              <i className="ri-global-line text-sm"></i>
              <span>{currentLang === "vi" ? "VI" : "EN"}</span>
            </button>
            {isAuthenticated ? (
              <>
                <NotificationBell />
                <span className="text-sm text-foreground-500 hidden lg:inline">
                  {profile?.full_name}
                </span>
                <Link
                  to={getDashboardPath()}
                  className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  {t("nav.dashboard")}
                </Link>
              </>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
              >
                {t("nav.login")}
              </Link>
            )}
          </div>

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden w-10 h-10 flex items-center justify-center text-foreground-700 cursor-pointer"
            aria-label="Toggle menu"
          >
            <i className={`text-xl ${mobileOpen ? "ri-close-line" : "ri-menu-line"}`}></i>
          </button>
        </div>

        {mobileOpen && (
          <div className="md:hidden pb-4 border-t border-background-200/70">
            <div className="flex flex-col gap-1 pt-3">
              {navLinks.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium text-foreground-600 hover:text-primary-600 hover:bg-background-100 rounded-md transition-colors duration-200 cursor-pointer"
                >
                  {t(link.key)}
                </a>
              ))}
              <div className="border-t border-background-200/70 my-2"></div>
              <button
                onClick={toggleLanguage}
                className="mx-3 mb-1 flex items-center gap-2 w-auto px-3 py-2.5 text-sm font-medium text-foreground-600 hover:text-foreground-900 hover:bg-background-100 rounded-md transition-colors duration-200 cursor-pointer"
              >
                <i className="ri-global-line text-base"></i>
                {currentLang === "vi" ? t("language.switchToEn") : t("language.switchToVi")}
              </button>
              {isAuthenticated ? (
                <Link
                  to={getDashboardPath()}
                  onClick={() => setMobileOpen(false)}
                  className="mx-3 mt-1 inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                >
                  {t("nav.dashboard")}
                </Link>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium text-foreground-600 hover:text-primary-600 rounded-md transition-colors duration-200 cursor-pointer"
                >
                  {t("nav.login")}
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}