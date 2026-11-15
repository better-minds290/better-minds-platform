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
