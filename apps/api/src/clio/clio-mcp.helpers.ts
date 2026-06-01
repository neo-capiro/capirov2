/**
 * MCP (Model Context Protocol) client bridging for Clio (P3-1).
 *
 * Lets Clio use tools exposed by external MCP servers as if they were native
 * tools. This module is the pure, testable core: an McpClient interface (a real
 * stdio/HTTP transport implements it; tests use a fake), parsing of an MCP
 * `tools/list` result, and bridging each MCP tool to a namespaced Anthropic tool
 * schema (`mcp__<server>__<tool>`) the agentic loop can offer + route. Wiring a
 * live transport + registering bridged tools in clio-tools.service is the
 * remaining integration. Pure helpers unit-test under `src/**.spec.ts`.
 */

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Minimal MCP client surface; a real transport (stdio/SSE/HTTP) implements it. */
export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface BridgedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const NS = 'mcp';
const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '_');

/** Namespaced Clio tool name for a bridged MCP tool: mcp__<server>__<tool>. */
export function bridgedToolName(server: string, tool: string): string {
  return `${NS}__${sanitize(server)}__${sanitize(tool)}`;
}

/** Parse a bridged name back to {server, tool}, or null if not bridged. */
export function parseBridgedToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(`${NS}__`)) return null;
  const parts = name.split('__');
  if (parts.length < 3) return null;
  const server = parts[1] ?? '';
  const tool = parts.slice(2).join('__');
  if (!server || !tool) return null;
  return { server, tool };
}

function isObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return !!schema && typeof schema === 'object' && !Array.isArray(schema);
}

/** Map one MCP tool descriptor to a namespaced Anthropic tool schema. */
export function bridgeMcpTool(server: string, tool: McpToolDescriptor): BridgedTool {
  return {
    name: bridgedToolName(server, tool.name),
    description: (tool.description ?? `MCP tool "${tool.name}" from ${server}`).slice(0, 1024),
    input_schema: isObjectSchema(tool.inputSchema)
      ? tool.inputSchema
      : { type: 'object', properties: {} },
  };
}

/** Tolerant parse of an MCP `tools/list` result (either `{tools:[...]}` or a bare array). */
export function parseMcpToolsList(result: unknown): McpToolDescriptor[] {
  const raw: unknown[] =
    isObjectSchema(result) && Array.isArray(result.tools)
      ? result.tools
      : Array.isArray(result)
        ? result
        : [];
  const out: McpToolDescriptor[] = [];
  for (const item of raw) {
    if (!isObjectSchema(item) || typeof item.name !== 'string' || !item.name) continue;
    out.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : undefined,
      inputSchema: isObjectSchema(item.inputSchema) ? item.inputSchema : undefined,
    });
  }
  return out;
}

/** List + bridge all of a server's tools via the client interface. */
export async function bridgeMcpServerTools(
  server: string,
  client: McpClient,
): Promise<BridgedTool[]> {
  const tools = await client.listTools();
  return tools.map((t) => bridgeMcpTool(server, t));
}
