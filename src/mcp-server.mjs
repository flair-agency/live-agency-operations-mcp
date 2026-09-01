import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ActivityObservationRequestSchema,
  ActivitySnapshotSchema,
  ActivitySourceSchema,
  InvitationObservationsSchema,
  ObserveCreatorActivityOutputSchema,
  ObserveInvitationStatusOutputSchema,
  ReadCreatorActivityOutputSchema,
  SourceContextSchema,
  TargetManifestSchema,
  ValidateCreatorActivityOutputSchema,
  ValidateInvitationStatusOutputSchema,
} from "./schemas.mjs";

export const SERVER_INSTRUCTIONS = `This server exposes source-neutral LIVE agency operations.

Phase 1 is read-only. It can normalize acquired creator activity, prepare or validate interactive creator-activity observations, and prepare or validate creator invitation-eligibility observations. It never authorizes invitations, follows, messages, relationship changes, or destination writes.

When observe_creator_activity returns interaction_required, use the returned private instructions only with the user-selected authenticated browser session. Preserve the returned request and sourceContext, observe the exact month and coverage, then call validate_creator_activity_observations. Stop instead of guessing when authentication, account, month, schema, result coverage, update time, or provider selection is ambiguous.

When observe_creator_invitation_status returns interaction_required, use the returned private instructions only with the user-selected authenticated browser session. Preserve the returned targetManifest and sourceContext, collect exactly one observation per requested account, then call validate_creator_invitation_status_observations. Stop instead of guessing when authentication, account, schema, result coverage, or provider selection is ambiguous.`;

function success(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorCode(error) {
  if (typeof error?.code === "string" && error.code) return error.code;
  if (error instanceof TypeError) return "INVALID_INPUT_OR_SOURCE";
  return "MCP_OPERATION_FAILED";
}

function failure(error) {
  const value = {
    status: "error",
    error: {
      code: errorCode(error),
      message: error instanceof Error ? error.message : "Unknown MCP operation failure",
    },
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function safeTool(handler) {
  return async (input) => {
    try {
      return success(await handler(input));
    } catch (error) {
      return failure(error);
    }
  };
}

const READ_ONLY_LOCAL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createMcpServer({ runtime }) {
  if (!runtime) throw new TypeError("runtime is required");
  const server = new McpServer(
    { name: "live-agency-operations", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "read_creator_activity",
    {
      title: "Read creator activity",
      description:
        "Normalize one complete monthly creator-activity source into diamonds, effective LIVE days, and LIVE minutes. Accepts an absolute XLSX path or a complete Markdown table already acquired by the client.",
      inputSchema: { source: ActivitySourceSchema },
      outputSchema: ReadCreatorActivityOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    safeTool((input) => runtime.readCreatorActivity(input)),
  );

  server.registerTool(
    "observe_creator_activity",
    {
      title: "Observe creator activity",
      description:
        "Resolve an installed read-only provider for an exact activity month and complete or selected account scope. A browser-based provider returns private interaction instructions without exposing source-specific knowledge in this MCP.",
      inputSchema: { request: ActivityObservationRequestSchema },
      outputSchema: ObserveCreatorActivityOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safeTool((input) => runtime.observeCreatorActivity(input)),
  );

  server.registerTool(
    "validate_creator_activity_observations",
    {
      title: "Validate creator activity observations",
      description:
        "Validate a normalized activity snapshot against the exact month, account scope, and source context returned by observe_creator_activity.",
      inputSchema: {
        request: ActivityObservationRequestSchema,
        sourceContext: SourceContextSchema,
        snapshot: ActivitySnapshotSchema,
      },
      outputSchema: ValidateCreatorActivityOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    safeTool((input) => runtime.validateCreatorActivity(input)),
  );

  server.registerTool(
    "observe_creator_invitation_status",
    {
      title: "Observe creator invitation status",
      description:
        "Resolve the installed read-only invitation-status provider for one complete target manifest. A browser-based provider returns interaction_required with private instructions; this tool never clicks invite, follow, message, or any relationship-changing control.",
      inputSchema: { targetManifest: TargetManifestSchema },
      outputSchema: ObserveInvitationStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    safeTool((input) => runtime.observeCreatorInvitationStatus(input)),
  );

  server.registerTool(
    "validate_creator_invitation_status_observations",
    {
      title: "Validate creator invitation-status observations",
      description:
        "Validate normalized invitation-status observations against the exact target manifest and source context returned by observe_creator_invitation_status. Rejects missing, duplicate, or unrequested accounts.",
      inputSchema: {
        targetManifest: TargetManifestSchema,
        sourceContext: SourceContextSchema,
        observations: InvitationObservationsSchema,
      },
      outputSchema: ValidateInvitationStatusOutputSchema,
      annotations: READ_ONLY_LOCAL,
    },
    safeTool((input) => runtime.validateCreatorInvitationStatus(input)),
  );

  return server;
}
