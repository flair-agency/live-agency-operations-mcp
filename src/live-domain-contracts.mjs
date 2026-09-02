import * as z from "zod/v4";

import {
  AccountObservationSubjectSchema,
  DOMAIN_CONTRACT_VERSION,
  ObservationEnvelopeSchema,
  PlatformAccountReferenceSchema,
  sha256CanonicalJson,
} from "./domain-contracts.mjs";

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;

function isIsoDateTime(value) {
  const match = typeof value === "string" ? value.match(ISO_DATE_TIME) : null;
  if (!match) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    zone,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  const monthDays = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  return (
    day >= 1 &&
    day <= monthDays &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    !(offsetHour === 14 && offsetMinute !== 0) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

const IsoDateTimeSchema = z.string().refine(isIsoDateTime, "must be a timezone-aware ISO date-time");
const CalendarDateSchema = z.string().refine(isCalendarDate, "must be a calendar date");

export const ObservedLiveSessionSchema = z
  .object({
    observationSessionKey: z.string().min(1),
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema,
    likeCount: z.number().int().nonnegative().nullable(),
    likeStatus: z.enum(["observed_exact", "observed_rounded", "not_available"]),
    likeDisplay: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((session, context) => {
    const start = Date.parse(session.startAt);
    const end = Date.parse(session.endAt);
    if (end < start || end - start > 24 * 60 * 60 * 1000) {
      context.addIssue({ code: "custom", message: "LIVE session duration is invalid" });
    }
    if (session.likeStatus === "not_available" && session.likeCount !== null) {
      context.addIssue({ code: "custom", message: "unavailable likes must remain null" });
    }
    if (session.likeStatus !== "not_available" && session.likeCount === null) {
      context.addIssue({ code: "custom", message: "observed likes require a count" });
    }
    if (session.likeStatus === "observed_rounded" && !session.likeDisplay) {
      context.addIssue({ code: "custom", message: "rounded likes require the source display" });
    }
  });

const LiveScanSchema = z
  .object({
    mode: z.enum(["incremental", "reconcile-window", "baseline-full"]),
    stopReason: z.enum(["known-anchor", "cutoff", "history-end", "no-history", "unavailable"]),
    knownMatchCount: z.number().int().nonnegative(),
  })
  .strict();

export const LiveObservationSchema = ObservationEnvelopeSchema.extend({
  observationType: z.literal("live-history-scan"),
  scan: LiveScanSchema,
  sessions: z.array(ObservedLiveSessionSchema),
})
  .strict()
  .superRefine((observation, context) => {
    const keys = new Set();
    for (const session of observation.sessions) {
      if (keys.has(session.observationSessionKey)) {
        context.addIssue({ code: "custom", message: "observation session key is duplicated" });
      }
      keys.add(session.observationSessionKey);
    }
    const payloadSha256 = sha256CanonicalJson({
      scan: observation.scan,
      sessions: observation.sessions,
    });
    if (payloadSha256 !== observation.payloadSha256) {
      context.addIssue({ code: "custom", message: "LIVE observation payload hash does not match" });
    }
  });

export const LiveObservationSessionRefSchema = z
  .object({
    observationId: z.string().uuid(),
    observationSessionKey: z.string().min(1),
  })
  .strict();

export const CanonicalLiveSessionSchema = z
  .object({
    contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
    sessionKey: z.string().min(1),
    subject: AccountObservationSubjectSchema,
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema,
    likeCount: z.number().int().nonnegative().nullable(),
    likeStatus: z.enum(["accepted_exact", "accepted_rounded", "unavailable"]),
    sourceSessions: z.array(LiveObservationSessionRefSchema).min(1),
  })
  .strict()
  .superRefine((session, context) => {
    const start = Date.parse(session.startAt);
    const end = Date.parse(session.endAt);
    if (end < start || end - start > 24 * 60 * 60 * 1000) {
      context.addIssue({ code: "custom", message: "canonical LIVE session duration is invalid" });
    }
    if (session.likeStatus === "unavailable" && session.likeCount !== null) {
      context.addIssue({ code: "custom", message: "unavailable canonical likes must remain null" });
    }
    if (session.likeStatus !== "unavailable" && session.likeCount === null) {
      context.addIssue({ code: "custom", message: "accepted canonical likes require a count" });
    }
    const refs = new Set();
    for (const source of session.sourceSessions) {
      const key = `${source.observationId}\u0000${source.observationSessionKey}`;
      if (refs.has(key)) {
        context.addIssue({ code: "custom", message: "canonical source session is duplicated" });
      }
      refs.add(key);
    }
  });

const QuarantinedLiveSessionSchema = z
  .object({
    sourceSession: LiveObservationSessionRefSchema,
    reason: z.enum([
      "ambiguous-natural-key",
      "conflicting-session-facts",
      "missing-account-reference",
      "invalid-session",
    ]),
    detail: z.string().min(1).optional(),
  })
  .strict();

function accountKey(reference) {
  return sha256CanonicalJson(PlatformAccountReferenceSchema.parse(reference));
}

function sourceSessionKey(source) {
  return `${source.observationId}\u0000${source.observationSessionKey}`;
}

export const LiveSessionReconciliationSchema = z
  .object({
    contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
    accountReference: PlatformAccountReferenceSchema,
    reconciledAt: IsoDateTimeSchema,
    observations: z.array(LiveObservationSchema).min(1),
    canonicalSessions: z.array(CanonicalLiveSessionSchema),
    quarantinedSessions: z.array(QuarantinedLiveSessionSchema),
  })
  .strict()
  .superRefine((reconciliation, context) => {
    const expectedAccount = accountKey(reconciliation.accountReference);
    const observationIds = new Set();
    const availableSources = new Set();
    for (const observation of reconciliation.observations) {
      if (observationIds.has(observation.observationId)) {
        context.addIssue({ code: "custom", message: "LIVE observation ID is duplicated" });
      }
      observationIds.add(observation.observationId);
      if (accountKey(observation.subject.accountReference) !== expectedAccount) {
        context.addIssue({ code: "custom", message: "LIVE observation account does not match" });
      }
      for (const session of observation.sessions) {
        availableSources.add(
          sourceSessionKey({
            observationId: observation.observationId,
            observationSessionKey: session.observationSessionKey,
          }),
        );
      }
    }

    const sessionKeys = new Set();
    const disposition = new Map();
    for (const session of reconciliation.canonicalSessions) {
      if (sessionKeys.has(session.sessionKey)) {
        context.addIssue({ code: "custom", message: "canonical LIVE session key is duplicated" });
      }
      sessionKeys.add(session.sessionKey);
      if (accountKey(session.subject.accountReference) !== expectedAccount) {
        context.addIssue({ code: "custom", message: "canonical LIVE session account does not match" });
      }
      for (const source of session.sourceSessions) {
        const key = sourceSessionKey(source);
        if (!availableSources.has(key)) {
          context.addIssue({ code: "custom", message: "canonical LIVE session source is missing" });
        }
        if (disposition.has(key)) {
          context.addIssue({ code: "custom", message: "observed LIVE session has multiple dispositions" });
        }
        disposition.set(key, "canonical");
      }
    }
    for (const quarantine of reconciliation.quarantinedSessions) {
      const key = sourceSessionKey(quarantine.sourceSession);
      if (!availableSources.has(key)) {
        context.addIssue({ code: "custom", message: "quarantined LIVE session source is missing" });
      }
      if (disposition.has(key)) {
        context.addIssue({ code: "custom", message: "observed LIVE session has multiple dispositions" });
      }
      disposition.set(key, "quarantined");
    }
    for (const key of availableSources) {
      if (!disposition.has(key)) {
        context.addIssue({ code: "custom", message: "observed LIVE session has no disposition" });
      }
    }
  });

const DailySessionContributionSchema = z
  .object({
    sessionKey: z.string().min(1),
    liveMinutes: z.number().int().nonnegative(),
    likeCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const DailyLiveAggregateSchema = z
  .object({
    contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
    accountReference: PlatformAccountReferenceSchema,
    localDate: CalendarDateSchema,
    timeZone: z.literal("Asia/Tokyo"),
    policyVersion: z.string().min(1),
    calculatedAt: IsoDateTimeSchema,
    sessionContributions: z.array(DailySessionContributionSchema),
    totalLiveMinutes: z.number().int().nonnegative(),
    totalLikeCount: z.number().int().nonnegative().nullable(),
    effectiveLiveDay: z.boolean(),
  })
  .strict()
  .superRefine((aggregate, context) => {
    const sessionKeys = new Set();
    for (const contribution of aggregate.sessionContributions) {
      if (sessionKeys.has(contribution.sessionKey)) {
        context.addIssue({ code: "custom", message: "daily aggregate session key is duplicated" });
      }
      sessionKeys.add(contribution.sessionKey);
    }
    const minutes = aggregate.sessionContributions.reduce(
      (sum, contribution) => sum + contribution.liveMinutes,
      0,
    );
    if (minutes !== aggregate.totalLiveMinutes) {
      context.addIssue({ code: "custom", message: "daily LIVE minutes do not match contributions" });
    }
    const likes = aggregate.sessionContributions.map((contribution) => contribution.likeCount);
    const expectedLikes = likes.some((value) => value === null)
      ? null
      : likes.reduce((sum, value) => sum + value, 0);
    if (expectedLikes !== aggregate.totalLikeCount) {
      context.addIssue({ code: "custom", message: "daily LIVE likes do not match contributions" });
    }
  });
