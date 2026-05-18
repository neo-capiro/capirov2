import { IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateStrategyDto {
  @IsString()
  @Length(1, 240)
  name!: string;

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  fiscalYear?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  submissionTypes?: string[];
}
