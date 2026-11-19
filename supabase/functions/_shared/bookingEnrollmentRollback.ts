/**
 * When a booking or admin assign inserts a class enrollment and then fails
 * to link the sprint session, only that newly inserted enrollment may be removed.
 * Existing enrollments and reused classes are never selected.
 */

export type EnrollmentRollbackReport = {
  attempted: boolean;
  deletedEnrollmentId: string | null;
  failed: boolean;
  error: string | null;
};

export function planNewEnrollmentRollback(insertedEnrollmentId: string | null | undefined): {
  deleteEnrollmentId: string | null;
} {
  if (typeof insertedEnrollmentId !== "string") return { deleteEnrollmentId: null };
  const id = insertedEnrollmentId.trim();
  if (!id) return { deleteEnrollmentId: null };
  return { deleteEnrollmentId: id };
}

export function reportEnrollmentRollback(input: {
  insertedEnrollmentId: string | null | undefined;
  deleteError: string | null;
}): EnrollmentRollbackReport {
  const plan = planNewEnrollmentRollback(input.insertedEnrollmentId);
  if (!plan.deleteEnrollmentId) {
    return { attempted: false, deletedEnrollmentId: null, failed: false, error: null };
  }
  if (input.deleteError) {
    return { attempted: true, deletedEnrollmentId: null, failed: true, error: input.deleteError };
  }
  return {
    attempted: true,
    deletedEnrollmentId: plan.deleteEnrollmentId,
    failed: false,
    error: null,
  };
}

export async function rollbackNewEnrollment(
  deleteEnrollment: (enrollmentId: string) => Promise<{ error: { message: string } | null }>,
  insertedEnrollmentId: string | null | undefined
): Promise<EnrollmentRollbackReport> {
  const plan = planNewEnrollmentRollback(insertedEnrollmentId);
  if (!plan.deleteEnrollmentId) {
    return reportEnrollmentRollback({ insertedEnrollmentId: null, deleteError: null });
  }
  const { error } = await deleteEnrollment(plan.deleteEnrollmentId);
  return reportEnrollmentRollback({
    insertedEnrollmentId: plan.deleteEnrollmentId,
    deleteError: error?.message ?? null,
  });
}

/** Enrollment ids that remain after a failed session link. Existing ids are kept. */
export function enrollmentIdsAfterFailedSessionUpdate(input: {
  existingEnrollmentIds: string[];
  insertedEnrollmentId: string | null;
  rollback: EnrollmentRollbackReport;
}): string[] {
  const ids = [...input.existingEnrollmentIds];
  if (input.insertedEnrollmentId && !ids.includes(input.insertedEnrollmentId)) {
    ids.push(input.insertedEnrollmentId);
  }
  if (input.rollback.deletedEnrollmentId) {
    return ids.filter((id) => id !== input.rollback.deletedEnrollmentId);
  }
  return ids;
}
