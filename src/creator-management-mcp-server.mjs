import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ManagementObserveCreatorActivityOutputSchema,
  ManagementReadCreatorActivityOutputSchema,
  ManagementValidateCreatorActivityOutputSchema,
  createReadAuditContext,
} from "./domain-contracts.mjs";
import { READ_ONLY_INTERACTIVE, READ_ONLY_LOCAL, safeTool } from "./mcp-support.mjs";
import {
  ActivityObservationRequestSchema,
  ActivitySnapshotSchema,
  ActivitySourceSchema,
  SourceContextSchema,
} from "./schemas.mjs";

export const CREATOR_MANAGEMENT_SERVER_INSTRUCTIONS = `This is the read-only Creator Management MCP v2 acquisition surface.

It normalizes, prepares, and validates member activity observations. It never writes to Creator Management Base, reads or writes Creator Scouting Base, sends messages, invites creators, or changes a relationship.

When observe_creator_activity returns interaction_required, use the returned private instructions only in the user-selected authenticated session. Preserve the exact request and sourceContext, observe the requested month and coverage, and then call validate_creator_activity_observations. Stop instead of guessing when authentication, account, month, schema, coverage, update time, or provider selection is ambiguous.`;

const DOMAIN = "creator-management";

function audited(tool, handler) {
  return safeTool(async (input) => {
    const result = await handler(input);
    return { ...result, auditContext: createReadAuditContext(DOMAIN, tool, input, result) };
  }, (input) => createReadAuditContext(DOMAIN, tool, input));
}

export function createCreatorManagementMcpServer({ runtime }) {
  if (!runtime) throw new TypeError("runtime is required");
  const server = new McpServer(
    { name: "creator-management", version: "0.3.0" },
    { instructions: CREATOR_MANAGEMENT_SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "read_creator_activity",
    {
      title: "Read creator activity",
      description:
        "Normalize one complete monthly member-activity source into diamonds, effective LIVE days, and LIVE minutes.",
      inputSchema: { source: ActivitySourceSchema },
      outputSchema: ManagementReadCreatorActivityOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    audited("read_creator_activity", (input) => runtime.readCreatorActivity(input)),
  );

  server.registerTool(
    "observe_creator_activity",
    {
      title: "Observe creator activity",
      description:
        "Resolve a read-only provider for an exact activity month and complete or selected member scope.",
      inputSchema: { request: ActivityObservationRequestSchema },
      outputSchema: ManagementObserveCreatorActivityOutputSchema,
      annotations: READ_ONLY_INTERACTIVE,
    },
    audited("observe_creator_activity", (input) => runtime.observeCreatorActivity(input)),
  );

  server.registerTool(
    "validate_creator_activity_observations",
    {
      title: "Validate creator activity observations",
      description:
        "Validate a normalized member-activity snapshot against the exact month, account scope, and acquisition context.",
      inputSchema: {
        request: ActivityObservationRequestSchema,
        sourceContext: SourceContextSchema,
        snapshot: ActivitySnapshotSchema,
      },
      outputSchema: ManagementValidateCreatorActivityOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    audited("validate_creator_activity_observations", (input) =>
      runtime.validateCreatorActivity(input),
    ),
  );

  return server;
}
