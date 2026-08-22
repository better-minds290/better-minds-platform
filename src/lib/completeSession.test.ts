import {
  canSaveLateTeacherFeedback,
  decideSprintProgressionAfterFeedback,
} from "./completeSession";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Late feedback after admin force-complete — save allowed, progression skipped
{
  assertEqual(
    canSaveLateTeacherFeedback({ sessionStatus: "awaiting_feedback", sprintStatus: "completed" }),
    true,
    "late feedback allowed on completed sprint"
  );

  const decision = decideSprintProgressionAfterFeedback({
    sprintStatus: "completed",
    sessionStatuses: ["completed", "completed", "completed"],
  });
  assertEqual(decision.skipProgression, true, "skip progression when sprint already completed");
  assertEqual(decision.reason, "already_completed", "already_completed reason");
  assertEqual(decision.shouldUpdateSprint, false, "do not re-complete sprint");
  assertEqual(decision.shouldGenerateNextSprint, false, "do not create duplicate next sprint");
  assertEqual(decision.shouldNotifySprintCompleted, false, "do not send duplicate sprint-completed notification");
  assertEqual(decision.shouldResetCompletedAt, false, "do not reset completed_at");
}

// Sprint 2 state is not part of this decision — parent sprint stays completed
{
  const decision = decideSprintProgressionAfterFeedback({
    sprintStatus: "completed",
    sessionStatuses: ["completed", "awaiting_feedback", "completed"],
  });
  assertEqual(decision.shouldGenerateNextSprint, false, "late feedback does not activate another sprint");
}

// Normal path still completes when sprint is active and all 3 sessions are done
{
  const decision = decideSprintProgressionAfterFeedback({
    sprintStatus: "active",
    sessionStatuses: ["completed", "completed", "completed"],
  });
  assertEqual(decision.skipProgression, false, "active sprint can complete");
  assertEqual(decision.shouldUpdateSprint, true, "complete sprint once");
  assertEqual(decision.shouldGenerateNextSprint, true, "generate next sprint once");
}

// Already-feedback-completed historical session — no progression side effects
{
  assertEqual(
    canSaveLateTeacherFeedback({ sessionStatus: "completed", sprintStatus: "completed" }),
    true,
    "re-save on already-completed session is data-only"
  );
  const decision = decideSprintProgressionAfterFeedback({
    sprintStatus: "completed",
    sessionStatuses: ["completed", "completed", "completed"],
  });
  assertEqual(decision.skipProgression, true, "already-feedback-completed skips progression");
}

// Absent session is not late-feedback eligible
{
  assertEqual(
    canSaveLateTeacherFeedback({ sessionStatus: "absent", sprintStatus: "completed" }),
    false,
    "absent stays absent"
  );
}

console.log("completeSession tests passed");
