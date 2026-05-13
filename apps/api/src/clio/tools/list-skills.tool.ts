import { Injectable } from '@nestjs/common';
import { SkillsService } from '../skills/skills.service.js';
import { tierContextFromExecution } from './tier-helpers.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Returns the full skills catalog (name + title + summary + category).
 * The index is also in the system prompt, but this tool exists so the
 * model can re-discover skills mid-conversation without paying for the
 * full prompt every turn — useful when the user pivots topics.
 */
@Injectable()
export class ListSkillsTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'list_skills',
    description:
      'List all skills available in the Clio skills library. Returns name, title, category, and a short summary per skill. The same list is in your system prompt — call this only when you need to re-check what is available mid-conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Optional category filter: lobbying, productivity, research, writing, developer, analysis.',
        },
      },
    },
  };

  constructor(private readonly skills: SkillsService) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const tier = tierContextFromExecution(ctx);
    const category =
      typeof rawInput.category === 'string' && rawInput.category.trim()
        ? rawInput.category.trim().toLowerCase()
        : null;
    const all = this.skills.list(tier);
    const filtered = category ? all.filter((s) => s.category === category) : all;
    return {
      ok: true,
      count: filtered.length,
      skills: filtered.map((s) => ({
        name: s.name,
        title: s.title,
        category: s.category,
        summary: s.summary,
      })),
    };
  }
}
