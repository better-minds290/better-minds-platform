import {
  enrollmentIdsAfterFailedSessionUpdate,
  rollbackNewEnrollment,
} from "./bookingEnrollmentRollback";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

{
  const deleted: string[] = [];
  const rollback = await rollbackNewEnrollment(async (enrollmentId) => {
    deleted.push(enrollmentId);
    return { error: null };
  }, "enr-new");
  assertEqual(deleted, ["enr-new"], "book: failed session update deletes only the new enrollment");
  assertEqual(rollback.failed, false, "book: rollback succeeds");
  assertEqual(
    enrollmentIdsAfterFailedSessionUpdate({
      existingEnrollmentIds: ["enr-existing"],
      insertedEnrollmentId: "enr-new",
      rollback,
    }),
    ["enr-existing"],
    "book: existing enrollment stays and the new row is gone"
  );
}

{
  const deleted: string[] = [];
  const rollback = await rollbackNewEnrollment(async (enrollmentId) => {
    deleted.push(enrollmentId);
    return { error: null };
  }, null);
  assertEqual(deleted, [], "assign: reused enrollment is not deleted");
  assertEqual(rollback.attempted, false, "assign: no rollback when this request did not insert");
  assertEqual(
    enrollmentIdsAfterFailedSessionUpdate({
      existingEnrollmentIds: ["enr-existing"],
      insertedEnrollmentId: null,
      rollback,
    }),
    ["enr-existing"],
    "assign: reused class enrollment is unchanged"
  );
}

{
  const rollback = await rollbackNewEnrollment(async () => ({ error: { message: "delete denied" } }), "enr-new");
  assertEqual(rollback.attempted, true, "rollback failure is attempted");
  assertEqual(rollback.failed, true, "rollback failure is reported");
  assertEqual(rollback.error, "delete denied", "rollback failure keeps the error");
  assertEqual(rollback.deletedEnrollmentId, null, "failed rollback does not claim a delete");
  assertEqual(
    enrollmentIdsAfterFailedSessionUpdate({
      existingEnrollmentIds: ["enr-existing"],
      insertedEnrollmentId: "enr-new",
      rollback,
    }),
    ["enr-existing", "enr-new"],
    "failed rollback leaves the new row in place and does not remove the existing one"
  );
}

{
  const deleted: string[] = [];
  await rollbackNewEnrollment(async (enrollmentId) => {
    deleted.push(enrollmentId);
    return { error: null };
  }, "   ");
  assertEqual(deleted, [], "blank enrollment id is not a delete target");
}

console.log("bookingEnrollmentRollback tests passed");
