import { createHash } from "node:crypto";

import * as z from "zod/v4";

import {
  ObserveCreatorActivityOutputSchema,
  ObserveCreatorLiveHistoryOutputSchema,
  ObserveCreatorProfileOutputSchema,
  ObserveInvitationStatusOutputSchema,
  ReadCreatorActivityOutputSchema,
  ValidateCreatorActivityOutputSchema,
  ValidateCreatorLiveHistoryOutputSchema,
  ValidateCreatorProfileOutputSchema,
  ValidateInvitationStatusOutputSchema,
} from "./schemas.mjs";

export const DOMAIN_CONTRACT_VERSION = 2;

export const DomainNameSchema = z.enum([
  "creator-scouting",
  "creator-management",
  "agency-intelligence",
]);

export const AuthoritySchema = z.enum(["read", "write", "action"]);

export const ProviderBindingRefSchema = z.object({
  providerFamily: z.string().min(1).nullable(),
  packageName: z.string().min(1),
  packageVersion: z.string().min(1),
  bindingId: z.string().min(1),
  knowledgeVersion: z.string().min(1).nullable(),
});

export const PlatformAccountReferenceSchema = z.object({
  platform: z.literal("tiktok"),
  username: z.string().min(1),
  platformUserId: z.string().min(1).nullable().optional(),
});

export const AccountObservationSubjectSchema = z.object({
  version: z.literal(DOMAIN_CONTRACT_VERSION),
  accountReference: PlatformAccountReferenceSchema,
});

export const InstanceProfileRefSchema = z.object({
  profileId: z.string().min(1),
  tenant: z.enum(["creator-networks", "flair"]),
  authority: z.enum(["read", "write"]),
  serviceCapabilityProfileId: z.string().min(1),
  schemaVersion: z.string().min(1),
  knowledgeVersion: z.string().min(1),
});

export const EvidenceRefSchema = z.object({
  evidenceId: z.string().uuid(),
  kind: z.enum(["api-response", "export", "screenshot", "manual-observation"]),
  capturedAt: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mediaType: z.string().min(1),
});

const ObservedAtSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
    "observedAt must be an ISO date-time with an explicit timezone",
  )
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "observedAt must be a real date-time",
  });

export const AccountIdentityEvidenceObservationSchema = z.object({
  observedAt: ObservedAtSchema,
  accountReference: PlatformAccountReferenceSchema,
  nickname: z.string().min(1).nullable(),
  avatarSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  evidence: z.array(EvidenceRefSchema).min(1),
});

export const KnownScoutingAccountEvidenceSchema = z.object({
  creatorRecordId: z.string().min(1),
  currentObservation: AccountIdentityEvidenceObservationSchema,
  historicalObservations: z.array(AccountIdentityEvidenceObservationSchema),
});

export const AccountEvidenceReviewPurposeSchema = z.enum([
  "duplicate-check",
  "username-change",
]);

export const AccountEvidenceSignalSchema = z.object({
  kind: z.enum([
    "current-username-exact",
    "historical-username-exact",
    "platform-user-id-exact",
    "avatar-sha256-exact",
    "nickname-exact",
  ]),
  targetObservedAt: ObservedAtSchema,
  knownObservedAt: ObservedAtSchema.nullable(),
  targetEvidenceIds: z.array(z.string().uuid()),
  knownEvidenceIds: z.array(z.string().uuid()),
});

export const AccountEvidenceCandidateSchema = z.object({
  creatorRecordId: z.string().min(1),
  currentUsername: z.string().min(1),
  disposition: z.enum([
    "same-current-username",
    "known-historical-username",
    "possible-username-change",
    "supporting-profile-evidence-only",
  ]),
  evidenceGrade: z.enum([
    "direct-account-reference",
    "corroborated-profile-evidence",
    "profile-evidence-hint",
  ]),
  signals: z.array(AccountEvidenceSignalSchema).min(1),
});

export const AccountEvidenceConflictSchema = z.object({
  code: z.enum([
    "current-username-maps-to-multiple-records",
    "platform-user-id-maps-to-multiple-records",
    "username-and-platform-user-id-disagree",
    "record-has-conflicting-platform-user-ids",
    "username-match-conflicts-with-platform-user-id",
  ]),
  creatorRecordIds: z.array(z.string().min(1)).min(1),
  detail: z.string().min(1),
});

export const AccountEvidenceReviewOutputSchema = z.object({
  status: z.enum(["no-candidate", "review-required", "conflict"]),
  purpose: AccountEvidenceReviewPurposeSchema,
  target: AccountIdentityEvidenceObservationSchema,
  candidates: z.array(AccountEvidenceCandidateSchema),
  conflicts: z.array(AccountEvidenceConflictSchema),
  decisionBoundary: z.object({
    automaticMutationAllowed: z.literal(false),
    actorIdentityAsserted: z.literal(false),
    recommendation: z.enum(["none", "manual-account-review"]),
  }),
});

export const UnavailableFieldSchema = z.object({
  field: z.string().min(1),
  reason: z.enum([
    "not-exposed",
    "not-observed",
    "not-applicable",
    "permission-denied",
    "source-drift",
  ]),
  detail: z.string().min(1).optional(),
});

export const ObservationEnvelopeSchema = z.object({
  contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
  observationId: z.string().uuid(),
  observedAt: z.string().min(1),
  subject: AccountObservationSubjectSchema,
  providerBinding: ProviderBindingRefSchema,
  evidence: z.array(EvidenceRefSchema),
  unavailableFields: z.array(UnavailableFieldSchema),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const DomainAuditContextSchema = z.object({
  contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
  domain: DomainNameSchema,
  authority: AuthoritySchema,
  tool: z.string().min(1),
  requestId: z.string().uuid(),
  requestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  interaction: z.enum(["local", "interactive", "unattended"]),
  targetCount: z.number().int().nonnegative().nullable(),
  observedCount: z.number().int().nonnegative().nullable(),
  providerBinding: ProviderBindingRefSchema.optional(),
  instanceProfile: InstanceProfileRefSchema.optional(),
});

export const MutationSchema = z.object({
  operation: z.enum(["create", "update", "delete"]),
  tableId: z.string().min(1),
  recordId: z.string().min(1).optional(),
  mutationKey: z.string().min(1),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const WriteIntentSchema = z.object({
  contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
  intentId: z.string().uuid(),
  domain: DomainNameSchema,
  authority: z.literal("write"),
  instanceProfile: InstanceProfileRefSchema.extend({ authority: z.literal("write") }),
  preparedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  mutations: z.array(MutationSchema).min(1),
  intentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const WriteApprovalSchema = z.object({
  intentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  approvedBy: z.string().min(1),
  approvedAt: z.string().min(1),
});

export const ReadbackResultSchema = z.object({
  contractVersion: z.literal(DOMAIN_CONTRACT_VERSION),
  intentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["verified", "mismatch", "outcome-unknown"]),
  verifiedAt: z.string().min(1),
  expectedMutationCount: z.number().int().nonnegative(),
  verifiedMutationCount: z.number().int().nonnegative(),
  discrepancies: z.array(z.string().min(1)),
});

export const ErrorEnvelopeSchema = z.object({
  status: z.literal("error"),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  auditContext: DomainAuditContextSchema.optional(),
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function sha256CanonicalJson(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function requestIdFromHash(hash) {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars
    .slice(12, 16)
    .join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20).join("")}`;
}

function targetCount(input) {
  if (input?.target) return 1;
  if (Number.isInteger(input?.targetManifest?.rowCount)) return input.targetManifest.rowCount;
  if (Number.isInteger(input?.source?.expectedRowCount)) return input.source.expectedRowCount;
  if (input?.request?.targetMode === "selected" && Array.isArray(input.request.accountKeys)) {
    return input.request.accountKeys.length;
  }
  return null;
}

function observedCount(result) {
  if (Number.isInteger(result?.observations?.rowCount)) return result.observations.rowCount;
  if (Number.isInteger(result?.snapshot?.rowCount)) return result.snapshot.rowCount;
  return null;
}

function bindingRef(result) {
  const context = result?.sourceContext;
  if (!context) return undefined;
  return {
    providerFamily: context.providerFamily ?? null,
    packageName: context.providerPackage,
    packageVersion: context.providerVersion,
    bindingId: context.bindingId,
    knowledgeVersion: context.knowledgeVersion,
  };
}

export function createReadAuditContext(domain, tool, input, result) {
  const parsedDomain = DomainNameSchema.parse(domain);
  if (parsedDomain === "agency-intelligence") {
    throw new TypeError("agency-intelligence is not exposed by this acquisition MCP");
  }
  const requestSha256 = sha256CanonicalJson(input);
  return {
    contractVersion: DOMAIN_CONTRACT_VERSION,
    domain: parsedDomain,
    authority: "read",
    tool,
    requestId: requestIdFromHash(requestSha256),
    requestSha256,
    interaction: result?.status === "interaction_required" ? "interactive" : "local",
    targetCount: targetCount(input),
    observedCount: observedCount(result),
    ...(bindingRef(result) ? { providerBinding: bindingRef(result) } : {}),
  };
}

function withAudit(schema) {
  return schema.extend({ auditContext: DomainAuditContextSchema });
}

export const ScoutingObserveInvitationEligibilityOutputSchema = withAudit(
  ObserveInvitationStatusOutputSchema,
);
export const ScoutingValidateInvitationEligibilityOutputSchema = withAudit(
  ValidateInvitationStatusOutputSchema,
);
export const ScoutingObserveCreatorProfileOutputSchema = withAudit(
  ObserveCreatorProfileOutputSchema,
);
export const ScoutingValidateCreatorProfileOutputSchema = withAudit(
  ValidateCreatorProfileOutputSchema,
);
export const ScoutingObserveCreatorLiveHistoryOutputSchema = withAudit(
  ObserveCreatorLiveHistoryOutputSchema,
);
export const ScoutingValidateCreatorLiveHistoryOutputSchema = withAudit(
  ValidateCreatorLiveHistoryOutputSchema,
);
export const ScoutingReviewAccountEvidenceOutputSchema = withAudit(
  AccountEvidenceReviewOutputSchema,
);
export const ManagementReadCreatorActivityOutputSchema = withAudit(
  ReadCreatorActivityOutputSchema,
);
export const ManagementObserveCreatorActivityOutputSchema = withAudit(
  ObserveCreatorActivityOutputSchema,
);
export const ManagementValidateCreatorActivityOutputSchema = withAudit(
  ValidateCreatorActivityOutputSchema,
);
