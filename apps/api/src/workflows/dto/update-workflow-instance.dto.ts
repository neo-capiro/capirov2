import { IsDateString, IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { WorkflowStatus } from '@prisma/client';

export class UpdateWorkflowInstanceDto {
  @IsOptional()
  @IsEnum(WorkflowStatus)
  status?: WorkflowStatus;

  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  targetMemberId?: string;

  @IsOptional()
  @IsDateString()
  submissionDeadline?: string;

  @IsOptional()
  @IsString()
  submissionMethod?: string;
}
