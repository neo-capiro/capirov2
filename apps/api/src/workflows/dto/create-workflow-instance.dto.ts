import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateWorkflowInstanceDto {
  @IsString()
  @Length(1, 120)
  templateSlug!: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  title?: string;
}
