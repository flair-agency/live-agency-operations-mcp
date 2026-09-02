import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_CAPABILITY,
  INVITATION_CAPABILITY,
  LIVE_HISTORY_OBSERVATION_CAPABILITY,
  PROFILE_OBSERVATION_CAPABILITY,
} from "@live-agency-skills/source-provider-api";

import {
  completeActivityObservationRequest,
  createOperationsRuntime,
  matchCreatorLiveHistoryObservations,
  matchCreatorProfileObservations,
  matchCreatorActivityObservation,
  matchInvitationObservations,
} from "../src/runtime.mjs";

function providerApi(provider, readValue) {
  return {
    async discoverProviders({ rootDir }) {
      assert.equal(rootDir, "/synthetic/runtime");
      return [provider];
    },
    async resolveProvider(input) {
      assert.deepEqual(input.providers, [provider]);
      return provider;
    },
    async readFromProvider(selected, request) {
      assert.equal(selected, provider);
      return typeof readValue === "function" ? readValue(request) : readValue;
    },
  };
}

test("readCreatorActivity maps a source to a capability provider and validates output", async () => {
  const provider = {
    packageName: "@synthetic/activity-provider",
    packageVersion: "1.2.3",
    bindingId: "monthly-source",
    knowledgeVersion: "synthetic/2026-09-01.1",
    executionKind: "module",
  };
  const snapshot = {
    month: "2026-08",
    sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    rowCount: 1,
    creators: [
      {
        accountKey: "synthetic_creator",
        diamonds: 1200,
        effectiveLiveDays: 8,
        liveMinutes: 945,
      },
    ],
  };
  let resolved;
  const api = providerApi(provider, (request) => {
    assert.equal(request.inputKind, "text/markdown");
    assert.equal(request.expectedRowCount, 1);
    return snapshot;
  });
  const originalResolve = api.resolveProvider;
  api.resolveProvider = async (input) => {
    resolved = input;
    return originalResolve(input);
  };

  const runtime = createOperationsRuntime({
    rootDir: "/synthetic/runtime",
    providerApi: api,
  });
  const result = await runtime.readCreatorActivity({
    source: {
      kind: "markdown",
      month: "2026-08",
      sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
      expectedRowCount: 1,
      text: "| synthetic | table |",
    },
  });

  assert.equal(resolved.capability, ACTIVITY_CAPABILITY);
  assert.equal(resolved.unattended, false);
  assert.deepEqual(result, {
    status: "ok",
    snapshot,
    sourceContext: {
      capability: ACTIVITY_CAPABILITY,
      providerPackage: "@synthetic/activity-provider",
      providerVersion: "1.2.3",
      bindingId: "monthly-source",
      knowledgeVersion: "synthetic/2026-09-01.1",
    },
  });
});

test("observeCreatorActivity returns content-bound private instructions", async () => {
  const provider = {
    packageName: "@synthetic/activity-provider",
    packageVersion: "2.0.0",
    bindingId: "activity-observation",
    knowledgeVersion: "synthetic-activity/2026-09-01.1",
    executionKind: "instructions",
    instructions: "Observe the exact month and selected accounts.",
  };
  let resolved;
  const api = providerApi(provider, null);
  const originalResolve = api.resolveProvider;
  api.resolveProvider = async (input) => {
    resolved = input;
    return originalResolve(input);
  };
  const runtime = createOperationsRuntime({
    rootDir: "/synthetic/runtime",
    providerApi: api,
    now: () => new Date("2026-09-01T03:00:00.000Z"),
  });

  const result = await runtime.observeCreatorActivity({
    request: {
      version: 1,
      month: "2026-08",
      targetMode: "selected",
      accountKeys: ["@Synthetic.Creator"],
    },
  });

  assert.equal(result.status, "interaction_required");
  assert.equal(result.instructions, provider.instructions);
  assert.deepEqual(result.request.accountKeys, ["synthetic.creator"]);
  assert.equal(result.request.generatedAt, "2026-09-01T03:00:00.000Z");
  assert.match(result.request.accountKeysSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    resolved.request.inputKind,
    "application/vnd.live-agency.creator-activity-observation-request+json",
  );
  assert.equal(resolved.unattended, false);
});

test("activity observation validation requires the exact month and selected accounts", () => {
  const request = completeActivityObservationRequest({
    version: 1,
    month: "2026-08",
    targetMode: "selected",
    accountKeys: ["@Synthetic.Creator"],
    generatedAt: "2026-09-01T03:00:00.000Z",
  });
  const snapshot = {
    month: "2026-08",
    sourceUpdatedAt: "2026-09-01T03:05:00.000Z",
    rowCount: 1,
    creators: [{
      accountKey: "SYNTHETIC.CREATOR",
      diamonds: 1200,
      effectiveLiveDays: 8,
      liveMinutes: 945,
    }],
  };

  assert.equal(
    matchCreatorActivityObservation(snapshot, request).creators[0].accountKey,
    "synthetic.creator",
  );
  assert.throws(
    () => matchCreatorActivityObservation({ ...snapshot, month: "2026-07" }, request),
    /does not match request month/,
  );
  assert.throws(
    () => matchCreatorActivityObservation({
      ...snapshot,
      creators: [{ ...snapshot.creators[0], accountKey: "not_requested" }],
    }, request),
    /unrequested accounts/,
  );
  assert.throws(
    () => completeActivityObservationRequest({
      version: 1,
      month: "2026-08",
      targetMode: "complete",
      accountKeys: ["synthetic.creator"],
    }),
    /must not specify accountKeys/,
  );
});

test("observeCreatorInvitationStatus returns interaction_required without executing instructions", async () => {
  const provider = {
    packageName: "@synthetic/invitation-provider",
    packageVersion: "2.0.0",
    bindingId: "status-observation",
    knowledgeVersion: "synthetic-invitation/2026-09-01.1",
    executionKind: "instructions",
    instructions: "Observe only. Never change a relationship.",
  };
  let readCalled = false;
  const api = providerApi(provider, null);
  api.readFromProvider = async () => {
    readCalled = true;
    throw new Error("must not execute");
  };
  const runtime = createOperationsRuntime({
    rootDir: "/synthetic/runtime",
    providerApi: api,
    now: () => new Date("2026-09-01T03:00:00.000Z"),
  });
  const result = await runtime.observeCreatorInvitationStatus({
    targetManifest: {
      version: 1,
      targetMode: "selected",
      rowCount: 1,
      rows: [{ creatorRecordId: "rec_synthetic", accountKey: "@Synthetic.Creator" }],
    },
  });

  assert.equal(readCalled, false);
  assert.equal(result.status, "interaction_required");
  assert.equal(result.instructions, provider.instructions);
  assert.equal(result.sourceContext.capability, INVITATION_CAPABILITY);
  assert.equal(result.targetManifest.generatedAt, "2026-09-01T03:00:00.000Z");
  assert.match(result.targetManifest.rowsSha256, /^[0-9a-f]{64}$/);
});

test("target manifests require a real timezone-aware generatedAt", async () => {
  const provider = {
    packageName: "@synthetic/invitation-provider",
    packageVersion: "2.0.0",
    bindingId: "status-observation",
    knowledgeVersion: "synthetic-invitation/2026-09-01.1",
    executionKind: "instructions",
    instructions: "Observe only.",
  };
  const runtime = createOperationsRuntime({
    rootDir: "/synthetic/runtime",
    providerApi: providerApi(provider, null),
  });
  const base = {
    version: 1,
    targetMode: "selected",
    rowCount: 1,
    rows: [{ creatorRecordId: "rec_synthetic", accountKey: "synthetic_creator" }],
  };

  await assert.rejects(
    runtime.observeCreatorInvitationStatus({
      targetManifest: { ...base, generatedAt: "2026-09-01T03:00:00" },
    }),
    /must be an ISO date-time/,
  );
  await assert.rejects(
    runtime.observeCreatorInvitationStatus({
      targetManifest: { ...base, generatedAt: "2026-02-30T03:00:00Z" },
    }),
    /must be an ISO date-time/,
  );
});

test("matchInvitationObservations rejects incomplete coverage and attaches record ids", () => {
  const manifest = {
    version: 1,
    generatedAt: "2026-09-01T03:00:00.000Z",
    targetMode: "selected",
    rowCount: 2,
    rows: [
      { creatorRecordId: "rec_a", accountKey: "@Creator.A" },
      { creatorRecordId: "rec_b", accountKey: "creator_b" },
    ],
  };
  const complete = {
    observedAt: "2026-09-01T03:05:00.000Z",
    rowCount: 2,
    creators: [
      { accountKey: "creator.a", state: "synthetic_eligible" },
      { accountKey: "@CREATOR_B", state: "synthetic_pending" },
    ],
  };

  const matched = matchInvitationObservations(complete, manifest);
  assert.deepEqual(
    matched.creators.map(({ creatorRecordId, accountKey }) => ({ creatorRecordId, accountKey })),
    [
      { creatorRecordId: "rec_a", accountKey: "creator.a" },
      { creatorRecordId: "rec_b", accountKey: "creator_b" },
    ],
  );

  assert.throws(
    () =>
      matchInvitationObservations(
        { ...complete, rowCount: 1, creators: complete.creators.slice(0, 1) },
        manifest,
      ),
    /missing requested accounts: creator_b/,
  );
  assert.throws(
    () =>
      matchInvitationObservations(
        {
          ...complete,
          rowCount: 3,
          creators: [
            ...complete.creators,
            { accountKey: "not_requested", state: "synthetic_unknown" },
          ],
        },
        manifest,
      ),
    /unrequested account: not_requested/,
  );
});

test("Scouting profile and LIVE observation routes return only bounded instructions", async () => {
  for (const [method, capability, expectedInputKind] of [
    [
      "observeCreatorProfiles",
      PROFILE_OBSERVATION_CAPABILITY,
      "application/vnd.live-agency.creator-profile-targets+json",
    ],
    [
      "observeCreatorLiveHistory",
      LIVE_HISTORY_OBSERVATION_CAPABILITY,
      "application/vnd.live-agency.creator-live-history-targets+json",
    ],
  ]) {
    const provider = {
      packageName: "@synthetic/tiktok-provider",
      packageVersion: "2.0.0",
      bindingId: `synthetic-${method}`,
      knowledgeVersion: "synthetic/1",
      executionKind: "instructions",
      instructions: "Observe only in the selected session.",
    };
    const api = providerApi(provider, null);
    let resolved;
    api.resolveProvider = async (input) => {
      resolved = input;
      return provider;
    };
    api.readFromProvider = async () => {
      throw new Error("interactive instructions must not be executed");
    };
    const runtime = createOperationsRuntime({
      rootDir: "/synthetic/runtime",
      providerApi: api,
      now: () => new Date("2026-09-02T03:00:00.000Z"),
    });
    const result = await runtime[method]({
      targetManifest: {
        version: 1,
        targetMode: "selected",
        rowCount: 1,
        rows: [{ creatorRecordId: "rec_synthetic", accountKey: "@Synthetic.Creator" }],
      },
    });
    assert.equal(result.status, "interaction_required");
    assert.equal(result.sourceContext.capability, capability);
    assert.equal(resolved.capability, capability);
    assert.equal(resolved.request.inputKind, expectedInputKind);
    assert.equal(resolved.unattended, false);
  }
});

test("profile and LIVE validation preserve the exact target record association", () => {
  const manifest = {
    version: 1,
    generatedAt: "2026-09-02T03:00:00.000Z",
    targetMode: "selected",
    rowCount: 1,
    rows: [{ creatorRecordId: "rec_synthetic", accountKey: "@Synthetic.Creator" }],
  };
  const profile = {
    observedAt: "2026-09-02T03:05:00.000Z",
    rowCount: 1,
    creators: [
      {
        creatorRecordId: "rec_synthetic",
        accountKey: "SYNTHETIC.CREATOR",
        observedAt: "2026-09-02T03:04:00.000Z",
        profile: {
          followerCount: 100,
          followerStatus: "observed_exact",
          recentPostCount30d: 1,
          recentPostStatus: "observed_exact",
          latestPostAt: "2026-09-01T00:00:00.000Z",
          latestPostStatus: "observed_exact",
          nickname: "Synthetic",
          nicknameStatus: "observed_exact",
          avatar: null,
          avatarStatus: "not_available",
          featureObservationData: null,
          featureObservationStatus: "not_available",
        },
      },
    ],
  };
  const live = {
    observedAt: "2026-09-02T03:05:00.000Z",
    rowCount: 1,
    creators: [
      {
        creatorRecordId: "rec_synthetic",
        accountKey: "synthetic.creator",
        observedAt: "2026-09-02T03:04:00.000Z",
        fanClubCount: 10,
        fanClubStatus: "observed_exact",
        liveScan: { mode: "incremental", stopReason: "known-anchor", knownMatchCount: 1 },
        lives: [
          {
            startAt: "2026-09-01T00:00:00.000Z",
            endAt: "2026-09-01T01:00:00.000Z",
            likeCount: 100,
            likeStatus: "observed_exact",
          },
        ],
      },
    ],
  };

  assert.equal(
    matchCreatorProfileObservations(profile, manifest).creators[0].accountKey,
    "synthetic.creator",
  );
  assert.equal(
    matchCreatorLiveHistoryObservations(live, manifest).creators[0].creatorRecordId,
    "rec_synthetic",
  );
  assert.throws(
    () =>
      matchCreatorProfileObservations(
        {
          ...profile,
          creators: [{ ...profile.creators[0], creatorRecordId: "rec_other" }],
        },
        manifest,
      ),
    /creatorRecordId does not match target/,
  );
  assert.throws(
    () =>
      matchCreatorLiveHistoryObservations(
        {
          ...live,
          creators: [{ ...live.creators[0], accountKey: "not_requested" }],
        },
        manifest,
      ),
    /unrequested account/,
  );
});
