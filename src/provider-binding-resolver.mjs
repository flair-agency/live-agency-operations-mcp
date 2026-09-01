import { readFile } from "node:fs/promises";

import * as z from "zod/v4";

import { AuthoritySchema, DomainNameSchema } from "./domain-contracts.mjs";

export class BindingProfileResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BindingProfileResolutionError";
    this.code = code;
  }
}

export const ProviderBindingRouteSchema = z.object({
  capability: z.string().regex(/^[-a-z0-9]+\/v\d+$/),
  inputKind: z.string().min(1),
  packageName: z.string().min(1),
  bindingId: z.string().min(1),
});

export const ProviderBindingProfileSchema = z.object({
  profileId: z.string().min(1),
  domain: DomainNameSchema,
  authority: AuthoritySchema,
  routes: z.array(ProviderBindingRouteSchema).min(1),
});

export async function loadProviderBindingProfiles(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    throw new TypeError("provider binding profile path is required");
  }
  const value = JSON.parse(await readFile(filePath, "utf8"));
  return z.array(ProviderBindingProfileSchema).min(1).parse(value);
}

export function resolveProviderBindingProfile(profiles, { profileId, domain, authority }) {
  const matches = profiles.filter((profile) => profile.profileId === profileId);
  if (matches.length === 0) {
    throw new BindingProfileResolutionError(
      "BINDING_PROFILE_NOT_FOUND",
      `Provider Binding Profile was not found: ${profileId}`,
    );
  }
  if (matches.length > 1) {
    throw new BindingProfileResolutionError(
      "BINDING_PROFILE_AMBIGUOUS",
      `Provider Binding Profile is duplicated: ${profileId}`,
    );
  }
  const profile = ProviderBindingProfileSchema.parse(matches[0]);
  if (profile.domain !== domain || profile.authority !== authority) {
    throw new BindingProfileResolutionError(
      "BINDING_PROFILE_SCOPE_MISMATCH",
      `Provider Binding Profile ${profileId} is not authorized for ${domain}/${authority}`,
    );
  }
  return profile;
}

export function createProfiledProviderResolver({ profile, resolveProvider }) {
  const parsedProfile = ProviderBindingProfileSchema.parse(profile);
  if (typeof resolveProvider !== "function") throw new TypeError("resolveProvider is required");

  return async function resolveProfiledProvider({ providers, capability, request, unattended }) {
    const routes = parsedProfile.routes.filter(
      (route) => route.capability === capability && route.inputKind === request?.inputKind,
    );
    if (routes.length === 0) {
      throw new BindingProfileResolutionError(
        "BINDING_ROUTE_NOT_FOUND",
        `No Provider Binding route exists for ${capability} and ${request?.inputKind}`,
      );
    }
    if (routes.length > 1) {
      throw new BindingProfileResolutionError(
        "BINDING_ROUTE_AMBIGUOUS",
        `More than one Provider Binding route exists for ${capability} and ${request?.inputKind}`,
      );
    }

    const [route] = routes;
    const exact = providers.filter(
      (provider) =>
        provider.packageName === route.packageName && provider.bindingId === route.bindingId,
    );
    if (exact.length === 0) {
      throw new BindingProfileResolutionError(
        "PROFILED_PROVIDER_NOT_INSTALLED",
        `Configured Provider Binding is not installed for route ${capability}/${request.inputKind}`,
      );
    }
    if (exact.length > 1) {
      throw new BindingProfileResolutionError(
        "PROFILED_PROVIDER_AMBIGUOUS",
        `Configured Provider Binding resolves to more than one installed descriptor`,
      );
    }

    return resolveProvider({
      providers: exact,
      capability,
      request,
      unattended,
    });
  };
}
