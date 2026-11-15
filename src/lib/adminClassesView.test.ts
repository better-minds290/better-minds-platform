import {
  ADMIN_CLASS_IN_CHUNK,
  adminClassRelatedReadFailed,
  chunkClassIds,
  classHasScheduleInWeek,
  decideClassesPrimaryRead,
  fetchChunkedClassRows,
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

const classIds = Array.from({ length: 668 }, (_, i) => `class-${i}`);
const idChunks = chunkClassIds(classIds);
assertEqual(idChunks.map((chunk) => chunk.length), [150, 150, 150, 150, 68], "668 ids split at 150");
assertEqual(ADMIN_CLASS_IN_CHUNK, 150, "chunk size stays 150");
assertEqual(
  idChunks.every((chunk) => chunk.length <= 150),
  true,
  "no chunk exceeds 150 ids"
);
assertEqual(idChunks.flat().join(","), classIds.join(","), "chunks cover every class id once");

const pageCalls: { firstId: string; from: number; to: number; size: number }[] = [];
const combined = await fetchChunkedClassRows(
  classIds,
  async (chunk, from, to) => {
    pageCalls.push({ firstId: chunk[0], from, to, size: chunk.length });
    if (chunk[0] === "class-0" && from === 0) {
      return { data: [{ class_id: "class-0", n: 0 }, { class_id: "class-0", n: 1 }], error: null };
    }
    if (chunk[0] === "class-0" && from === 2) {
      return { data: [{ class_id: "class-1", n: 2 }], error: null };
    }
    return { data: [{ class_id: chunk[0], n: from }], error: null };
  },
  150,
  2
);
assertEqual(
  pageCalls.map((call) => [call.firstId, call.from, call.to, call.size]),
  [
    ["class-0", 0, 1, 150],
    ["class-0", 2, 3, 150],
    ["class-150", 0, 1, 150],
    ["class-300", 0, 1, 150],
    ["class-450", 0, 1, 150],
    ["class-600", 0, 1, 68],
  ],
  "full page requests the next range; later chunks start at 0"
);
assertEqual(
  combined.map((row) => row.n),
  [0, 1, 2, 0, 0, 0, 0],
  "chunk pages are combined in order"
);

let failedResolved = false;
try {
  await fetchChunkedClassRows(classIds, async (chunk) => {
    if (chunk[0] === "class-150") return { data: [], error: { message: "Bad Request" } };
    return { data: [{ class_id: chunk[0] }], error: null };
  });
  failedResolved = true;
} catch (err) {
  assertEqual((err as { message?: string }).message, "Bad Request", "failed chunk throws");
}
assertEqual(failedResolved, false, "failed chunk is not returned as an empty list");

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
  "weekly statistics unchanged after chunked reads"
);

console.log("adminClassesView tests passed");
