import { BadRequestException, Injectable } from '@nestjs/common';
import { UserMemoryService } from '../memory/user-memory.service.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Save a single fact about the current user that should survive
 * across sessions. The model decides what's worth saving —
 * preferences, ongoing projects, key relationships. Memories surface
 * automatically in the system prompt on future turns; there's no
 * matching `recall` tool because the model doesn't need one.
 */
@Injectable()
export class RememberAboutUserTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'remember_about_user',
    description:
      'Remember a single fact about the user across future conversations. ' +
      "Use sparingly — only for things genuinely worth retaining (preferences, ongoing projects, important relationships, working style). Don't store transient task state; the conversation already covers that. " +
      'Returns the memory id so subsequent turns can reference it.',
    inputSchema: {
      type: 'object',
      required: ['category', 'content'],
      properties: {
        category: {
          type: 'string',
          description:
            'Short tag describing the memory shape: "preference", "fact", "project", "contact", "working_style", or any tag that fits. Used for grouping when displayed back to the model.',
        },
        content: {
          type: 'string',
          description:
            'The fact itself, phrased declaratively from your point of view about the user. E.g. "Prefers terse, code-only responses without prose explanations." Keep under ~250 chars.',
        },
      },
    },
  };

  constructor(private readonly memory: UserMemoryService) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const category = requiredString(rawInput.category, 'category');
    const content = requiredString(rawInput.content, 'content');
    if (content.length > 1000) {
      throw new BadRequestException('content must be under 1000 characters');
    }
    const id = await this.memory.remember(ctx.tenantId, ctx.userId, {
      category,
      content,
    });
    return { ok: true, id };
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${label} must be a non-empty string`);
  }
  return value.trim();
}
