import { Controller, Get } from '@nestjs/common';
import { TenantContextStore } from '../../tenant/tenant-context.store.js';
import { SkillsService } from './skills.service.js';

/**
 * GET /api/clio/skills — browseable catalog for the SPA's Skills page.
 *
 * Returns the user-tier-filtered subset. Static data, no DB, no
 * pagination — the whole library fits comfortably under 10 skills
 * for now.
 */
@Controller('clio/skills')
export class ClioSkillsController {
  constructor(
    private readonly skills: SkillsService,
    private readonly store: TenantContextStore,
  ) {}

  @Get()
  list() {
    const ctx = this.store.require();
    const tier = ctx.role === 'capiro_admin' ? 'internal' : 'customer';
    return {
      items: this.skills.list(tier).map((s) => ({
        name: s.name,
        title: s.title,
        category: s.category,
        summary: s.summary,
        // Don't surface full instructions over the API — they're for
        // the model. The user-facing page just needs the catalog.
        recommendedTools: s.recommendedTools ?? [],
      })),
    };
  }
}
