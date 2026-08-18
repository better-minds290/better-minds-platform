export interface AdminSprintRow {
  id: string;
  sprint_number: number;
  status: string;
}

const UNFINISHED_SPRINT_STATUSES = new Set(["pending", "locked"]);

/**
 * Pick the sprint Admin Sprint tab should treat as the learner's current sprint.
 *
 * Priority:
 * 1. active
 * 2. expired
 * 3. earliest pending/locked (next sprint awaiting unlock)
 * 4. highest sprint_number when everything is finished
 */
export function selectCurrentAdminSprint(sprints: AdminSprintRow[]): AdminSprintRow | null {
  if (sprints.length === 0) return null;

  const sorted = [...sprints].sort((a, b) => a.sprint_number - b.sprint_number);

  const active = sorted.find((s) => s.status === "active");
  if (active) return active;

  const expired = sorted.find((s) => s.status === "expired");
  if (expired) return expired;

  const nextPending = sorted.find((s) => UNFINISHED_SPRINT_STATUSES.has(s.status));
  if (nextPending) return nextPending;

  return sorted[sorted.length - 1];
}

export function canForceCompleteSprint(status: string): boolean {
  return status !== "completed";
}
