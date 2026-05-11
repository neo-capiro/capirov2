import { Injectable } from '@nestjs/common';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

interface GetClientContextInput {
  clientId?: string;
  clientName?: string;
}

interface GetClientContextOutput {
  found: boolean;
  client?: {
    id: string;
    name: string;
    status: string;
    website: string | null;
    description: string | null;
    productDescription: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
  };
  // When clientName lookup matched zero or many rows we return a hint so
  // the agent can re-prompt the user instead of pretending the lookup
  // succeeded.
  candidateNames?: string[];
  reason?: string;
}

@Injectable()
export class GetClientContextTool implements Tool {
  readonly internal = false; // available to every tier — it's only the tenant's own data

  readonly definition: ToolDefinition = {
    name: 'get_client_context',
    description:
      'Fetch the structured profile for a client of the current tenant. ' +
      'Pass either `clientId` (preferred when known) or `clientName` (case-insensitive fuzzy match). ' +
      'Returns the canonical record — name, contact info, description, status. ' +
      'Use this before drafting any client-facing artifact so the output is grounded in real data instead of invented details.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: {
          type: 'string',
          description: 'Capiro client UUID. Preferred when the user has named or pasted one.',
        },
        clientName: {
          type: 'string',
          description:
            'Free-text client name. Substring/case-insensitive match against the canonical name. ' +
            'Only use this when no clientId is available.',
        },
      },
    },
  };

  async execute(input: GetClientContextInput, ctx: ToolExecutionContext): Promise<GetClientContextOutput> {
    const { tx } = ctx;
    if (!input.clientId && !input.clientName) {
      return { found: false, reason: 'Provide either clientId or clientName.' };
    }

    if (input.clientId) {
      const row = await tx.client.findFirst({
        where: { id: input.clientId },
        select: {
          id: true,
          name: true,
          status: true,
          website: true,
          description: true,
          productDescription: true,
          primaryContactName: true,
          primaryContactEmail: true,
          primaryContactPhone: true,
        },
      });
      if (!row) return { found: false, reason: `No client with id ${input.clientId}.` };
      return { found: true, client: row };
    }

    // Name lookup. Case-insensitive substring match — tenant_id filter is
    // already on the table via RLS, so we only see this tenant's rows.
    const candidates = await tx.client.findMany({
      where: { name: { contains: input.clientName!, mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 6,
      select: {
        id: true,
        name: true,
        status: true,
        website: true,
        description: true,
        productDescription: true,
        primaryContactName: true,
        primaryContactEmail: true,
        primaryContactPhone: true,
      },
    });

    if (candidates.length === 0) {
      return { found: false, reason: `No client matches "${input.clientName}".` };
    }
    if (candidates.length === 1) {
      return { found: true, client: candidates[0] };
    }
    return {
      found: false,
      reason: `Multiple clients match "${input.clientName}"; ask the user to clarify.`,
      candidateNames: candidates.map((c) => c.name),
    };
  }
}
