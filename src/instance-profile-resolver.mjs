import { readFile } from "node:fs/promises";

import * as z from "zod/v4";

import { DomainNameSchema } from "./domain-contracts.mjs";

export class InstanceProfileResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InstanceProfileResolutionError";
    this.code = code;
  }
}

const ImmutableIdSchema = z.string().min(1);

export const LarkInstanceProfileSchema = z.object({
  profileId: z.string().min(1),
  domain: DomainNameSchema,
  tenant: z.enum(["creator-networks", "flair"]),
  authority: z.enum(["read", "write"]),
  baseId: ImmutableIdSchema,
  credentialRef: z.string().min(1),
  serviceCapabilityProfileId: z.string().min(1),
  schemaVersion: z.string().min(1),
  schemaFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  knowledgeVersion: z.string().min(1),
  tables: z.record(z.string().min(1), ImmutableIdSchema),
});

export async function loadLarkInstanceProfiles(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    throw new TypeError("Lark Instance Profile path is required");
  }
  const value = JSON.parse(await readFile(filePath, "utf8"));
  return z.array(LarkInstanceProfileSchema).min(1).parse(value);
}

export function resolveLarkInstanceProfile(
  profiles,
  { profileId, domain, tenant, authority },
) {
  const matches = profiles.filter((profile) => profile.profileId === profileId);
  if (matches.length === 0) {
    throw new InstanceProfileResolutionError(
      "INSTANCE_PROFILE_NOT_FOUND",
      `Lark Instance Profile was not found: ${profileId}`,
    );
  }
  if (matches.length > 1) {
    throw new InstanceProfileResolutionError(
      "INSTANCE_PROFILE_AMBIGUOUS",
      `Lark Instance Profile is duplicated: ${profileId}`,
    );
  }
  const profile = LarkInstanceProfileSchema.parse(matches[0]);
  if (
    profile.domain !== domain ||
    profile.tenant !== tenant ||
    profile.authority !== authority
  ) {
    throw new InstanceProfileResolutionError(
      "INSTANCE_PROFILE_SCOPE_MISMATCH",
      `Lark Instance Profile ${profileId} is not authorized for ${domain}/${tenant}/${authority}`,
    );
  }
  return profile;
}

export function toInstanceProfileRef(profile) {
  const parsed = LarkInstanceProfileSchema.parse(profile);
  return {
    profileId: parsed.profileId,
    tenant: parsed.tenant,
    authority: parsed.authority,
    serviceCapabilityProfileId: parsed.serviceCapabilityProfileId,
    schemaVersion: parsed.schemaVersion,
    knowledgeVersion: parsed.knowledgeVersion,
  };
}
