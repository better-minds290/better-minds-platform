import { isLearnerBookingWindowOpen } from "./datetime";
import {
  isSchedulerDayAllowed,
  isSlotAllowedForSession,
  isTeachingClassDate,
  weekdayFromSlotDate,
} from "./scheduling";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

// Weekdays for the sample week of 2026-08-30 (Sunday) … 2026-09-06 (Sunday)
const SUN_AUG_30 = "2026-08-30";
const MON_AUG_31 = "2026-08-31";
const TUE_SEP_01 = "2026-09-01";
const WED_SEP_02 = "2026-09-02";
const THU_SEP_03 = "2026-09-03";
const FRI_SEP_04 = "2026-09-04";
const SAT_SEP_05 = "2026-09-05";
const SUN_SEP_06 = "2026-09-06";

assertEqual(weekdayFromSlotDate(SUN_AUG_30), 0, "Aug 30 2026 is Sunday");
assertEqual(weekdayFromSlotDate(MON_AUG_31), 1, "Aug 31 2026 is Monday");
assertEqual(weekdayFromSlotDate(WED_SEP_02), 3, "Sep 2 2026 is Wednesday");
assertEqual(weekdayFromSlotDate(THU_SEP_03), 4, "Sep 3 2026 is Thursday");
assertEqual(weekdayFromSlotDate(SAT_SEP_05), 6, "Sep 5 2026 is Saturday");

// Session 2: Monday–Wednesday allowed
assert(isSlotAllowedForSession(2, MON_AUG_31) === true, "Session 2 Monday allowed");
assert(isSlotAllowedForSession(2, TUE_SEP_01) === true, "Session 2 Tuesday allowed");
assert(isSlotAllowedForSession(2, WED_SEP_02) === true, "Session 2 Wednesday allowed");
assert(isSlotAllowedForSession(2, THU_SEP_03) === false, "Session 2 Thursday blocked");
assert(isSlotAllowedForSession(2, FRI_SEP_04) === false, "Session 2 Friday blocked");
assert(isSlotAllowedForSession(2, SAT_SEP_05) === false, "Session 2 Saturday blocked");
assert(isSlotAllowedForSession(2, SUN_AUG_30) === false, "Session 2 Sunday blocked");
assert(isSlotAllowedForSession(2, SUN_SEP_06) === false, "Session 2 next Sunday blocked");

// Session 3: Thursday–Saturday allowed
assert(isSlotAllowedForSession(3, WED_SEP_02) === false, "Session 3 Wednesday blocked");
assert(isSlotAllowedForSession(3, THU_SEP_03) === true, "Session 3 Thursday allowed");
assert(isSlotAllowedForSession(3, FRI_SEP_04) === true, "Session 3 Friday allowed");
assert(isSlotAllowedForSession(3, SAT_SEP_05) === true, "Session 3 Saturday allowed");
assert(isSlotAllowedForSession(3, SUN_AUG_30) === false, "Session 3 Sunday blocked");
assert(isSlotAllowedForSession(3, SUN_SEP_06) === false, "Session 3 next Sunday blocked");
assert(isSlotAllowedForSession(3, MON_AUG_31) === false, "Session 3 Monday blocked");

// Global no-Sunday-class (admin, learner, auto, any session number)
assert(isTeachingClassDate(SUN_AUG_30) === false, "Admin cannot create Sunday class (Aug 30)");
assert(isTeachingClassDate(SUN_SEP_06) === false, "Admin cannot create Sunday class (Sep 6)");
assert(isTeachingClassDate(MON_AUG_31) === true, "Monday is a teaching day");
assert(isTeachingClassDate(SAT_SEP_05) === true, "Saturday is a teaching day");
assert(isSlotAllowedForSession(1, SUN_AUG_30) === false, "Session 1 also cannot occur on Sunday");
assert(isSlotAllowedForSession(1, WED_SEP_02) === true, "Session 1 may use any Mon–Sat teaching day");

// Auto-schedulers skip Sunday and honor S2/S3 split
assert(isSchedulerDayAllowed(2, 0) === false, "Auto S2 skips Sunday");
assert(isSchedulerDayAllowed(3, 0) === false, "Auto S3 skips Sunday");
assert(isSchedulerDayAllowed(2, 1) === true, "Auto S2 Monday");
assert(isSchedulerDayAllowed(2, 3) === true, "Auto S2 Wednesday");
assert(isSchedulerDayAllowed(2, 4) === false, "Auto S2 skips Thursday");
assert(isSchedulerDayAllowed(3, 3) === false, "Auto S3 skips Wednesday");
assert(isSchedulerDayAllowed(3, 4) === true, "Auto S3 Thursday");
assert(isSchedulerDayAllowed(3, 6) === true, "Auto S3 Saturday");

// Sunday-only learner booking window (Vietnam)
assert(
  isLearnerBookingWindowOpen(new Date("2026-08-30T12:00:00+07:00")) === true,
  "Booking window open on Vietnam Sunday"
);
assert(
  isLearnerBookingWindowOpen(new Date("2026-08-29T12:00:00+07:00")) === false,
  "Booking window closed on Vietnam Saturday"
);
assert(
  isLearnerBookingWindowOpen(new Date("2026-08-31T12:00:00+07:00")) === false,
  "Booking window closed on Vietnam Monday"
);
assert(
  isLearnerBookingWindowOpen(new Date("2026-08-29T23:30:00+07:00")) === false,
  "Saturday 23:30 VN is not Sunday"
);
assert(
  isLearnerBookingWindowOpen(new Date("2026-08-30T00:30:00+07:00")) === true,
  "Sunday 00:30 VN is the booking window"
);

console.log("scheduling.test.ts: all assertions passed");
