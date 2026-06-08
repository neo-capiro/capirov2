import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const TONES = [
  'professional_neutral',
  'editorial_narrative',
  'technical_dense',
  'conversational_plain',
] as const;

const CONTEXT_KINDS = [
  'meeting',
  'email_thread',
  'capability',
  'prior_submission',
  'intel',
  'research',
  'freeform_note',
] as const;

export class WhitePaperContextItemDto {
  @IsString()
  id!: string;

  @IsIn(CONTEXT_KINDS)
  kind!: (typeof CONTEXT_KINDS)[number];

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsString()
  @MaxLength(8000)
  content!: string;

  @IsOptional()
  @IsString()
  refId?: string;

  @IsOptional()
  @IsString()
  tag?: string;
}

export class GenerateWhitePaperDto {
  @IsOptional()
  @IsString()
  variantSlug?: string;

  @IsOptional()
  @IsIn(TONES)
  tone?: (typeof TONES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  steerNote?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhitePaperContextItemDto)
  contextItems?: WhitePaperContextItemDto[];
}

export class GenerateWhitePaperSectionDto {
  @IsString()
  sectionId!: string;

  @IsString()
  @MaxLength(240)
  heading!: string;

  @IsOptional()
  @IsIn(['draft', 'rewrite', 'improve'])
  mode?: 'draft' | 'rewrite' | 'improve';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  improveDirective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  currentBody?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instruction?: string;

  @IsOptional()
  @IsIn(TONES)
  tone?: (typeof TONES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  steerNote?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhitePaperContextItemDto)
  contextItems?: WhitePaperContextItemDto[];
}
