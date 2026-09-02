import assert from "node:assert/strict";
import test from "node:test";

import {
  createProfiledProviderResolver,
  resolveProviderBindingProfile,
} from "../src/provider-binding-resolver.mjs";
import {
  resolveLarkInstanceProfile,
  toInstanceProfileRef,
} from "../src/instance-profile-resolver.mjs";

const route = {
  capability: "creator-activity-source/v1",
  inputKind: "application/x.synthetic+json",
  packageName: "@synthetic/provider",
  bindingId: "activity",
};

const bindingProfile = {
  profileId: "creator-management-read",
  domain: "creator-management",
  authority: "read",
  routes: [route],
};

test("Provider Binding Profile resolution requires exact id, domain, and authority", () => {
  assert.equal(
    resolveProviderBindingProfile([bindingProfile], {
      profileId: "creator-management-read",
      domain: "creator-management",
      authority: "read",
    }).routes[0].bindingId,
    "activity",
  );
  assert.throws(
    () =>
      resolveProviderBindingProfile([bindingProfile], {
        profileId: "missing",
        domain: "creator-management",
        authority: "read",
      }),
    (error) => error.code === "BINDING_PROFILE_NOT_FOUND",
  );
  assert.throws(
    () =>
      resolveProviderBindingProfile([bindingProfile], {
        profileId: "creator-management-read",
        domain: "creator-scouting",
        authority: "read",
      }),
    (error) => error.code === "BINDING_PROFILE_SCOPE_MISMATCH",
  );
});

test("profiled provider routing does not fall back to another installed binding", async () => {
  const configured = {
    packageName: "@synthetic/provider",
    bindingId: "activity",
    manifest: { provides: [route.capability] },
  };
  const fallback = {
    packageName: "@synthetic/fallback",
    bindingId: "activity",
    manifest: { provides: [route.capability] },
  };
  let delegatedProviders;
  const resolve = createProfiledProviderResolver({
    profile: bindingProfile,
    async resolveProvider(input) {
      delegatedProviders = input.providers;
      return input.providers[0];
    },
  });

  assert.equal(
    await resolve({
      providers: [fallback, configured],
      capability: route.capability,
      request: { inputKind: route.inputKind },
      unattended: false,
    }),
    configured,
  );
  assert.deepEqual(delegatedProviders, [configured]);

  await assert.rejects(
    resolve({
      providers: [fallback],
      capability: route.capability,
      request: { inputKind: route.inputKind },
      unattended: false,
    }),
    (error) => error.code === "PROFILED_PROVIDER_NOT_INSTALLED",
  );
});

test("duplicate Provider Binding routes and descriptors fail closed", async () => {
  const duplicateRouteResolver = createProfiledProviderResolver({
    profile: { ...bindingProfile, routes: [route, { ...route }] },
    async resolveProvider() {
      throw new Error("must not delegate");
    },
  });
  await assert.rejects(
    duplicateRouteResolver({
      providers: [],
      capability: route.capability,
      request: { inputKind: route.inputKind },
      unattended: false,
    }),
    (error) => error.code === "BINDING_ROUTE_AMBIGUOUS",
  );

  const descriptorResolver = createProfiledProviderResolver({
    profile: bindingProfile,
    async resolveProvider() {
      throw new Error("must not delegate");
    },
  });
  const descriptor = {
    packageName: route.packageName,
    bindingId: route.bindingId,
  };
  await assert.rejects(
    descriptorResolver({
      providers: [descriptor, { ...descriptor }],
      capability: route.capability,
      request: { inputKind: route.inputKind },
      unattended: false,
    }),
    (error) => error.code === "PROFILED_PROVIDER_AMBIGUOUS",
  );
});

const readInstanceProfile = {
  profileId: "flair-creator-management-read",
  domain: "creator-management",
  tenant: "flair",
  authority: "read",
  baseId: "synthetic-base-id",
  credentialRef: "env:SYNTHETIC_LARK_READ_CREDENTIAL",
  serviceCapabilityProfileId: "synthetic-flair-capabilities",
  schemaVersion: "creator-management/v2",
  schemaFingerprint: "b".repeat(64),
  knowledgeVersion: "2026-09-02.1",
  tables: { creators: "synthetic-creator-table-id" },
};

test("Lark Instance Profile resolution never falls back across domain or authority", () => {
  const resolved = resolveLarkInstanceProfile([readInstanceProfile], {
    profileId: "flair-creator-management-read",
    domain: "creator-management",
    tenant: "flair",
    authority: "read",
  });
  assert.deepEqual(toInstanceProfileRef(resolved), {
    profileId: "flair-creator-management-read",
    tenant: "flair",
    authority: "read",
    serviceCapabilityProfileId: "synthetic-flair-capabilities",
    schemaVersion: "creator-management/v2",
    knowledgeVersion: "2026-09-02.1",
  });

  for (const request of [
    {
      profileId: "flair-creator-management-read",
      domain: "creator-scouting",
      tenant: "flair",
      authority: "read",
    },
    {
      profileId: "flair-creator-management-read",
      domain: "creator-management",
      tenant: "flair",
      authority: "write",
    },
    {
      profileId: "flair-creator-management-read",
      domain: "creator-management",
      tenant: "creator-networks",
      authority: "read",
    },
  ]) {
    assert.throws(
      () => resolveLarkInstanceProfile([readInstanceProfile], request),
      (error) => error.code === "INSTANCE_PROFILE_SCOPE_MISMATCH",
    );
  }
});

test("missing and duplicate Lark Instance Profiles fail closed", () => {
  assert.throws(
    () =>
      resolveLarkInstanceProfile([], {
        profileId: readInstanceProfile.profileId,
        domain: "creator-management",
        tenant: "flair",
        authority: "read",
      }),
    (error) => error.code === "INSTANCE_PROFILE_NOT_FOUND",
  );
  assert.throws(
    () =>
      resolveLarkInstanceProfile([readInstanceProfile, { ...readInstanceProfile }], {
        profileId: readInstanceProfile.profileId,
        domain: "creator-management",
        tenant: "flair",
        authority: "read",
      }),
    (error) => error.code === "INSTANCE_PROFILE_AMBIGUOUS",
  );
});
