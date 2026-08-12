import { useTranslation } from "react-i18next";

export default function CTASection() {
  const { t } = useTranslation();

  return (
    <section className="w-full py-16 md:py-24 bg-background-100">
      <div className="w-full max-w-3xl mx-auto px-4 md:px-6 text-center">
        <h2 className="font-heading text-2xl md:text-4xl font-bold text-foreground-950 mb-4">
          {t("cta.title")}
        </h2>
        <p className="text-sm md:text-base text-foreground-600 mb-8 md:mb-10 max-w-xl mx-auto">
          {t("cta.subtitle")}
        </p>
        <a
          href="https://forms.gle/hC6pbhuFBSmUaxQs6"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-8 py-3.5 rounded-full text-sm md:text-base font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-all duration-200 whitespace-nowrap cursor-pointer"
        >
          {t("cta.button")}
          <i className="ri-arrow-right-line ml-2"></i>
        </a>
      </div>
    </section>
  );
}