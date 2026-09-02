import { createHash } from "node:crypto";
import path from "node:path";

import {
  ACTIVITY_CAPABILITY,
  INVITATION_CAPABILITY,
  LIVE_HISTORY_OBSERVATION_CAPABILITY,
  PROFILE_OBSERVATION_CAPABILITY,
  discoverProviders,
  readFromProvider,
  resolveProvider,
  validateActivitySnapshot,
  validateInvitationObservations,
  validateLiveHistoryObservations,
  validateProfileObservations,
} from "@live-agency-skills/source-provider-api";

import { createProfiledProviderResolver } from "./provider-binding-resolver.mjs";

export const XLSX_INPUT_KIND =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ACTIVITY_OBSERVATION_INPUT_KIND =
  "application/vnd.live-agency.creator-activity-observation-request+json";
export const INVITATION_TARGET_INPUT_KIND =
  "application/vnd.live-agency.creator-invitation-targets+json";
export const PROFILE_TARGET_INPUT_KIND =
  "application/vnd.live-agency.creator-profile-targets+json";
export const LIVE_HISTORY_TARGET_INPUT_KIND =
  "application/vnd.live-agency.creator-live-history-targets+json";

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertIsoDateTime(value, label) {
  const match =
    typeof value === "string"
      ? value.match(
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/,
        )
      : null;
  if (!match) {
    throw new TypeError(`${label} must be an ISO date-time`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHourText, offsetMinuteText] = match;
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
  if (
    day < 1 ||
    day > monthDays ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`${label} must be an ISO date-time`);
  }
}

export function normalizeAccountKey(value) {
  let normalized = String(value).normalize("NFKC").trim();
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  return normalized.toLocaleLowerCase("und");
}

export function completeTargetManifest(value, now = () => new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("targetManifest must be an object");
  }
  if (value.version !== 1 || !["due", "selected", "all"].includes(value.targetMode)) {
    throw new TypeError("targetManifest format is invalid");
  }
  if (!Array.isArray(value.rows) || value.rowCount !== value.rows.length || value.rows.length < 1) {
    throw new TypeError("targetManifest rowCount must match a non-empty rows array");
  }

  const seenAccounts = new Set();
  const seenRecords = new Set();
  for (const [index, row] of value.rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`targetManifest row ${index} is invalid`);
    }
    const accountKey = normalizeAccountKey(row.accountKey);
    if (!accountKey) throw new TypeError(`targetManifest row ${index} accountKey is invalid`);
    if (seenAccounts.has(accountKey)) {
      throw new TypeError(`targetManifest accountKey is duplicated: ${accountKey}`);
    }
    if (typeof row.creatorRecordId !== "string" || !row.creatorRecordId) {
      throw new TypeError(`targetManifest row ${index} creatorRecordId is invalid`);
    }
    if (seenRecords.has(row.creatorRecordId)) {
      throw new TypeError(
        `targetManifest creatorRecordId is duplicated: ${row.creatorRecordId}`,
      );
    }
    seenAccounts.add(accountKey);
    seenRecords.add(row.creatorRecordId);
  }

  const generatedAt = value.generatedAt ?? now().toISOString();
  assertIsoDateTime(generatedAt, "targetManifest.generatedAt");
  const rowsSha256 = sha256Json(value.rows);
  if (value.rowsSha256 !== undefined && value.rowsSha256 !== rowsSha256) {
    throw new TypeError("targetManifest rowsSha256 does not match rows");
  }
  return {
    ...value,
    generatedAt: new Date(generatedAt).toISOString(),
    rowsSha256,
  };
}

export function completeActivityObservationRequest(value, now = () => new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("activity observation request must be an object");
  }
  if (
    value.version !== 1 ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month) ||
    !["complete", "selected"].includes(value.targetMode)
  ) {
    throw new TypeError("activity observation request format is invalid");
  }

  const suppliedAccounts = value.accountKeys ?? [];
  if (!Array.isArray(suppliedAccounts)) {
    throw new TypeError("activity observation request accountKeys must be an array");
  }
  const accountKeys = suppliedAccounts.map((accountKey, index) => {
    const normalized = normalizeAccountKey(accountKey);
    if (!normalized) {
      throw new TypeError(`activity observation request accountKeys[${index}] is invalid`);
    }
    return normalized;
  });
  if (new Set(accountKeys).size !== accountKeys.length) {
    throw new TypeError("activity observation request accountKeys are duplicated");
  }
  if (value.targetMode === "complete" && accountKeys.length !== 0) {
    throw new TypeError("complete activity observation must not specify accountKeys");
  }
  if (value.targetMode === "selected" && accountKeys.length === 0) {
    throw new TypeError("selected activity observation requires accountKeys");
  }

  const generatedAt = value.generatedAt ?? now().toISOString();
  assertIsoDateTime(generatedAt, "activity observation request generatedAt");
  const accountKeysSha256 = sha256Json(accountKeys);
  if (
    value.accountKeysSha256 !== undefined &&
    value.accountKeysSha256 !== accountKeysSha256
  ) {
    throw new TypeError("activity observation request accountKeysSha256 does not match accountKeys");
  }
  return {
    version: 1,
    month: value.month,
    targetMode: value.targetMode,
    accountKeys,
    generatedAt: new Date(generatedAt).toISOString(),
    accountKeysSha256,
  };
}

function sourceContext(provider, capability) {
  return {
    capability,
    ...(provider.manifest?.providerFamily
      ? { providerFamily: provider.manifest.providerFamily }
      : {}),
    providerPackage: provider.packageName,
    providerVersion: provider.packageVersion,
    bindingId: provider.bindingId,
    knowledgeVersion: provider.knowledgeVersion ?? null,
  };
}

function assertSourceContext(context, capability) {
  if (!context || typeof context !== "object" || context.capability !== capability) {
    throw new TypeError(`sourceContext.capability must be ${capability}`);
  }
  for (const key of ["providerPackage", "providerVersion", "bindingId"]) {
    if (typeof context[key] !== "string" || !context[key]) {
      throw new TypeError(`sourceContext.${key} is required`);
    }
  }
  if (
    context.knowledgeVersion !== null &&
    (typeof context.knowledgeVersion !== "string" || !context.knowledgeVersion)
  ) {
    throw new TypeError("sourceContext.knowledgeVersion must be a string or null");
  }
}

function activityRequest(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("source must be an object");
  }
  if (source.kind === "markdown") {
    return {
      request: {
        inputKind: "text/markdown",
        month: source.month,
        sourceUpdatedAt: source.sourceUpdatedAt,
        expectedRowCount: source.expectedRowCount,
        text: source.text,
      },
      unattended: false,
    };
  }
  if (source.kind === "xlsx") {
    if (typeof source.filePath !== "string" || !path.isAbsolute(source.filePath)) {
      throw new TypeError("source.filePath must be an absolute path");
    }
    return {
      request: {
        inputKind: XLSX_INPUT_KIND,
        filePath: source.filePath,
        ...(source.month === undefined ? {} : { month: source.month }),
      },
      unattended: true,
    };
  }
  throw new TypeError("source.kind must be markdown or xlsx");
}

export function matchInvitationObservations(observationsValue, manifestValue) {
  const observations = validateInvitationObservations(observationsValue);
  const manifest = completeTargetManifest(manifestValue);
  const targetsByAccount = new Map(
    manifest.rows.map((row) => [normalizeAccountKey(row.accountKey), row]),
  );
  const seen = new Set();
  const creators = observations.creators.map((creator) => {
    const accountKey = normalizeAccountKey(creator.accountKey);
    if (!accountKey || seen.has(accountKey)) {
      throw new TypeError(
        `observation accountKey is invalid or duplicated: ${creator.accountKey}`,
      );
    }
    seen.add(accountKey);
    const target = targetsByAccount.get(accountKey);
    if (!target) {
      throw new TypeError(`observation contains an unrequested account: ${accountKey}`);
    }
    return {
      ...creator,
      creatorRecordId: target.creatorRecordId,
      accountKey,
    };
  });
  const missing = [...targetsByAccount.keys()].filter((accountKey) => !seen.has(accountKey));
  if (missing.length > 0) {
    throw new TypeError(`observations are missing requested accounts: ${missing.join(", ")}`);
  }
  return { ...observations, creators };
}

function matchTargetedObservations(observationsValue, manifestValue, validate, label) {
  const observations = validate(observationsValue);
  const manifest = completeTargetManifest(manifestValue);
  const targetsByAccount = new Map(
    manifest.rows.map((row) => [normalizeAccountKey(row.accountKey), row]),
  );
  const seenAccounts = new Set();
  const seenRecords = new Set();
  const creators = observations.creators.map((creator) => {
    const accountKey = normalizeAccountKey(creator.accountKey);
    if (!accountKey || seenAccounts.has(accountKey)) {
      throw new TypeError(`${label} accountKey is invalid or duplicated: ${creator.accountKey}`);
    }
    seenAccounts.add(accountKey);
    const target = targetsByAccount.get(accountKey);
    if (!target) throw new TypeError(`${label} contains an unrequested account: ${accountKey}`);
    if (creator.creatorRecordId !== target.creatorRecordId) {
      throw new TypeError(`${label} creatorRecordId does not match target: ${accountKey}`);
    }
    if (seenRecords.has(creator.creatorRecordId)) {
      throw new TypeError(`${label} creatorRecordId is duplicated: ${creator.creatorRecordId}`);
    }
    seenRecords.add(creator.creatorRecordId);
    return { ...creator, accountKey };
  });
  const missing = [...targetsByAccount.keys()].filter(
    (accountKey) => !seenAccounts.has(accountKey),
  );
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing requested accounts: ${missing.join(", ")}`);
  }
  return { ...observations, creators };
}

export function matchCreatorProfileObservations(observationsValue, manifestValue) {
  return matchTargetedObservations(
    observationsValue,
    manifestValue,
    validateProfileObservations,
    "profile observations",
  );
}

export function matchCreatorLiveHistoryObservations(observationsValue, manifestValue) {
  return matchTargetedObservations(
    observationsValue,
    manifestValue,
    validateLiveHistoryObservations,
    "LIVE-history observations",
  );
}

export function matchCreatorActivityObservation(snapshotValue, requestValue) {
  const snapshot = validateActivitySnapshot(snapshotValue);
  const request = completeActivityObservationRequest(requestValue);
  if (snapshot.month !== request.month) {
    throw new TypeError(
      `activity snapshot month ${snapshot.month} does not match request month ${request.month}`,
    );
  }

  const seen = new Set();
  const creators = snapshot.creators.map((creator) => {
    const accountKey = normalizeAccountKey(creator.accountKey);
    if (!accountKey || seen.has(accountKey)) {
      throw new TypeError(
        `activity snapshot accountKey is invalid or duplicated: ${creator.accountKey}`,
      );
    }
    seen.add(accountKey);
    return { ...creator, accountKey };
  });

  if (request.targetMode === "selected") {
    const requested = new Set(request.accountKeys);
    const extras = [...seen].filter((accountKey) => !requested.has(accountKey));
    const missing = [...requested].filter((accountKey) => !seen.has(accountKey));
    if (extras.length > 0) {
      throw new TypeError(
        `activity snapshot contains unrequested accounts: ${extras.join(", ")}`,
      );
    }
    if (missing.length > 0) {
      throw new TypeError(
        `activity snapshot is missing requested accounts: ${missing.join(", ")}`,
      );
    }
  }
  return { ...snapshot, creators };
}

const defaultProviderApi = {
  discoverProviders,
  resolveProvider,
  readFromProvider,
};

export function createOperationsRuntime({
  rootDir = process.cwd(),
  providerApi = defaultProviderApi,
  bindingProfile,
  now = () => new Date(),
} = {}) {
  let providersPromise;
  const providers = () => {
    providersPromise ??= providerApi.discoverProviders({ rootDir });
    return providersPromise;
  };

  const profiledResolve = bindingProfile
    ? createProfiledProviderResolver({
        profile: bindingProfile,
        resolveProvider: providerApi.resolveProvider,
      })
    : providerApi.resolveProvider;

  async function selectProvider(capability, request, unattended) {
    return profiledResolve({
      providers: await providers(),
      capability,
      request,
      unattended,
    });
  }

  return {
    async readCreatorActivity({ source }) {
      const { request, unattended } = activityRequest(source);
      const provider = await selectProvider(ACTIVITY_CAPABILITY, request, unattended);
      const snapshot = validateActivitySnapshot(
        await providerApi.readFromProvider(provider, request),
      );
      return {
        status: "ok",
        snapshot,
        sourceContext: sourceContext(provider, ACTIVITY_CAPABILITY),
      };
    },

    async observeCreatorActivity({ request: requestValue }) {
      const request = completeActivityObservationRequest(requestValue, now);
      const providerRequest = {
        inputKind: ACTIVITY_OBSERVATION_INPUT_KIND,
        activityObservationRequest: request,
      };
      const provider = await selectProvider(
        ACTIVITY_CAPABILITY,
        providerRequest,
        false,
      );
      const context = sourceContext(provider, ACTIVITY_CAPABILITY);
      if (provider.executionKind === "instructions") {
        if (typeof provider.instructions !== "string" || !provider.instructions.trim()) {
          throw new TypeError("interactive provider instructions are missing");
        }
        return {
          status: "interaction_required",
          request,
          sourceContext: context,
          instructions: provider.instructions,
        };
      }
      return {
        status: "completed",
        request,
        sourceContext: context,
        snapshot: matchCreatorActivityObservation(
          await providerApi.readFromProvider(provider, providerRequest),
          request,
        ),
      };
    },

    validateCreatorActivity({ request: requestValue, sourceContext: context, snapshot }) {
      const request = completeActivityObservationRequest(requestValue, now);
      assertSourceContext(context, ACTIVITY_CAPABILITY);
      return {
        status: "validated",
        request,
        sourceContext: { ...context },
        snapshot: matchCreatorActivityObservation(snapshot, request),
      };
    },

    async observeCreatorInvitationStatus({ targetManifest }) {
      const manifest = completeTargetManifest(targetManifest, now);
      const request = {
        inputKind: INVITATION_TARGET_INPUT_KIND,
        targetManifest: manifest,
      };
      const provider = await selectProvider(INVITATION_CAPABILITY, request, false);
      const context = sourceContext(provider, INVITATION_CAPABILITY);
      if (provider.executionKind === "instructions") {
        if (typeof provider.instructions !== "string" || !provider.instructions.trim()) {
          throw new TypeError("interactive provider instructions are missing");
        }
        return {
          status: "interaction_required",
          targetManifest: manifest,
          sourceContext: context,
          instructions: provider.instructions,
        };
      }
      const observations = matchInvitationObservations(
        await providerApi.readFromProvider(provider, request),
        manifest,
      );
      return {
        status: "completed",
        targetManifest: manifest,
        sourceContext: context,
        observations,
      };
    },

    validateCreatorInvitationStatus({ targetManifest, sourceContext: context, observations }) {
      const manifest = completeTargetManifest(targetManifest, now);
      assertSourceContext(context, INVITATION_CAPABILITY);
      return {
        status: "validated",
        targetManifest: manifest,
        sourceContext: { ...context },
        observations: matchInvitationObservations(observations, manifest),
      };
    },

    async observeCreatorProfiles({ targetManifest }) {
      const manifest = completeTargetManifest(targetManifest, now);
      const request = { inputKind: PROFILE_TARGET_INPUT_KIND, targetManifest: manifest };
      const provider = await selectProvider(PROFILE_OBSERVATION_CAPABILITY, request, false);
      const context = sourceContext(provider, PROFILE_OBSERVATION_CAPABILITY);
      if (provider.executionKind === "instructions") {
        if (typeof provider.instructions !== "string" || !provider.instructions.trim()) {
          throw new TypeError("interactive provider instructions are missing");
        }
        return {
          status: "interaction_required",
          targetManifest: manifest,
          sourceContext: context,
          instructions: provider.instructions,
        };
      }
      return {
        status: "completed",
        targetManifest: manifest,
        sourceContext: context,
        observations: matchCreatorProfileObservations(
          await providerApi.readFromProvider(provider, request),
          manifest,
        ),
      };
    },

    validateCreatorProfileObservations({
      targetManifest,
      sourceContext: context,
      observations,
    }) {
      const manifest = completeTargetManifest(targetManifest, now);
      assertSourceContext(context, PROFILE_OBSERVATION_CAPABILITY);
      return {
        status: "validated",
        targetManifest: manifest,
        sourceContext: { ...context },
        observations: matchCreatorProfileObservations(observations, manifest),
      };
    },

    async observeCreatorLiveHistory({ targetManifest }) {
      const manifest = completeTargetManifest(targetManifest, now);
      const request = { inputKind: LIVE_HISTORY_TARGET_INPUT_KIND, targetManifest: manifest };
      const provider = await selectProvider(
        LIVE_HISTORY_OBSERVATION_CAPABILITY,
        request,
        false,
      );
      const context = sourceContext(provider, LIVE_HISTORY_OBSERVATION_CAPABILITY);
      if (provider.executionKind === "instructions") {
        if (typeof provider.instructions !== "string" || !provider.instructions.trim()) {
          throw new TypeError("interactive provider instructions are missing");
        }
        return {
          status: "interaction_required",
          targetManifest: manifest,
          sourceContext: context,
          instructions: provider.instructions,
        };
      }
      return {
        status: "completed",
        targetManifest: manifest,
        sourceContext: context,
        observations: matchCreatorLiveHistoryObservations(
          await providerApi.readFromProvider(provider, request),
          manifest,
        ),
      };
    },

    validateCreatorLiveHistoryObservations({
      targetManifest,
      sourceContext: context,
      observations,
    }) {
      const manifest = completeTargetManifest(targetManifest, now);
      assertSourceContext(context, LIVE_HISTORY_OBSERVATION_CAPABILITY);
      return {
        status: "validated",
        targetManifest: manifest,
        sourceContext: { ...context },
        observations: matchCreatorLiveHistoryObservations(observations, manifest),
      };
    },
  };
}
