import { addCalendarDays, getCurrentWeekRangeYmd } from "./datetime.ts";

export type AdminClassesPrimaryDecision = "error" | "empty" | "continue";

/** 0 = this Vietnam week, 1 = next Vietnam week. */
export type AdminWeekOffset = 0 | 1;

export const DEFAULT_ADMIN_WEEK_OFFSET: AdminWeekOffset = 0;

/** A failed classes read is not an empty week. */
export function decideClassesPrimaryRead(
  error: { message?: string } | null | undefined,
  rowCount: number | null | undefined
): AdminClassesPrimaryDecision {
  if (error) return "error";
  if (rowCount == null || rowCount === 0) return "empty";
  return "continue";
}

/** Schedule or session failures must not be applied as "no classes this week". */
export function adminClassRelatedReadFailed(
  errors: ReadonlyArray<{ message?: string } | null | undefined>
): boolean {
  return errors.some((error) => !!error);
}

export function isLatestAdminClassesRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

/** Matches AdminLearners `IN_CHUNK`. One `.in()` above this overflows the GET URL. */
export const ADMIN_CLASS_IN_CHUNK = 150;

/** PostgREST/Supabase default max rows per response. */
export const ADMIN_CLASS_PAGE_SIZE = 1000;

export function chunkClassIds(
  ids: readonly string[],
  chunkSize = ADMIN_CLASS_IN_CHUNK
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Load rows for many class ids without one oversized `.in()` URL.
 * Each chunk is paged so a 1000-row response cap cannot drop the rest.
 * A failed page throws; callers must not treat that as an empty result.
 */
export async function fetchChunkedClassRows<T>(
  classIds: readonly string[],
  fetchPage: (
    chunk: readonly string[],
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  chunkSize = ADMIN_CLASS_IN_CHUNK,
  pageSize = ADMIN_CLASS_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunk of chunkClassIds(classIds, chunkSize)) {
    let from = 0;
    for (;;) {
      const { data, error } = await fetchPage(chunk, from, from + pageSize - 1);
      if (error) throw error;
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }
  return rows;
}

/** Monday–Sunday YMD range. Next week is seven calendar days after this week. */
export function adminWeekRangeYmd(
  offset: AdminWeekOffset = DEFAULT_ADMIN_WEEK_OFFSET,
  now: Date = new Date()
): { start: string; end: string } {
  const current = getCurrentWeekRangeYmd(now);
  if (offset === 0) return current;
  return {
    start: addCalendarDays(current.start, 7),
    end: addCalendarDays(current.end, 7),
  };
}

/** Distinct class ids that have a schedule date inside the selected week. */
export function classIdsInSelectedWeek(
  schedules: readonly { class_id: string | null; date: string }[],
  weekStart: string,
  weekEnd: string
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of schedules) {
    if (!row.class_id || seen.has(row.class_id)) continue;
    if (!classHasScheduleInWeek([row.date], weekStart, weekEnd)) continue;
    seen.add(row.class_id);
    ids.push(row.class_id);
  }
  return ids;
}

export function filterAdminClassesBySearch<
  T extends {
    name: string;
    course_name: string | null;
    teacher_name: string | null;
    subject: string;
  },
>(classes: readonly T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return [...classes];
  return classes.filter(
    (cls) =>
      cls.name.toLowerCase().includes(query) ||
      (cls.course_name || "").toLowerCase().includes(query) ||
      (cls.teacher_name || "").toLowerCase().includes(query) ||
      cls.subject.toLowerCase().includes(query)
  );
}

/** Page a date-range read so the 1,000-row cap cannot drop later rows. */
export async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  pageSize = ADMIN_CLASS_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export function classHasScheduleInWeek(
  dates: readonly string[],
  weekStart: string,
  weekEnd: string
): boolean {
  return dates.some((date) => date >= weekStart && date <= weekEnd);
}

export function summarizeAdminClassesWeek(
  classes: readonly {
    is_current_week: boolean;
    student_count: number;
    session_stats: { total: number; completed: number };
  }[]
): { active: number; thisWeek: number; students: number } {
  let active = 0;
  let thisWeek = 0;
  let students = 0;
  for (const cls of classes) {
    if (!cls.is_current_week) continue;
    thisWeek += 1;
    students += cls.student_count;
    const fullyCompleted =
      cls.session_stats.total > 0 && cls.session_stats.completed === cls.session_stats.total;
    if (!fullyCompleted) active += 1;
  }
  return { active, thisWeek, students };
}
