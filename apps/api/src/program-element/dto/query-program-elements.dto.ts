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

  // When 'true', restrict the list to PEs that have at least one underlying data
  // signal (FY history row, PE-linked federal award, or a bill referencing the PE).
  // Lets the finder hide sparse/empty PEs so users don't click into blank detail
  // pages. Omitted/any other value = no filter (return all PEs).
  @IsOptional()
  @IsString()
  @IsIn(['true', 'false'])
  has_data?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  divergence_threshold?: number;

  // Reconciliation queue status filter (Step 29): open | resolved | all.
  @IsOptional()
  @IsString()
  @IsIn(['open', 'resolved', 'dismissed', 'all'])
  status?: string;

  // Step 1.4 — budget-delta filters.
  @IsOptional()
  @IsString()
  deltaType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fy?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  minScore?: number;
}
