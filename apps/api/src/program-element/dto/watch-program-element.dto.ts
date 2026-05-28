import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class WatchProgramElementDto {
  @Type(() => Boolean)
  @IsBoolean()
  watching!: boolean;
}
