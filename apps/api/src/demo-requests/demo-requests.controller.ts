import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { DemoRequestsService } from './demo-requests.service.js';

class CreateDemoRequestDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(1, 200)
  company!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

@Controller('v1/demo-requests')
export class DemoRequestsController {
  constructor(private readonly service: DemoRequestsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateDemoRequestDto, @Req() req: Request) {
    return this.service.create({
      ...body,
      ip: forwardedIp(req),
      userAgent: req.headers['user-agent'],
    });
  }
}

function forwardedIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') return forwardedFor.split(',')[0]?.trim();
  if (Array.isArray(forwardedFor)) return forwardedFor[0]?.split(',')[0]?.trim();
  return req.ip;
}
