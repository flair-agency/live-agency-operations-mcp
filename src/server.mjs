import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./mcp-server.mjs";
import { createOperationsRuntime } from "./runtime.mjs";

function defaultRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export async function main() {
  const rootDir = process.env.LIVE_AGENCY_PROVIDER_RUNTIME_ROOT
    ? path.resolve(process.env.LIVE_AGENCY_PROVIDER_RUNTIME_ROOT)
    : defaultRootDir();
  const server = createMcpServer({ runtime: createOperationsRuntime({ rootDir }) });
  await server.connect(new StdioServerTransport());
  console.error("live-agency-operations MCP server running on stdio");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
