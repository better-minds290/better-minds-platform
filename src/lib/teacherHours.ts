import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarDateToLocalDate, toLocalDateStr } from "./datetime";

const PAGE_SIZE = 1000;
const TAUGHT_STATUSES = new Set(["completed", "absent"]);
const SKIP_SCHEDULE_STATUSES = new Set(["cancelled", "canceled", "deleted"]);

export interface ClassScheduleRow {
  id: string;
  class_id: string | null;
  teacher_id: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
}

export interface LiveSprintSessionRow {
  id: string;
  class_id: string | null;
  teacher_id: string | null;
  status: string | null;
  session_number: number | null;
  session_type: string | null;
}

export interface ClassDurationRow {
  id: string;
  teacher_id: string | null;
  duration_minutes: number | null;
}

export interface TeacherWorkloadSource {
  schedules: ClassScheduleRow[];
  sessions: LiveSprintSessionRow[];
  classes: ClassDurationRow[];
}

export interface TeachingSessionUnit {
  key: string;
  teacherId: string;
  date: string | null;
  durationHours: number;
  booked: boolean;
  taught: boolean;
}

export interface TeacherWorkHourStats {
  teacherId: string;
  taughtSessions: number;
  teachingHours: number;
  bookedSessions: number;
}

export interface DateRangeYmd {
  start: string;
  end: string;
}

function isLiveTeacherSession(session: LiveSprintSessionRow): boolean {
  if (session.session_number === 1) return false;
  if (session.session_type === "self_study") return false;
  return true;
}

function sessionIndicatesTaught(status: string | null): boolean {
  return !!status && TAUGHT_STATUSES.has(status);
}

function parseClockToHours(time: string): number | null {
  const parts = time.split(":");
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = parts.length > 2 ? Number(parts[2]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return hours + minutes / 60 + seconds / 3600;
}

/** Duration in hours from start_time → end_time. Keeps half hours (1.5), does not round 1.5 to 2. */
export function durationHoursFromTimes(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0;
  const start = parseClockToHours(startTime);
  const end = parseClockToHours(endTime);
  if (start === null || end === null) return 0;
  let hours = end - start;
  if (hours < 0) hours += 24;
  return Math.round(hours * 10) / 10;
}

export function formatTeachingHours(hours: number, unit: string): string {
  const rounded = Math.round(hours * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${display} ${unit}`;
}

export function honorDateRangeYmd(
  period: "monthly" | "quarterly" | "yearly",
  year: number,
  month: number,
  quarter: number
): DateRangeYmd {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (period === "monthly") {
    const lastDay = new Date(year, month, 0).getDate();
    return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
  }
  if (period === "quarterly") {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(year, endMonth, 0).getDate();
    return { start: `${year}-${pad(startMonth)}-01`, end: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function isDateInRangeYmd(date: string | null, range: DateRangeYmd): boolean {
  if (!date) return false;
  return date >= range.start && date <= range.end;
}

async function fetchPaginated<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  apply?: (query: any) => any
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function fetchTeacherWorkloadSource(supabase: SupabaseClient): Promise<TeacherWorkloadSource> {
  const [schedules, sessions, classes] = await Promise.all([
    fetchPaginated<ClassScheduleRow>(
      supabase,
      "class_schedules",
      "id, class_id, teacher_id, date, start_time, end_time, status"
    ),
    fetchPaginated<LiveSprintSessionRow>(
      supabase,
      "sprint_sessions",
      "id, class_id, teacher_id, status, session_number, session_type",
      (q) => q.neq("session_number", 1)
    ),
    fetchPaginated<ClassDurationRow>(supabase, "classes", "id, teacher_id, duration_minutes"),
  ]);

  return { schedules, sessions, classes };
}

/**
 * One unique class_schedules.id (or booked class / legacy session) = one teaching session.
 * Learner/feedback/attendance rows are never counted separately.
 */
export function buildTeachingSessionUnits(source: TeacherWorkloadSource): TeachingSessionUnit[] {
  const liveSessions = source.sessions.filter(isLiveTeacherSession);
  const classDuration = new Map<string, number>();
  const classTeacher = new Map<string, string>();
  source.classes.forEach((cls) => {
    if (cls.duration_minutes && cls.duration_minutes > 0) {
      classDuration.set(cls.id, Math.round((cls.duration_minutes / 60) * 10) / 10);
    }
    if (cls.teacher_id) classTeacher.set(cls.id, cls.teacher_id);
  });

  const sessionsByClass = new Map<string, LiveSprintSessionRow[]>();
  const sessionsWithoutClass: LiveSprintSessionRow[] = [];
  liveSessions.forEach((session) => {
    if (session.class_id) {
      const list = sessionsByClass.get(session.class_id) || [];
      list.push(session);
      sessionsByClass.set(session.class_id, list);
    } else {
      sessionsWithoutClass.push(session);
    }
  });

  const units: TeachingSessionUnit[] = [];
  const coveredClassIds = new Set<string>();

  source.schedules.forEach((schedule) => {
    if (!schedule.id || SKIP_SCHEDULE_STATUSES.has(schedule.status || "")) return;
    const classSessions = schedule.class_id ? sessionsByClass.get(schedule.class_id) || [] : [];
    const teacherId =
      schedule.teacher_id ||
      classSessions.find((s) => s.teacher_id)?.teacher_id ||
      (schedule.class_id ? classTeacher.get(schedule.class_id) : undefined);
    if (!teacherId) return;

    if (schedule.class_id) coveredClassIds.add(schedule.class_id);

    const taught =
      schedule.status === "completed" || classSessions.some((s) => sessionIndicatesTaught(s.status));
    const fromTimes = durationHoursFromTimes(schedule.start_time, schedule.end_time);
    const fallbackHours = schedule.class_id ? classDuration.get(schedule.class_id) || 0 : 0;

    units.push({
      key: `schedule:${schedule.id}`,
      teacherId,
      date: schedule.date,
      durationHours: fromTimes > 0 ? fromTimes : fallbackHours,
      booked: true,
      taught,
    });
  });

  sessionsByClass.forEach((classSessions, classId) => {
    if (coveredClassIds.has(classId)) return;
    const teacherId =
      classSessions.find((s) => s.teacher_id)?.teacher_id || classTeacher.get(classId);
    if (!teacherId) return;
    units.push({
      key: `class:${classId}`,
      teacherId,
      date: null,
      durationHours: classDuration.get(classId) || 0,
      booked: true,
      taught: classSessions.some((s) => sessionIndicatesTaught(s.status)),
    });
  });

  sessionsWithoutClass.forEach((session) => {
    if (!session.teacher_id) return;
    units.push({
      key: `session:${session.id}`,
      teacherId: session.teacher_id,
      date: null,
      durationHours: 0,
      booked: true,
      taught: sessionIndicatesTaught(session.status),
    });
  });

  return units;
}

export function summarizeTeacherHours(units: TeachingSessionUnit[]): Map<string, TeacherWorkHourStats> {
  const stats = new Map<string, TeacherWorkHourStats>();
  units.forEach((unit) => {
    const entry = stats.get(unit.teacherId) || {
      teacherId: unit.teacherId,
      taughtSessions: 0,
      teachingHours: 0,
      bookedSessions: 0,
    };
    if (unit.booked) entry.bookedSessions += 1;
    if (unit.taught) {
      entry.taughtSessions += 1;
      entry.teachingHours = Math.round((entry.teachingHours + unit.durationHours) * 10) / 10;
    }
    stats.set(unit.teacherId, entry);
  });
  return stats;
}

export function taughtUnitsInHonorPeriod(
  units: TeachingSessionUnit[],
  range: DateRangeYmd
): TeachingSessionUnit[] {
  return units.filter((unit) => unit.taught && isDateInRangeYmd(unit.date, range));
}

/** HH:MM from HH:MM or HH:MM:SS — used to match availability ↔ class_schedules. */
export function normalizeClockTime(time: string | null): string {
  if (!time) return "00:00";
  return time.length > 5 ? time.slice(0, 5) : time;
}

export function bookedAvailabilitySlotKey(teacherId: string, date: string, startTime: string): string {
  return `${teacherId}|${date}|${normalizeClockTime(startTime)}`;
}

/** Keys for availability slots already consumed by a non-cancelled class schedule. */
export function buildBookedAvailabilityKeys(
  schedules: Pick<ClassScheduleRow, "teacher_id" | "date" | "start_time" | "status">[]
): Set<string> {
  const keys = new Set<string>();
  schedules.forEach((schedule) => {
    if (!schedule.teacher_id || !schedule.date || !schedule.start_time) return;
    if (SKIP_SCHEDULE_STATUSES.has(schedule.status || "")) return;
    keys.add(bookedAvailabilitySlotKey(schedule.teacher_id, schedule.date, schedule.start_time));
  });
  return keys;
}

export function isAvailabilitySlotBooked(
  slot: { date: string | null; start_time: string },
  teacherId: string,
  bookedKeys: Set<string>
): boolean {
  if (!slot.date) return false;
  return bookedKeys.has(bookedAvailabilitySlotKey(teacherId, slot.date, slot.start_time));
}

export function filterUnbookedAvailabilitySlots<T extends { date: string | null; start_time: string }>(
  slots: T[],
  teacherId: string,
  bookedKeys: Set<string>
): T[] {
  return slots.filter((slot) => !isAvailabilitySlotBooked(slot, teacherId, bookedKeys));
}

/** Unique booked teaching schedules for one teacher inside a calendar week. */
export function bookedUnitsInDateRange(
  units: TeachingSessionUnit[],
  teacherId: string,
  range: DateRangeYmd
): TeachingSessionUnit[] {
  return units.filter(
    (unit) => unit.teacherId === teacherId && unit.booked && isDateInRangeYmd(unit.date, range)
  );
}

export function summarizeWeeklyBookedTeaching(
  units: TeachingSessionUnit[],
  teacherId: string,
  range: DateRangeYmd
): { classCount: number; totalHours: number } {
  const weekUnits = bookedUnitsInDateRange(units, teacherId, range);
  const totalHours = weekUnits.reduce((sum, unit) => sum + unit.durationHours, 0);
  return {
    classCount: weekUnits.length,
    totalHours: Math.round(totalHours * 10) / 10,
  };
}

export interface TeacherAvailabilityRow {
  teacher_id: string;
  date: string | null;
  day_of_week?: number | null;
  start_time: string | null;
  end_time: string | null;
  is_active?: boolean | null;
}

export interface TeacherUnavailableDateRow {
  teacher_id: string;
  date: string;
}

export interface TeacherWeeklyClassStats {
  classesThisWeek: number;
  completedClassesThisWeek: number;
}

/** Sum registered availability hours for one teacher in a calendar week (recurring patterns). */
export function summarizeWeeklyAvailabilityHours(
  patterns: TeacherAvailabilityRow[],
  teacherId: string,
  range: DateRangeYmd,
  unavailableDates: TeacherUnavailableDateRow[] = []
): number {
  return (
    summarizeWeeklyAvailabilityHoursByTeacher(patterns, [teacherId], range, unavailableDates).get(
      teacherId
    ) || 0
  );
}

/** Taught teaching units for one teacher inside a calendar week. */
export function taughtUnitsInDateRange(
  units: TeachingSessionUnit[],
  teacherId: string,
  range: DateRangeYmd
): TeachingSessionUnit[] {
  return units.filter(
    (unit) => unit.teacherId === teacherId && unit.taught && isDateInRangeYmd(unit.date, range)
  );
}

export function summarizeWeeklyTaughtClasses(
  units: TeachingSessionUnit[],
  teacherId: string,
  range: DateRangeYmd
): number {
  return taughtUnitsInDateRange(units, teacherId, range).length;
}

/** Batch weekly class stats for many teachers in one pass. */
export function summarizeWeeklyClassStatsByTeacher(
  units: TeachingSessionUnit[],
  teacherIds: string[],
  range: DateRangeYmd
): Map<string, TeacherWeeklyClassStats> {
  const stats = new Map<string, TeacherWeeklyClassStats>();
  teacherIds.forEach((id) => {
    stats.set(id, { classesThisWeek: 0, completedClassesThisWeek: 0 });
  });
  units.forEach((unit) => {
    if (!unit.booked || !isDateInRangeYmd(unit.date, range)) return;
    const entry = stats.get(unit.teacherId);
    if (!entry) return;
    entry.classesThisWeek += 1;
    if (unit.taught) entry.completedClassesThisWeek += 1;
  });
  return stats;
}

function patternDayOfWeek(pattern: TeacherAvailabilityRow): number | null {
  if (pattern.day_of_week !== null && pattern.day_of_week !== undefined) {
    return pattern.day_of_week;
  }
  if (pattern.date) return calendarDateToLocalDate(pattern.date).getDay();
  return null;
}

function weekDayDates(range: DateRangeYmd): { date: string; dayOfWeek: number }[] {
  const start = calendarDateToLocalDate(range.start);
  const days: { date: string; dayOfWeek: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({ date: toLocalDateStr(d), dayOfWeek: d.getDay() });
  }
  return days;
}

export function weeklyAvailabilityOccurrenceKey(
  teacherId: string,
  date: string,
  startTime: string | null,
  endTime: string | null
): string {
  return `${teacherId}|${date}|${normalizeClockTime(startTime)}|${normalizeClockTime(endTime)}`;
}

export function buildUnavailableDateSet(rows: TeacherUnavailableDateRow[]): Set<string> {
  const set = new Set<string>();
  rows.forEach((row) => {
    if (row.teacher_id && row.date) set.add(`${row.teacher_id}|${row.date}`);
  });
  return set;
}

/**
 * Expand active recurring availability patterns onto concrete current-week occurrences.
 * Anchor `date` is ignored; `day_of_week` drives which weekday in the range gets a slot.
 */
export function expandWeeklyAvailabilityOccurrences(
  patterns: TeacherAvailabilityRow[],
  range: DateRangeYmd,
  unavailableDates: TeacherUnavailableDateRow[] = []
): Map<string, number> {
  const unavailable = buildUnavailableDateSet(unavailableDates);
  const weekDays = weekDayDates(range);
  const dowToDate = new Map<number, string>();
  weekDays.forEach((day) => dowToDate.set(day.dayOfWeek, day.date));

  const seenKeys = new Set<string>();
  const hoursByTeacher = new Map<string, number>();

  patterns.forEach((pattern) => {
    if (!pattern.teacher_id || pattern.is_active === false) return;
    if (!pattern.start_time || !pattern.end_time) return;

    const dow = patternDayOfWeek(pattern);
    if (dow === null) return;

    const occurrenceDate = dowToDate.get(dow);
    if (!occurrenceDate) return;
    if (unavailable.has(`${pattern.teacher_id}|${occurrenceDate}`)) return;

    const key = weeklyAvailabilityOccurrenceKey(
      pattern.teacher_id,
      occurrenceDate,
      pattern.start_time,
      pattern.end_time
    );
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    const slotHours = durationHoursFromTimes(pattern.start_time, pattern.end_time);
    const prev = hoursByTeacher.get(pattern.teacher_id) || 0;
    hoursByTeacher.set(
      pattern.teacher_id,
      Math.round((prev + slotHours) * 10) / 10
    );
  });

  return hoursByTeacher;
}

/** Batch weekly availability hours for many teachers in one pass (recurring patterns). */
export function summarizeWeeklyAvailabilityHoursByTeacher(
  patterns: TeacherAvailabilityRow[],
  teacherIds: string[],
  range: DateRangeYmd,
  unavailableDates: TeacherUnavailableDateRow[] = []
): Map<string, number> {
  const expanded = expandWeeklyAvailabilityOccurrences(patterns, range, unavailableDates);
  const hours = new Map<string, number>();
  teacherIds.forEach((id) => hours.set(id, expanded.get(id) || 0));
  return hours;
}

export function formatDecimalHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Current-week schedules + linked sessions/classes only (fixed small query count). */
export async function fetchTeacherWeeklyWorkloadSource(
  supabase: SupabaseClient,
  range: DateRangeYmd
): Promise<TeacherWorkloadSource> {
  const schedules = await fetchPaginated<ClassScheduleRow>(
    supabase,
    "class_schedules",
    "id, class_id, teacher_id, date, start_time, end_time, status",
    (q) => q.gte("date", range.start).lte("date", range.end)
  );

  const classIds = [...new Set(schedules.map((s) => s.class_id).filter(Boolean))] as string[];

  const [sessions, classes] = await Promise.all([
    classIds.length > 0
      ? fetchPaginated<LiveSprintSessionRow>(
          supabase,
          "sprint_sessions",
          "id, class_id, teacher_id, status, session_number, session_type",
          (q) => q.in("class_id", classIds).neq("session_number", 1)
        )
      : Promise.resolve([]),
    classIds.length > 0
      ? fetchPaginated<ClassDurationRow>(
          supabase,
          "classes",
          "id, teacher_id, duration_minutes",
          (q) => q.in("id", classIds)
        )
      : Promise.resolve([]),
  ]);

  return { schedules, sessions, classes };
}

export async function fetchTeacherAvailabilityPatterns(
  supabase: SupabaseClient,
  teacherIds: string[]
): Promise<TeacherAvailabilityRow[]> {
  if (teacherIds.length === 0) return [];
  return fetchPaginated<TeacherAvailabilityRow>(
    supabase,
    "teacher_availability",
    "teacher_id, date, day_of_week, start_time, end_time, is_active",
    (q) => q.eq("is_active", true).in("teacher_id", teacherIds)
  );
}

export async function fetchTeacherUnavailableDatesForWeek(
  supabase: SupabaseClient,
  teacherIds: string[],
  range: DateRangeYmd
): Promise<TeacherUnavailableDateRow[]> {
  if (teacherIds.length === 0) return [];
  return fetchPaginated<TeacherUnavailableDateRow>(
    supabase,
    "teacher_unavailable_dates",
    "teacher_id, date",
    (q) => q.in("teacher_id", teacherIds).gte("date", range.start).lte("date", range.end)
  );
}
