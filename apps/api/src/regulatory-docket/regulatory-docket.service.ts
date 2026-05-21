import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RegulatoryDocketFilters {
  agencyId?: string;
  documentType?: string;
  page?: number;
  limit?: number;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Service exposing Regulations.gov docket data.
 *
 * GLOBAL table — no tenant_id, no RLS.
 * Populated by `pnpm sync:regulatory-dockets`.
 */
@Injectable()
export class RegulatoryDocketService {
  constructor(private readonly prisma: PrismaService) {}

  async listDockets(filters: RegulatoryDocketFilters): Promise<PagedResult<object>> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.agencyId) where.agencyId = filters.agencyId;
    if (filters.documentType) where.documentType = filters.documentType;

    const [data, total] = await Promise.all([
      this.prisma.regulatoryDocket.findMany({
        where,
        orderBy: { postedDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.regulatoryDocket.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getDocket(documentId: string): Promise<object> {
    const doc = await this.prisma.regulatoryDocket.findUnique({
      where: { documentId },
    });
    if (!doc) throw new NotFoundException(`Regulatory docket ${documentId} not found`);
    return doc;
  }

  async getUpcomingDeadlines(days = 30): Promise<object[]> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.regulatoryDocket.findMany({
      where: {
        commentEndDate: { gte: now, lte: cutoff },
        withdrawn: false,
      },
      orderBy: { commentEndDate: 'asc' },
      take: 50,
    });
  }
}
