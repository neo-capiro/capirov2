import { BadRequestException, Injectable } from '@nestjs/common';
import { UserMemoryService } from '../memory/user-memory.service.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Forget a previously-remembered fact about the user. The id comes
 * from the memory block injected into the system prompt — the model
 * sees each memory tagged with its id and can drop one when the user
 * says "forget that I ...".
 */
@Injectable()
export class ForgetAboutUserTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'forget_about_user',
    description:
      'Forget a specific memory about the user. Call this when the user explicitly asks you to forget something or when a memory is no longer accurate. Memory ids are listed in the system prompt next to each remembered item.',
    inputSchema: {
      type: 'object',
      required: ['memoryId'],
      properties: {
        memoryId: {
          type: 'string',
          description: 'UUID of the memory to forget. From the memory block in the system prompt.',
        },
      },
    },
  };

  constructor(private readonly memory: UserMemoryService) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const id = rawInput.memoryId;
    if (typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('memoryId must be a non-empty string');
    }
    const removed = await this.memory.forget(ctx.tenantId, ctx.userId, id.trim());
    return { ok: removed, found: removed };
  }
}
