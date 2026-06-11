import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptSecret, encryptSecret, parseAesKey } from '../common/secret-crypto.js';
import { ToolCircuitBreaker, CircuitOpenError } from './clio-circuit-breaker.js';
import { createMcpClient, type McpServerConnection } from './clio-mcp-transport.js';
import {
  bridgeMcpTool,
  filterAllowedMcpTools,
  parseBridgedToolName,
  wrapMcpResultForPrompt,
  type BridgedTool,
} from './clio-mcp.helpers.js';

interface RegisteredMcpTool {
  serverId: string;
  serverName: string;
  toolName: string;
  bridgedName: string;
  readOnly: boolean;
}

interface TenantMcpRegistry {
  fetchedAt: number;
  schemas: BridgedTool[];
  byBridgedName: Map<string, RegisteredMcpTool>;
}

export interface McpServerInput {
  name?: unknown;
  transport?: unknown;
  endpoint?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  authToken?: unknown;
  toolAllowlist?: unknown;
  readOnlyTools?: unknown;
  enabled?: unknown;
}

const REGISTRY_TTL_MS = 15 * 60 * 1000;

/**
 * Tenant-configured MCP servers for Clio (assistant-parity F6a).
 *
 * Registry: per-tenant bridged tool schemas, refreshed on a 15-minute TTL (or
 * admin "refresh now"), merged into the chat tool surface at request time.
 * Only allowlisted tools register; every bridged tool is treated as
 * side-effecting (serialized + audit-logged) unless listed in readOnlyTools.
 * Bearer secrets are AES-256-GCM encrypted at rest and write-only through the
 * API. Calls run behind the shared circuit breaker so a dead server degrades
 * the turn instead of killing it.
 */
@Injectable()
export class ClioMcpService {
  private readonly logger = new Logger(ClioMcpService.name);
  private readonly registry = new Map<string, TenantMcpRegistry>();
  private readonly breaker = new ToolCircuitBreaker({ threshold: 3, cooldownMs: 60_000 });

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private enabled(): boolean {
    return this.config.get('CLIO_MCP_ENABLED', { infer: true });
  }

  private encryptionKey(): Buffer {
    const raw = this.config.get('OAUTH_TOKEN_ENCRYPTION_KEY', { infer: true });
    if (!raw) {
      throw new ServiceUnavailableException(
        'MCP auth secrets need OAUTH_TOKEN_ENCRYPTION_KEY to be configured',
      );
    }
    return parseAesKey(raw);
  }

  // ── Admin CRUD (secrets write-only) ──────────────────────────────────────

  async listServers(ctx: TenantContext) {
    const rows = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMcpServer.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((row) => this.redact(row));
  }

  async createServer(ctx: TenantContext, input: McpServerInput) {
    const data = this.validateInput(input, true);
    const row = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMcpServer.create({
        data: {
          tenantId: ctx.tenantId,
          createdByUserId: ctx.userId,
          ...data,
        } as unknown as Prisma.ClioMcpServerUncheckedCreateInput,
      }),
    );
    await this.audit(ctx, 'clio.mcp_server.create', row.id, { name: row.name, transport: row.transport });
    this.invalidate(ctx.tenantId);
    return this.redact(row);
  }

  async updateServer(ctx: TenantContext, id: string, input: McpServerInput) {
    const existing = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMcpServer.findFirst({ where: { id, tenantId: ctx.tenantId } }),
    );
    if (!existing) throw new NotFoundException('MCP server not found');
    const data = this.validateInput(input, false);
    const row = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMcpServer.update({
        where: { id },
        data: data as unknown as Prisma.ClioMcpServerUncheckedUpdateInput,
      }),
    );
    await this.audit(ctx, 'clio.mcp_server.update', id, { name: row.name, enabled: row.enabled });
    this.invalidate(ctx.tenantId);
    return this.redact(row);
  }

  async deleteServer(ctx: TenantContext, id: string) {
    const existing = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMcpServer.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    );
    if (!existing) throw new NotFoundException('MCP server not found');
    await this.prisma.withTenant(ctx.tenantId, (tx) => tx.clioMcpServer.delete({ where: { id } }));
    await this.audit(ctx, 'clio.mcp_server.delete', id, { name: existing.name });
    this.invalidate(ctx.tenantId);
    return { deleted: true };
  }

  /** Admin "refresh now": rebuild the tenant registry immediately. */
  async refreshNow(ctx: TenantContext) {
    this.invalidate(ctx.tenantId);
    const registry = await this.registryForTenant(ctx.tenantId);
    return {
      tools: registry.schemas.map((schema) => schema.name),
      refreshedAt: new Date(registry.fetchedAt).toISOString(),
    };
  }

  // ── Registry (request-time tool surface) ─────────────────────────────────

  invalidate(tenantId: string): void {
    this.registry.delete(tenantId);
  }

  /** Bridged tool schemas for a tenant (cached, 15-minute TTL). */
  async bridgedSchemasForTenant(tenantId: string): Promise<BridgedTool[]> {
    if (!this.enabled()) return [];
    try {
      return (await this.registryForTenant(tenantId)).schemas;
    } catch (err) {
      this.logger.warn(`MCP registry unavailable [tenant ${tenantId}]: ${(err as Error).message}`);
      return [];
    }
  }

  /** Whether a bridged tool may run concurrently (explicitly read-only). */
  isBridgedToolReadOnly(tenantId: string, bridgedName: string): boolean {
    const entry = this.registry.get(tenantId)?.byBridgedName.get(bridgedName);
    return entry?.readOnly ?? false;
  }

  private async registryForTenant(tenantId: string): Promise<TenantMcpRegistry> {
    const cached = this.registry.get(tenantId);
    if (cached && Date.now() - cached.fetchedAt < REGISTRY_TTL_MS) return cached;

    const servers = await this.prisma.withTenant(tenantId, (tx) =>
      tx.clioMcpServer.findMany({ where: { tenantId, enabled: true } }),
    );
    const schemas: BridgedTool[] = [];
    const byBridgedName = new Map<string, RegisteredMcpTool>();
    for (const server of servers) {
      const allowlist = asStringArray(server.toolAllowlist);
      if (!allowlist.length) continue; // empty allowlist registers nothing (fail-closed)
      try {
        const client = this.clientFor(server);
        const tools = filterAllowedMcpTools(await client.listTools(), allowlist);
        const readOnly = new Set(asStringArray(server.readOnlyTools));
        for (const tool of tools) {
          const bridged = bridgeMcpTool(server.name, tool);
          if (byBridgedName.has(bridged.name)) continue;
          schemas.push(bridged);
          byBridgedName.set(bridged.name, {
            serverId: server.id,
            serverName: server.name,
            toolName: tool.name,
            bridgedName: bridged.name,
            readOnly: readOnly.has(tool.name),
          });
        }
        await this.prisma
          .withTenant(tenantId, (tx) =>
            tx.clioMcpServer.update({
              where: { id: server.id },
              data: { lastSyncAt: new Date(), lastError: null },
            }),
          )
          .catch(() => {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`MCP listTools failed [${server.name}]: ${message}`);
        await this.prisma
          .withTenant(tenantId, (tx) =>
            tx.clioMcpServer.update({
              where: { id: server.id },
              data: { lastError: message.slice(0, 500) },
            }),
          )
          .catch(() => {});
      }
    }
    const registry: TenantMcpRegistry = { fetchedAt: Date.now(), schemas, byBridgedName };
    this.registry.set(tenantId, registry);
    return registry;
  }

  // ── Execution (routed from the agentic loop) ─────────────────────────────

  /**
   * Execute a bridged tool call. Circuit-breaker guarded per (tenant, server);
   * results come back wrapped + sanitized as untrusted data; every WRITE
   * (non-readOnly) call lands in AuditLog.
   */
  async executeBridged(
    ctx: TenantContext,
    bridgedName: string,
    input: Record<string, unknown>,
  ): Promise<{ tool: string; server: string; untrusted: true; content: string }> {
    if (!this.enabled()) throw new BadRequestException('MCP tools are disabled');
    const parsed = parseBridgedToolName(bridgedName);
    if (!parsed) throw new BadRequestException(`Not a bridged MCP tool: ${bridgedName}`);
    const registry = await this.registryForTenant(ctx.tenantId);
    const entry = registry.byBridgedName.get(bridgedName);
    if (!entry) throw new NotFoundException(`MCP tool not registered: ${bridgedName}`);
    const breakerKey = `${ctx.tenantId}:mcp:${entry.serverId}`;
    if (this.breaker.isOpen(breakerKey)) throw new CircuitOpenError(bridgedName);

    const server = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMcpServer.findFirst({ where: { id: entry.serverId, tenantId: ctx.tenantId } }),
    );
    if (!server || !server.enabled) throw new NotFoundException('MCP server not found or disabled');

    if (!entry.readOnly) {
      await this.audit(ctx, 'clio.mcp_tool.call', server.id, {
        server: server.name,
        tool: entry.toolName,
        // Redact values; record the argument keys for the audit trail.
        argKeys: Object.keys(input ?? {}),
      });
    }

    try {
      const client = this.clientFor(server);
      const result = await client.callTool(entry.toolName, input);
      this.breaker.recordSuccess(breakerKey);
      return {
        tool: bridgedName,
        server: server.name,
        untrusted: true,
        content: wrapMcpResultForPrompt(server.name, result),
      };
    } catch (err) {
      this.breaker.recordFailure(breakerKey);
      throw err;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private clientFor(server: {
    transport: string;
    endpoint: string | null;
    command: string | null;
    args: unknown;
    envJson: unknown;
    authTokenCiphertext: string | null;
    authTokenIv: string | null;
    authTokenAuthTag: string | null;
  }) {
    let authToken: string | null = null;
    if (server.authTokenCiphertext && server.authTokenIv && server.authTokenAuthTag) {
      authToken = decryptSecret(this.encryptionKey(), {
        ciphertext: server.authTokenCiphertext,
        iv: server.authTokenIv,
        authTag: server.authTokenAuthTag,
      });
    }
    const conn: McpServerConnection = {
      transport: server.transport === 'stdio' ? 'stdio' : 'http',
      endpoint: server.endpoint,
      command: server.command,
      args: asStringArray(server.args),
      env: asStringRecord(server.envJson),
      authToken,
    };
    return createMcpClient(conn, this.config.get('CLIO_MCP_STDIO_ALLOWED_COMMANDS', { infer: true }));
  }

  private validateInput(input: McpServerInput, isCreate: boolean): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (isCreate || input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!/^[a-z0-9][a-z0-9-_]{1,63}$/i.test(name)) {
        throw new BadRequestException('name must be 2-64 chars of [a-zA-Z0-9-_]');
      }
      data.name = name;
    }
    if (isCreate || input.transport !== undefined) {
      const transport = String(input.transport ?? '');
      if (!['http', 'stdio'].includes(transport)) {
        throw new BadRequestException('transport must be http or stdio');
      }
      data.transport = transport;
    }
    if (input.endpoint !== undefined) {
      const endpoint = input.endpoint === null ? null : String(input.endpoint).trim();
      if (endpoint) {
        let url: URL;
        try {
          url = new URL(endpoint);
        } catch {
          throw new BadRequestException('endpoint must be a valid URL');
        }
        if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
          throw new BadRequestException('endpoint must use https');
        }
      }
      data.endpoint = endpoint;
    }
    if (input.command !== undefined) {
      data.command = input.command === null ? null : String(input.command).trim().slice(0, 500);
    }
    if (input.args !== undefined) {
      data.args = asStringArray(input.args).slice(0, 20);
    }
    if (input.env !== undefined) {
      data.envJson = asStringRecord(input.env);
    }
    if (input.toolAllowlist !== undefined) {
      data.toolAllowlist = asStringArray(input.toolAllowlist).slice(0, 50);
    }
    if (input.readOnlyTools !== undefined) {
      data.readOnlyTools = asStringArray(input.readOnlyTools).slice(0, 50);
    }
    if (input.enabled !== undefined) {
      data.enabled = Boolean(input.enabled);
    }
    if (typeof input.authToken === 'string' && input.authToken.trim()) {
      const envelope = encryptSecret(this.encryptionKey(), input.authToken.trim());
      data.authTokenCiphertext = envelope.ciphertext;
      data.authTokenIv = envelope.iv;
      data.authTokenAuthTag = envelope.authTag;
      data.authKeyVersion = this.config.get('OAUTH_TOKEN_ENCRYPTION_KEY_VERSION', { infer: true });
    } else if (input.authToken === null) {
      data.authTokenCiphertext = null;
      data.authTokenIv = null;
      data.authTokenAuthTag = null;
      data.authKeyVersion = null;
    }
    if (isCreate) {
      if (data.transport === 'http' && !data.endpoint) {
        throw new BadRequestException('http transport requires an endpoint');
      }
      if (data.transport === 'stdio' && !data.command) {
        throw new BadRequestException('stdio transport requires a command');
      }
    }
    return data;
  }

  /** Never return secret material — only whether a token is set. */
  private redact(row: {
    id: string;
    name: string;
    transport: string;
    endpoint: string | null;
    command: string | null;
    args: unknown;
    toolAllowlist: unknown;
    readOnlyTools: unknown;
    enabled: boolean;
    lastSyncAt: Date | null;
    lastError: string | null;
    authTokenCiphertext: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      endpoint: row.endpoint,
      command: row.command,
      args: asStringArray(row.args),
      toolAllowlist: asStringArray(row.toolAllowlist),
      readOnlyTools: asStringArray(row.readOnlyTools),
      enabled: row.enabled,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
      hasAuthToken: Boolean(row.authTokenCiphertext),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async audit(
    ctx: TenantContext,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma
      .withTenant(ctx.tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            actorRole: ctx.role,
            action,
            entityType: 'clio_mcp_server',
            entityId,
            after: after as Prisma.InputJsonValue,
          },
        }),
      )
      .catch((err) => {
        this.logger.warn(`MCP audit write failed [${action}]: ${(err as Error).message}`);
      });
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
