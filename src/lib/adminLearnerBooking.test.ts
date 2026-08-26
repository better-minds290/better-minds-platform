import {
  hasSundayBookingWindowPassed,
  vietnamMostRecentSundayYmd,
  teachingWeekRangeAfterSunday,
  isLearnerBookingWindowOpen,
} from "./datetime";
import {
  applyAdminAssignBooking,
  buildLearnerBookingView,
  buildLearnerBookingViews,
  deriveSessionBookingBadge,
  hasLateFilterMatch,
  hasValidBooking,
  type ClassScheduleInfo,
  type EnrollmentRef,
  type LiveSessionRow,
  type SprintRow,
} from "./adminLearnerBooking";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

const SUN_AUG_30 = new Date("2026-08-30T12:00:00+07:00");
const MON_AUG_31 = new Date("2026-08-31T09:00:00+07:00");
const SAT_SEP_05 = new Date("2026-09-05T18:00:00+07:00");
const SUN_SEP_06 = new Date("2026-09-06T00:30:00+07:00");
const SAT_AUG_29_LATE = new Date("2026-08-29T23:30:00+07:00");
const SUN_AUG_30_EARLY = new Date("2026-08-30T00:30:00+07:00");

function sprint(overrides: Partial<SprintRow> = {}): SprintRow {
  return {
    id: "sp-2",
    enrollment_id: "enr-1",
    sprint_number: 2,
    status: "active",
    ...overrides,
  };
}

function session(overrides: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return {
    id: "sess-2",
    sprint_id: "sp-2",
    session_number: 2,
    session_type: "vietnamese_teacher",
    status: "available",
    teacher_id: null,
    scheduled_at: null,
    class_id: null,
    meeting_link: null,
    ...overrides,
  };
}

function schedule(overrides: Partial<ClassScheduleInfo> = {}): ClassScheduleInfo {
  return {
    class_id: "class-a",
    date: "2026-08-31",
    start_time: "09:00:00",
    end_time: "10:00:00",
    status: "scheduled",
    teacher_id: "teacher-a",
    ...overrides,
  };
}

function badge(args: {
  session?: LiveSessionRow;
  sprint?: SprintRow;
  schedule?: ClassScheduleInfo | null;
  enrollmentStatus?: string;
  now: Date;
  enrolledClassIds?: Set<string> | null;
}) {
  return deriveSessionBookingBadge({
    session: args.session ?? session(),
    sprint: args.sprint ?? sprint(),
    schedule: args.schedule,
    enrollmentStatus: args.enrollmentStatus ?? "active",
    windowPassed: hasSundayBookingWindowPassed(args.now),
    enrolledClassIds: args.enrolledClassIds,
  });
}

function schedMap(...rows: ClassScheduleInfo[]) {
  return new Map(rows.map((row) => [row.class_id, row]));
}

// --- Sunday window (Vietnam) ---
assertEqual(vietnamMostRecentSundayYmd(SUN_AUG_30), "2026-08-30", "Sunday is itself");
assertEqual(vietnamMostRecentSundayYmd(MON_AUG_31), "2026-08-30", "Monday maps to previous Sunday");
assertEqual(vietnamMostRecentSundayYmd(SAT_SEP_05), "2026-08-30", "Saturday maps to previous Sunday");
assertEqual(vietnamMostRecentSundayYmd(SUN_SEP_06), "2026-09-06", "next Sunday is not last week's Sunday");
assertEqual(
  teachingWeekRangeAfterSunday("2026-08-30"),
  { start: "2026-08-31", end: "2026-09-05" },
  "teaching week after Aug 30 Sunday is Mon–Sat"
);
assertEqual(hasSundayBookingWindowPassed(SUN_AUG_30), false, "Sunday window not passed at noon");
assertEqual(hasSundayBookingWindowPassed(SUN_AUG_30_EARLY), false, "Sunday 00:30 VN window open");
assertEqual(hasSundayBookingWindowPassed(SAT_AUG_29_LATE), true, "Saturday 23:30 VN window already passed");
assertEqual(hasSundayBookingWindowPassed(MON_AUG_31), true, "Monday window passed");
assertEqual(isLearnerBookingWindowOpen(SUN_AUG_30), true, "booking open Sunday");
assertEqual(isLearnerBookingWindowOpen(MON_AUG_31), false, "booking closed Monday");

// 1. S2 booked → 2 Booked
{
  const booked = session({ class_id: "class-a", scheduled_at: "2026-08-31T09:00:00+07:00", teacher_id: "teacher-a", status: "in_progress" });
  assertEqual(badge({ session: booked, schedule: schedule(), now: MON_AUG_31 }), "booked", "1. S2 booked");
}

// 2. S2 not booked after Sunday → 2 Late
assertEqual(badge({ now: MON_AUG_31 }), "late", "2. S2 unbooked after Sunday is Late");

// 3. S3 booked → 3 Booked
{
  const booked = session({
    id: "sess-3",
    session_number: 3,
    session_type: "foreign_teacher",
    class_id: "class-b",
    scheduled_at: "2026-09-03T14:00:00+07:00",
    status: "in_progress",
  });
  assertEqual(
    badge({ session: booked, schedule: schedule({ class_id: "class-b", date: "2026-09-03" }), now: MON_AUG_31 }),
    "booked",
    "3. S3 booked"
  );
}

// 4. S3 not booked after Sunday → 3 Late
assertEqual(
  badge({
    session: session({ id: "sess-3", session_number: 3, session_type: "foreign_teacher" }),
    now: SAT_SEP_05,
  }),
  "late",
  "4. S3 unbooked after Sunday is Late"
);

// 5–7. Late filter
{
  const bothBooked = buildLearnerBookingView({
    sprint: sprint(),
    sessions: [
      session({ class_id: "c2", status: "in_progress", scheduled_at: "2026-08-31T09:00:00+07:00" }),
      session({ id: "sess-3", session_number: 3, class_id: "c3", status: "in_progress", scheduled_at: "2026-09-03T14:00:00+07:00" }),
    ],
    enrollmentStatus: "active",
    schedulesByClassId: schedMap(schedule({ class_id: "c2" }), schedule({ class_id: "c3", date: "2026-09-03" })),
    teachersById: new Map(),
    now: MON_AUG_31,
  });
  assertEqual(bothBooked.session2, "booked", "5. S2 booked");
  assertEqual(bothBooked.session3, "booked", "5. S3 booked");
  assertEqual(hasLateFilterMatch(bothBooked), false, "5. both booked excluded from Late filter");

  const s2Late = buildLearnerBookingView({
    sprint: sprint(),
    sessions: [
      session(),
      session({ id: "sess-3", session_number: 3, class_id: "c3", status: "in_progress", scheduled_at: "2026-09-03T14:00:00+07:00" }),
    ],
    enrollmentStatus: "active",
    schedulesByClassId: schedMap(schedule({ class_id: "c3", date: "2026-09-03" })),
    teachersById: new Map(),
    now: MON_AUG_31,
  });
  assertEqual(s2Late.session2, "late", "6. S2 Late");
  assertEqual(s2Late.session3, "booked", "6. S3 Booked");
  assertEqual(hasLateFilterMatch(s2Late), true, "6. one late matches Late filter");

  const bothLate = buildLearnerBookingView({
    sprint: sprint(),
    sessions: [session(), session({ id: "sess-3", session_number: 3 })],
    enrollmentStatus: "active",
    schedulesByClassId: new Map(),
    teachersById: new Map(),
    now: MON_AUG_31,
  });
  assertEqual(bothLate.session2, "late", "7. S2 Late");
  assertEqual(bothLate.session3, "late", "7. S3 Late");
  assertEqual(hasLateFilterMatch(bothLate), true, "7. both late matches Late filter");
}

// 8–9. Admin assign late S2/S3 → Booked (derived from class_id, no Late flag)
{
  const lateS2 = session();
  assertEqual(badge({ session: lateS2, now: MON_AUG_31 }), "late", "8. before assign S2 is Late");
  const assignedS2 = applyAdminAssignBooking(lateS2, {
    class_id: "class-assigned-2",
    teacher_id: "teacher-a",
    scheduled_at: "2026-09-01T09:00:00+07:00",
  });
  assert(hasValidBooking(assignedS2, schedule({ class_id: "class-assigned-2" })), "8. assign writes class_id + schedule");
  assertEqual(
    badge({ session: assignedS2, schedule: schedule({ class_id: "class-assigned-2" }), now: MON_AUG_31 }),
    "booked",
    "8. Admin assign late S2 → Booked"
  );

  const lateS3 = session({ id: "sess-3", session_number: 3 });
  assertEqual(badge({ session: lateS3, now: MON_AUG_31 }), "late", "9. before assign S3 is Late");
  const assignedS3 = applyAdminAssignBooking(lateS3, {
    class_id: "class-assigned-3",
    teacher_id: "teacher-b",
    scheduled_at: "2026-09-03T14:00:00+07:00",
  });
  assertEqual(
    badge({ session: assignedS3, schedule: schedule({ class_id: "class-assigned-3", date: "2026-09-03" }), now: MON_AUG_31 }),
    "booked",
    "9. Admin assign late S3 → Booked"
  );
}

// 10. Before Sunday window ends → do not mark Late
assertEqual(badge({ now: SUN_AUG_30 }), "neutral", "10. Sunday noon not Late");
assertEqual(badge({ now: SUN_AUG_30_EARLY }), "neutral", "10. Sunday 00:30 VN not Late");

// 11. Pending/locked session not yet expected → neutral
assertEqual(
  badge({ session: session({ status: "locked" }), now: MON_AUG_31 }),
  "neutral",
  "11. locked session not Late"
);
assertEqual(
  badge({ sprint: sprint({ status: "pending" }), now: MON_AUG_31 }),
  "neutral",
  "11. pending sprint not Late"
);
assertEqual(
  badge({ sprint: sprint({ status: "locked" }), now: MON_AUG_31 }),
  "neutral",
  "11. locked sprint not Late"
);

// 12. Completed historical sprint → not falsely Late
assertEqual(
  badge({
    sprint: sprint({ status: "completed" }),
    session: session({ status: "completed", class_id: null, scheduled_at: null }),
    now: MON_AUG_31,
  }),
  "neutral",
  "12. completed sprint unlinked session not Late"
);
assertEqual(
  badge({
    session: session({ status: "completed", class_id: null }),
    now: MON_AUG_31,
  }),
  "neutral",
  "12. completed session without booking not Late"
);
assertEqual(
  badge({
    session: session({ status: "absent", class_id: null }),
    now: MON_AUG_31,
  }),
  "neutral",
  "12. absent session not Late"
);

// 13–14. Group class + two learners do not mix
{
  const sharedClass = "group-class";
  const enrollments: EnrollmentRef[] = [
    { id: "enr-a", learner_id: "learner-a", status: "active" },
    { id: "enr-b", learner_id: "learner-b", status: "active" },
  ];
  const sprints: SprintRow[] = [
    sprint({ id: "sp-a", enrollment_id: "enr-a" }),
    sprint({ id: "sp-b", enrollment_id: "enr-b" }),
  ];
  const sessions: LiveSessionRow[] = [
    session({
      id: "sess-a2",
      sprint_id: "sp-a",
      class_id: sharedClass,
      status: "in_progress",
      scheduled_at: "2026-08-31T09:00:00+07:00",
      teacher_id: "teacher-a",
    }),
    session({
      id: "sess-a3",
      sprint_id: "sp-a",
      session_number: 3,
      status: "available",
    }),
    session({
      id: "sess-b2",
      sprint_id: "sp-b",
      status: "available",
    }),
    session({
      id: "sess-b3",
      sprint_id: "sp-b",
      session_number: 3,
      class_id: sharedClass,
      status: "in_progress",
      scheduled_at: "2026-09-03T14:00:00+07:00",
      teacher_id: "teacher-a",
    }),
  ];
  const views = buildLearnerBookingViews({
    learnerIds: ["learner-a", "learner-b"],
    enrollments,
    sprints,
    sessions,
    schedules: [schedule({ class_id: sharedClass })],
    classEnrollments: [
      { class_id: sharedClass, student_id: "learner-a" },
      { class_id: sharedClass, student_id: "learner-b" },
    ],
    teachersById: new Map([["teacher-a", "Teacher A"]]),
    now: MON_AUG_31,
  });
  const a = views.get("learner-a")!;
  const b = views.get("learner-b")!;
  assertEqual(a.session2, "booked", "13. learner A S2 booked in group class");
  assertEqual(a.session3, "late", "13. learner A S3 still Late");
  assertEqual(b.session2, "late", "14. learner B S2 Late — not copied from A");
  assertEqual(b.session3, "booked", "13. learner B S3 booked in same group class");
  assertEqual(a.detailsByNumber[2]?.teacherName, "Teacher A", "13. group class teacher on A S2");
  assertEqual(b.detailsByNumber[3]?.teacherName, "Teacher A", "13. group class teacher on B S3");
  assert(a.detailsByNumber[2]?.sessionId !== b.detailsByNumber[2]?.sessionId, "14. session rows stay per learner");
}

// 15. Multiple courses/enrollments → active enrollment wins
{
  const views = buildLearnerBookingViews({
    learnerIds: ["learner-1"],
    enrollments: [
      { id: "enr-old", learner_id: "learner-1", status: "completed" },
      { id: "enr-new", learner_id: "learner-1", status: "active" },
    ],
    sprints: [
      sprint({ id: "sp-old", enrollment_id: "enr-old", sprint_number: 8, status: "completed" }),
      sprint({ id: "sp-new", enrollment_id: "enr-new", sprint_number: 1, status: "active" }),
    ],
    sessions: [
      session({ id: "old-2", sprint_id: "sp-old", class_id: "old-class", status: "completed" }),
      session({ id: "new-2", sprint_id: "sp-new", status: "available" }),
      session({ id: "new-3", sprint_id: "sp-new", session_number: 3, class_id: "new-class", status: "in_progress" }),
    ],
    schedules: [schedule({ class_id: "new-class", date: "2026-09-03" })],
    teachersById: new Map(),
    now: MON_AUG_31,
  });
  const view = views.get("learner-1")!;
  assertEqual(view.detailsByNumber[2]?.sessionId, "new-2", "15. current enrollment session, not completed course");
  assertEqual(view.session2, "late", "15. current S2 Late");
  assertEqual(view.session3, "booked", "15. current S3 Booked");
  assertEqual(view.liveSessionNumbers, [2, 3], "15. live numbers from current sprint");
}

// 16. Vietnam timezone Sunday boundary
assertEqual(badge({ now: SAT_AUG_29_LATE }), "late", "16. Sat 23:30 VN is still Late for prior window");
assertEqual(badge({ now: SUN_AUG_30_EARLY }), "neutral", "16. Sun 00:30 VN is not Late");
assertEqual(
  vietnamMostRecentSundayYmd(new Date("2026-08-29T17:00:00.000Z")),
  "2026-08-30",
  "16. 17:00 UTC = Sunday 00:00 VN"
);
assertEqual(
  vietnamMostRecentSundayYmd(new Date("2026-08-29T16:59:00.000Z")),
  "2026-08-23",
  "16. 16:59 UTC = Saturday 23:59 VN → previous Sunday Aug 23"
);

// Only Session 2 exists
{
  const view = buildLearnerBookingView({
    sprint: sprint(),
    sessions: [session(), session({ id: "s1", session_number: 1, session_type: "self_study" })],
    enrollmentStatus: "active",
    schedulesByClassId: new Map(),
    teachersById: new Map(),
    now: MON_AUG_31,
  });
  assertEqual(view.liveSessionNumbers, [2], "only S2 shown when S3 missing");
  assertEqual(view.session3, null, "missing S3 is null not Late");
  assertEqual(hasLateFilterMatch(view), true, "only S2 Late still matches filter");
}

// Force-completed / awaiting feedback / cancelled then rebooked
assertEqual(
  badge({
    session: session({ status: "awaiting_feedback", class_id: "c1" }),
    schedule: schedule({ class_id: "c1", status: "completed" }),
    now: MON_AUG_31,
  }),
  "booked",
  "awaiting feedback with class is Booked"
);
assertEqual(
  badge({
    session: session({ class_id: "c-cancel" }),
    schedule: schedule({ class_id: "c-cancel", status: "cancelled" }),
    now: MON_AUG_31,
  }),
  "late",
  "cancelled schedule is not Booked"
);

// Booked then cancelled (class_id cleared, status available)
assertEqual(
  badge({ session: session({ status: "available", class_id: null, scheduled_at: null }), now: MON_AUG_31 }),
  "late",
  "cancelled after Sunday → Late"
);
assertEqual(
  badge({ session: session({ status: "available", class_id: null, scheduled_at: null }), now: SUN_AUG_30 }),
  "neutral",
  "cancelled on Sunday → still able to book"
);

// Reschedule keeps booking
assertEqual(
  badge({
    session: session({
      class_id: "class-new",
      scheduled_at: "2026-09-02T10:00:00+07:00",
      status: "in_progress",
    }),
    schedule: schedule({ class_id: "class-new", date: "2026-09-02" }),
    now: MON_AUG_31,
  }),
  "booked",
  "rescheduled session stays Booked"
);

// Expired sprint still expected
assertEqual(
  badge({ sprint: sprint({ status: "expired" }), now: MON_AUG_31 }),
  "late",
  "expired active-context sprint unbooked is Late"
);

// Expired sprint + available S2/S3: Admin assign Late → Booked; sprint stays expired
{
  const expiredSprint = sprint({ status: "expired" });
  const lateS2 = session({ status: "available" });
  assertEqual(badge({ session: lateS2, sprint: expiredSprint, now: MON_AUG_31 }), "late", "expired S2 Late before assign");
  const assignedS2 = applyAdminAssignBooking(lateS2, {
    class_id: "class-expired-2",
    teacher_id: "teacher-a",
    scheduled_at: "2026-09-01T09:00:00+07:00",
  });
  assertEqual(
    badge({
      session: assignedS2,
      sprint: expiredSprint,
      schedule: schedule({ class_id: "class-expired-2" }),
      now: MON_AUG_31,
    }),
    "booked",
    "expired sprint assign S2 Late → Booked"
  );
  assertEqual(expiredSprint.status, "expired", "assign does not reopen expired sprint");

  const lateS3 = session({ id: "sess-3", session_number: 3, status: "available" });
  assertEqual(badge({ session: lateS3, sprint: expiredSprint, now: MON_AUG_31 }), "late", "expired S3 Late before assign");
  const assignedS3 = applyAdminAssignBooking(lateS3, {
    class_id: "class-expired-3",
    teacher_id: "teacher-b",
    scheduled_at: "2026-09-03T14:00:00+07:00",
  });
  assertEqual(
    badge({
      session: assignedS3,
      sprint: expiredSprint,
      schedule: schedule({ class_id: "class-expired-3", date: "2026-09-03" }),
      now: MON_AUG_31,
    }),
    "booked",
    "expired sprint assign S3 Late → Booked"
  );
  assertEqual(expiredSprint.status, "expired", "S3 assign still leaves sprint expired");
}

// Enrollment completed
assertEqual(
  badge({ enrollmentStatus: "completed", now: MON_AUG_31 }),
  "neutral",
  "completed enrollment not Late"
);

// Click details: S2 vs S3
{
  const view = buildLearnerBookingView({
    sprint: sprint({ sprint_number: 4 }),
    sessions: [
      session({
        id: "click-2",
        class_id: "class-2",
        teacher_id: "teacher-2",
        scheduled_at: "2026-08-31T09:00:00+07:00",
        status: "in_progress",
        meeting_link: "https://meet.example/s2",
      }),
      session({
        id: "click-3",
        session_number: 3,
        status: "available",
      }),
    ],
    enrollmentStatus: "active",
    schedulesByClassId: new Map([
      [
        "class-2",
        schedule({
          class_id: "class-2",
          teacher_id: "teacher-2",
          date: "2026-08-31",
          start_time: "09:00:00",
          end_time: "10:30:00",
          status: "scheduled",
        }),
      ],
    ]),
    teachersById: new Map([["teacher-2", "Minh Teacher"]]),
    now: MON_AUG_31,
  });
  const d2 = view.detailsByNumber[2]!;
  const d3 = view.detailsByNumber[3]!;
  assertEqual(d2.sessionId, "click-2", "click S2 returns session 2");
  assertEqual(d2.sessionNumber, 2, "click S2 number");
  assertEqual(d2.sprintNumber, 4, "click S2 sprint");
  assertEqual(d2.teacherName, "Minh Teacher", "click S2 teacher");
  assertEqual(d2.scheduledDate, "2026-08-31", "click S2 date");
  assertEqual(d2.startTime, "09:00", "click S2 start");
  assertEqual(d2.endTime, "10:30", "click S2 end");
  assertEqual(d2.durationMinutes, 90, "click S2 duration");
  assertEqual(d2.meetingLink, "https://meet.example/s2", "click S2 meeting link");
  assertEqual(d2.classStatus, "scheduled", "click S2 class status");
  assertEqual(d2.booked, true, "click S2 booked");
  assertEqual(d2.bookingBadge, "booked", "click S2 badge");
  assertEqual(d3.sessionId, "click-3", "click S3 returns session 3");
  assertEqual(d3.sessionNumber, 3, "click S3 number");
  assertEqual(d3.booked, false, "click S3 not booked");
  assertEqual(d3.bookingBadge, "late", "click S3 Late");
}

// Final sprint / selectCurrentAdminSprint: active wins over pending
{
  const views = buildLearnerBookingViews({
    learnerIds: ["learner-1"],
    enrollments: [{ id: "enr-1", learner_id: "learner-1", status: "active" }],
    sprints: [
      sprint({ id: "sp-1", sprint_number: 1, status: "completed" }),
      sprint({ id: "sp-2", sprint_number: 2, status: "active" }),
      sprint({ id: "sp-3", sprint_number: 3, status: "pending" }),
    ],
    sessions: [
      session({ id: "old", sprint_id: "sp-1", class_id: "old" }),
      session({ id: "cur", sprint_id: "sp-2" }),
      session({ id: "next", sprint_id: "sp-3" }),
    ],
    schedules: [],
    teachersById: new Map(),
    now: MON_AUG_31,
  });
  assertEqual(views.get("learner-1")!.detailsByNumber[2]?.sessionId, "cur", "active sprint, not sprints[0]");
}

// A–G. Real booking vs soft scheduled_at
{
  const suggested = session({
    scheduled_at: "2026-08-31T09:00:00+07:00",
    teacher_id: "teacher-auto",
    status: "available",
    class_id: null,
  });
  assertEqual(hasValidBooking(suggested, null), false, "D. scheduled_at alone is not a real booking");
  assertEqual(badge({ session: suggested, now: MON_AUG_31 }), "late", "D. auto-scheduler suggestion stays Late after Sunday");
  assertEqual(badge({ session: suggested, now: SUN_AUG_30 }), "neutral", "D. auto-scheduler suggestion not Late on Sunday");

  const lockedSuggested = session({
    scheduled_at: "2026-08-31T09:00:00+07:00",
    teacher_id: "teacher-confirm",
    status: "locked",
    class_id: null,
  });
  assertEqual(
    badge({ session: lockedSuggested, now: MON_AUG_31 }),
    "neutral",
    "D. confirm-sprint-teachers locked + scheduled_at is not Booked"
  );

  assertEqual(
    hasValidBooking(
      session({ class_id: "class-a", scheduled_at: "2026-08-31T09:00:00+07:00" }),
      schedule()
    ),
    true,
    "A/B/C. class_id + live schedule is Booked"
  );

  const deletedSchedule = session({ class_id: "class-gone", scheduled_at: "2026-08-31T09:00:00+07:00", status: "in_progress" });
  assertEqual(hasValidBooking(deletedSchedule, null), false, "F. class_id with deleted schedule is not Booked");
  assertEqual(badge({ session: deletedSchedule, schedule: null, now: MON_AUG_31 }), "late", "F. deleted schedule → Late after Sunday");

  const cancelledSchedule = session({ class_id: "c-cancel", status: "in_progress" });
  assertEqual(
    hasValidBooking(cancelledSchedule, schedule({ class_id: "c-cancel", status: "cancelled" })),
    false,
    "F. cancelled schedule is not Booked"
  );

  const groupViews = buildLearnerBookingViews({
    learnerIds: ["enrolled-learner", "stale-learner"],
    enrollments: [
      { id: "enr-enrolled", learner_id: "enrolled-learner", status: "active" },
      { id: "enr-stale", learner_id: "stale-learner", status: "active" },
    ],
    sprints: [
      sprint({ id: "sp-enrolled", enrollment_id: "enr-enrolled" }),
      sprint({ id: "sp-stale", enrollment_id: "enr-stale" }),
    ],
    sessions: [
      session({
        id: "sess-enrolled",
        sprint_id: "sp-enrolled",
        class_id: "group-1",
        status: "in_progress",
      }),
      session({
        id: "sess-stale",
        sprint_id: "sp-stale",
        class_id: "group-1",
        status: "in_progress",
      }),
    ],
    schedules: [schedule({ class_id: "group-1" })],
    teachersById: new Map(),
    classEnrollments: [{ class_id: "group-1", student_id: "enrolled-learner" }],
    now: MON_AUG_31,
  });
  assertEqual(groupViews.get("enrolled-learner")!.session2, "booked", "G. enrolled group-class learner is Booked");
  assertEqual(groupViews.get("stale-learner")!.session2, "late", "G. class_id without class_enrollments is not Booked");
}

console.log("adminLearnerBooking.test.ts: all assertions passed");
