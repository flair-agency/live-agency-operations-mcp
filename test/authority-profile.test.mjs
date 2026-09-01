import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorityLaunchProfileSchema,
  validateAuthorityIsolation,
} from "../src/authority-profile.mjs";

const profiles = [
  {
    profileId: "synthetic-scouting-read",
    domain: "creator-scouting",
    authority: "read",
    processName: "synthetic-creator-scouting-read",
    auditIdentity: "synthetic-audit-scouting-read",
    credentialRefs: ["env:SYNTHETIC_SCOUTING_READ"],
    providerBindingProfileId: "synthetic-scouting-read-bindings",
  },
  {
    profileId: "synthetic-scouting-write",
    domain: "creator-scouting",
    authority: "write",
    processName: "synthetic-creator-scouting-write",
    auditIdentity: "synthetic-audit-scouting-write",
    credentialRefs: ["env:SYNTHETIC_SCOUTING_WRITE"],
    instanceProfileId: "synthetic-scouting-base-write",
  },
  {
    profileId: "synthetic-scouting-action",
    domain: "creator-scouting",
    authority: "action",
    processName: "synthetic-creator-scouting-action",
    auditIdentity: "synthetic-audit-scouting-action",
    credentialRefs: ["env:SYNTHETIC_SCOUTING_ACTION"],
    providerBindingProfileId: "synthetic-scouting-action-bindings",
  },
];

test("read, Lark-write, and BackStage-action launch profiles stay isolated", () => {
  const validated = validateAuthorityIsolation(profiles);
  assert.deepEqual(
    validated.map(({ authority }) => authority),
    ["read", "write", "action"],
  );
});

test("authority profiles require the correct backing profile type", () => {
  assert.throws(
    () =>
      AuthorityLaunchProfileSchema.parse({
        ...profiles[1],
        instanceProfileId: undefined,
      }),
    /write authority requires a Lark Instance Profile/,
  );
  assert.throws(
    () =>
      AuthorityLaunchProfileSchema.parse({
        ...profiles[2],
        providerBindingProfileId: undefined,
      }),
    /action authority requires a Provider Binding Profile/,
  );
});

test("authority profiles reject shared process, audit, and credential identities", () => {
  for (const duplicate of [
    { processName: profiles[0].processName },
    { auditIdentity: profiles[0].auditIdentity },
    { credentialRefs: profiles[0].credentialRefs },
  ]) {
    assert.throws(
      () => validateAuthorityIsolation([profiles[0], { ...profiles[1], ...duplicate }]),
      (error) => error.code.startsWith("AUTHORITY_"),
    );
  }
});
