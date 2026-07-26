import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface LessonSummaryFormProps {
  sessionId: string;
  sprintId: string;
  lessonSummary: string | null;
  status: string;
  onSubmitSuccess?: () => void;
}

export default function LessonSummaryForm({
  sessionId,
  lessonSummary: initialSummary,
  status: initialStatus,
  onSubmitSuccess,
}: LessonSummaryFormProps) {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [summary, setSummary] = useState(initialSummary || "");
  const [questions, setQuestions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(initialStatus === "completed");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: authData } = await supabase.auth.getSession();
      const userId = authData?.session?.user?.id;

      if (!userId) {
        setError(t("session.submitError"));
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke("complete-session", {
        body: {
          session_id: sessionId,
          teacher_id: userId,
          lesson_summary: summary,
          questions: questions,
        },
      });

      if (fnError) throw new Error(fnError.message);

      if (data?.success && data?.session_completed) {
        setSubmitted(true);
        setSuccess(t("session.summarySubmitSuccess"));
        onSubmitSuccess?.();
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(data?.error || t("session.summarySubmitFailed"));
      }
    } catch (err: any) {
      console.error("Submit lesson summary error:", err);
      setError(err?.message || t("session.submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const isCompleted = submitted || initialStatus === "completed";

  return (
    <div className="space-y-5">
      {success && (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2">
          <i className="ri-check-line"></i>
          {success}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-md bg-accent-100 text-accent-700 text-sm flex items-center gap-2">
          <i className="ri-error-warning-line"></i>
          {error}
        </div>
      )}

      {isCompleted ? (
        <div className="space-y-4">
          <div className="p-5 rounded-lg bg-accent-50/50 border border-accent-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-600">
                <i className="ri-check-line"></i>
              </div>
              <span className="text-sm font-semibold text-accent-800">{t("session.alreadyCompleted")}</span>
            </div>
            <p className="text-sm text-foreground-700 whitespace-pre-wrap leading-relaxed">{summary || initialSummary || ""}</p>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("session.whatILearned")}
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={5}
              maxLength={500}
              className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 transition-colors resize-y"
              placeholder={t("session.summaryPlaceholder")}
            />
            <p className="text-[11px] text-foreground-400 mt-1">{summary.length} / 500</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("session.questionsLabel")}
            </label>
            <textarea
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              rows={3}
              maxLength={300}
              className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 transition-colors resize-y"
              placeholder={t("session.questionsPlaceholder")}
            />
            <p className="text-[11px] text-foreground-400 mt-1">{questions.length} / 300</p>
          </div>

          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || summary.trim().length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              {submitting ? (
                <>
                  <i className="ri-loader-4-line animate-spin"></i>
                  {t("session.submitting")}
                </>
              ) : (
                <>
                  <i className="ri-send-plane-line"></i>
                  {t("session.submitSummary")}
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}