import assert from "node:assert/strict";
import test from "node:test";

import { sha256CanonicalJson } from "../src/domain-contracts.mjs";
import {
  DailyLiveAggregateSchema,
  LiveHistorySyncPlanSchema,
  LiveObservationSchema,
} from "../src/live-domain-contracts.mjs";

const accountReference = { platform: "tiktok", username: "synthetic.creator" };

function completedSession({
  startAt = "2026-09-01T12:00:00.000Z",
  endAt = "2026-09-01T13:00:00.000Z",
} = {}) {
  return {
    startAt,
    endAt,
    likeCount: 100,
    likeStatus: "observed_exact",
  };
}

function observation({
  observationId = "6ba7b811-9dad-41d1-80b4-00c04fd430c8",
  sessions = [completedSession()],
} = {}) {
  const scan = { mode: "incremental", stopReason: "known-anchor", knownMatchCount: 1 };
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

test("LIVE observations contain only completed sessions keyed by exact start time", () => {
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

  assert.throws(
    () =>
      LiveObservationSchema.parse(
        observation({
          sessions: [
            completedSession(),
            completedSession({ endAt: "2026-09-01T13:30:00.000Z" }),
          ],
        }),
      ),
    /start time is duplicated/,
  );
  assert.throws(
    () =>
      LiveObservationSchema.parse(
        observation({
          sessions: [
            completedSession({
              startAt: "2026-09-02T00:15:00.000Z",
              endAt: "2026-09-02T00:30:00.000Z",
            }),
          ],
        }),
      ),
    /ongoing session/,
  );
});

test("LIVE history sync creates only sessions with unseen exact start times", () => {
  const existing = completedSession();
  const unseen = completedSession({
    startAt: "2026-09-01T14:00:00.000Z",
    endAt: "2026-09-01T14:30:00.000Z",
  });
  const source = observation({ sessions: [unseen, existing] });
  const plan = {
    contractVersion: 2,
    accountReference,
    plannedAt: "2026-09-02T01:00:00.000Z",
    observation: source,
    existingRecords: [{ recordId: "rec-existing", startAt: existing.startAt }],
    matches: [{ startAt: existing.startAt, recordId: "rec-existing" }],
    creates: [unseen],
  };
  const parsed = LiveHistorySyncPlanSchema.parse(plan);
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.creates.length, 1);

  assert.throws(
    () => LiveHistorySyncPlanSchema.parse({ ...plan, creates: [existing, unseen] }),
    /creates do not match unseen start times/,
  );
  assert.throws(
    () => LiveHistorySyncPlanSchema.parse({ ...plan, matches: [] }),
    /matches do not cover existing start times/,
  );
});

test("LIVE history sync fails closed on duplicate existing start times", () => {
  const source = observation();
  assert.throws(
    () =>
      LiveHistorySyncPlanSchema.parse({
        contractVersion: 2,
        accountReference,
        plannedAt: "2026-09-02T01:00:00.000Z",
        observation: source,
        existingRecords: [
          { recordId: "rec-a", startAt: source.sessions[0].startAt },
          { recordId: "rec-b", startAt: source.sessions[0].startAt },
        ],
        matches: [{ startAt: source.sessions[0].startAt, recordId: "rec-a" }],
        creates: [],
      }),
    /existing LIVE start time is duplicated/,
  );
});

test("daily aggregates accept completed session start times once and verify totals", () => {
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
        sessionStartAt: "2026-09-01T12:00:00.000Z",
        sessionEndAt: "2026-09-01T13:00:00.000Z",
        likeCount: 100,
      },
      {
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
    /session start time is duplicated/,
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
