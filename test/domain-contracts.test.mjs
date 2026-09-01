import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountObservationSubjectSchema,
  InstanceProfileRefSchema,
  ObservationEnvelopeSchema,
  ReadbackResultSchema,
  WriteApprovalSchema,
  WriteIntentSchema,
  createReadAuditContext,
  sha256CanonicalJson,
} from "../src/domain-contracts.mjs";

test("account observation reference does not assert a Flair person or creator identity", () => {
  const subject = AccountObservationSubjectSchema.parse({
    version: 2,
    accountReference: {
      platform: "tiktok",
      accountKey: "synthetic.creator",
      platformUserId: "synthetic-platform-id",
    },
  });

  assert.equal(subject.accountReference.accountKey, "synthetic.creator");
  assert.equal("creatorId" in subject, false);
  assert.equal("personId" in subject, false);
  assert.equal("platformAccountId" in subject, false);
});

test("read audit context is deterministic and rejects the aggregate domain", () => {
  const first = createReadAuditContext("creator-scouting", "observe_creator", {
    accountKey: "synthetic.creator",
  });
  const second = createReadAuditContext("creator-scouting", "observe_creator", {
    accountKey: "synthetic.creator",
  });

  assert.deepEqual(first, second);
  assert.equal(first.contractVersion, 2);
  assert.equal(first.authority, "read");
  assert.match(first.requestSha256, /^[0-9a-f]{64}$/);
  assert.throws(
    () => createReadAuditContext("agency-intelligence", "aggregate", {}),
    /not exposed by this acquisition MCP/,
  );
});

test("instance profiles are explicit and authority-scoped", () => {
  assert.deepEqual(
    InstanceProfileRefSchema.parse({
      profileId: "flair.creator-management.production",
      tenant: "flair",
      authority: "write",
      schemaVersion: "creator-management/v2",
      knowledgeVersion: "2026-09-02.1",
    }),
    {
      profileId: "flair.creator-management.production",
      tenant: "flair",
      authority: "write",
      schemaVersion: "creator-management/v2",
      knowledgeVersion: "2026-09-02.1",
    },
  );
  assert.throws(
    () =>
      InstanceProfileRefSchema.parse({
        profileId: "fallback",
        tenant: "unknown",
        authority: "action",
        schemaVersion: "v2",
        knowledgeVersion: "1",
      }),
    /Invalid option/i,
  );
});

test("observation evidence and unavailable values have source-neutral envelopes", () => {
  const payload = { followers: 100, nickname: "Synthetic" };
  const envelope = ObservationEnvelopeSchema.parse({
    contractVersion: 2,
    observationId: "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
    observedAt: "2026-09-02T00:00:00.000Z",
    subject: {
      version: 2,
      accountReference: { platform: "tiktok", accountKey: "synthetic.creator" },
    },
    providerBinding: {
      providerFamily: "tiktok",
      packageName: "@synthetic/provider",
      packageVersion: "1.0.0",
      bindingId: "public-profile",
      knowledgeVersion: "synthetic/1",
    },
    evidence: [
      {
        evidenceId: "6ba7b812-9dad-41d1-80b4-00c04fd430c8",
        kind: "screenshot",
        capturedAt: "2026-09-02T00:00:00.000Z",
        sha256: "c".repeat(64),
        mediaType: "image/png",
      },
    ],
    unavailableFields: [{ field: "platformUserId", reason: "not-exposed" }],
    payloadSha256: sha256CanonicalJson(payload),
  });

  assert.equal(envelope.providerBinding.providerFamily, "tiktok");
  assert.equal(envelope.unavailableFields[0].reason, "not-exposed");
  assert.equal(
    sha256CanonicalJson({ nickname: "Synthetic", followers: 100 }),
    envelope.payloadSha256,
  );
});

test("write intent, approval, and readback contracts remain content-bound", () => {
  const mutation = {
    operation: "update",
    tableId: "synthetic-table-id",
    recordId: "synthetic-record-id",
    mutationKey: "creator-month:synthetic:2026-08",
    payloadSha256: "d".repeat(64),
  };
  const intentSha256 = sha256CanonicalJson({ mutations: [mutation] });
  const intent = WriteIntentSchema.parse({
    contractVersion: 2,
    intentId: "6ba7b813-9dad-41d1-80b4-00c04fd430c8",
    domain: "creator-management",
    authority: "write",
    instanceProfile: {
      profileId: "flair-creator-management-write",
      tenant: "flair",
      authority: "write",
      schemaVersion: "creator-management/v2",
      knowledgeVersion: "2026-09-02.1",
    },
    preparedAt: "2026-09-02T00:00:00.000Z",
    expiresAt: "2026-09-02T01:00:00.000Z",
    mutations: [mutation],
    intentSha256,
  });
  const approval = WriteApprovalSchema.parse({
    intentSha256,
    approvedBy: "synthetic-reviewer",
    approvedAt: "2026-09-02T00:05:00.000Z",
  });
  const readback = ReadbackResultSchema.parse({
    contractVersion: 2,
    intentSha256,
    status: "verified",
    verifiedAt: "2026-09-02T00:06:00.000Z",
    expectedMutationCount: 1,
    verifiedMutationCount: 1,
    discrepancies: [],
  });

  assert.equal(approval.intentSha256, intent.intentSha256);
  assert.equal(readback.intentSha256, intent.intentSha256);
  assert.equal(readback.status, "verified");
  assert.throws(
    () =>
      WriteIntentSchema.parse({
        ...intent,
        authority: "action",
      }),
    /Invalid input/i,
  );
});
