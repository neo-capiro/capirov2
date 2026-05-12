import { Injectable, NotFoundException } from '@nestjs/common';
import { ForgetAboutUserTool } from './forget-about-user.tool.js';
import { GetClientContextTool } from './get-client-context.tool.js';
import { RememberAboutUserTool } from './remember-about-user.tool.js';
import { RenderArtifactTool } from './render-artifact.tool.js';
import type { Tool, ToolDefinition } from './tool.types.js';

export type ClioTier = 'internal' | 'customer';

/**
 * Single source of truth for the tools the Clio agent loop can call.
 *
 * Tier gating lives here, not in the tool itself: every tool declares
 * `internal: boolean` and the registry filters the visible set when the
 * caller asks for a customer-tier list. The agent loop only knows about
 * tools the API has handed it for that session.
 */
@Injectable()
export class ToolRegistryService {
  private readonly tools: Map<string, Tool>;

  constructor(
    private readonly getClientContext: GetClientContextTool,
    private readonly renderArtifact: RenderArtifactTool,
    private readonly rememberAboutUser: RememberAboutUserTool,
    private readonly forgetAboutUser: ForgetAboutUserTool,
  ) {
    this.tools = new Map<string, Tool>([
      [getClientContext.definition.name, getClientContext],
      [renderArtifact.definition.name, renderArtifact],
      [rememberAboutUser.definition.name, rememberAboutUser],
      [forgetAboutUser.definition.name, forgetAboutUser],
    ]);
    // Track-A parallel work adds search_federal_register, search_lda_filings,
    // search_legislative_sources here.
  }

  /** Tool definitions in Bedrock Converse `toolConfig.tools[]` shape, filtered by tier. */
  toolsForTier(tier: ClioTier): ToolDefinition[] {
    return this.list(tier).map((t) => t.definition);
  }

  /**
   * Resolve a tool by name. The internal controller calls this on every
   * /api/clio/internal/tools/:name request — if the tool doesn't exist OR
   * the session's tier doesn't include it, returns NotFound (intentionally
   * indistinguishable from "no such tool" so a customer-tier session can't
   * enumerate internal tools by probing the endpoint).
   */
  resolve(name: string, tier: ClioTier): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new NotFoundException(`Tool "${name}" not found`);
    if (tool.internal && tier !== 'internal') {
      throw new NotFoundException(`Tool "${name}" not found`);
    }
    return tool;
  }

  private list(tier: ClioTier): Tool[] {
    const all = Array.from(this.tools.values());
    return tier === 'internal' ? all : all.filter((t) => !t.internal);
  }
}
