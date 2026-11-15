import {
  ADMIN_CLASS_IN_CHUNK,
  DEFAULT_ADMIN_WEEK_OFFSET,
  adminClassRelatedReadFailed,
  adminWeekRangeYmd,
  chunkClassIds,
  classHasScheduleInWeek,
  classIdsInSelectedWeek,
  decideClassesPrimaryRead,
  fetchAllPages,
  fetchChunkedClassRows,
  filterAdminClassesBySearch,
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

assertEqual(DEFAULT_ADMIN_WEEK_OFFSET, 0, "this week is selected by default");

const sundayEveningVn = new Date("2026-11-15T16:30:00.000Z");
const mondayMorningVn = new Date("2026-11-15T17:30:00.000Z");
assertEqual(adminWeekRangeYmd(0, sundayEveningVn), { start: "2026-11-09", end: "2026-11-15" }, "Sunday evening VN is still this Monday–Sunday");
assertEqual(adminWeekRangeYmd(1, sundayEveningVn), { start: "2026-11-16", end: "2026-11-22" }, "next week is the following Monday–Sunday");
assertEqual(adminWeekRangeYmd(0, mondayMorningVn), { start: "2026-11-16", end: "2026-11-22" }, "Monday 00:30 VN starts the new week");
assertEqual(adminWeekRangeYmd(1, mondayMorningVn), { start: "2026-11-23", end: "2026-11-29" }, "next week follows the new Monday");

const historical = Array.from({ length: 10000 }, (_, i) => ({ class_id: `old-${i}`, date: "2020-01-06" }));
const mixedSchedules = [
  ...historical,
  { class_id: "both", date: "2026-11-10" },
  { class_id: "both", date: "2026-11-18" },
  { class_id: "this-only", date: "2026-11-12" },
  { class_id: "next-only", date: "2026-11-20" },
  { class_id: null, date: "2026-11-11" },
];
assertEqual(
  classIdsInSelectedWeek(mixedSchedules, "2026-11-09", "2026-11-15"),
  ["both", "this-only"],
  "10k historical rows are not selected for this week"
);
assertEqual(
  classIdsInSelectedWeek(mixedSchedules, "2026-11-16", "2026-11-22"),
  ["both", "next-only"],
  "a class with dates in both weeks is kept for each selected week"
);
assertEqual(classIdsInSelectedWeek([], "2026-11-09", "2026-11-15"), [], "empty week has no class ids");
assertEqual(decideClassesPrimaryRead(null, 0), "empty", "empty week is an empty state, not an error");

const thisWeekCards = [
  {
    id: "both",
    name: "Both weeks",
    course_name: "Starter",
    teacher_name: "Ngoc Tran",
    subject: "Speaking",
    is_current_week: true,
    student_count: 3,
    session_stats: { total: 2, completed: 1 },
  },
  {
    id: "this-only",
    name: "This only",
    course_name: "Starter",
    teacher_name: "Mai",
    subject: "Grammar",
    is_current_week: true,
    student_count: 1,
    session_stats: { total: 2, completed: 2 },
  },
];
const nextWeekCards = [
  {
    id: "both",
    name: "Both weeks",
    course_name: "Starter",
    teacher_name: "Ngoc Tran",
    subject: "Speaking",
    is_current_week: true,
    student_count: 3,
    session_stats: { total: 2, completed: 1 },
  },
  {
    id: "next-only",
    name: "Next only",
    course_name: "Advanced",
    teacher_name: "Hana",
    subject: "Writing",
    is_current_week: true,
    student_count: 4,
    session_stats: { total: 0, completed: 0 },
  },
];
assertEqual(summarizeAdminClassesWeek(thisWeekCards), { active: 1, thisWeek: 2, students: 4 }, "this week counts");
assertEqual(summarizeAdminClassesWeek(nextWeekCards), { active: 2, thisWeek: 2, students: 7 }, "next week counts use the same rules");
assertEqual(
  filterAdminClassesBySearch(thisWeekCards, "ngoc").map((cls) => cls.id),
  ["both"],
  "search stays inside the selected week"
);
assertEqual(filterAdminClassesBySearch(nextWeekCards, "writing").map((cls) => cls.id), ["next-only"], "search matches the selected week only");
assertEqual(filterAdminClassesBySearch(thisWeekCards, "writing"), [], "other week's subject is not searched here");

assertEqual(isLatestAdminClassesRequest(1, 2), false, "switching weeks ignores the older request");

const paged = await fetchAllPages(async (from, to) => {
  assertEqual(to - from, 1, "schedule page size is applied");
  if (from === 0) return { data: [{ class_id: "a" }, { class_id: "b" }], error: null };
  return { data: [{ class_id: "c" }], error: null };
}, 2);
assertEqual(paged.map((row) => row.class_id), ["a", "b", "c"], "schedule pages are combined");

let pageFailed = false;
try {
  await fetchAllPages(async (from) => {
    if (from === 0) return { data: [{ class_id: "a" }, { class_id: "b" }], error: null };
    return { data: null, error: { message: "Bad Request" } };
  }, 2);
  pageFailed = true;
} catch (err) {
  assertEqual((err as { message?: string }).message, "Bad Request", "failed schedule page throws");
}
assertEqual(pageFailed, false, "failed schedule page is not an empty week");

console.log("adminClassesView tests passed");
