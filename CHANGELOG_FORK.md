# Fork Changelog

Tracks fork-specific changes on top of upstream [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp).

For upstream changes see [CHANGELOG.md](./CHANGELOG.md).

Versioning: `v<upstream-version>-chatwoot.<n>` where:

- `<upstream-version>` is the n8n-mcp version we synced from (e.g., `2.51.1`)
- `<n>` is the iteration number for fork-specific changes on that base

## [Unreleased] - Chatwoot node 0.9.0

### Changed

- **Chatwoot catalog generated from the node package** (`src/integrations/chatwoot/chatwoot-node-snapshot.json`,
  `npm run generate:chatwoot-catalog -- --package <built n8n-nodes-chatwoot> --version <x.y.z>`). It now lists
  all 39 resources and 269 operations of the `@renatoascencio/n8n-nodes-chatwoot` 0.9.0 source worktree with its real
  properties (the old hand-written list had 27 resources and no operations or parameters), credentials shown per
  resource, and the author URL `https://github.com/RenatoAscencio`. See
  [catalog regeneration and provenance](docs/CHATWOOT_CATALOG.md), including the captured source digest,
  the manifest's pending version bump and `--check` for reproducibility.
- **AI Agent tool**: the main node sets `usableAsTool`, so the catalog marks it `isAITool` and registers the
  `@renatoascencio/n8n-nodes-chatwoot.chatwootTool` variant.
- **Chatwoot Trigger**: events are exactly Chatwoot's `ALLOWED_WEBHOOK_EVENTS` (removed the invalid
  `conversation_assignee_changed` / `conversation_team_changed`, added typing and inbox events), plus the manual
  (agent bot / API channel) source, filters and options. Webhook payload shapes of Chatwoot 4.18 are documented
  in `get_node` docs.
- **Workflow templates**: fixed payload paths (`$json.name` for `contact_created`, conversation display id for
  `conversation_created`), parameter names (`options.message_type`/`options.private`,
  `additionalFields.name`/`email`, `assignmentType`), the online-agent filter (`availability_status === 'online'`),
  the send-message webhook response mode, and removed the empty trigger `webhookId` (every import shared one
  webhook path). New template `chatwoot-ai-agent` (Chatwoot Tool on an AI Agent), restricted to pending
  conversations so it stops replying after handing off to a human.
- **Template checker** (`template-validator.ts`): validates Chatwoot parameters, trigger events and payload paths
  of any workflow against the catalog; `chatwoot_doctor` uses it instead of expecting exactly 5 templates.
- **Installation guide**: env-managed install (`N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV` + `N8N_COMMUNITY_PACKAGES`),
  n8n 3.0 `N8N_UNVERIFIED_PACKAGES_ENABLED=true`; `N8N_CUSTOM_EXTENSIONS` takes directories, not package names.
- **Connection validator / `chatwoot_doctor`**: agent bot tokens, Public API (inbox identifier), Platform API
  inputs, Chatwoot error texts, catalog version and an n8n 3.x advisory. Failed probes and credential lookups
  make the summary unhealthy; supplied tokens are redacted from messages. Credential presence is explicitly
  distinguished from verified installation. Bot probes require Chatwoot's resource-not-found response.
- **Workflow validation**: applies defaults only from visible properties and checks static multi-select
  values, preventing missing Chatwoot search queries and invalid trigger events from passing validation.
  Removed obsolete `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` guidance.
- `npm run register:chatwoot` atomically refreshes Chatwoot nodes in an existing `data/nodes.db`, preserving
  fetched documentation and rolling back on failure.

---

## [v2.51.1-chatwoot.1] - 2026-05-06

### Synced from upstream (v2.35.4 → v2.51.1, 83 commits)

- Sanitizer hardening for telemetry workflow ingestion (#779)
- New tools: `n8n_manage_datatable`, `n8n_manage_credentials`, `n8n_audit_instance`, `n8n_generate_workflow`
- `includeUsage` flag for credential listing — shows which workflows reference each credential
- `WWW-Authenticate` Bearer challenge on 401 responses (RFC 6750)
- FTS5 graceful unavailability fallback in sql.js adapter (#398)
- Critical memory leak fix in sql.js adapter (#335)
- HTTP handlers: defensive JSON.parse for stringified params (#605)
- Workflow validator improvements
- And ~75 other upstream fixes/features. See [upstream CHANGELOG](./CHANGELOG.md) for full details.

### Fork-specific (preserved through sync)

- **`chatwoot_doctor` MCP tool** — diagnostic tool for Chatwoot integration health
- **`@renatoascencio/n8n-nodes-chatwoot` registered in nodes.db** — 2 nodes (Chatwoot, Chatwoot Trigger) discoverable via MCP catalog
- **Chatwoot connection validator** — graceful degradation, hardened error messages
- **5 Chatwoot workflow templates** — pre-built examples for common use cases
- **Multi-arch Docker support** (amd64 + arm64) via `docker-publish.yml`
- **Docker MCP Toolkit metadata labels** for image discoverability

### Conflict resolutions during sync

- `src/mcp/server.ts`: kept both `chatwoot_doctor` handler + new upstream tools
- `src/scripts/rebuild.ts`: kept both Chatwoot node registration + upstream's FTS5 rebuild guard
- `README.md`: kept fork's Chatwoot-specific README
- `data/nodes.db`: took upstream's fresh DB and re-registered `@renatoascencio/n8n-nodes-chatwoot`

---

## [v2.35.2-chatwoot.x] - 2026-02-19

Initial Chatwoot integration baseline. See git history for details.

- Chatwoot integration scaffold (`src/integrations/chatwoot/`)
- `chatwoot_doctor` diagnostic tool
- Connection validator with timeout/error classification
- 5 workflow templates (monitoring, sync, messaging, automation, public API)
- Unit tests (19/19 passing, 88%+ coverage)
- Docker CI workflow for GHCR
- Multi-arch support (amd64 + arm64)

---

## How to update

1. Sync with upstream: `git fetch upstream && git merge upstream/main`
2. Resolve conflicts (preserve fork-specific files)
3. Re-register Chatwoot nodes if `data/nodes.db` was overwritten (`npm run build && npm run register:chatwoot`)
4. Run `npm run build` and chatwoot tests
5. Tag as `v<new-upstream>-chatwoot.<next-n>`
6. Add entry to this file
