import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export default function HeroSection() {
  const { t } = useTranslation();

  // Google Form URLs
  const learnerFormUrl = "https://forms.gle/hC6pbhuFBSmUaxQs6";
  const teacherFormUrl = "https://forms.gle/xcqKyYQM5XmqVEKB8";

  return (
    <section className="relative w-full h-[560px] md:h-[720px] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0">
        <img
          src="https://readdy.ai/api/search-image?query=Abstract%20geometric%20composition%20with%20flowing%20organic%20shapes%20in%20deep%20navy%20blue%20midnight%20blue%20and%20soft%20teal%20cyan%20tones%20on%20warm%20off%20white%20cream%20background%2C%20gentle%20flowing%20gradients%2C%20educational%20learning%20theme%2C%20modern%20minimalist%20style%2C%20clean%20serene%20atmosphere%2C%20high%20resolution%20editorial%20quality%2C%20no%20text%20or%20lettering%2C%20peaceful%20calm%20aesthetic%20with%20cool%20professional%20tones&width=1800&height=1200&seq=hero-bg-001&orientation=landscape&nocache=true"
          alt="Better Minds learning platform"
          className="w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/25 to-black/45"></div>
      </div>

      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 md:px-6 text-center">
        <div className="mx-auto mb-5 md:mb-7 w-28 h-28 md:w-36 md:h-36 lg:w-44 lg:h-44 rounded-full overflow-hidden ring-4 ring-white/20 shadow-2xl">
          <img
            src="https://storage.readdy-site.link/project_files/1ab2a421-cc26-4354-b646-3d53c859d815/01222115-fafd-4255-9dfa-d4e2f774ae71_compressed_6df3edd9-f034-455d-b7f8-70625a98a467.webp"
            alt="Better Minds logo"
            className="w-full h-full object-cover"
          />
        </div>
        <h1 className="font-heading text-4xl md:text-6xl lg:text-8xl font-bold text-white leading-[1.1] tracking-tight">
          {t("hero.title")}
          <br />
          <span className="text-primary-400">{t("hero.titleLine2")}</span>
        </h1>
        <p className="mt-5 md:mt-6 text-sm md:text-base text-white/80 max-w-2xl mx-auto leading-relaxed">
          {t("hero.subtitle")}
        </p>
        <div className="mt-8 md:mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={learnerFormUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-7 py-3 rounded-md text-sm md:text-base font-semibold bg-primary-500 text-background-50 hover:bg-primary-400 transition-all duration-200 whitespace-nowrap cursor-pointer"
          >
            {t("hero.ctaLearner")}
            <i className="ri-arrow-right-up-line ml-2"></i>
          </a>
          <a
            href={teacherFormUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-7 py-3 rounded-md text-sm md:text-base font-semibold border border-white/30 text-white hover:bg-white/10 transition-all duration-200 whitespace-nowrap cursor-pointer"
          >
            {t("hero.ctaTeacher")}
            <i className="ri-arrow-right-up-line ml-2"></i>
          </a>
        </div>
        <p className="mt-4 text-xs text-white/50">
          {t("hero.googleFormRedirect")}
        </p>
      </div>
    </section>
  );
}