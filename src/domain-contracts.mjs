import { createHash } from "node:crypto";

import * as z from "zod/v4";

import {
  ObserveCreatorActivityOutputSchema,
  ObserveInvitationStatusOutputSchema,
  ReadCreatorActivityOutputSchema,
  ValidateCreatorActivityOutputSchema,
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
export const ManagementReadCreatorActivityOutputSchema = withAudit(
  ReadCreatorActivityOutputSchema,
);
export const ManagementObserveCreatorActivityOutputSchema = withAudit(
  ObserveCreatorActivityOutputSchema,
);
export const ManagementValidateCreatorActivityOutputSchema = withAudit(
  ValidateCreatorActivityOutputSchema,
);
