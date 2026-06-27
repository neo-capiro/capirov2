import { IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  @Length(1, 240)
  name?: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  fiscalYear?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  submissionTypes?: string[];

  @IsOptional()
  settings?: Record<string, unknown>;
}
