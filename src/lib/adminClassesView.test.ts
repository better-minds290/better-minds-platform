import {
  adminClassRelatedReadFailed,
  classHasScheduleInWeek,
  decideClassesPrimaryRead,
  isLatestAdminClassesRequest,
  summarizeAdminClassesWeek,
} from "./adminClassesView.ts";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const weekStart = "2026-11-09";
const weekEnd = "2026-11-15";

assertEqual(decideClassesPrimaryRead({ message: "JWT expired" }, 4), "error", "classes error is not an empty week");
assertEqual(decideClassesPrimaryRead({ message: "timeout" }, null), "error", "classes error with null rows");
assertEqual(decideClassesPrimaryRead(null, 0), "empty", "genuine empty classes list");
assertEqual(decideClassesPrimaryRead(null, null), "empty", "missing classes payload without error");
assertEqual(decideClassesPrimaryRead(undefined, 2), "continue", "classes rows continue the load");

assertEqual(adminClassRelatedReadFailed([null, null]), false, "schedules and sessions ok");
assertEqual(
  adminClassRelatedReadFailed([{ message: "URI too long" }, null]),
  true,
  "schedules error must not become zero current-week classes"
);
assertEqual(
  adminClassRelatedReadFailed([null, { message: "timeout" }]),
  true,
  "sessions error must not be applied as completed-session stats"
);

assertEqual(isLatestAdminClassesRequest(1, 2), false, "stale classes request is ignored");
assertEqual(isLatestAdminClassesRequest(2, 2), true, "latest classes request is applied");

assertEqual(classHasScheduleInWeek(["2026-11-08"], weekStart, weekEnd), false, "schedule before week excluded");
assertEqual(classHasScheduleInWeek(["2026-11-09", "2026-12-01"], weekStart, weekEnd), true, "week start included");
assertEqual(classHasScheduleInWeek(["2026-11-15"], weekStart, weekEnd), true, "week end included");
assertEqual(classHasScheduleInWeek(["2026-11-16"], weekStart, weekEnd), false, "schedule after week excluded");
assertEqual(classHasScheduleInWeek([], weekStart, weekEnd), false, "no schedules is not this week");

assertEqual(
  summarizeAdminClassesWeek([
    {
      is_current_week: true,
      student_count: 3,
      session_stats: { total: 2, completed: 1 },
    },
    {
      is_current_week: true,
      student_count: 1,
      session_stats: { total: 2, completed: 2 },
    },
    {
      is_current_week: true,
      student_count: 4,
      session_stats: { total: 0, completed: 0 },
    },
    {
      is_current_week: false,
      student_count: 9,
      session_stats: { total: 1, completed: 0 },
    },
  ]),
  { active: 2, thisWeek: 3, students: 8 },
  "week stats: completed excluded from active, outside week excluded, unfinished still active"
);

console.log("adminClassesView tests passed");
