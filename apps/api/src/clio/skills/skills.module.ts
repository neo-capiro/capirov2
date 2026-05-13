import { Module } from '@nestjs/common';
import { TenantModule } from '../../tenant/tenant.module.js';
import { ListSkillsTool } from '../tools/list-skills.tool.js';
import { LoadSkillTool } from '../tools/load-skill.tool.js';
import { ClioSkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  imports: [TenantModule],
  controllers: [ClioSkillsController],
  providers: [SkillsService, ListSkillsTool, LoadSkillTool],
  exports: [SkillsService, ListSkillsTool, LoadSkillTool],
})
export class ClioSkillsModule {}
