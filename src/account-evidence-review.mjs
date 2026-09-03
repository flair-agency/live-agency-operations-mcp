import {
  AccountEvidenceReviewOutputSchema,
  AccountEvidenceReviewPurposeSchema,
  AccountIdentityEvidenceObservationSchema,
  KnownScoutingAccountEvidenceSchema,
} from "./domain-contracts.mjs";

function normalizedUsername(value) {
  return value.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
}

function normalizedNickname(value) {
  return value?.normalize("NFKC").trim().replace(/\s+/gu, " ") ?? null;
}

function distinct(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function evidenceIds(observation) {
  return observation.evidence.map((item) => item.evidenceId).sort();
}

function newestMatchingObservation(observations, predicate) {
  return observations
    .filter(predicate)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
}

function signal(kind, target, knownObservation = null) {
  return {
    kind,
    targetObservedAt: target.observedAt,
    knownObservedAt: knownObservation?.observedAt ?? null,
    targetEvidenceIds: evidenceIds(target),
    knownEvidenceIds: knownObservation ? evidenceIds(knownObservation) : [],
  };
}

function candidateFor(target, knownAccount) {
  const targetUsername = normalizedUsername(target.accountReference.username);
  const currentUsername = normalizedUsername(
    knownAccount.currentObservation.accountReference.username,
  );
  const currentUsernameMatches = targetUsername === currentUsername;
  const historicalUsernameObservation = newestMatchingObservation(
    knownAccount.historicalObservations,
    (observation) =>
      normalizedUsername(observation.accountReference.username) === targetUsername &&
      normalizedUsername(observation.accountReference.username) !== currentUsername,
  );
  const allKnownObservations = [
    knownAccount.currentObservation,
    ...knownAccount.historicalObservations,
  ];
  const userIdObservation = target.accountReference.platformUserId
    ? newestMatchingObservation(
        allKnownObservations,
        (observation) =>
          observation.accountReference.platformUserId === target.accountReference.platformUserId,
      )
    : null;
  const avatarObservation = target.avatarSha256
    ? newestMatchingObservation(
        allKnownObservations,
        (observation) => observation.avatarSha256 === target.avatarSha256,
      )
    : null;
  const targetNickname = normalizedNickname(target.nickname);
  const nicknameObservation = targetNickname
    ? newestMatchingObservation(
        allKnownObservations,
        (observation) => normalizedNickname(observation.nickname) === targetNickname,
      )
    : null;

  const signals = [];
  if (currentUsernameMatches) {
    signals.push(signal("current-username-exact", target, knownAccount.currentObservation));
  }
  if (historicalUsernameObservation) {
    signals.push(signal("historical-username-exact", target, historicalUsernameObservation));
  }
  if (userIdObservation) {
    signals.push(signal("platform-user-id-exact", target, userIdObservation));
  }
  if (avatarObservation) {
    signals.push(signal("avatar-sha256-exact", target, avatarObservation));
  }
  if (nicknameObservation) {
    signals.push(signal("nickname-exact", target, nicknameObservation));
  }

  const hasDirectReference = currentUsernameMatches || historicalUsernameObservation || userIdObservation;
  const hasCorroboratedProfileEvidence = avatarObservation && nicknameObservation;
  if (!hasDirectReference && !avatarObservation) return null;

  let disposition = "supporting-profile-evidence-only";
  if (currentUsernameMatches) disposition = "same-current-username";
  else if (historicalUsernameObservation) disposition = "known-historical-username";
  else if (userIdObservation) disposition = "possible-username-change";

  return {
    creatorRecordId: knownAccount.creatorRecordId,
    currentUsername: knownAccount.currentObservation.accountReference.username,
    disposition,
    evidenceGrade: hasDirectReference
      ? "direct-account-reference"
      : hasCorroboratedProfileEvidence
        ? "corroborated-profile-evidence"
        : "profile-evidence-hint",
    signals,
  };
}

function conflict(code, recordIds, detail) {
  return { code, creatorRecordIds: distinct(recordIds), detail };
}

function reviewConflicts(target, knownAccounts, candidates) {
  const conflicts = [];
  const currentUsernameMatches = candidates.filter((candidate) =>
    candidate.signals.some((item) => item.kind === "current-username-exact"),
  );
  if (currentUsernameMatches.length > 1) {
    conflicts.push(
      conflict(
        "current-username-maps-to-multiple-records",
        currentUsernameMatches.map((candidate) => candidate.creatorRecordId),
        "The normalized current username is present on more than one Creator record.",
      ),
    );
  }

  const userIdMatches = candidates.filter((candidate) =>
    candidate.signals.some((item) => item.kind === "platform-user-id-exact"),
  );
  if (userIdMatches.length > 1) {
    conflicts.push(
      conflict(
        "platform-user-id-maps-to-multiple-records",
        userIdMatches.map((candidate) => candidate.creatorRecordId),
        "The same observed TikTok User ID appears on more than one Creator record.",
      ),
    );
  }

  const usernameIds = new Set(currentUsernameMatches.map((item) => item.creatorRecordId));
  const platformIds = new Set(userIdMatches.map((item) => item.creatorRecordId));
  if (
    usernameIds.size > 0 &&
    platformIds.size > 0 &&
    [...usernameIds].every((recordId) => !platformIds.has(recordId))
  ) {
    conflicts.push(
      conflict(
        "username-and-platform-user-id-disagree",
        [...usernameIds, ...platformIds],
        "The current username and TikTok User ID point to disjoint Creator records.",
      ),
    );
  }

  for (const knownAccount of knownAccounts) {
    const knownIds = distinct([
      knownAccount.currentObservation.accountReference.platformUserId,
      ...knownAccount.historicalObservations.map(
        (observation) => observation.accountReference.platformUserId,
      ),
    ]);
    if (knownIds.length > 1 && candidates.some((item) => item.creatorRecordId === knownAccount.creatorRecordId)) {
      conflicts.push(
        conflict(
          "record-has-conflicting-platform-user-ids",
          [knownAccount.creatorRecordId],
          "One candidate Creator record contains more than one observed TikTok User ID.",
        ),
      );
    }

    if (
      target.accountReference.platformUserId &&
      normalizedUsername(knownAccount.currentObservation.accountReference.username) ===
        normalizedUsername(target.accountReference.username) &&
      knownIds.length > 0 &&
      !knownIds.includes(target.accountReference.platformUserId)
    ) {
      conflicts.push(
        conflict(
          "username-match-conflicts-with-platform-user-id",
          [knownAccount.creatorRecordId],
          "The current username matches, but every known TikTok User ID differs from the target observation.",
        ),
      );
    }
  }

  return conflicts.sort((left, right) =>
    `${left.code}:${left.creatorRecordIds.join(",")}`.localeCompare(
      `${right.code}:${right.creatorRecordIds.join(",")}`,
    ),
  );
}

export function reviewScoutingAccountEvidence(input) {
  const purpose = AccountEvidenceReviewPurposeSchema.parse(input?.purpose);
  const target = AccountIdentityEvidenceObservationSchema.parse(input?.target);
  const knownAccounts = KnownScoutingAccountEvidenceSchema.array().parse(input?.knownAccounts);
  const observations = [
    target,
    ...knownAccounts.flatMap((account) => [
      account.currentObservation,
      ...account.historicalObservations,
    ]),
  ];
  if (observations.some((observation) => !normalizedUsername(observation.accountReference.username))) {
    throw new TypeError("account observation username is empty after normalization");
  }
  const recordIds = knownAccounts.map((account) => account.creatorRecordId);
  if (new Set(recordIds).size !== recordIds.length) {
    throw new TypeError("knownAccounts creatorRecordId is duplicated");
  }

  const candidates = knownAccounts
    .map((account) => candidateFor(target, account))
    .filter(Boolean)
    .sort((left, right) => left.creatorRecordId.localeCompare(right.creatorRecordId));
  const conflicts = reviewConflicts(target, knownAccounts, candidates);
  const status = conflicts.length > 0
    ? "conflict"
    : candidates.length > 0
      ? "review-required"
      : "no-candidate";

  return AccountEvidenceReviewOutputSchema.parse({
    status,
    purpose,
    target,
    candidates,
    conflicts,
    decisionBoundary: {
      automaticMutationAllowed: false,
      actorIdentityAsserted: false,
      recommendation: status === "no-candidate" ? "none" : "manual-account-review",
    },
  });
}
