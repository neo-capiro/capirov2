import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateDocumentDto {
  @IsString() name!: string;
  @IsOptional() @IsInt() @Min(0) ordinal?: number;
  @IsOptional() @IsObject() body?: Record<string, unknown>;
}

export class UpdateDocumentDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(0) ordinal?: number;
  @IsOptional() @IsObject() body?: Record<string, unknown>;
}
