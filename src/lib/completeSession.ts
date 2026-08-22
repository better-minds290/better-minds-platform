/**
 * Teacher feedback may complete a session and then a sprint.
 * After Admin force-completes a sprint, late feedback must update
 * historical session/rating data only — never re-run progression.
 */

export type SprintProgressionSkipReason =
  | "already_completed"
  | "not_all_sessions_completed"
  | "has_absent";

export interface SprintProgressionDecision {
  skipProgression: boolean;
  reason: SprintProgressionSkipReason | "ready_to_complete";
  shouldUpdateSprint: boolean;
  shouldGenerateNextSprint: boolean;
  shouldNotifySprintCompleted: boolean;
  shouldResetCompletedAt: boolean;
}

export function decideSprintProgressionAfterFeedback(input: {
  sprintStatus: string | null | undefined;
  sessionStatuses: string[];
}): SprintProgressionDecision {
  if (input.sprintStatus === "completed") {
    return {
      skipProgression: true,
      reason: "already_completed",
      shouldUpdateSprint: false,
      shouldGenerateNextSprint: false,
      shouldNotifySprintCompleted: false,
      shouldResetCompletedAt: false,
    };
  }

  const hasAbsent = input.sessionStatuses.some((status) => status === "absent");
  const allCompleted =
    input.sessionStatuses.length === 3 &&
    input.sessionStatuses.every((status) => status === "completed");

  if (!allCompleted) {
    return {
      skipProgression: true,
      reason: hasAbsent ? "has_absent" : "not_all_sessions_completed",
      shouldUpdateSprint: false,
      shouldGenerateNextSprint: false,
      shouldNotifySprintCompleted: false,
      shouldResetCompletedAt: false,
    };
  }

  return {
    skipProgression: false,
    reason: "ready_to_complete",
    shouldUpdateSprint: true,
    shouldGenerateNextSprint: true,
    shouldNotifySprintCompleted: true,
    shouldResetCompletedAt: true,
  };
}

/** Late feedback may write ratings even when the parent sprint is already closed. */
export function canSaveLateTeacherFeedback(input: {
  sessionStatus: string;
  sprintStatus: string | null | undefined;
}): boolean {
  if (input.sessionStatus === "absent") return false;
  if (input.sessionStatus !== "awaiting_feedback" && input.sessionStatus !== "completed") {
    return false;
  }
  return input.sprintStatus === "completed" || input.sprintStatus === "active";
}
