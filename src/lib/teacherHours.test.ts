import {
  buildTeachingSessionUnits,
  durationHoursFromTimes,
  formatTeachingHours,
  honorDateRangeYmd,
  summarizeTeacherHours,
  taughtUnitsInHonorPeriod,
  type TeacherWorkloadSource,
} from "./teacherHours";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function emptySource(overrides: Partial<TeacherWorkloadSource> = {}): TeacherWorkloadSource {
  return { schedules: [], sessions: [], classes: [], ...overrides };
}

// Duration formatting
assertEqual(durationHoursFromTimes("18:00:00", "19:00:00"), 1, "1 hour slot");
assertEqual(durationHoursFromTimes("18:00", "19:30"), 1.5, "1.5 hour slot");
assertEqual(durationHoursFromTimes("19:00:00", "21:00:00"), 2, "2 hour slot");
assertEqual(formatTeachingHours(2, "giờ"), "2 giờ", "whole hours");
assertEqual(formatTeachingHours(1.5, "giờ"), "1.5 giờ", "decimal hours not rounded to 2");

// 1 learner, one 2-hour class → 1 taught session, 2 hours, 1 booked
{
  const units = buildTeachingSessionUnits(
    emptySource({
      schedules: [
        {
          id: "sch-1",
          class_id: "class-1",
          teacher_id: "teacher-a",
          date: "2026-08-10",
          start_time: "18:00:00",
          end_time: "20:00:00",
          status: "completed",
        },
      ],
      sessions: [
        {
          id: "sess-1",
          class_id: "class-1",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
      ],
    })
  );
  const stats = summarizeTeacherHours(units).get("teacher-a")!;
  assertEqual(units.length, 1, "1 learner: one unique schedule");
  assertEqual(stats.bookedSessions, 1, "1 learner: Tổng Buổi");
  assertEqual(stats.taughtSessions, 1, "1 learner: Buổi đã dạy");
  assertEqual(stats.teachingHours, 2, "1 learner: Tổng giờ dạy");
}

// 2 learners, same 2-hour class → still 1 session and 2 hours (never 2/4)
{
  const units = buildTeachingSessionUnits(
    emptySource({
      schedules: [
        {
          id: "sch-2",
          class_id: "class-2",
          teacher_id: "teacher-a",
          date: "2026-08-11",
          start_time: "18:00:00",
          end_time: "20:00:00",
          status: "completed",
        },
      ],
      sessions: [
        {
          id: "sess-a",
          class_id: "class-2",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
        {
          id: "sess-b",
          class_id: "class-2",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
      ],
    })
  );
  const stats = summarizeTeacherHours(units).get("teacher-a")!;
  assertEqual(units.length, 1, "2 learners: still one unique schedule");
  assertEqual(stats.bookedSessions, 1, "2 learners: Tổng Buổi = 1");
  assertEqual(stats.taughtSessions, 1, "2 learners: Buổi đã dạy = 1");
  assertEqual(stats.teachingHours, 2, "2 learners: Tổng giờ dạy = 2, not 4");
}

// Spec example: 18:00–20:00 with 2 learners + 19:00–20:30 with 1 learner → 2 buổi, 3.5 giờ
{
  const units = buildTeachingSessionUnits(
    emptySource({
      schedules: [
        {
          id: "sch-a",
          class_id: "class-a",
          teacher_id: "teacher-a",
          date: "2026-08-12",
          start_time: "18:00:00",
          end_time: "20:00:00",
          status: "completed",
        },
        {
          id: "sch-b",
          class_id: "class-b",
          teacher_id: "teacher-a",
          date: "2026-08-12",
          start_time: "19:00:00",
          end_time: "20:30:00",
          status: "completed",
        },
      ],
      sessions: [
        {
          id: "a1",
          class_id: "class-a",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
        {
          id: "a2",
          class_id: "class-a",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
        {
          id: "b1",
          class_id: "class-b",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 3,
          session_type: "foreign_teacher",
        },
      ],
    })
  );
  const stats = summarizeTeacherHours(units).get("teacher-a")!;
  assertEqual(stats.taughtSessions, 2, "mixed: Buổi đã dạy = 2");
  assertEqual(stats.teachingHours, 3.5, "mixed: Tổng giờ dạy = 3.5");
  assertEqual(stats.bookedSessions, 2, "mixed: Tổng Buổi = 2");
}

// One present + one absent in the same class still counts as one taught session
{
  const units = buildTeachingSessionUnits(
    emptySource({
      schedules: [
        {
          id: "sch-mix",
          class_id: "class-mix",
          teacher_id: "teacher-a",
          date: "2026-08-13",
          start_time: "18:00:00",
          end_time: "19:00:00",
          status: "completed",
        },
      ],
      sessions: [
        {
          id: "mix-1",
          class_id: "class-mix",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
        {
          id: "mix-2",
          class_id: "class-mix",
          teacher_id: "teacher-a",
          status: "absent",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
      ],
    })
  );
  const stats = summarizeTeacherHours(units).get("teacher-a")!;
  assertEqual(stats.taughtSessions, 1, "present+absent: one taught session");
  assertEqual(stats.teachingHours, 1, "present+absent: duration counted once");
}

// Booked but not taught
{
  const units = buildTeachingSessionUnits(
    emptySource({
      schedules: [
        {
          id: "sch-upcoming",
          class_id: "class-up",
          teacher_id: "teacher-a",
          date: "2026-08-20",
          start_time: "18:00:00",
          end_time: "19:00:00",
          status: "scheduled",
        },
      ],
      sessions: [
        {
          id: "up-1",
          class_id: "class-up",
          teacher_id: "teacher-a",
          status: "in_progress",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
      ],
    })
  );
  const stats = summarizeTeacherHours(units).get("teacher-a")!;
  assertEqual(stats.bookedSessions, 1, "upcoming: Tổng Buổi");
  assertEqual(stats.taughtSessions, 0, "upcoming: not taught");
  assertEqual(stats.teachingHours, 0, "upcoming: no hours");
}

// Legacy: two learner rows, same class_id, no schedule → one session; duration from classes
{
  const units = buildTeachingSessionUnits(
    emptySource({
      classes: [{ id: "legacy-class", teacher_id: "teacher-a", duration_minutes: 90 }],
      sessions: [
        {
          id: "leg-1",
          class_id: "legacy-class",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
        {
          id: "leg-2",
          class_id: "legacy-class",
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 2,
          session_type: "vietnamese_teacher",
        },
      ],
    })
  );
  const stats = summarizeTeacherHours(units).get("teacher-a")!;
  assertEqual(units[0].key, "class:legacy-class", "legacy class key");
  assertEqual(stats.taughtSessions, 1, "legacy class: one taught session");
  assertEqual(stats.teachingHours, 1.5, "legacy class: duration_minutes fallback");
}

// Legacy: no class_id → one unit per sprint_sessions.id
{
  const units = buildTeachingSessionUnits(
    emptySource({
      sessions: [
        {
          id: "bare-1",
          class_id: null,
          teacher_id: "teacher-a",
          status: "completed",
          session_number: 3,
          session_type: "foreign_teacher",
        },
      ],
    })
  );
  assertEqual(units[0].key, "session:bare-1", "legacy session key");
  assertEqual(units[0].durationHours, 0, "legacy session without times: hours 0");
  assertEqual(units[0].date, null, "legacy session excluded from honor date filter");
}

// Honor period uses class_schedules.date, not feedback time
{
  const units = buildTeachingSessionUnits(
    emptySource({
      schedules: [
        {
          id: "in-month",
          class_id: "c-in",
          teacher_id: "teacher-a",
          date: "2026-08-05",
          start_time: "18:00:00",
          end_time: "19:00:00",
          status: "completed",
        },
        {
          id: "out-month",
          class_id: "c-out",
          teacher_id: "teacher-a",
          date: "2026-07-05",
          start_time: "18:00:00",
          end_time: "20:00:00",
          status: "completed",
        },
      ],
    })
  );
  const range = honorDateRangeYmd("monthly", 2026, 8, 3);
  const honor = taughtUnitsInHonorPeriod(units, range);
  const stats = summarizeTeacherHours(honor).get("teacher-a")!;
  assertEqual(honor.length, 1, "honor: only August schedule date");
  assertEqual(stats.teachingHours, 1, "honor: rank hours from period only");
}

console.log("teacherHours tests passed");
