import * as z from "zod/v4";

export const SourceContextSchema = z.object({
  capability: z.string().min(1),
  providerFamily: z.string().min(1).nullable().optional(),
  providerPackage: z.string().min(1),
  providerVersion: z.string().min(1),
  bindingId: z.string().min(1),
  knowledgeVersion: z.string().min(1).nullable(),
});

export const ActivitySnapshotSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  sourceUpdatedAt: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  creators: z.array(
    z.object({
      accountKey: z.string().min(1),
      diamonds: z.number().int().nonnegative(),
      effectiveLiveDays: z.number().int().nonnegative(),
      liveMinutes: z.number().int().nonnegative(),
    }),
  ),
});

export const ActivitySourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("markdown"),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    sourceUpdatedAt: z.string().min(1),
    expectedRowCount: z.number().int().positive(),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal("xlsx"),
    filePath: z.string().min(1),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  }),
]);

export const ActivityObservationRequestSchema = z.object({
  version: z.literal(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetMode: z.enum(["complete", "selected"]),
  accountKeys: z.array(z.string().min(1)).default([]),
  generatedAt: z.string().min(1).optional(),
  accountKeysSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const CompleteActivityObservationRequestSchema = z.object({
  version: z.literal(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetMode: z.enum(["complete", "selected"]),
  accountKeys: z.array(z.string().min(1)),
  generatedAt: z.string().min(1),
  accountKeysSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const TargetRowSchema = z.object({
  creatorRecordId: z.string().min(1),
  accountKey: z.string().min(1),
});

export const TargetManifestSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1).optional(),
  targetMode: z.enum(["due", "selected", "all"]),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(TargetRowSchema),
  rowsSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const CompleteTargetManifestSchema = TargetManifestSchema.extend({
  generatedAt: z.string().min(1),
  rowsSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const AvatarSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  name: z.string().min(1),
  mimeType: z.string().startsWith("image/"),
});

export const InvitationCreatorSchema = z.object({
  accountKey: z.string().min(1),
  state: z.string().min(1),
  externalUserId: z.string().optional(),
  nickname: z.string().optional(),
  avatar: AvatarSchema.nullable().optional(),
});

export const InvitationObservationsSchema = z.object({
  observedAt: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  creators: z.array(InvitationCreatorSchema),
});

export const MatchedInvitationObservationsSchema = InvitationObservationsSchema.extend({
  creators: z.array(
    InvitationCreatorSchema.extend({
      creatorRecordId: z.string().min(1),
    }),
  ),
});

export const ReadCreatorActivityOutputSchema = z.object({
  status: z.literal("ok"),
  snapshot: ActivitySnapshotSchema,
  sourceContext: SourceContextSchema,
});

export const ObserveCreatorActivityOutputSchema = z.object({
  status: z.enum(["interaction_required", "completed"]),
  request: CompleteActivityObservationRequestSchema,
  sourceContext: SourceContextSchema,
  instructions: z.string().min(1).optional(),
  snapshot: ActivitySnapshotSchema.optional(),
});

export const ValidateCreatorActivityOutputSchema = z.object({
  status: z.literal("validated"),
  request: CompleteActivityObservationRequestSchema,
  sourceContext: SourceContextSchema,
  snapshot: ActivitySnapshotSchema,
});

export const ObserveInvitationStatusOutputSchema = z.object({
  status: z.enum(["interaction_required", "completed"]),
  targetManifest: CompleteTargetManifestSchema,
  sourceContext: SourceContextSchema,
  instructions: z.string().min(1).optional(),
  observations: MatchedInvitationObservationsSchema.optional(),
});

export const ValidateInvitationStatusOutputSchema = z.object({
  status: z.literal("validated"),
  targetManifest: CompleteTargetManifestSchema,
  sourceContext: SourceContextSchema,
  observations: MatchedInvitationObservationsSchema,
});
