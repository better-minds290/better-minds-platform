export type AdminClassesPrimaryDecision = "error" | "empty" | "continue";

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
