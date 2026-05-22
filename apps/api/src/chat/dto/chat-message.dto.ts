import {
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChatContextDto } from './chat-context.dto.js';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content!: string;

  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}

export class EditDraftDto {
  @IsString()
  engagementId!: string;

  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsString()
  currentSubject!: string;

  @IsString()
  currentBody!: string;

  @IsString()
  @MinLength(1)
  instruction!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}

export class EditWorkflowDto {
  @IsString()
  instanceId!: string;

  @IsString()
  fieldKey!: string;

  @IsString()
  currentValue!: string;

  @IsString()
  @MinLength(1)
  instruction!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}
