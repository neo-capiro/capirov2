import { IsOptional, IsString } from 'class-validator';

export class ChatContextDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsString()
  engagementId?: string;

  @IsOptional()
  @IsString()
  meetingId?: string;

  @IsOptional()
  @IsString()
  outreachId?: string;

  @IsOptional()
  @IsString()
  workflowInstanceId?: string;

  @IsOptional()
  @IsString()
  workflowTemplateSlug?: string;

  @IsOptional()
  @IsString()
  intelligenceTab?: string;
}
