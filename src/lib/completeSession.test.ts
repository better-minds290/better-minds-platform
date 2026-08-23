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

// Active sprint + awaiting feedback — save allowed, later progression still possible
{
  assertEqual(
    canSaveLateTeacherFeedback({ sessionStatus: "awaiting_feedback", sprintStatus: "active" }),
    true,
    "active sprint awaiting feedback can submit"
  );
}

// Completed session under Completed filter — late write allowed, no second sprint
{
  assertEqual(
    canSaveLateTeacherFeedback({ sessionStatus: "completed", sprintStatus: "completed" }),
    true,
    "completed session on completed sprint can still save late grade"
  );
  const afterLastLearner = decideSprintProgressionAfterFeedback({
    sprintStatus: "completed",
    sessionStatuses: ["completed", "completed", "completed"],
  });
  assertEqual(afterLastLearner.shouldGenerateNextSprint, false, "final missing grade does not generate Sprint 2 again");
  assertEqual(afterLastLearner.shouldNotifySprintCompleted, false, "final missing grade does not duplicate sprint-complete notification");
  assertEqual(afterLastLearner.shouldUpdateSprint, false, "parent sprint stays completed");
}

console.log("completeSession tests passed");
