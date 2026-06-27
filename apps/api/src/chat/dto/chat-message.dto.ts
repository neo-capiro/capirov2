import {
  IsArray,
  IsIn,
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

class DraftWhitePaperContextItemDto {
  @IsString()
  id!: string;

  @IsString()
  kind!: string;

  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  refId?: string;

  @IsOptional()
  @IsString()
  tag?: string;
}

export class DraftWhitePaperSectionDto {
  @IsString()
  instanceId!: string;

  @IsString()
  sectionId!: string;

  @IsString()
  @MinLength(1)
  heading!: string;

  @IsOptional()
  @IsIn(['draft', 'rewrite', 'improve'])
  mode?: 'draft' | 'rewrite' | 'improve';

  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftWhitePaperContextItemDto)
  contextItems?: DraftWhitePaperContextItemDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}
