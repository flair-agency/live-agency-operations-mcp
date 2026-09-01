import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createCreatorManagementMcpServer } from "./creator-management-mcp-server.mjs";
import {
  loadProviderBindingProfiles,
  resolveProviderBindingProfile,
} from "./provider-binding-resolver.mjs";
import { createOperationsRuntime } from "./runtime.mjs";

function defaultRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export async function main() {
  const rootDir = process.env.LIVE_AGENCY_PROVIDER_RUNTIME_ROOT
    ? path.resolve(process.env.LIVE_AGENCY_PROVIDER_RUNTIME_ROOT)
    : defaultRootDir();
  const profilePath = process.env.LIVE_AGENCY_PROVIDER_BINDING_PROFILES_PATH
    ? path.resolve(process.env.LIVE_AGENCY_PROVIDER_BINDING_PROFILES_PATH)
    : path.join(rootDir, "config", "v2-provider-binding-profiles.json");
  const bindingProfile = resolveProviderBindingProfile(
    await loadProviderBindingProfiles(profilePath),
    {
      profileId: "flair-creator-management-read",
      domain: "creator-management",
      authority: "read",
    },
  );
  const server = createCreatorManagementMcpServer({
    runtime: createOperationsRuntime({ rootDir, bindingProfile }),
  });
  await server.connect(new StdioServerTransport());
  console.error("creator-management MCP server running on stdio with read authority");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
