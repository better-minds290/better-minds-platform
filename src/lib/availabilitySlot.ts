import { isTeachingClassDate } from "./scheduling";

const MINUTES_PER_DAY = 24 * 60;

export interface AvailabilitySlotLike {
  date: string;
  start_time: string;
  duration_minutes: number;
  is_active: boolean;
}

/** Clock minutes from midnight. Accepts HH:MM or HH:MM:SS. */
export function parseAvailabilityClockMinutes(time: string): number | null {
  const parts = String(time || "").trim().split(":");
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** startMinutes + duration. Null if the clock or duration cannot be parsed. */
export function availabilityEndMinutes(startTime: string, durationMinutes: number): number | null {
  const startMinutes = parseAvailabilityClockMinutes(startTime);
  if (startMinutes === null) return null;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  return startMinutes + durationMinutes;
}

/**
 * True when the slot would reach or pass the next calendar day.
 * Ending exactly at 00:00 (endMinutes === 1440) is a midnight crossing.
 */
export function availabilitySlotCrossesMidnight(startTime: string, durationMinutes: number): boolean {
  const endMinutes = availabilityEndMinutes(startTime, durationMinutes);
  if (endMinutes === null) return true;
  return endMinutes >= MINUTES_PER_DAY;
}

/**
 * Same-day HH:MM end time. Null when the slot crosses midnight or inputs are invalid.
 * Call this only after (or as) midnight validation — it does not wrap with modulo 24.
 */
export function formatSameDayAvailabilityEndTime(
  startTime: string,
  durationMinutes: number
): string | null {
  const endMinutes = availabilityEndMinutes(startTime, durationMinutes);
  if (endMinutes === null || endMinutes >= MINUTES_PER_DAY) return null;
  const eh = Math.floor(endMinutes / 60);
  const em = endMinutes % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

/**
 * Slots that would be written on save (active, teaching date) and cross midnight.
 * If any exist, Save must abort before DELETE/INSERT.
 */
export function midnightCrossingSlotsBlockingSave(slots: AvailabilitySlotLike[]): AvailabilitySlotLike[] {
  return slots.filter(
    (slot) =>
      slot.is_active &&
      slot.date &&
      isTeachingClassDate(slot.date) &&
      availabilitySlotCrossesMidnight(slot.start_time, slot.duration_minutes)
  );
}
