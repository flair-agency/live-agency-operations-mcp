import * as z from "zod/v4";

import { AuthoritySchema, DomainNameSchema } from "./domain-contracts.mjs";

export class AuthorityProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthorityProfileError";
    this.code = code;
  }
}

export const AuthorityLaunchProfileSchema = z
  .object({
    profileId: z.string().min(1),
    domain: DomainNameSchema,
    authority: AuthoritySchema,
    processName: z.string().min(1),
    auditIdentity: z.string().min(1),
    credentialRefs: z.array(z.string().min(1)).min(1),
    providerBindingProfileId: z.string().min(1).optional(),
    instanceProfileId: z.string().min(1).optional(),
  })
  .superRefine((profile, context) => {
    if (profile.authority === "read" && !profile.providerBindingProfileId) {
      context.addIssue({
        code: "custom",
        path: ["providerBindingProfileId"],
        message: "read authority requires a Provider Binding Profile",
      });
    }
    if (profile.authority === "write" && !profile.instanceProfileId) {
      context.addIssue({
        code: "custom",
        path: ["instanceProfileId"],
        message: "write authority requires a Lark Instance Profile",
      });
    }
    if (profile.authority === "action" && !profile.providerBindingProfileId) {
      context.addIssue({
        code: "custom",
        path: ["providerBindingProfileId"],
        message: "action authority requires a Provider Binding Profile",
      });
    }
  });

export function validateAuthorityIsolation(profileValues) {
  const profiles = z.array(AuthorityLaunchProfileSchema).min(1).parse(profileValues);
  const profileIds = new Set();
  const processNames = new Set();
  const auditIdentities = new Set();
  const credentialOwners = new Map();

  for (const profile of profiles) {
    for (const [value, seen, code, label] of [
      [profile.profileId, profileIds, "AUTHORITY_PROFILE_DUPLICATED", "profile ID"],
      [profile.processName, processNames, "AUTHORITY_PROCESS_SHARED", "process name"],
      [profile.auditIdentity, auditIdentities, "AUTHORITY_AUDIT_IDENTITY_SHARED", "audit identity"],
    ]) {
      if (seen.has(value)) {
        throw new AuthorityProfileError(code, `Authority ${label} is shared: ${value}`);
      }
      seen.add(value);
    }

    for (const credentialRef of profile.credentialRefs) {
      const owner = credentialOwners.get(credentialRef);
      if (owner) {
        throw new AuthorityProfileError(
          "AUTHORITY_CREDENTIAL_SHARED",
          `Credential reference ${credentialRef} is shared by ${owner} and ${profile.profileId}`,
        );
      }
      credentialOwners.set(credentialRef, profile.profileId);
    }
  }
  return profiles;
}
