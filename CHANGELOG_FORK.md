# Fork Changelog

Tracks fork-specific changes on top of upstream [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp).

For upstream changes see [CHANGELOG.md](./CHANGELOG.md).

Versioning: `v<upstream-version>-chatwoot.<n>` where:

- `<upstream-version>` is the n8n-mcp version we synced from (e.g., `2.51.1`)
- `<n>` is the iteration number for fork-specific changes on that base

## [Unreleased] - Sync with upstream v2.99.2 (n8n 2.44.x)

### Changed

- **Merged `czlonkowski/n8n-mcp` v2.99.2** (was 2.53.0). n8n-nodes-base, n8n-core and
  @n8n/n8n-nodes-langchain 2.44.3, n8n-workflow 2.44.2, MCP SDK 1.30.0. Brings the upstream security fixes
  (SSRF hostname normalization, multi-tenant session isolation, validation DoS limits, telemetry/log
  redaction, prototype pollution) and node validation for n8n up to 2.44 (deprecated-node warnings, current
  typeVersions). Node 20 is no longer supported: use Node `^22.23.4 || ^24.22.1 || >=26.12.1`.
- **`data/nodes.db` is upstream's 2.44.x database plus the registered fork nodes**: the three
  `@renatoascencio/n8n-nodes-chatwoot` 0.9.0 nodes and the three `@renatoascencio/n8n-nodes-evolution-api` 0.1.0
  nodes (3,149 nodes in total).
- **Fork tools moved to upstream's `additionalTools` seam** (`src/mcp/fork-additional-tools.ts`):
  `chatwoot_doctor`, `n8n_login`, `n8n_create_folder` and `n8n_move_workflow` no longer patch the tool lists
  and dispatch switch in `server.ts`, which removes the recurring merge conflicts there. A host that passes
  its own `additionalTools` keeps full control of the tool surface. REST tools stay off in multi-tenant mode.
- Dropped fork-only edits that upstream now covers: visible-defaults handling in the config validator and
  the unknown community node warning (`COMMUNITY_NODE_NOT_IN_CATALOG` is now upstream's plain warning).
  Kept: `multiOptions` membership validation (Chatwoot Trigger events) and Chatwoot registration in `rebuild`.
- CI: removed the fork-deleted `docker-build*.yml` again and restored upstream's generated
  `issue-triage.lock.yml` (the self-hosted runner edit would queue jobs on a public repo).

### Added

- **`npm run register:community -- --package <built package root>`**
  (`src/scripts/register-community-package.ts`): registers any built community package (nodes, Tool variants,
  triggers) in an existing `data/nodes.db`, replacing its previous rows and keeping fetched README data.
  Used for `@renatoascencio/n8n-nodes-evolution-api`, so `search_nodes`, `get_node` and `validate_workflow`
  know the node.

### Compatibility checked

- n8n 2.45.7 (current stable): the internal REST endpoints the fork uses (`POST /rest/login` with
  `emailOrLdapLoginId` and `mfaCode`, `POST /rest/projects/:id/folders`, `PATCH /rest/workflows/:id` with only
  `parentFolderId`) are unchanged, and the public API differs from 2.44.5 only by additions (the schemas are
  identical). Upstream's own contract check stops at 2.44.5.

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

1. Work in a separate worktree: `git worktree add <dir> -b <branch> origin/main`
2. Sync with upstream: `git fetch upstream && git merge upstream/main`
3. Resolve conflicts (preserve fork-specific files). Take upstream's `data/nodes.db`, workflows and generated
   files; keep `docker-build*.yml` and `CLAUDE.md` deleted
4. Inside a `node:22.23.4` container: `npm ci --legacy-peer-deps && npm run build`, then re-register the fork
   nodes in the database: `npm run register:chatwoot` and
   `npm run register:community -- --package <built @renatoascencio/n8n-nodes-evolution-api>`
5. Run `tsc`, the unit tests and a stdio smoke test (`tools/list` shows `chatwoot_doctor`, `n8n_login`...)
6. Add entry to this file; merge through a PR; the GHCR image rebuilds
