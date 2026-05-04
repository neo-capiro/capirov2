import { Injectable } from '@nestjs/common';
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

@Injectable()
export class DemoRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateDemoRequestInput) {
    if (input.website?.trim()) {
      return { ok: true };
    }

    await this.prisma.demoRequest.create({
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

    return { ok: true };
  }
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
