import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ScoutingObserveCreatorLiveHistoryOutputSchema,
  ScoutingObserveCreatorProfileOutputSchema,
  ScoutingObserveInvitationEligibilityOutputSchema,
  ScoutingValidateCreatorLiveHistoryOutputSchema,
  ScoutingValidateCreatorProfileOutputSchema,
  ScoutingValidateInvitationEligibilityOutputSchema,
  createReadAuditContext,
} from "./domain-contracts.mjs";
import { READ_ONLY_INTERACTIVE, READ_ONLY_LOCAL, safeTool } from "./mcp-support.mjs";
import {
  InvitationObservationsSchema,
  LiveHistoryObservationsSchema,
  ProfileObservationsSchema,
  SourceContextSchema,
  TargetManifestSchema,
} from "./schemas.mjs";

export const CREATOR_SCOUTING_SERVER_INSTRUCTIONS = `This is the read-only Creator Scouting MCP v2 acquisition surface.

It prepares and validates public-profile, LIVE-history, and invitation-eligibility observations for prospective creators. It never sends messages, follows creators, sends gifts, submits invitations, changes relationships, or writes to Lark. Those authorities are not available in this process.

When an observe tool returns interaction_required, use the returned private instructions only in the user-selected authenticated session. Preserve the exact targetManifest and sourceContext, collect exactly one observation per requested account, and then call the matching validation tool. Stop instead of guessing when authentication, account, schema, coverage, or provider selection is ambiguous.`;

const DOMAIN = "creator-scouting";

function audited(tool, handler) {
  return safeTool(async (input) => {
    const result = await handler(input);
    return { ...result, auditContext: createReadAuditContext(DOMAIN, tool, input, result) };
  }, (input) => createReadAuditContext(DOMAIN, tool, input));
}

export function createCreatorScoutingMcpServer({ runtime }) {
  if (!runtime) throw new TypeError("runtime is required");
  const server = new McpServer(
    { name: "creator-scouting", version: "0.3.0" },
    { instructions: CREATOR_SCOUTING_SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "observe_creator_profiles",
    {
      title: "Observe creator public profiles",
      description:
        "Resolve a read-only public-profile provider for an exact target manifest. This tool returns normalized source observations or bounded interactive instructions and never writes to Lark.",
      inputSchema: { targetManifest: TargetManifestSchema },
      outputSchema: ScoutingObserveCreatorProfileOutputSchema,
      annotations: READ_ONLY_INTERACTIVE,
    },
    audited("observe_creator_profiles", (input) => runtime.observeCreatorProfiles(input)),
  );

  server.registerTool(
    "validate_creator_profile_observations",
    {
      title: "Validate creator profile observations",
      description:
        "Validate one normalized public-profile observation per exact requested account and reject changed identity or coverage.",
      inputSchema: {
        targetManifest: TargetManifestSchema,
        sourceContext: SourceContextSchema,
        observations: ProfileObservationsSchema,
      },
      outputSchema: ScoutingValidateCreatorProfileOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    audited("validate_creator_profile_observations", (input) =>
      runtime.validateCreatorProfileObservations(input),
    ),
  );

  server.registerTool(
    "observe_creator_live_history",
    {
      title: "Observe creator LIVE history",
      description:
        "Resolve a read-only LIVE-history provider for an exact target manifest. The profile history contains completed sessions only; repeated scans are matched by exact session start time within each account.",
      inputSchema: { targetManifest: TargetManifestSchema },
      outputSchema: ScoutingObserveCreatorLiveHistoryOutputSchema,
      annotations: READ_ONLY_INTERACTIVE,
    },
    audited("observe_creator_live_history", (input) =>
      runtime.observeCreatorLiveHistory(input),
    ),
  );

  server.registerTool(
    "validate_creator_live_history_observations",
    {
      title: "Validate creator LIVE-history observations",
      description:
        "Validate one normalized completed LIVE-history observation per exact requested account. This validation does not write or produce a daily aggregate.",
      inputSchema: {
        targetManifest: TargetManifestSchema,
        sourceContext: SourceContextSchema,
        observations: LiveHistoryObservationsSchema,
      },
      outputSchema: ScoutingValidateCreatorLiveHistoryOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    audited("validate_creator_live_history_observations", (input) =>
      runtime.validateCreatorLiveHistoryObservations(input),
    ),
  );

  server.registerTool(
    "observe_creator_invitation_eligibility",
    {
      title: "Observe creator invitation eligibility",
      description:
        "Resolve a read-only provider for an exact candidate target manifest. This tool observes eligibility only and never activates an invitation, follow, or message control.",
      inputSchema: { targetManifest: TargetManifestSchema },
      outputSchema: ScoutingObserveInvitationEligibilityOutputSchema,
      annotations: READ_ONLY_INTERACTIVE,
    },
    audited("observe_creator_invitation_eligibility", (input) =>
      runtime.observeCreatorInvitationStatus(input),
    ),
  );

  server.registerTool(
    "validate_creator_invitation_eligibility_observations",
    {
      title: "Validate creator invitation-eligibility observations",
      description:
        "Validate one normalized eligibility observation per exact requested account and reject missing, duplicate, or unrequested creators.",
      inputSchema: {
        targetManifest: TargetManifestSchema,
        sourceContext: SourceContextSchema,
        observations: InvitationObservationsSchema,
      },
      outputSchema: ScoutingValidateInvitationEligibilityOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    audited("validate_creator_invitation_eligibility_observations", (input) =>
      runtime.validateCreatorInvitationStatus(input),
    ),
  );

  return server;
}
