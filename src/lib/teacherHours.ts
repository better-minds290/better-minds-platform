import type { SupabaseClient } from "@supabase/supabase-js";

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
