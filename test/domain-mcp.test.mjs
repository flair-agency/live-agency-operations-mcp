import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  CREATOR_MANAGEMENT_SERVER_INSTRUCTIONS,
  createCreatorManagementMcpServer,
} from "../src/creator-management-mcp-server.mjs";
import {
  CREATOR_SCOUTING_SERVER_INSTRUCTIONS,
  createCreatorScoutingMcpServer,
} from "../src/creator-scouting-mcp-server.mjs";

async function connected(createServer, runtime) {
  const server = createServer({ runtime });
  const client = new Client({ name: "v2-domain-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

function assertReadOnly(tools) {
  assert.equal(tools.every((tool) => tool.annotations?.readOnlyHint === true), true);
  assert.equal(tools.every((tool) => tool.annotations?.destructiveHint === false), true);
}

test("Creator Scouting is a separate read-only MCP process", async (t) => {
  const connection = await connected(createCreatorScoutingMcpServer, {
    async observeCreatorInvitationStatus({ targetManifest }) {
      return {
        status: "interaction_required",
        targetManifest: {
          ...targetManifest,
          generatedAt: "2026-09-02T00:00:00.000Z",
          rowsSha256: "a".repeat(64),
        },
        sourceContext: {
          capability: "creator-invitation-status-source/v1",
          providerPackage: "@synthetic/provider",
          providerVersion: "1.0.0",
          bindingId: "invitation-eligibility",
          knowledgeVersion: "synthetic/1",
        },
        instructions: "Observe eligibility only.",
      };
    },
  });
  t.after(() => connection.close());

  const listed = await connection.client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      "observe_creator_invitation_eligibility",
      "validate_creator_invitation_eligibility_observations",
    ],
  );
  assertReadOnly(listed.tools);
  assert.equal(connection.client.getInstructions(), CREATOR_SCOUTING_SERVER_INSTRUCTIONS);
  assert.match(connection.client.getInstructions(), /never sends messages/i);
  assert.match(connection.client.getInstructions(), /never.*writes to Lark/i);

  const result = await connection.client.callTool({
    name: "observe_creator_invitation_eligibility",
    arguments: {
      targetManifest: {
        version: 1,
        targetMode: "selected",
        rowCount: 1,
        rows: [{ creatorRecordId: "rec_synthetic", accountKey: "synthetic.creator" }],
      },
    },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(
    {
      contractVersion: result.structuredContent.auditContext.contractVersion,
      domain: result.structuredContent.auditContext.domain,
      authority: result.structuredContent.auditContext.authority,
      tool: result.structuredContent.auditContext.tool,
    },
    {
      contractVersion: 2,
      domain: "creator-scouting",
      authority: "read",
      tool: "observe_creator_invitation_eligibility",
    },
  );
  assert.match(result.structuredContent.auditContext.requestSha256, /^[0-9a-f]{64}$/);
  assert.match(result.structuredContent.auditContext.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(result.structuredContent.auditContext.targetCount, 1);
  assert.equal(result.structuredContent.auditContext.observedCount, null);
  assert.equal(
    result.structuredContent.auditContext.providerBinding.bindingId,
    "invitation-eligibility",
  );
});

test("Creator Management is a separate read-only MCP process", async (t) => {
  const connection = await connected(createCreatorManagementMcpServer, {
    async readCreatorActivity() {
      return {
        status: "ok",
        snapshot: {
          month: "2026-08",
          sourceUpdatedAt: "2026-09-02T00:00:00.000Z",
          rowCount: 1,
          creators: [
            {
              accountKey: "synthetic.creator",
              diamonds: 100,
              effectiveLiveDays: 2,
              liveMinutes: 90,
            },
          ],
        },
        sourceContext: {
          capability: "creator-activity-source/v1",
          providerPackage: "@synthetic/provider",
          providerVersion: "1.0.0",
          bindingId: "member-activity",
          knowledgeVersion: "synthetic/1",
        },
      };
    },
  });
  t.after(() => connection.close());

  const listed = await connection.client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      "read_creator_activity",
      "observe_creator_activity",
      "validate_creator_activity_observations",
    ],
  );
  assertReadOnly(listed.tools);
  assert.equal(connection.client.getInstructions(), CREATOR_MANAGEMENT_SERVER_INSTRUCTIONS);
  assert.match(connection.client.getInstructions(), /never writes to Creator Management Base/i);
  assert.match(connection.client.getInstructions(), /never.*invites creators/i);

  const result = await connection.client.callTool({
    name: "read_creator_activity",
    arguments: {
      source: {
        kind: "markdown",
        month: "2026-08",
        sourceUpdatedAt: "2026-09-02T00:00:00.000Z",
        expectedRowCount: 1,
        text: "| synthetic | activity |",
      },
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.auditContext.contractVersion, 2);
  assert.equal(result.structuredContent.auditContext.domain, "creator-management");
  assert.equal(result.structuredContent.auditContext.authority, "read");
  assert.equal(result.structuredContent.auditContext.tool, "read_creator_activity");
  assert.match(result.structuredContent.auditContext.requestSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.structuredContent.auditContext.targetCount, 1);
  assert.equal(result.structuredContent.auditContext.observedCount, 1);
  assert.equal(result.structuredContent.auditContext.providerBinding.bindingId, "member-activity");
});

test("domain MCP failures retain audit context without leaking private details", async (t) => {
  const connection = await connected(createCreatorManagementMcpServer, {
    async readCreatorActivity() {
      const error = new Error("synthetic source shape changed");
      error.code = "SCHEMA_CHANGED";
      error.details = { instructions: "private provider detail" };
      throw error;
    },
  });
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    name: "read_creator_activity",
    arguments: {
      source: {
        kind: "markdown",
        month: "2026-08",
        sourceUpdatedAt: "2026-09-02T00:00:00.000Z",
        expectedRowCount: 1,
        text: "| synthetic | activity |",
      },
    },
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(result.isError, true);
  assert.equal(payload.error.code, "SCHEMA_CHANGED");
  assert.equal(payload.auditContext.domain, "creator-management");
  assert.equal(payload.auditContext.authority, "read");
  assert.doesNotMatch(result.content[0].text, /private provider detail/);
  assert.doesNotMatch(result.content[0].text, /\n\s+at /);
});
