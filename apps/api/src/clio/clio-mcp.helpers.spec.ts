import { describe, expect, test } from '@jest/globals';
import {
  bridgeMcpServerTools,
  bridgeMcpTool,
  bridgedToolName,
  parseBridgedToolName,
  parseMcpToolsList,
  type McpClient,
  type McpToolDescriptor,
} from './clio-mcp.helpers.js';

describe('bridged tool naming', () => {
  test('namespaces and round-trips server + tool', () => {
    const name = bridgedToolName('AWS API', 'call_aws');
    expect(name).toBe('mcp__AWS_API__call_aws');
    expect(parseBridgedToolName(name)).toEqual({ server: 'AWS_API', tool: 'call_aws' });
  });
  test('returns null for non-bridged names', () => {
    expect(parseBridgedToolName('search_congress_bills')).toBeNull();
    expect(parseBridgedToolName('mcp__only')).toBeNull();
  });
});

describe('bridgeMcpTool', () => {
  test('maps to a namespaced Anthropic schema with a default object schema', () => {
    const bridged = bridgeMcpTool('weather', { name: 'forecast' });
    expect(bridged.name).toBe('mcp__weather__forecast');
    expect(bridged.input_schema).toEqual({ type: 'object', properties: {} });
    expect(bridged.description).toContain('weather');
  });
  test('preserves a provided input schema + clamps long descriptions', () => {
    const schema = { type: 'object', properties: { city: { type: 'string' } } };
    const bridged = bridgeMcpTool('weather', {
      name: 'forecast',
      description: 'x'.repeat(2000),
      inputSchema: schema,
    });
    expect(bridged.input_schema).toBe(schema);
    expect(bridged.description.length).toBeLessThanOrEqual(1024);
  });
});

describe('parseMcpToolsList', () => {
  test('parses {tools:[...]} and a bare array, dropping invalid items', () => {
    const fromObj = parseMcpToolsList({ tools: [{ name: 'a' }, { description: 'no name' }, 42] });
    expect(fromObj.map((t) => t.name)).toEqual(['a']);
    const fromArr = parseMcpToolsList([{ name: 'b', description: 'B' }]);
    expect(fromArr[0]).toEqual({ name: 'b', description: 'B', inputSchema: undefined });
  });
  test('non-list input yields []', () => {
    expect(parseMcpToolsList(null)).toEqual([]);
    expect(parseMcpToolsList('nope')).toEqual([]);
  });
});

describe('bridgeMcpServerTools (mocked MCP server)', () => {
  test('lists + bridges all tools via the client interface', async () => {
    const fake: McpClient = {
      listTools: async (): Promise<McpToolDescriptor[]> => [
        { name: 'forecast', description: 'Weather' },
        { name: 'alerts' },
      ],
      callTool: async () => ({ ok: true }),
    };
    const bridged = await bridgeMcpServerTools('weather', fake);
    expect(bridged.map((b) => b.name)).toEqual(['mcp__weather__forecast', 'mcp__weather__alerts']);
  });
});
