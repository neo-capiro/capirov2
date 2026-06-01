import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryProgramElementsDto {
  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  budget_activity?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn(['markup-monitor'])
  mode?: 'markup-monitor';

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  divergence_threshold?: number;

  // Reconciliation queue status filter (Step 29): open | resolved | all.
  @IsOptional()
  @IsString()
  @IsIn(['open', 'resolved', 'dismissed', 'all'])
  status?: string;
}
