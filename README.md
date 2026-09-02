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

## Version 2 domain processes

The mixed `live-agency-operations` process remains available as a transitional
compatibility surface. Version 2 Skills use two separately launched read-only
domain processes that share the same provider-resolution runtime:

- Creator Scouting exposes paired observe/validate tools for public profiles,
  LIVE history, and invitation eligibility.
- Creator Management exposes `read_creator_activity`,
  `observe_creator_activity`, and `validate_creator_activity_observations`.

Each domain result includes a content-bound audit context with contract version,
domain, read authority, tool name, request identity and hash, target and observed
counts, and the resolved Provider Binding. Lark writes and BackStage
relationship-changing actions are not available in either process. Shared v2
schemas also define account-observation references with the current mutable
username as the TikTok operational key, observation evidence,
unavailable values, write intent, approval, and readback results; write tools are
not exposed in this release. They deliberately do not define a Flair-owned
Actor, candidacy, platform-account, creator, or membership ID while the v2
identity model is under review.

`live-domain-contracts.mjs` additionally keeps LIVE scan observations,
reconciled canonical sessions, and JST daily aggregates as separate contracts.
Each observed session must be assigned exactly once to a canonical session or a
review quarantine. Multiple scans may support one canonical session, while a
daily aggregate accepts each canonical session key at most once. Raw repeated
observations therefore cannot be summed as separate LIVE sessions.

The domain entrypoints load exact capability/input-to-Binding routes from
`config/v2-provider-binding-profiles.json` in the composition root. Missing,
duplicate, mismatched, or uninstalled profiles fail closed. Set
`LIVE_AGENCY_PROVIDER_BINDING_PROFILES_PATH` only when the compatible private
composition root stores that configuration elsewhere.

`instance-profile-resolver.mjs` defines the corresponding fail-closed Lark
Instance Profile contract. Each private profile binds one profile ID to one
domain, tenant, authority, Base ID, credential reference, schema fingerprint,
knowledge version, and set of immutable table IDs. Production Instance Profile
documents and credentials are deliberately not stored in this repository.

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

Start the v2 domain processes independently:

```sh
npm run mcp:start:scouting
npm run mcp:start:management
```

The following is an example Codex project configuration. Replace
`/absolute/path/to/...` with the actual absolute path to the composition root.

```toml
[mcp_servers.live-agency-operations]
command = "node"
args = ["/absolute/path/to/live-agency-provider-runtime/mcp/live-agency-operations/src/server.mjs"]
cwd = "/absolute/path/to/live-agency-provider-runtime"
```

The v2 domain configuration uses separate entries:

```toml
[mcp_servers.creator-scouting]
command = "node"
args = ["/absolute/path/to/live-agency-provider-runtime/mcp/live-agency-operations/src/creator-scouting-server.mjs"]
cwd = "/absolute/path/to/live-agency-provider-runtime"

[mcp_servers.creator-management]
command = "node"
args = ["/absolute/path/to/live-agency-provider-runtime/mcp/live-agency-operations/src/creator-management-server.mjs"]
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

After adding the configuration, restart Codex and confirm that Creator Scouting
advertises six tools and Creator Management advertises three tools. The legacy
mixed process continues to advertise its original five-tool compatibility
surface.
