import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class AddContextItemDto {
  @IsIn(['source', 'news', 'free-text']) kind!: 'source' | 'news' | 'free-text';
  @IsObject() payload!: Record<string, unknown>;
}
