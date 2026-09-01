import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer, SERVER_INSTRUCTIONS } from "../src/mcp-server.mjs";

async function connected(runtime) {
  const server = createMcpServer({ runtime });
  const client = new Client({ name: "synthetic-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

test("MCP advertises three source-neutral, read-only tools and server safety instructions", async (t) => {
  const connection = await connected({});
  t.after(() => connection.close());

  const listed = await connection.client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      "read_creator_activity",
      "observe_creator_invitation_status",
      "validate_creator_invitation_status_observations",
    ],
  );
  assert.equal(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true), true);
  assert.equal(listed.tools.every((tool) => tool.annotations?.destructiveHint === false), true);
  assert.equal(connection.client.getInstructions(), SERVER_INSTRUCTIONS);
  assert.match(connection.client.getInstructions(), /never authorizes invitations/i);
});

test("MCP returns validated structured creator activity", async (t) => {
  const snapshot = {
    month: "2026-08",
    sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    rowCount: 1,
    creators: [
      {
        accountKey: "synthetic_creator",
        diamonds: 10,
        effectiveLiveDays: 2,
        liveMinutes: 75,
      },
    ],
  };
  const connection = await connected({
    async readCreatorActivity() {
      return {
        status: "ok",
        snapshot,
        sourceContext: {
          capability: "creator-activity-source/v1",
          providerPackage: "@synthetic/provider",
          providerVersion: "1.0.0",
          bindingId: "activity",
          knowledgeVersion: "synthetic/1",
        },
      };
    },
  });
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    name: "read_creator_activity",
    arguments: {
      source: {
        kind: "markdown",
        month: "2026-08",
        sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
        expectedRowCount: 1,
        text: "| synthetic | table |",
      },
    },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent.snapshot, snapshot);
});

test("MCP fails closed without exposing stacks or provider instruction details", async (t) => {
  const connection = await connected({
    async readCreatorActivity() {
      const error = new Error("synthetic source shape changed");
      error.code = "SCHEMA_CHANGED";
      error.details = { instructions: "private synthetic detail" };
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
        sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
        expectedRowCount: 1,
        text: "| synthetic | table |",
      },
    },
  });
  const payload = JSON.parse(result.content[0].text);

  assert.equal(result.isError, true);
  assert.deepEqual(payload, {
    status: "error",
    error: {
      code: "SCHEMA_CHANGED",
      message: "synthetic source shape changed",
    },
  });
  assert.doesNotMatch(result.content[0].text, /private synthetic detail/);
  assert.doesNotMatch(result.content[0].text, /\n\s+at /);
});
