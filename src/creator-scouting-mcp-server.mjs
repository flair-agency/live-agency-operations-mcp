import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ScoutingObserveInvitationEligibilityOutputSchema,
  ScoutingValidateInvitationEligibilityOutputSchema,
  createReadAuditContext,
} from "./domain-contracts.mjs";
import { READ_ONLY_INTERACTIVE, READ_ONLY_LOCAL, safeTool } from "./mcp-support.mjs";
import {
  InvitationObservationsSchema,
  SourceContextSchema,
  TargetManifestSchema,
} from "./schemas.mjs";

export const CREATOR_SCOUTING_SERVER_INSTRUCTIONS = `This is the read-only Creator Scouting MCP v2 acquisition surface.

It prepares and validates invitation-eligibility observations for prospective creators. It never sends messages, follows creators, sends gifts, submits invitations, changes relationships, or writes to Lark. Those authorities are not available in this process.

When observe_creator_invitation_eligibility returns interaction_required, use the returned private instructions only in the user-selected authenticated session. Preserve the exact targetManifest and sourceContext, collect exactly one observation per requested account, and then call validate_creator_invitation_eligibility_observations. Stop instead of guessing when authentication, account, schema, coverage, or provider selection is ambiguous.`;

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
