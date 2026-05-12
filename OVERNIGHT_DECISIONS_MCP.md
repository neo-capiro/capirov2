# §14. MCP Connectors — design spec

You asked: make Clio a Hermes+Claude-Cowork-grade assistant for any work setting. The unlock is **Model Context Protocol (MCP) connectors** — letting Clio plug into the user's actual work tools (Outlook, Gmail, Drive, Slack, GitHub, Linear, Notion, etc.) and dynamically expose their tools to the agent.

This file is the design I want you to validate before I sink hours into wiring providers one by one.

## What's already there (live tonight)

- `/connectors` page in the SPA (`apps/web/src/pages/connectors/ConnectorsPage.tsx`), linked from the primary nav with the API/plug icon.
- Real connection status for **Microsoft 365** — reuses the existing tenant-wide `IntegrationConnection` row + `/api/engagement/integrations` endpoint. "Connect" kicks off the existing OAuth flow.
- Card grid for the planned connectors: Google Workspace, Gmail, Calendar, Drive, SharePoint, Slack, GitHub, Linear, Notion, **Custom MCP server**. All show "Coming soon" today so you can see the catalog.

The Connectors page is real infrastructure, not just a placeholder. The cards for unbuilt providers click as disabled — when each provider lands its card switches from "Coming soon" → "Available" → "Connected" without any UI rewrite.

## Architecture for the real thing

### Two classes of connector

**Tenant-scoped** (shared across the tenant): Microsoft 365, Google Workspace, SharePoint. Already the existing `engagement_connections` table shape. One mailbox per tenant, one calendar feed per tenant.

**User-scoped** (one connection per Capiro user): Gmail-personal, GitHub, Linear (when the user wants to file issues *as themselves*), Notion-personal, custom MCP. Need a NEW table:

```prisma
model ClioConnector {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  userId          String   @map("user_id") @db.Uuid
  provider        String   // 'gmail', 'github', 'linear', 'notion', 'mcp_custom'
  // For OAuth providers: encrypted access/refresh token (same crypto
  // as engagement_connection_tokens — reuse TokenCryptoService).
  // For raw MCP servers: the server URL.
  config          Json     @default("{}") @map("config_jsonb")
  status          String   @default("connected")
  // Tool names the server advertised at connect time. Refreshed on a
  // schedule + when the agent loop hits a 'unknown tool' error.
  toolNames       String[] @map("tool_names") @default([])
  lastRefreshedAt DateTime? @map("last_refreshed_at") @db.Timestamptz(6)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  // RLS isolated by tenant_id like everything else.
  @@unique([tenantId, userId, provider], map: "clio_connectors_unique")
  @@index([tenantId, userId])
  @@map("clio_connectors")
}
```

### Tool registration becomes dynamic

Today `ToolRegistryService` hard-codes its 5 tools. With connectors it becomes:

1. **Static tools** (always available): `get_client_context`, `render_artifact`, `remember_about_user`, `forget_about_user`, `web_search`.
2. **Connector tools** (loaded per-session at chat time): query `clio_connectors` for the active user, fetch each connector's tool list, prefix the names with the connector id (so `gmail.search_email`, `github.get_pr`), and merge into the registry that turn.

The agent loop already supports a variable tool surface — it just sends whatever `toolsForTier(...)` returns. No change to the Bedrock plumbing.

### How tools actually execute

When Clio's agent loop hits `gmail.search_email` it calls back to `/api/clio/internal/tools/gmail.search_email`. The Capiro API:

1. Splits `gmail.search_email` into `provider=gmail`, `tool=search_email`.
2. Looks up the user's `clio_connector` row for `provider=gmail`.
3. For OAuth providers (built-in adapters): calls the provider's REST API with the stored token.
4. For `mcp_custom`: opens an MCP client connection to `config.serverUrl`, calls the tool, returns the result.
5. Result flows back to Clio as a `toolResult` block — same path as today.

### OAuth flow per provider

Each OAuth provider needs:
- App registration in the provider's console (one-time, by you).
- Client ID + secret stored in Secrets Manager.
- `POST /api/clio/connectors/:provider/start` → returns authorization URL.
- `GET /api/clio/connectors/:provider/callback` → exchanges code for token, stores in `clio_connectors.config_jsonb` (encrypted with `TokenCryptoService`).

Microsoft 365 already has this whole flow at `/api/engagement/integrations/microsoft/*` — the work is replicating it per provider.

### MCP custom-server flow

For "Custom MCP server":

- User pastes a URL like `https://my-internal-mcp.example.com`.
- Optional API key field (stored encrypted, sent as `Authorization: Bearer` on every request).
- API connects to the MCP server's `tools/list` endpoint, stores the tool names, exposes them as `<connectorId>.<toolName>` to the agent.

This is the path that lets the user bring ANY internal tool into Clio without us writing an adapter.

### Per-user instance feel

This is the answer to "every user has their own independent instance". One Fargate task still serves everyone, but each user's session sees:
- Their own `clio_user_memories` (already shipped)
- Their own connected tools (new, via this spec)
- Their own preferences in the system prompt

That's what makes Clio feel like a personal assistant rather than a shared bot.

## Build order I'd suggest

Each row is roughly one focused session of work:

1. **Schema + module** — `clio_connectors` table, RLS migration, `ConnectorsService` (CRUD on the row + token decrypt).
2. **Gmail OAuth** — first new provider. Easier than Microsoft because no cert auth, plain client-secret + PKCE.
3. **GitHub OAuth + tools** — `github.search_repos`, `github.read_file`, `github.create_issue`. Token has small scope.
4. **Slack OAuth + tools** — `slack.search_messages`, `slack.post_message`, `slack.list_channels`. Requires Slack app review for prod; staging can ship.
5. **Custom MCP client** — Python `mcp` package in Clio runtime, dynamic tool discovery, lazy connection pooling.
6. **Calendar + Drive** (Google Workspace) — single OAuth, multiple tools.
7. **Linear, Notion** — narrow adapters, mostly REST.

Per provider: ~1 session of work for the adapter + UI wiring once the framework from (1) lands.

## Things I want your call on

1. **Per-user OAuth scope** — should `gmail` be per-user (each user connects their own Gmail) or per-tenant (one shared inbox)? I lean per-user for Gmail/GitHub/Linear; per-tenant for Microsoft 365 / Google Workspace org-wide.
2. **Where the OAuth apps live** — register them under capiro.ai or under a dedicated `clio.capiro.ai` brand?
3. **MCP server runtime trust model** — when a user connects a custom MCP server, do we sandbox tool calls (treat them as untrusted) or trust them as much as we trust our own tools? Default: untrusted, with explicit user permission per tool category.
4. **Tool name collisions** — if two connectors advertise `search`, do we prefix them all (`gmail.search` / `drive.search`) or let the user disambiguate? My recommendation is always-prefix.
5. **Approval gates** — Hermes lets the user approve each tool call before it runs. Worth a build for high-stakes tools (send email, post message)? Yes if we want to ship to customers.

## Commits this round

- Connectors page scaffolding (`ConnectorsPage.tsx`, `connectors.css`, App route, AppShell nav entry, page-title map).
- This spec file (§14).
