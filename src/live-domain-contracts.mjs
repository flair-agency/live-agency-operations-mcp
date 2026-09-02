import * as z from "zod/v4";

import {
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

function calendarDateInTokyo(value) {
  const date = new Date(Date.parse(value));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const IsoDateTimeSchema = z.string().refine(isIsoDateTime, "must be a timezone-aware ISO date-time");
const CalendarDateSchema = z.string().refine(isCalendarDate, "must be a calendar date");

export const CompletedLiveSessionSchema = z
  .object({
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
  sessions: z.array(CompletedLiveSessionSchema),
})
  .strict()
  .superRefine((observation, context) => {
    const startTimes = new Set();
    const observedAt = Date.parse(observation.observedAt);
    for (const session of observation.sessions) {
      if (startTimes.has(session.startAt)) {
        context.addIssue({ code: "custom", message: "completed LIVE session start time is duplicated" });
      }
      startTimes.add(session.startAt);
      if (Date.parse(session.endAt) > observedAt) {
        context.addIssue({ code: "custom", message: "LIVE history cannot contain an ongoing session" });
      }
    }
    const payloadSha256 = sha256CanonicalJson({
      scan: observation.scan,
      sessions: observation.sessions,
    });
    if (payloadSha256 !== observation.payloadSha256) {
      context.addIssue({ code: "custom", message: "LIVE observation payload hash does not match" });
    }
  });

export const ExistingLiveHistoryRecordSchema = z
  .object({
    recordId: z.string().min(1),
    startAt: IsoDateTimeSchema,
  })
  .strict();

const MatchedLiveHistoryRecordSchema = z
  .object({
    startAt: IsoDateTimeSchema,
    recordId: z.string().min(1),
  })
  .strict();

function accountKey(reference) {
  return sha256CanonicalJson(PlatformAccountReferenceSchema.parse(reference));
}

export const LiveHistorySyncPlanSchema = z
  .object({
    contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
    accountReference: PlatformAccountReferenceSchema,
    plannedAt: IsoDateTimeSchema,
    observation: LiveObservationSchema,
    existingRecords: z.array(ExistingLiveHistoryRecordSchema),
    matches: z.array(MatchedLiveHistoryRecordSchema),
    creates: z.array(CompletedLiveSessionSchema),
  })
  .strict()
  .superRefine((plan, context) => {
    if (accountKey(plan.observation.subject.accountReference) !== accountKey(plan.accountReference)) {
      context.addIssue({ code: "custom", message: "LIVE observation account does not match" });
    }

    const existingByStart = new Map();
    for (const record of plan.existingRecords) {
      if (existingByStart.has(record.startAt)) {
        context.addIssue({ code: "custom", message: "existing LIVE start time is duplicated" });
      }
      existingByStart.set(record.startAt, record.recordId);
    }

    const observedByStart = new Map(
      plan.observation.sessions.map((session) => [session.startAt, session]),
    );
    const expectedCreateStarts = new Set(
      [...observedByStart.keys()].filter((startAt) => !existingByStart.has(startAt)),
    );
    const expectedMatchStarts = new Set(
      [...observedByStart.keys()].filter((startAt) => existingByStart.has(startAt)),
    );

    const createStarts = new Set();
    for (const session of plan.creates) {
      if (createStarts.has(session.startAt)) {
        context.addIssue({ code: "custom", message: "LIVE create start time is duplicated" });
      }
      createStarts.add(session.startAt);
      const observed = observedByStart.get(session.startAt);
      if (!observed || sha256CanonicalJson(observed) !== sha256CanonicalJson(session)) {
        context.addIssue({ code: "custom", message: "LIVE create is not an exact observed session" });
      }
    }
    if (
      createStarts.size !== expectedCreateStarts.size ||
      [...expectedCreateStarts].some((startAt) => !createStarts.has(startAt))
    ) {
      context.addIssue({ code: "custom", message: "LIVE creates do not match unseen start times" });
    }

    const matchStarts = new Set();
    for (const match of plan.matches) {
      if (matchStarts.has(match.startAt)) {
        context.addIssue({ code: "custom", message: "LIVE match start time is duplicated" });
      }
      matchStarts.add(match.startAt);
      if (existingByStart.get(match.startAt) !== match.recordId) {
        context.addIssue({ code: "custom", message: "LIVE match does not reference the exact existing record" });
      }
    }
    if (
      matchStarts.size !== expectedMatchStarts.size ||
      [...expectedMatchStarts].some((startAt) => !matchStarts.has(startAt))
    ) {
      context.addIssue({ code: "custom", message: "LIVE matches do not cover existing start times" });
    }
  });

const DailySessionContributionSchema = z
  .object({
    sessionStartAt: IsoDateTimeSchema,
    sessionEndAt: IsoDateTimeSchema,
    likeCount: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((contribution, context) => {
    const start = Date.parse(contribution.sessionStartAt);
    const end = Date.parse(contribution.sessionEndAt);
    if (end < start || end - start > 24 * 60 * 60 * 1000) {
      context.addIssue({ code: "custom", message: "daily LIVE contribution duration is invalid" });
    }
  });

export const DailyLiveAggregateSchema = z
  .object({
    contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
    accountReference: PlatformAccountReferenceSchema,
    localDate: CalendarDateSchema,
    timeZone: z.literal("Asia/Tokyo"),
    aggregationBasis: z.literal("session-start-date"),
    crossMidnightAllocation: z.literal("full-session-to-start-date"),
    policyVersion: z.string().min(1),
    calculatedAt: IsoDateTimeSchema,
    sessionContributions: z.array(DailySessionContributionSchema),
    totalObservedLiveMinutes: z.number().nonnegative(),
    totalLikeCount: z.number().int().nonnegative().nullable(),
    effectiveLiveDay: z.boolean(),
  })
  .strict()
  .superRefine((aggregate, context) => {
    const sessionStartTimes = new Set();
    for (const contribution of aggregate.sessionContributions) {
      if (sessionStartTimes.has(contribution.sessionStartAt)) {
        context.addIssue({ code: "custom", message: "daily aggregate session start time is duplicated" });
      }
      sessionStartTimes.add(contribution.sessionStartAt);
      if (calendarDateInTokyo(contribution.sessionStartAt) !== aggregate.localDate) {
        context.addIssue({
          code: "custom",
          message: "daily LIVE contribution must use the JST session start date",
        });
      }
    }
    const minutes = aggregate.sessionContributions.reduce(
      (sum, contribution) =>
        sum + (Date.parse(contribution.sessionEndAt) - Date.parse(contribution.sessionStartAt)) / 60000,
      0,
    );
    if (Math.abs(minutes - aggregate.totalObservedLiveMinutes) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "daily observed LIVE minutes do not match session elapsed time",
      });
    }
    const likes = aggregate.sessionContributions.map((contribution) => contribution.likeCount);
    const expectedLikes = likes.some((value) => value === null)
      ? null
      : likes.reduce((sum, value) => sum + value, 0);
    if (expectedLikes !== aggregate.totalLikeCount) {
      context.addIssue({ code: "custom", message: "daily LIVE likes do not match contributions" });
    }
    if (aggregate.effectiveLiveDay !== (aggregate.sessionContributions.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "effective LIVE day does not match session contributions",
      });
    }
  });
