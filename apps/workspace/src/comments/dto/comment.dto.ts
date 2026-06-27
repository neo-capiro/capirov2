import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsString() body!: string;
  @IsOptional() @IsString() quote?: string;
  @IsOptional() @IsObject() anchor?: Record<string, unknown>;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsIn(['editor', 'reviewer', 'viewer', 'commenter'])
  role?: 'editor' | 'reviewer' | 'viewer' | 'commenter';
}

export class UpdateCommentDto {
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsBoolean() resolved?: boolean;
}
