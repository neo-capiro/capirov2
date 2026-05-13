import { BadRequestException, Injectable } from '@nestjs/common';
import { SkillsService } from '../skills/skills.service.js';
import { tierContextFromExecution } from './tier-helpers.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Loads the full instructions for a named skill. The skill INDEX is
 * already in your system prompt — this tool returns the BODY, which
 * is what you need to actually execute the skill correctly.
 *
 * Usage pattern:
 *   1. User asks something that matches a skill ("write me a policy memo").
 *   2. You recognize the match from the system-prompt index.
 *   3. You call load_skill({name: 'draft_policy_memo'}).
 *   4. You follow the returned instructions for the rest of the turn.
 */
@Injectable()
export class LoadSkillTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'load_skill',
    description:
      "Load a skill's full instructions from the Clio skills library. Call this when a user request matches a skill listed in your system prompt — the body of the skill tells you exactly how to handle it. The skill's recommended tools are returned too, so you know which tools to reach for.",
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description:
            'Skill name from the system-prompt index (e.g. "draft_policy_memo", "research_lobbyist", "code_review").',
        },
      },
    },
  };

  constructor(private readonly skills: SkillsService) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const name = typeof rawInput.name === 'string' ? rawInput.name.trim() : '';
    if (!name) throw new BadRequestException('name is required');
    const tier = tierContextFromExecution(ctx);
    const skill = this.skills.get(name, tier);
    if (!skill) {
      return {
        ok: false,
        error: `No skill named "${name}". Call list_skills to see what's available.`,
      };
    }
    return {
      ok: true,
      name: skill.name,
      title: skill.title,
      category: skill.category,
      summary: skill.summary,
      instructions: skill.instructions,
      recommendedTools: skill.recommendedTools ?? [],
    };
  }
}
