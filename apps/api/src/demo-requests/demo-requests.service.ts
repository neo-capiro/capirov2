import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateDemoRequestInput {
  name: string;
  email: string;
  company: string;
  role?: string;
  message?: string;
  source?: string;
  website?: string;
  ip?: string;
  userAgent?: string;
}

interface DemoRequestEmailValues {
  requestId: string;
  submittedAt: string;
  name: string;
  email: string;
  company: string;
  role: string;
  message: string;
  source: string;
  ip: string;
  userAgent: string;
}

@Injectable()
export class DemoRequestsService {
  private readonly logger = new Logger(DemoRequestsService.name);
  private readonly ses: SESv2Client;
  private readonly fromAddress: string;
  private readonly toAddress: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    const region = config.get('AWS_REGION_DEFAULT', { infer: true });
    this.ses = new SESv2Client({ region });
    this.fromAddress = config.get('DEMO_REQUEST_EMAIL_FROM', { infer: true });
    this.toAddress = config.get('DEMO_REQUEST_EMAIL_TO', { infer: true });
  }

  async create(input: CreateDemoRequestInput) {
    if (input.website?.trim()) {
      this.logger.warn('Ignored demo request with populated honeypot field');
      return { ok: true };
    }

    const request = await this.prisma.demoRequest.create({
      data: {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        company: input.company.trim(),
        role: normalizeOptional(input.role),
        message: normalizeOptional(input.message),
        source: normalizeOptional(input.source),
        ip: normalizeOptional(input.ip),
        userAgent: normalizeOptional(input.userAgent),
      },
      select: { id: true },
    });

    this.logger.log(
      `Stored demo request ${request.id} for ${input.email.trim().toLowerCase()} (${input.company.trim()})`,
    );

    try {
      await this.sendSalesNotification(request.id, input);
      this.logger.log(`Sent demo request ${request.id} notification to ${this.toAddress}`);
    } catch (error) {
      this.logger.error(
        `Failed to send demo request ${request.id} notification to ${this.toAddress}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Demo request was saved, but the email notification could not be sent. Please email sales@capiro.ai directly.',
      );
    }

    return { ok: true };
  }

  private async sendSalesNotification(requestId: string, input: CreateDemoRequestInput) {
    const submittedAt = new Date().toISOString();
    const values: DemoRequestEmailValues = {
      requestId,
      submittedAt,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      company: input.company.trim(),
      role: normalizeOptional(input.role) ?? 'Not provided',
      message: normalizeOptional(input.message) ?? 'Not provided',
      source: normalizeOptional(input.source) ?? 'Not provided',
      ip: normalizeOptional(input.ip) ?? 'Not available',
      userAgent: normalizeOptional(input.userAgent) ?? 'Not available',
    };

    const subject = `Capiro demo request: ${values.company}`;
    const text = [
      'New Capiro demo request',
      '',
      `Request ID: ${values.requestId}`,
      `Submitted: ${values.submittedAt}`,
      `Name: ${values.name}`,
      `Email: ${values.email}`,
      `Company: ${values.company}`,
      `Role: ${values.role}`,
      `Source: ${values.source}`,
      `IP: ${values.ip}`,
      `User agent: ${values.userAgent}`,
      '',
      'Message:',
      values.message,
    ].join('\n');

    await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [this.toAddress] },
        ReplyToAddresses: [values.email],
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: text, Charset: 'UTF-8' },
              Html: {
                Data: renderDemoRequestEmail(values),
                Charset: 'UTF-8',
              },
            },
          },
        },
      }),
    );
  }
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function renderDemoRequestEmail(values: DemoRequestEmailValues): string {
  return [
    '<!doctype html>',
    '<html><body style="font-family:Arial,sans-serif;color:#101828;line-height:1.45">',
    '<h2 style="margin:0 0 16px">New Capiro demo request</h2>',
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse">',
    row('Request ID', values.requestId),
    row('Submitted', values.submittedAt),
    row('Name', values.name),
    row('Email', values.email),
    row('Company', values.company),
    row('Role', values.role),
    row('Source', values.source),
    row('IP', values.ip),
    row('User agent', values.userAgent),
    '</table>',
    '<h3 style="margin:20px 0 8px">Message</h3>',
    `<p style="white-space:pre-wrap;margin:0">${escapeHtml(values.message)}</p>`,
    '</body></html>',
  ].join('');
}

function row(label: string, value: string): string {
  return `<tr><th align="left" style="color:#667085">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
