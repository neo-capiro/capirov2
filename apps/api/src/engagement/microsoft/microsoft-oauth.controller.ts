import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../../auth/roles.decorator.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { CurrentTenant } from '../../tenant/current-tenant.decorator.js';
import { MicrosoftOAuthService } from './microsoft-oauth.service.js';

class StartOAuthDto {
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @IsOptional()
  @IsEmail()
  accountEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;
}

@Controller('engagement/integrations/microsoft')
export class MicrosoftOAuthController {
  constructor(private readonly oauth: MicrosoftOAuthService) {}

  @Get('capabilities')
  @UseGuards(RolesGuard)
  @Roles('user_admin')
  capabilities() {
    return this.oauth.capabilities();
  }

  // Returns an authorization URL the browser should navigate to. Called from
  // the integrations UI in response to the user clicking "Connect Microsoft".
  @Post('start')
  @UseGuards(RolesGuard)
  @Roles('user_admin')
  start(@CurrentTenant() ctx: TenantContext, @Body() body: StartOAuthDto) {
    return this.oauth.start(ctx, body);
  }

  // Microsoft redirects the browser here with ?code&state. We exchange the
  // code for tokens, persist them, and bounce the user back to the UI.
  // The route stays under the `/api/engagement/...` global prefix and goes
  // through the same Clerk-aware tenant middleware as every other endpoint.
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      const target = `${this.oauth.getSuccessRedirect()}?provider=microsoft_365&error=${encodeURIComponent(
        errorDescription || error,
      )}`;
      res.redirect(302, target);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('Missing code or state');
    }

    const result = await this.oauth.handleCallback({ code, state });
    const target = `${this.oauth.getSuccessRedirect()}?provider=microsoft_365&connectionId=${encodeURIComponent(
      result.connectionId,
    )}&connected=1`;
    res.redirect(302, target);
  }
}
