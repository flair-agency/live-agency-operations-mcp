import assert from "node:assert/strict";
import test from "node:test";

import { sha256CanonicalJson } from "../src/domain-contracts.mjs";
import {
  DailyLiveAggregateSchema,
  LiveObservationSchema,
  LiveSessionReconciliationSchema,
} from "../src/live-domain-contracts.mjs";

const accountReference = { platform: "tiktok", username: "synthetic.creator" };

function observation({
  observationId = "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
  observationSessionKey = "scan-session-a",
  startAt = "2026-09-01T12:00:00.000Z",
  endAt = "2026-09-01T13:00:00.000Z",
} = {}) {
  const scan = { mode: "incremental", stopReason: "known-anchor", knownMatchCount: 1 };
  const sessions = [
    {
      observationSessionKey,
      startAt,
      endAt,
      likeCount: 100,
      likeStatus: "observed_exact",
    },
  ];
  return {
    contractVersion: 2,
    observationId,
    observedAt: "2026-09-02T00:00:00.000Z",
    subject: { version: 2, accountReference },
    providerBinding: {
      providerFamily: "tiktok",
      packageName: "@synthetic/provider",
      packageVersion: "1.0.0",
      bindingId: "live-history",
      knowledgeVersion: "synthetic/1",
    },
    evidence: [
      {
        evidenceId: "6ba7b812-9dad-41d1-80b4-00c04fd430c8",
        kind: "screenshot",
        capturedAt: "2026-09-02T00:00:00.000Z",
        sha256: "a".repeat(64),
        mediaType: "image/png",
      },
    ],
    unavailableFields: [],
    observationType: "live-history-scan",
    scan,
    sessions,
    payloadSha256: sha256CanonicalJson({ scan, sessions }),
  };
}

function canonicalSession(sourceSessions) {
  return {
    contractVersion: 2,
    sessionKey: "canonical-session-a",
    subject: { version: 2, accountReference },
    startAt: "2026-09-01T12:00:00.000Z",
    endAt: "2026-09-01T13:00:00.000Z",
    likeCount: 100,
    likeStatus: "accepted_exact",
    sourceSessions,
  };
}

test("LIVE observations bind each normalized scan payload and preserve unavailable values", () => {
  assert.equal(LiveObservationSchema.parse(observation()).sessions[0].likeCount, 100);
  assert.throws(
    () => LiveObservationSchema.parse({ ...observation(), payloadSha256: "b".repeat(64) }),
    /payload hash/,
  );
  const unavailable = observation();
  unavailable.sessions[0].likeCount = null;
  unavailable.sessions[0].likeStatus = "not_available";
  unavailable.payloadSha256 = sha256CanonicalJson({
    scan: unavailable.scan,
    sessions: unavailable.sessions,
  });
  assert.equal(LiveObservationSchema.parse(unavailable).sessions[0].likeCount, null);
});

test("multiple observations may support one canonical LIVE session", () => {
  const first = observation();
  const second = observation({
    observationId: "6ba7b813-9dad-41d1-80b4-00c04fd430c8",
    observationSessionKey: "scan-session-b",
  });
  const reconciliation = LiveSessionReconciliationSchema.parse({
    contractVersion: 2,
    accountReference,
    reconciledAt: "2026-09-02T01:00:00.000Z",
    observations: [first, second],
    canonicalSessions: [
      canonicalSession([
        {
          observationId: first.observationId,
          observationSessionKey: "scan-session-a",
        },
        {
          observationId: second.observationId,
          observationSessionKey: "scan-session-b",
        },
      ]),
    ],
    quarantinedSessions: [],
  });
  assert.equal(reconciliation.canonicalSessions.length, 1);
  assert.equal(reconciliation.observations.length, 2);
});

test("an observed LIVE session cannot become two canonical sessions or disappear silently", () => {
  const source = observation();
  const ref = {
    observationId: source.observationId,
    observationSessionKey: "scan-session-a",
  };
  const base = {
    contractVersion: 2,
    accountReference,
    reconciledAt: "2026-09-02T01:00:00.000Z",
    observations: [source],
    quarantinedSessions: [],
  };
  assert.throws(
    () =>
      LiveSessionReconciliationSchema.parse({
        ...base,
        canonicalSessions: [
          canonicalSession([ref]),
          { ...canonicalSession([ref]), sessionKey: "canonical-session-b" },
        ],
      }),
    /multiple dispositions/,
  );
  assert.throws(
    () => LiveSessionReconciliationSchema.parse({ ...base, canonicalSessions: [] }),
    /no disposition/,
  );
});

test("daily aggregates accept canonical session contributions once and verify totals", () => {
  const aggregate = {
    contractVersion: 2,
    accountReference,
    localDate: "2026-09-01",
    timeZone: "Asia/Tokyo",
    aggregationBasis: "session-start-date",
    crossMidnightAllocation: "full-session-to-start-date",
    policyVersion: "synthetic/1",
    calculatedAt: "2026-09-02T01:00:00.000Z",
    sessionContributions: [
      {
        sessionKey: "canonical-session-a",
        sessionStartAt: "2026-09-01T12:00:00.000Z",
        sessionEndAt: "2026-09-01T13:00:00.000Z",
        likeCount: 100,
      },
      {
        sessionKey: "canonical-session-b",
        sessionStartAt: "2026-09-01T14:00:00.000Z",
        sessionEndAt: "2026-09-01T14:30:00.000Z",
        likeCount: 50,
      },
    ],
    totalObservedLiveMinutes: 90,
    totalLikeCount: 150,
    effectiveLiveDay: true,
  };
  assert.equal(DailyLiveAggregateSchema.parse(aggregate).totalObservedLiveMinutes, 90);
  assert.throws(
    () =>
      DailyLiveAggregateSchema.parse({
        ...aggregate,
        sessionContributions: [
          aggregate.sessionContributions[0],
          { ...aggregate.sessionContributions[0] },
        ],
        totalObservedLiveMinutes: 120,
        totalLikeCount: 200,
      }),
    /session key is duplicated/,
  );
  assert.throws(
    () => DailyLiveAggregateSchema.parse({ ...aggregate, totalObservedLiveMinutes: 91 }),
    /minutes do not match session elapsed time/,
  );
  assert.throws(
    () =>
      DailyLiveAggregateSchema.parse({
        ...aggregate,
        sessionContributions: [
          {
            sessionKey: "cross-midnight-session",
            sessionStartAt: "2026-09-02T14:30:00.000Z",
            sessionEndAt: "2026-09-02T16:00:00.000Z",
            likeCount: 100,
          },
        ],
        totalObservedLiveMinutes: 90,
        totalLikeCount: 100,
      }),
    /JST session start date/,
  );
  assert.equal("observationId" in DailyLiveAggregateSchema.parse(aggregate), false);
});

test("cross-midnight LIVE duration is attributed entirely to the JST session start date", () => {
  const aggregate = {
    contractVersion: 2,
    accountReference,
    localDate: "2026-09-01",
    timeZone: "Asia/Tokyo",
    aggregationBasis: "session-start-date",
    crossMidnightAllocation: "full-session-to-start-date",
    policyVersion: "synthetic/1",
    calculatedAt: "2026-09-02T16:30:00.000Z",
    sessionContributions: [
      {
        sessionKey: "cross-midnight-session",
        sessionStartAt: "2026-09-01T14:30:00.000Z",
        sessionEndAt: "2026-09-01T16:00:00.000Z",
        likeCount: 100,
      },
    ],
    totalObservedLiveMinutes: 90,
    totalLikeCount: 100,
    effectiveLiveDay: true,
  };
  assert.equal(DailyLiveAggregateSchema.parse(aggregate).localDate, "2026-09-01");
});
