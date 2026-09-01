# Live agency operations MCP

A local STDIO MCP server that makes provider-specific acquisition available to
chats and skills. MCP tool names and contracts remain source-neutral, while the
server resolves installed capability providers at runtime.

All Phase 1 operations are read-only.

- `read_creator_activity`: Normalize monthly diamonds, effective LIVE days, and
  LIVE minutes.
- `observe_creator_activity`: Resolve an interactive, source-specific activity
  acquisition provider for an exact month and complete or selected scope.
- `validate_creator_activity_observations`: Verify the normalized activity
  snapshot against that exact request and provider context.
- `observe_creator_invitation_status`: Resolve an invitation-status provider. An
  interactive provider returns private instructions for use in an authenticated
  browser session.
- `validate_creator_invitation_status_observations`: Verify that observations
  exactly match the requested targets.

Direct messages, invitations, follows, relationship changes, and writes to Lark
or other destinations are outside this server's scope. Credentials and real data
must not be stored in the repository.

This MCP is maintained in its own repository and is mounted at
`mcp/live-agency-operations` by the private `live-agency-provider-runtime`
composition root. The composition root supplies the source-provider API and
the installed provider packages.

## Start the server

Run the following command from the `live-agency-provider-runtime` composition
root:

```sh
npm run mcp:start
```

The following is an example Codex project configuration. Replace
`/absolute/path/to/...` with the actual absolute path to the composition root.

```toml
[mcp_servers.live-agency-operations]
command = "node"
args = ["/absolute/path/to/live-agency-provider-runtime/mcp/live-agency-operations/src/server.mjs"]
cwd = "/absolute/path/to/live-agency-provider-runtime"
```

If this repository is checked out outside the composition root, set
`LIVE_AGENCY_PROVIDER_RUNTIME_ROOT` to the absolute path of a compatible
runtime containing the provider workspaces.

## Test

Install the composition-root workspaces, then run:

```sh
npm run test:mcp
```

After adding the configuration, restart Codex and confirm that all five tools
appear in the MCP tool list.
