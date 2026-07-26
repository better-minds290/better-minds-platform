import { useState } from "react";
import { useTranslation } from "react-i18next";

interface EnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseName: string;
  courseLevel: string;
  courseId: string;
  enrollmentPassword: string | null;
  onEnroll: (password?: string) => Promise<{ success: boolean; error?: string }>;
}

export default function EnrollmentModal({
  isOpen,
  onClose,
  courseName,
  courseLevel,
  enrollmentPassword,
  onEnroll,
}: EnrollmentModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setPasswordError(null);
    setErrorMessage(null);

    // Client-side password pre-check for instant feedback
    if (enrollmentPassword && password.trim() !== enrollmentPassword) {
      setPasswordError(t("enroll.passwordIncorrect"));
      return;
    }

    setIsSubmitting(true);

    const result = await onEnroll(password.trim() || undefined);

    setIsSubmitting(false);

    if (result.success) {
      setIsSuccess(true);
    } else {
      setErrorMessage(result.error || t("enroll.genericError"));
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isSubmitting && !isSuccess) {
      onClose();
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setErrorMessage(null);
    setPasswordError(null);
    setPassword("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm transition-opacity duration-300"></div>

      {/* Modal */}
      <div
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-background-50 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] overflow-hidden animate-[fadeScaleIn_0.25s_ease-out]"
        style={{
          animation: "fadeScaleIn 0.25s ease-out",
        }}
      >
        {isSuccess ? (
          /* Success State */
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-full bg-accent-100 text-accent-600 mb-5">
              <i className="ri-check-line text-3xl"></i>
            </div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-2">
              {t("enroll.successTitle")}
            </h2>
            <p className="text-sm text-foreground-600 mb-6 leading-relaxed">
              {t("enroll.successDesc", { course: courseName })}
            </p>
            <button
              onClick={() => {
                handleReset();
                onClose();
              }}
              className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              <i className="ri-dashboard-line"></i>
              {t("enroll.goToDashboard")}
            </button>
          </div>
        ) : (
          /* Form State */
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-background-200/70">
              <div>
                <h2 className="font-heading text-lg font-bold text-foreground-950">
                  {t("enroll.title")}
                </h2>
                <p className="text-xs text-foreground-500 mt-0.5">
                  {courseName} · {courseLevel}
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="w-8 h-8 flex items-center justify-center rounded-md text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
              {/* Error message */}
              {errorMessage && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-50 border border-accent-200 text-sm text-accent-700">
                  <i className="ri-error-warning-line mt-0.5 shrink-0"></i>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Password input */}
              {enrollmentPassword && (
                <div>
                  <label className="block text-sm font-semibold text-foreground-800 mb-2">
                    {t("enroll.passwordLabel")}
                  </label>
                  <div className="relative">
                    <i className="ri-lock-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
                    <input
                      type="text"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (passwordError) setPasswordError(null);
                      }}
                      placeholder={t("enroll.passwordPlaceholder")}
                      disabled={isSubmitting}
                      className={`w-full pl-10 pr-4 py-2.5 text-sm bg-background-50 border rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 transition-all duration-200 ${
                        passwordError
                          ? "border-accent-400 focus:border-accent-400 focus:ring-accent-400/20"
                          : "border-background-200 focus:border-primary-400 focus:ring-primary-400/20"
                      } disabled:opacity-60`}
                    />
                  </div>
                  {passwordError && (
                    <p className="mt-1.5 text-xs text-accent-600 flex items-center gap-1">
                      <i className="ri-error-warning-line"></i>
                      {passwordError}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-foreground-400">
                    {t("enroll.passwordRequiredHint")}
                  </p>
                </div>
              )}

              {/* Enrollment info */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-background-100 text-xs text-foreground-500">
                <i className="ri-information-line mt-0.5 text-foreground-400 shrink-0"></i>
                <span className="leading-relaxed">
                  {t("enroll.autoSetupInfo")}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-background-200/70 bg-background-100/50">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-medium text-foreground-600 hover:text-foreground-700 hover:bg-background-200 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {t("enroll.cancel")}
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-60 min-w-[100px]"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin"></div>
                    {t("enroll.generatingSprints")}
                  </>
                ) : (
                  <>
                    <i className="ri-check-line"></i>
                    {t("enroll.confirmEnroll")}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}