import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_CAPABILITY,
  INVITATION_CAPABILITY,
} from "@live-agency-skills/source-provider-api";

import {
  createOperationsRuntime,
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
