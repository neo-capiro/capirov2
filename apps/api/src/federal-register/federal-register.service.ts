import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface FederalRegisterFilters {
  type?: string;
  agency?: string;
  topic?: string;
  dateFrom?: string;
  dateTo?: string;
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
 * Service exposing Federal Register document data.
 *
 * GLOBAL table, no tenant_id, no RLS.
 * Populated by `pnpm sync:federal-register`.
 */
@Injectable()
export class FederalRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(filters: FederalRegisterFilters): Promise<PagedResult<object>> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.type) where.type = filters.type.toUpperCase();
    if (filters.agency) where.agencyNames = { has: filters.agency };
    if (filters.topic) where.topics = { has: filters.topic };
    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
      if (filters.dateTo) dateFilter.lte = new Date(filters.dateTo);
      where.publicationDate = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.federalRegisterDocument.findMany({
        where,
        orderBy: { publicationDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.federalRegisterDocument.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getDocument(documentNumber: string): Promise<object> {
    const doc = await this.prisma.federalRegisterDocument.findUnique({
      where: { documentNumber },
    });
    if (!doc) throw new NotFoundException(`Federal Register document ${documentNumber} not found`);
    return doc;
  }

  async getUpcomingDeadlines(days = 30): Promise<object[]> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.federalRegisterDocument.findMany({
      where: {
        commentEndDate: { gte: now, lte: cutoff },
      },
      orderBy: { commentEndDate: 'asc' },
      take: 50,
    });
  }

  async getByAgency(agencyName: string, page = 1, limit = 25): Promise<PagedResult<object>> {
    const pg = Math.max(1, page);
    const lim = Math.min(100, Math.max(1, limit));
    const skip = (pg - 1) * lim;

    const where: Record<string, unknown> = {
      agencyNames: { has: agencyName },
    };

    const [data, total] = await Promise.all([
      this.prisma.federalRegisterDocument.findMany({
        where,
        orderBy: { publicationDate: 'desc' },
        skip,
        take: lim,
      }),
      this.prisma.federalRegisterDocument.count({ where }),
    ]);

    return { data, total, page: pg, limit: lim };
  }
}
