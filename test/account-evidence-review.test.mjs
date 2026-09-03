import assert from "node:assert/strict";
import test from "node:test";

import { reviewScoutingAccountEvidence } from "../src/account-evidence-review.mjs";

let sequence = 1;

function evidence(observedAt) {
  const suffix = String(sequence++).padStart(12, "0");
  return [
    {
      evidenceId: `00000000-0000-4000-8000-${suffix}`,
      kind: "api-response",
      capturedAt: observedAt,
      sha256: String(sequence % 10).repeat(64),
      mediaType: "application/json",
    },
  ];
}

function observation({
  username,
  observedAt = "2026-09-04T00:00:00.000Z",
  platformUserId = null,
  nickname = null,
  avatarSha256 = null,
}) {
  return {
    observedAt,
    accountReference: { platform: "tiktok", username, platformUserId },
    nickname,
    avatarSha256,
    evidence: evidence(observedAt),
  };
}

function knownAccount({
  creatorRecordId,
  username,
  platformUserId = null,
  nickname = null,
  avatarSha256 = null,
  historicalObservations = [],
}) {
  return {
    creatorRecordId,
    currentObservation: observation({
      username,
      platformUserId,
      nickname,
      avatarSha256,
      observedAt: "2026-09-03T00:00:00.000Z",
    }),
    historicalObservations,
  };
}

test("matching User ID can surface a username-change candidate without mutating identity", () => {
  const result = reviewScoutingAccountEvidence({
    purpose: "username-change",
    target: observation({
      username: "new_name",
      platformUserId: "platform-123",
      nickname: "Creator",
      avatarSha256: "a".repeat(64),
    }),
    knownAccounts: [
      knownAccount({
        creatorRecordId: "rec_existing",
        username: "old_name",
        platformUserId: "platform-123",
        nickname: "Creator",
        avatarSha256: "a".repeat(64),
      }),
    ],
  });

  assert.equal(result.status, "review-required");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].disposition, "possible-username-change");
  assert.equal(result.candidates[0].evidenceGrade, "direct-account-reference");
  assert.deepEqual(
    result.candidates[0].signals.map((item) => item.kind),
    ["platform-user-id-exact", "avatar-sha256-exact", "nickname-exact"],
  );
  assert.equal(result.decisionBoundary.automaticMutationAllowed, false);
  assert.equal(result.decisionBoundary.actorIdentityAsserted, false);
  assert.equal(result.decisionBoundary.recommendation, "manual-account-review");
});

test("avatar and nickname equality remains corroborating evidence for manual review", () => {
  const result = reviewScoutingAccountEvidence({
    purpose: "username-change",
    target: observation({
      username: "possible_new_name",
      nickname: "Same nickname",
      avatarSha256: "b".repeat(64),
    }),
    knownAccounts: [
      knownAccount({
        creatorRecordId: "rec_possible",
        username: "old_name",
        nickname: "Same nickname",
        avatarSha256: "b".repeat(64),
      }),
    ],
  });

  assert.equal(result.status, "review-required");
  assert.equal(result.candidates[0].disposition, "supporting-profile-evidence-only");
  assert.equal(result.candidates[0].evidenceGrade, "corroborated-profile-evidence");
});

test("nickname equality by itself does not create an account candidate", () => {
  const result = reviewScoutingAccountEvidence({
    purpose: "duplicate-check",
    target: observation({ username: "new_account", nickname: "Common nickname" }),
    knownAccounts: [
      knownAccount({
        creatorRecordId: "rec_unrelated",
        username: "different_account",
        nickname: "Common nickname",
      }),
    ],
  });

  assert.equal(result.status, "no-candidate");
  assert.deepEqual(result.candidates, []);
  assert.equal(result.decisionBoundary.recommendation, "none");
});

test("disagreement between current username and User ID fails closed", () => {
  const result = reviewScoutingAccountEvidence({
    purpose: "duplicate-check",
    target: observation({ username: "@target_name", platformUserId: "platform-target" }),
    knownAccounts: [
      knownAccount({
        creatorRecordId: "rec_username",
        username: "target_name",
        platformUserId: "platform-other",
      }),
      knownAccount({
        creatorRecordId: "rec_user_id",
        username: "different_name",
        platformUserId: "platform-target",
      }),
    ],
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.decisionBoundary.recommendation, "manual-account-review");
  assert.deepEqual(
    result.conflicts.map((item) => item.code),
    [
      "username-and-platform-user-id-disagree",
      "username-match-conflicts-with-platform-user-id",
    ],
  );
});

test("historical username equality is evidence but never an automatic alias update", () => {
  const result = reviewScoutingAccountEvidence({
    purpose: "duplicate-check",
    target: observation({ username: "OLD_NAME" }),
    knownAccounts: [
      knownAccount({
        creatorRecordId: "rec_history",
        username: "current_name",
        historicalObservations: [
          observation({ username: "old_name", observedAt: "2026-08-01T00:00:00.000Z" }),
        ],
      }),
    ],
  });

  assert.equal(result.status, "review-required");
  assert.equal(result.candidates[0].disposition, "known-historical-username");
  assert.equal(result.decisionBoundary.automaticMutationAllowed, false);
});

test("duplicated Creator record inputs are rejected", () => {
  const duplicate = knownAccount({ creatorRecordId: "rec_duplicate", username: "one" });
  assert.throws(
    () =>
      reviewScoutingAccountEvidence({
        purpose: "duplicate-check",
        target: observation({ username: "target" }),
        knownAccounts: [duplicate, { ...duplicate }],
      }),
    /creatorRecordId is duplicated/,
  );
});
