import { useTranslation } from "react-i18next";
import { formatVietnamDate, getUiDateLocale, vietnamTodayStr } from "@/lib/datetime";

interface UnavailableDate {
  id?: string;
  date: string;
  reason: string;
}

interface UnavailableDatesEditorProps {
  dates: UnavailableDate[];
  onAdd: () => void;
  onUpdate: (index: number, field: "date" | "reason", value: string) => void;
  onRemove: (index: number) => void;
}

export default function UnavailableDatesEditor({
  dates,
  onAdd,
  onUpdate,
  onRemove,
}: UnavailableDatesEditorProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getUiDateLocale(i18n.language);
  const todayStr = vietnamTodayStr();

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    return formatVietnamDate(dateStr, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }, dateLocale);
  };

  return (
    <div className="rounded-xl border border-background-200/70 bg-background-50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600">
            <i className="ri-calendar-close-line"></i>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground-900">
              {t("teacher.availabilityUnavailableTitle")}
            </p>
            <p className="text-[10px] text-foreground-400">
              {t("teacher.availabilityUnavailableSubtitle")}
            </p>
          </div>
        </div>
        <button
          onClick={onAdd}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary-500 text-background-50 hover:bg-secondary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-add-line mr-1"></i>
          {t("teacher.availabilityAddDate")}
        </button>
      </div>

      {dates.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-xs text-foreground-400">
            {t("teacher.availabilityNoUnavailable")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {dates.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-background-200/70 bg-background-50"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] font-medium text-foreground-400 uppercase tracking-wider">
                    {t("teacher.availabilityDateLabel")}
                  </label>
                  <input
                    type="date"
                    min={todayStr}
                    value={item.date}
                    onChange={(e) => onUpdate(idx, "date", e.target.value)}
                    className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300"
                  />
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <label className="text-[10px] font-medium text-foreground-400 uppercase tracking-wider">
                    {t("teacher.availabilityReasonLabel")}
                  </label>
                  <input
                    type="text"
                    value={item.reason}
                    onChange={(e) => onUpdate(idx, "reason", e.target.value)}
                    placeholder={t("teacher.availabilityReasonPlaceholder")}
                    className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 w-full"
                  />
                </div>
              </div>
              <button
                onClick={() => onRemove(idx)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-foreground-300 hover:text-accent-500 hover:bg-accent-50 transition-colors duration-150 cursor-pointer shrink-0"
                title={t("teacher.availabilityRemoveDate")}
              >
                <i className="ri-close-line"></i>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}