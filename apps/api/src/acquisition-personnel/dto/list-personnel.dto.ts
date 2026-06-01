import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

// The global ValidationPipe runs whitelist + forbidNonWhitelisted, so every query
// field needs a class-validator decorator or the request is rejected with 400.
export class ListPersonnelDto {
  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  organization?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  pe_code?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export interface PersonnelListItemDto {
  id: string;
  fullName: string;
  service: string | null;
  organization: string | null;
  title: string | null;
  role: string | null;
  pePrimary: string | null;
  peSecondary: string[];
  emailDomain: string | null;
  publicProfileUrl: string | null;
  confidence: number;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceCount: number;
}

export interface PersonnelListResponseDto {
  data: PersonnelListItemDto[];
  total: number;
  page: number;
  limit: number;
}
