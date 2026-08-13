/**
 * Learner lifecycle source of truth: enrollments.status
 * - pending: no enrollment (UI-derived)
 * - active: enrolled and in program (legacy "paused" maps here)
 * - completed: finished program; history kept, operational flows stopped
 *
 * profiles.is_active remains a separate account soft-deactivate flag.
 */

export type LearnerLifecycleStatus = "pending" | "active" | "completed";

/** DB statuses that still count as operationally active until legacy pause is migrated. */
export const OPERATIONAL_ENROLLMENT_STATUSES = ["active", "paused"] as const;

export function normalizeEnrollmentStatus(
  raw: string | null | undefined
): Exclude<LearnerLifecycleStatus, "pending"> | null {
  if (!raw) return null;
  if (raw === "completed") return "completed";
  // Legacy paused enrollments behave as active in the new lifecycle.
  if (raw === "active" || raw === "paused") return "active";
  return null;
}

/**
 * Derive learner-level lifecycle from one or more enrollment statuses.
 * Prefer active over completed when multiple enrollments exist (future multi-course).
 */
export function deriveLearnerLifecycle(
  enrollmentStatuses: Array<string | null | undefined>
): LearnerLifecycleStatus {
  const normalized = enrollmentStatuses
    .map(normalizeEnrollmentStatus)
    .filter((s): s is Exclude<LearnerLifecycleStatus, "pending"> => s != null);

  if (normalized.length === 0) return "pending";
  if (normalized.some((s) => s === "active")) return "active";
  if (normalized.some((s) => s === "completed")) return "completed";
  return "pending";
}

export function isOperationallyActive(status: LearnerLifecycleStatus): boolean {
  return status === "active";
}

export function canBookClasses(status: LearnerLifecycleStatus): boolean {
  return status === "active";
}

export function canBeScheduled(status: LearnerLifecycleStatus): boolean {
  return status === "active" || status === "pending";
}
