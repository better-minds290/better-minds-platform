import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function Footer() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const honeypot = form.querySelector<HTMLInputElement>('input[name="website_alt"]');
    if (honeypot && honeypot.value.trim() !== "") {
      setStatus("success");
      setEmail("");
      return;
    }
    setStatus("submitting");
    try {
      const formData = new URLSearchParams();
      formData.append("email", email);
      await fetch("https://readdy.ai/api/form/d916lrgbhec1he3opplg", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <footer className="bg-secondary-900 text-background-100">
      <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-14 md:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
          <div className="lg:col-span-1">
            <h3 className="font-heading text-xl font-bold text-background-50 mb-3">
              {t("footer.tagline")}
            </h3>
            <p className="text-sm text-background-300 leading-relaxed max-w-xs">
              {t("footer.description")}
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-background-50 mb-4">
              {t("footer.quickLinks")}
            </h4>
            <div className="flex flex-col gap-2.5">
              {[
                { key: "footer.linkHome", href: "/" },
                { key: "footer.linkLogin", href: "/login" },
              ].map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  className="text-sm text-background-300 hover:text-background-50 transition-colors duration-200 cursor-pointer"
                >
                  {t(link.key)}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-background-50 mb-4">
              {t("footer.resources")}
            </h4>
            <div className="flex flex-col gap-2.5">
              <a
                href="/courses"
                className="text-sm text-background-300 hover:text-background-50 transition-colors duration-200 cursor-pointer"
              >
                {t("footer.linkCourses")}
              </a>
              <a
                href="/login"
                className="text-sm text-background-300 hover:text-background-50 transition-colors duration-200 cursor-pointer"
              >
                {t("footer.linkLogin")}
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-background-50 mb-4">
              {t("footer.registerTitle")}
            </h4>
            <div className="flex flex-col gap-2.5">
              <a
                href="https://forms.gle/hC6pbhuFBSmUaxQs6"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-sm text-background-300 hover:text-background-50 transition-colors duration-200 cursor-pointer inline-flex items-center gap-1.5"
              >
                <i className="ri-user-add-line text-xs"></i>
                {t("footer.registerLearner")}
              </a>
              <a
                href="https://forms.gle/xcqKyYQM5XmqVEKB8"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-sm text-background-300 hover:text-background-50 transition-colors duration-200 cursor-pointer inline-flex items-center gap-1.5"
              >
                <i className="ri-briefcase-line text-xs"></i>
                {t("footer.registerTeacher")}
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-background-50 mb-2">
              {t("footer.newsletter")}
            </h4>
            <p className="text-sm text-background-300 mb-4 leading-relaxed">
              {t("footer.newsletterDesc")}
            </p>
            <form onSubmit={handleSubmit} data-readdy-form>
              <input
                type="text"
                name="website_alt"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute opacity-0 pointer-events-none"
                style={{ position: "absolute", left: "-9999px", opacity: 0, pointerEvents: "none" }}
              />
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  name="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("footer.newsletterPlaceholder")}
                  className="flex-1 px-4 py-2.5 rounded-md text-sm bg-background-50/10 border border-background-50/20 text-background-50 placeholder:text-background-400 focus:outline-none focus:border-primary-500 transition-colors duration-200"
                />
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-400 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
                >
                  {status === "submitting"
                    ? t("footer.newsletterSending")
                    : t("footer.newsletterButton")}
                </button>
              </div>
              {status === "success" && (
                <p className="text-xs text-accent-400 mt-2">{t("footer.newsletterSuccess")}</p>
              )}
              {status === "error" && (
                <p className="text-xs text-accent-400 mt-2">{t("footer.newsletterError")}</p>
              )}
            </form>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-background-50/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-background-400">
            {t("footer.copyright")}
          </p>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <a href="#" rel="nofollow" className="w-8 h-8 flex items-center justify-center text-background-400 hover:text-background-50 transition-colors duration-200 cursor-pointer" aria-label={t("footer.social.fb")}>
                <i className="ri-facebook-fill"></i>
              </a>
              <a href="#" rel="nofollow" className="w-8 h-8 flex items-center justify-center text-background-400 hover:text-background-50 transition-colors duration-200 cursor-pointer" aria-label={t("footer.social.tw")}>
                <i className="ri-twitter-x-fill"></i>
              </a>
              <a href="#" rel="nofollow" className="w-8 h-8 flex items-center justify-center text-background-400 hover:text-background-50 transition-colors duration-200 cursor-pointer" aria-label={t("footer.social.li")}>
                <i className="ri-linkedin-fill"></i>
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}