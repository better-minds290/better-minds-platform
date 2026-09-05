import {
  availabilityEndMinutes,
  availabilitySlotCrossesMidnight,
  formatSameDayAvailabilityEndTime,
  midnightCrossingSlotsBlockingSave,
} from "./availabilitySlot";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

// Valid same-day slots
assert(availabilitySlotCrossesMidnight("21:00", 60) === false, "21:00 + 60 is valid");
assertEqual(formatSameDayAvailabilityEndTime("21:00", 60), "22:00", "21:00 + 60 ends 22:00");

assert(availabilitySlotCrossesMidnight("22:00", 60) === false, "22:00 + 60 is valid");
assertEqual(formatSameDayAvailabilityEndTime("22:00", 60), "23:00", "22:00 + 60 ends 23:00");

assert(availabilitySlotCrossesMidnight("23:00", 30) === false, "23:00 + 30 is valid");
assertEqual(formatSameDayAvailabilityEndTime("23:00", 30), "23:30", "23:00 + 30 ends 23:30");

// Invalid midnight-crossing slots (including ending exactly at 00:00)
assert(availabilitySlotCrossesMidnight("23:00", 60) === true, "23:00 + 60 is invalid");
assertEqual(formatSameDayAvailabilityEndTime("23:00", 60), null, "23:00 + 60 has no same-day end");
assertEqual(availabilityEndMinutes("23:00", 60), 24 * 60, "23:00 + 60 is exactly 1440 minutes");

assert(availabilitySlotCrossesMidnight("23:30", 60) === true, "23:30 + 60 is invalid");
assertEqual(formatSameDayAvailabilityEndTime("23:30", 60), null, "23:30 + 60 has no same-day end");

assert(availabilitySlotCrossesMidnight("22:30", 90) === true, "22:30 + 90 is invalid");
assertEqual(formatSameDayAvailabilityEndTime("22:30", 90), null, "22:30 + 90 has no same-day end");

// HH:MM:SS from the database uses the same minute math (no wrap)
assert(availabilitySlotCrossesMidnight("23:00:00", 60) === true, "23:00:00 + 60 is invalid");
assertEqual(formatSameDayAvailabilityEndTime("22:00:00", 60), "23:00", "22:00:00 + 60 ends 23:00");

// Save gate: invalid active teaching-day slot blocks save (caller must run this before DELETE)
const blocking = midnightCrossingSlotsBlockingSave([
  { date: "2026-09-07", start_time: "22:00", duration_minutes: 60, is_active: true },
  { date: "2026-09-08", start_time: "23:00", duration_minutes: 60, is_active: true },
]);
assert(blocking.length === 1, "save gate finds the one midnight-crossing slot");
assertEqual(blocking[0].date, "2026-09-08", "save gate reports the crossing slot date");
assert(
  midnightCrossingSlotsBlockingSave([
    { date: "2026-09-07", start_time: "22:00", duration_minutes: 60, is_active: true },
    { date: "2026-09-08", start_time: "23:00", duration_minutes: 30, is_active: true },
  ]).length === 0,
  "valid slots do not block save"
);

// Mirror handleSave: abort before any delete when a crossing slot is present.
function simulatedSave(slots: Parameters<typeof midnightCrossingSlotsBlockingSave>[0]): "aborted" | "deleted" {
  if (midnightCrossingSlotsBlockingSave(slots).length > 0) return "aborted";
  return "deleted";
}
assertEqual(
  simulatedSave([{ date: "2026-09-07", start_time: "23:00", duration_minutes: 60, is_active: true }]),
  "aborted",
  "invalid save aborts before delete"
);
assertEqual(
  simulatedSave([{ date: "2026-09-07", start_time: "22:00", duration_minutes: 60, is_active: true }]),
  "deleted",
  "valid save may proceed to delete"
);

console.log("availabilitySlot.test.ts: all assertions passed");
