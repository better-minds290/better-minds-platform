import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import UnavailableDatesEditor from "./UnavailableDatesEditor";

interface TimeSlot {
  id?: string;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  is_active: boolean;
}

interface UnavailableDate {
  id?: string;
  date: string;
  reason: string;
}

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getNextWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(thisMonday.getDate() + 7);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);

  return {
    monday: nextMonday,
    sunday: nextSunday,
    mondayStr: toLocalDateStr(nextMonday),
    sundayStr: toLocalDateStr(nextSunday),
  };
}

function isDateInNextWeek(dateStr: string): boolean {
  const { mondayStr, sundayStr } = getNextWeekRange();
  return dateStr >= mondayStr && dateStr <= sundayStr;
}

export default function AvailabilityTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const supabase = getSupabase();

  const nextWeek = useMemo(() => getNextWeekRange(), []);

  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [unavailableDates, setUnavailableDates] = useState<UnavailableDate[]>([]);
  const [originalSlots, setOriginalSlots] = useState<TimeSlot[]>([]);
  const [originalUnavailable, setOriginalUnavailable] = useState<UnavailableDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [bookedSlotKeys, setBookedSlotKeys] = useState<Set<string>>(new Set());

  const [newSlotDate, setNewSlotDate] = useState(nextWeek.mondayStr);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchAvailability = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("teacher_availability")
        .select("*")
        .eq("teacher_id", profile.id)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (fetchError) throw fetchError;

      const fetched: TimeSlot[] = (data || []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        date: (row.date as string) || "",
        start_time: row.start_time as string,
        end_time: row.end_time as string,
        duration_minutes: (row.duration_minutes as number) || 60,
        is_active: row.is_active as boolean,
      }));
      setSlots(fetched);
      setOriginalSlots(JSON.parse(JSON.stringify(fetched)));
    } catch (err: unknown) {
      console.error("Failed to fetch availability:", err);
      setError(t("teacher.availabilityLoadError"));
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase, t]);

  const fetchUnavailableDates = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data, error: fetchError } = await supabase
        .from("teacher_unavailable_dates")
        .select("*")
        .eq("teacher_id", profile.id)
        .order("date", { ascending: true });
      if (fetchError) throw fetchError;
      const dates = (data || []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        date: row.date as string,
        reason: (row.reason as string) || "",
      }));
      setUnavailableDates(dates);
      setOriginalUnavailable(JSON.parse(JSON.stringify(dates)));
    } catch (err: unknown) {
      console.error("Failed to fetch unavailable dates:", err);
    }
  }, [profile?.id, supabase]);

  const fetchBookedSlots = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data } = await supabase
        .from("class_schedules")
        .select("date, start_time")
        .eq("teacher_id", profile.id)
        .in("status", ["booked", "active"]);
      const keys = new Set<string>();
      (data || []).forEach((row: Record<string, unknown>) => {
        const timeVal = (row.start_time as string) || "";
        keys.add(`${row.date}|${timeVal.slice(0, 5)}`);
      });
      setBookedSlotKeys(keys);
    } catch (err: unknown) {
      console.error("Failed to fetch booked slots:", err);
    }
  }, [profile?.id, supabase]);

  useEffect(() => {
    fetchAvailability();
    fetchUnavailableDates();
    fetchBookedSlots();
  }, [fetchAvailability, fetchUnavailableDates, fetchBookedSlots]);

  const nextWeekSlots = useMemo(() => {
    return slots.filter((s) => isDateInNextWeek(s.date));
  }, [slots]);

  const sortedSlots = useMemo(() => {
    return [...nextWeekSlots].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.start_time.localeCompare(b.start_time);
    });
  }, [nextWeekSlots]);

  const handleAddSlot = () => {
    const startTime = "08:00";
    const dur = 60;
    const [h, m] = startTime.split(":").map(Number);
    const totalMin = h * 60 + m + dur;
    const eh = Math.floor(totalMin / 60) % 24;
    const em = totalMin % 60;
    const endTime = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;

    const newDow = new Date(newSlotDate + "T00:00:00").getDay();
    const exists = slots.some((s) => {
      const sDow = new Date(s.date + "T00:00:00").getDay();
      return sDow === newDow && s.start_time === startTime;
    });
    if (exists) {
      showToast("error", t("teacher.availabilityDuplicateSlot"));
      return;
    }

    const newSlot: TimeSlot = {
      date: newSlotDate,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: dur,
      is_active: true,
    };
    setSlots((prev) => [...prev, newSlot]);

    const next = new Date(newSlotDate + "T00:00:00");
    next.setDate(next.getDate() + 1);
    const nextStr = toLocalDateStr(next);
    if (nextStr <= nextWeek.sundayStr) {
      setNewSlotDate(nextStr);
    }
  };

  const handleUpdateSlot = (index: number, field: "date" | "start_time" | "duration_minutes", value: number | string) => {
    setSlots((prev) => {
      const updated = [...prev];
      const globalIdx = slots.findIndex((s) => s === prev[index]);
      if (globalIdx === -1) return prev;

      if (field === "date") {
        updated[index] = { ...updated[index], date: value as string };
      } else if (field === "start_time") {
        updated[index] = { ...updated[index], start_time: value as string };
        const [h2, m2] = (value as string).split(":").map(Number);
        const totalMin2 = h2 * 60 + m2 + updated[index].duration_minutes;
        const eh2 = Math.floor(totalMin2 / 60) % 24;
        const em2 = totalMin2 % 60;
        updated[index].end_time = `${String(eh2).padStart(2, "0")}:${String(em2).padStart(2, "0")}`;
      } else if (field === "duration_minutes") {
        updated[index] = { ...updated[index], duration_minutes: value as number };
        const [h3, m3] = updated[index].start_time.split(":").map(Number);
        const totalMin3 = h3 * 60 + m3 + (value as number);
        const eh3 = Math.floor(totalMin3 / 60) % 24;
        const em3 = totalMin3 % 60;
        updated[index].end_time = `${String(eh3).padStart(2, "0")}:${String(em3).padStart(2, "0")}`;
      }
      return updated;
    });
  };

  const handleRemoveSlot = (slotIndexInSorted: number) => {
    const slotToRemove = sortedSlots[slotIndexInSorted];
    if (!slotToRemove) return;
    const key = `${slotToRemove.date}|${slotToRemove.start_time}`;
    if (bookedSlotKeys.has(key)) {
      showToast("error", t("teacher.availabilityCannotDeleteBooked"));
      return;
    }
    setSlots((prev) => prev.filter(
      (s) => !(s.date === slotToRemove.date && s.start_time === slotToRemove.start_time)
    ));
  };

  const handleToggleActive = (index: number) => {
    setSlots((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], is_active: !updated[index].is_active };
      return updated;
    });
  };

  const handleAddUnavailableDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = toLocalDateStr(tomorrow);
    setUnavailableDates((prev) => [...prev, { date: dateStr, reason: "" }]);
  };

  const handleUpdateUnavailableDate = (index: number, field: "date" | "reason", value: string) => {
    setUnavailableDates((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveUnavailableDate = (index: number) => {
    setUnavailableDates((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!profile?.id) return;
    setSaving(true);
    try {
      // Check if any removed slots are already booked
      const removedSlots = originalSlots.filter(
        (orig) => !slots.some((s) => s.date === orig.date && s.start_time === orig.start_time)
      );
      if (removedSlots.length > 0) {
        const { data: bookedData } = await supabase
          .from("class_schedules")
          .select("date, start_time")
          .eq("teacher_id", profile.id)
          .in("status", ["booked", "active"]);
        const bookedSet = new Set(
          (bookedData || []).map((r: Record<string, unknown>) => {
            const t = (r.start_time as string) || "";
            return `${r.date}|${t.slice(0, 5)}`;
          })
        );
        const blockedSlots = removedSlots.filter((s) => bookedSet.has(`${s.date}|${s.start_time}`));
        if (blockedSlots.length > 0) {
          showToast("error", t("teacher.availabilityCannotSaveBookedSlots"));
          setSaving(false);
          return;
        }
      }

      const { error: deleteError } = await supabase
        .from("teacher_availability")
        .delete()
        .eq("teacher_id", profile.id);
      if (deleteError) throw deleteError;

      const activeSlots = slots.filter((s) => s.is_active && s.date);
      const dedupedSlots = activeSlots.filter(
        (slot, idx, arr) => {
          const dow = new Date(slot.date + "T00:00:00").getDay();
          return arr.findIndex((s) => {
            const sDow = new Date(s.date + "T00:00:00").getDay();
            return sDow === dow && s.start_time === slot.start_time && s.duration_minutes === slot.duration_minutes;
          }) === idx;
        }
      );

      if (dedupedSlots.length > 0) {
        const { error: insertError } = await supabase
          .from("teacher_availability")
          .insert(dedupedSlots.map((s) => ({
            teacher_id: profile.id,
            date: s.date,
            day_of_week: new Date(s.date + "T00:00:00").getDay(),
            start_time: s.start_time,
            end_time: s.end_time,
            duration_minutes: s.duration_minutes,
            is_active: true,
          })));
        if (insertError) throw insertError;
      }

      const { error: delUnavailErr } = await supabase
        .from("teacher_unavailable_dates")
        .delete()
        .eq("teacher_id", profile.id);
      if (delUnavailErr) throw delUnavailErr;

      const datesToInsert = unavailableDates
        .filter((d) => d.date)
        .map((d) => ({ teacher_id: profile.id, date: d.date, reason: d.reason || null }));
      if (datesToInsert.length > 0) {
        const { error: insUnavailErr } = await supabase
          .from("teacher_unavailable_dates")
          .insert(datesToInsert);
        if (insUnavailErr) throw insUnavailErr;
      }

      showToast("success", t("teacher.availabilitySaved"));
      await fetchAvailability();
      await fetchUnavailableDates();
    } catch (err: unknown) {
      console.error("Failed to save availability:", err);
      showToast("error", t("teacher.availabilityError"));
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = useMemo(() => {
    return (
      JSON.stringify(slots) !== JSON.stringify(originalSlots) ||
      JSON.stringify(unavailableDates) !== JSON.stringify(originalUnavailable)
    );
  }, [slots, originalSlots, unavailableDates, originalUnavailable]);

  const totalActiveSlots = useMemo(() => nextWeekSlots.filter((s) => s.is_active).length, [nextWeekSlots]);

  const weeklyHours = useMemo(() => {
    let totalMinutes = 0;
    for (const slot of nextWeekSlots) {
      if (!slot.is_active) continue;
      totalMinutes += slot.duration_minutes;
    }
    return Math.round((totalMinutes / 60) * 10) / 10;
  }, [nextWeekSlots]);

  const formatTimeDisplay = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };

  const formatDuration = (mins: number) => {
    if (mins === 30) return "30 min";
    if (mins === 60) return "1 hr";
    if (mins === 90) return "1.5 hr";
    return `${mins} min`;
  };

  const weekLabel = useMemo(() => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formatShort = (d: Date) => `${months[d.getMonth()]} ${d.getDate()}`;
    return `${formatShort(nextWeek.monday)} – ${formatShort(nextWeek.sunday)}, ${nextWeek.monday.getFullYear()}`;
  }, [nextWeek]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
          <p className="text-sm text-foreground-400">{t("teacher.availabilityLoading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-error-warning-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-600 font-medium mb-4">{error}</p>
        <button
          onClick={fetchAvailability}
          className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line mr-1.5"></i>
          {t("dashboard.retry")}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Next Week Banner */}
      <div className="mb-6 p-4 rounded-xl bg-accent-50 border border-accent-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-bold text-foreground-950 mb-0.5">
            {t("teacher.availabilityTitle")}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-100 text-accent-800">
              <i className="ri-calendar-event-line"></i>
              {t("teacher.availabilityNextWeek")}: {weekLabel}
            </span>
            <span className="text-xs text-foreground-500">{t("teacher.availabilityDateSubtitle")}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-100 text-accent-700">
            <i className="ri-time-line"></i>
            {weeklyHours}h
          </span>
          <span className="text-xs text-foreground-400">
            {totalActiveSlots} {t("teacher.availabilitySlotCount", { count: totalActiveSlots })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Slot Editor */}
        <div className="lg:col-span-2 space-y-5">
          {/* Add Slot Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-xl border border-background-200/70 bg-background-50">
            <div className="flex items-center gap-3 flex-1 flex-wrap">
              <div className="flex items-center gap-2">
                <i className="ri-calendar-line text-foreground-400"></i>
                <input
                  type="date"
                  value={newSlotDate}
                  min={nextWeek.mondayStr}
                  max={nextWeek.sundayStr}
                  onChange={(e) => setNewSlotDate(e.target.value)}
                  className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 cursor-pointer"
                />
              </div>
              <span className="text-xs text-foreground-400">{t("teacher.availabilityStartTime")}</span>
              <input
                type="time"
                defaultValue="08:00"
                className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300"
                id="new-slot-time"
              />
              <select
                defaultValue="60"
                className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 cursor-pointer"
                id="new-slot-duration"
              >
                <option value={30}>30 min</option>
                <option value={60}>1 hr</option>
                <option value={90}>1.5 hr</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                const timeInput = document.getElementById("new-slot-time") as HTMLInputElement;
                const durationInput = document.getElementById("new-slot-duration") as HTMLSelectElement;
                const startTime = timeInput?.value || "08:00";
                const dur = parseInt(durationInput?.value || "60", 10);

                const newDow = new Date(newSlotDate + "T00:00:00").getDay();
                const exists = slots.some((s) => {
                  const sDow = new Date(s.date + "T00:00:00").getDay();
                  return sDow === newDow && s.start_time === startTime;
                });
                if (exists) {
                  showToast("error", t("teacher.availabilityDuplicateSlot"));
                  return;
                }

                const [h, m] = startTime.split(":").map(Number);
                const totalMin = h * 60 + m + dur;
                const eh = Math.floor(totalMin / 60) % 24;
                const em = totalMin % 60;
                const endTime = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
                const newSlot: TimeSlot = {
                  date: newSlotDate,
                  start_time: startTime,
                  end_time: endTime,
                  duration_minutes: dur,
                  is_active: true,
                };
                setSlots((prev) => [...prev, newSlot]);
                const next = new Date(newSlotDate + "T00:00:00");
                next.setDate(next.getDate() + 1);
                const nextStr = toLocalDateStr(next);
                if (nextStr <= nextWeek.sundayStr) {
                  setNewSlotDate(nextStr);
                }
              }}
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line mr-1.5"></i>
              {t("teacher.availabilityAddSlot")}
            </button>
          </div>

          {/* Slot List */}
          {sortedSlots.length === 0 ? (
            <div className="py-12 text-center rounded-xl border border-dashed border-background-300 bg-background-50">
              <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-200 text-foreground-400 mb-4">
                <i className="ri-calendar-event-line text-2xl"></i>
              </div>
              <p className="text-sm text-foreground-500 font-medium mb-1">{t("teacher.availabilityEmpty")}</p>
              <p className="text-xs text-foreground-400">{t("teacher.availabilityDateHint")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSlots.map((slot, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors duration-150 ${
                    slot.is_active
                      ? "border-background-200/70 bg-background-50"
                      : "border-background-100 bg-background-100/50 opacity-60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleActive(idx)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      slot.is_active
                        ? "bg-primary-500 border-primary-500"
                        : "border-foreground-300"
                    }`}
                    title={slot.is_active ? t("teacher.availabilityActive") : t("teacher.availabilityInactive")}
                  >
                    {slot.is_active && (
                      <i className="ri-check-line text-[10px] text-background-50"></i>
                    )}
                  </button>

                  <div className="flex items-center gap-3 flex-1 flex-wrap">
                    <input
                      type="date"
                      value={slot.date}
                      min={nextWeek.mondayStr}
                      max={nextWeek.sundayStr}
                      onChange={(e) => handleUpdateSlot(idx, "date", e.target.value)}
                      className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 cursor-pointer"
                    />

                    <input
                      type="time"
                      value={slot.start_time}
                      onChange={(e) => handleUpdateSlot(idx, "start_time", e.target.value)}
                      className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300"
                    />

                    <select
                      value={slot.duration_minutes}
                      onChange={(e) => handleUpdateSlot(idx, "duration_minutes", parseInt(e.target.value))}
                      className="text-sm rounded-md border border-background-200 bg-background-50 px-2 py-1.5 text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 cursor-pointer"
                    >
                      <option value={30}>30 min</option>
                      <option value={60}>1 hr</option>
                      <option value={90}>1.5 hr</option>
                    </select>

                    <span className="text-xs text-foreground-400 whitespace-nowrap">
                      {formatTimeDisplay(slot.start_time)} – {formatTimeDisplay(slot.end_time)}
                    </span>
                  </div>

                  {bookedSlotKeys.has(`${slot.date}|${slot.start_time}`) ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-foreground-400 bg-foreground-100 whitespace-nowrap shrink-0" title={t("teacher.availabilityCannotDeleteBooked")}>
                      <i className="ri-lock-line text-[11px]"></i>
                      {t("teacher.availabilityBooked")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(idx)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-foreground-300 hover:text-accent-500 hover:bg-accent-50 transition-colors duration-150 cursor-pointer shrink-0"
                      title={t("teacher.availabilityRemoveSlot")}
                    >
                      <i className="ri-close-line"></i>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Save Button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-foreground-400">
              {totalActiveSlots} {t("teacher.availabilitySlotCount", { count: totalActiveSlots })} · {t("teacher.availabilityHoursPerWeek", { hours: weeklyHours })}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer whitespace-nowrap"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-background-50 border-t-transparent rounded-full animate-spin mr-2"></div>
                  {t("teacher.availabilitySaving")}
                </>
              ) : (
                <>
                  <i className="ri-save-line mr-1.5"></i>
                  {t("teacher.availabilitySave")}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Preview + Unavailable Dates */}
        <div className="lg:col-span-1 space-y-5">
          <div className="rounded-xl border border-background-200/70 bg-background-50 p-5 sticky top-24">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600">
                <i className="ri-calendar-view"></i>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground-900">
                  {t("teacher.availabilityPreview")}
                </p>
                <p className="text-[10px] text-foreground-400">
                  {t("teacher.availabilityNextWeek")}: {weekLabel}
                </p>
              </div>
            </div>

            {sortedSlots.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xs text-foreground-400">{t("teacher.availabilityEmpty")}</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {(() => {
                  const grouped: Record<string, TimeSlot[]> = {};
                  sortedSlots.forEach((s) => {
                    if (!grouped[s.date]) grouped[s.date] = [];
                    grouped[s.date].push(s);
                  });
                  return Object.entries(grouped).map(([date, dateSlots]) => (
                    <div key={date} className="p-2.5 rounded-lg border border-background-200/50">
                      <p className="text-xs font-semibold text-foreground-700 mb-1.5">
                        {formatDateDisplay(date)}
                      </p>
                      <div className="space-y-0.5">
                        {dateSlots.map((slot, sIdx) => (
                          <div
                            key={sIdx}
                            className={`flex items-center gap-1.5 text-[10px] ${
                              slot.is_active
                                ? "text-foreground-600"
                                : "text-foreground-300 line-through"
                            }`}
                          >
                            <span
                              className={`w-1 h-1 rounded-full shrink-0 ${
                                slot.is_active ? "bg-primary-400" : "bg-foreground-200"
                              }`}
                            ></span>
                            {formatTimeDisplay(slot.start_time)} · {formatDuration(slot.duration_minutes)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>

          <UnavailableDatesEditor
            dates={unavailableDates}
            onAdd={handleAddUnavailableDate}
            onUpdate={handleUpdateUnavailableDate}
            onRemove={handleRemoveUnavailableDate}
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-[slideUp_0.3s_ease-out]">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
              toast.type === "success"
                ? "bg-primary-600 text-background-50"
                : "bg-accent-600 text-background-50"
            }`}
          >
            <i className={toast.type === "success" ? "ri-check-line" : "ri-close-line"}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}