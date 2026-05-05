import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AssociationEntityType, EngagementProvider, EngagementTaskStatus } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { EngagementService } from './engagement.service.js';

class CreateIntegrationDto {
  @IsEnum(EngagementProvider)
  provider!: EngagementProvider;

  @IsOptional()
  @IsEmail()
  accountEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;
}

class AttendeeDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  role?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  responseStatus?: string;
}

class CreateMeetingDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsString()
  @Length(1, 240)
  subject!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  location?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsEmail()
  organizerEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  organizerName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => AttendeeDto)
  attendees?: AttendeeDto[];
}

class UpdateMeetingDto {
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  status?: string;
}

class CreateNoteDto {
  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsBoolean()
  confidential?: boolean;

  @IsOptional()
  @IsString()
  accessLevel?: string;
}

class CreateDebriefDto extends CreateNoteDto {}

class UpdateMeetingPrepDto {
  @IsOptional()
  @IsString()
  summary?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  agenda?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  talkingPoints?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  risks?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  followUps?: string[];
}

class CreateTaskDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  mailThreadId?: string;

  @IsString()
  @Length(1, 240)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 240)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(EngagementTaskStatus)
  status?: EngagementTaskStatus;
}

class AssociationOverrideDto {
  @IsEnum(AssociationEntityType)
  entityType!: AssociationEntityType;

  @IsUUID()
  entityId!: string;

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class AttachmentUploadDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @IsOptional()
  @IsUUID()
  mailMessageId?: string;

  @IsString()
  @Length(1, 240)
  fileName!: string;

  @IsString()
  @Length(1, 160)
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  contentLength!: number;
}

class ConfirmAttachmentDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @IsOptional()
  @IsUUID()
  mailMessageId?: string;

  @IsString()
  @Length(1, 240)
  fileName!: string;

  @IsString()
  @Length(1, 160)
  contentType!: string;

  @IsString()
  s3Key!: string;

  @IsOptional()
  @IsString()
  checksumSha256?: string;
}

const reportStatuses = ['auto', 'not_started', 'in_progress', 'complete'] as const;

class CreateReportTargetOfficeDto {
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsString()
  @Length(1, 240)
  memberPrincipal!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  committee?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  staffer?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  building?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  leadOwner?: string | null;
}

class UpsertReportTargetOfficeDto extends CreateReportTargetOfficeDto {
  @IsString()
  @Length(1, 240)
  officeKey!: string;

  @IsOptional()
  @IsIn(reportStatuses)
  prepStatus?: (typeof reportStatuses)[number];

  @IsOptional()
  @IsIn(reportStatuses)
  outreachStatus?: (typeof reportStatuses)[number];

  @IsOptional()
  @IsIn(reportStatuses)
  submissionStatus?: (typeof reportStatuses)[number];

  @IsOptional()
  @IsString()
  @Length(1, 80)
  source?: string;
}

@Controller('engagement')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class EngagementController {
  constructor(private readonly service: EngagementService) {}

  @Get('capabilities')
  capabilities() {
    return this.service.capabilities();
  }

  @Get('integrations')
  @Roles('standard_user')
  integrations(@CurrentTenant() ctx: TenantContext) {
    return this.service.listIntegrations(ctx);
  }

  @Post('integrations')
  @Roles('standard_user')
  createIntegration(@CurrentTenant() ctx: TenantContext, @Body() body: CreateIntegrationDto) {
    return this.service.createIntegration(ctx, body);
  }

  @Get('meetings')
  meetings(
    @CurrentTenant() ctx: TenantContext,
    @Query('clientId') clientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listMeetings(ctx, { clientId, from, to });
  }

  @Get('meetings/:id')
  meeting(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.getMeeting(ctx, id);
  }

  @Post('meetings')
  createMeeting(@CurrentTenant() ctx: TenantContext, @Body() body: CreateMeetingDto) {
    return this.service.createMeeting(ctx, body);
  }

  @Put('meetings/:id')
  updateMeeting(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateMeetingDto,
  ) {
    return this.service.updateMeeting(ctx, id, body);
  }

  @Post('meetings/:id/notes')
  createNote(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') meetingId: string,
    @Body() body: CreateNoteDto,
  ) {
    return this.service.createMeetingNote(ctx, meetingId, body);
  }

  @Get('meetings/:id/notes')
  meetingNotes(@CurrentTenant() ctx: TenantContext, @Param('id') meetingId: string) {
    return this.service.listMeetingNotes(ctx, meetingId);
  }

  @Post('meetings/:id/debriefs')
  createDebrief(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') meetingId: string,
    @Body() body: CreateDebriefDto,
  ) {
    return this.service.createMeetingDebrief(ctx, meetingId, body);
  }

  @Get('meetings/:id/debriefs')
  meetingDebriefs(@CurrentTenant() ctx: TenantContext, @Param('id') meetingId: string) {
    return this.service.listMeetingDebriefs(ctx, meetingId);
  }

  @Post('meetings/:id/prep')
  generatePrep(@CurrentTenant() ctx: TenantContext, @Param('id') meetingId: string) {
    return this.service.generateMeetingPrep(ctx, meetingId);
  }

  @Patch('meeting-preps/:id')
  updatePrep(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') prepId: string,
    @Body() body: UpdateMeetingPrepDto,
  ) {
    return this.service.updateMeetingPrep(ctx, prepId, body);
  }

  @Post('meeting-preps/:id/approve')
  approvePrep(@CurrentTenant() ctx: TenantContext, @Param('id') prepId: string) {
    return this.service.approveMeetingPrep(ctx, prepId);
  }

  @Get('mail-threads')
  mailThreads(@CurrentTenant() ctx: TenantContext, @Query('clientId') clientId?: string) {
    return this.service.listMailThreads(ctx, { clientId });
  }

  @Get('reports/overview')
  reportOverview(
    @CurrentTenant() ctx: TenantContext,
    @Query('clientId') clientId?: string,
    @Query('period') period?: string,
  ) {
    return this.service.reportOverview(ctx, { clientId, period });
  }

  @Post('reports/target-offices')
  createReportTargetOffice(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: CreateReportTargetOfficeDto,
  ) {
    return this.service.createReportTargetOffice(ctx, body);
  }

  @Post('reports/target-offices/overrides')
  upsertReportTargetOffice(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: UpsertReportTargetOfficeDto,
  ) {
    return this.service.upsertReportTargetOffice(ctx, body);
  }

  @Get('tasks')
  tasks(@CurrentTenant() ctx: TenantContext, @Query('clientId') clientId?: string) {
    return this.service.listTasks(ctx, { clientId });
  }

  @Post('tasks')
  createTask(@CurrentTenant() ctx: TenantContext, @Body() body: CreateTaskDto) {
    return this.service.createTask(ctx, body);
  }

  @Patch('tasks/:id')
  updateTask(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.service.updateTask(ctx, id, body);
  }

  @Post('associations/override')
  overrideAssociation(@CurrentTenant() ctx: TenantContext, @Body() body: AssociationOverrideDto) {
    return this.service.overrideAssociation(ctx, body);
  }

  @Get('context/:clientId')
  clientContext(@CurrentTenant() ctx: TenantContext, @Param('clientId') clientId: string) {
    return this.service.clientContext(ctx, clientId);
  }

  @Post('attachments/upload-url')
  createAttachmentUploadUrl(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: AttachmentUploadDto,
  ) {
    return this.service.createAttachmentUploadUrl(ctx, body);
  }

  @Post('attachments/confirm')
  confirmAttachment(@CurrentTenant() ctx: TenantContext, @Body() body: ConfirmAttachmentDto) {
    return this.service.confirmAttachment(ctx, body);
  }

  @Get('attachments')
  attachments(
    @CurrentTenant() ctx: TenantContext,
    @Query('clientId') clientId?: string,
    @Query('meetingId') meetingId?: string,
    @Query('mailMessageId') mailMessageId?: string,
  ) {
    return this.service.listAttachments(ctx, { clientId, meetingId, mailMessageId });
  }

  @Delete('attachments/:id')
  deleteAttachment(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.deleteAttachment(ctx, id);
  }
}
