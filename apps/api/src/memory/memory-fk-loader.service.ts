import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextStore } from '../tenant/tenant-context.store.js';
import type { FkRelation } from './memory-graph.helpers.js';

/**
 * Loads authoritative DB foreign-key relations for the current tenant and
 * shapes them into FkRelation[] for the knowledge-graph builder (origin='fk').
 *
 * These are the STRUCTURAL backbone of the graph (Phase A): clients linked to
 * the bills/issues/people/meetings they actually own in Postgres. All queries
 * run under withTenant -> RLS, so a caller only ever sees their tenant's rows.
 *
 * Node id convention (matches memory-graph.helpers + wikilink slugs):
 *   client:<clientId>  bill:<billId>  issue:<code>  person:<personId>
 *   meeting:<meetingId>  office:<slug>
 */
@Injectable()
export class MemoryFkLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCtx: TenantContextStore,
  ) {}

  async loadForCurrentTenant(): Promise<FkRelation[]> {
    const ctx = this.tenantCtx.require();
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const out: FkRelation[] = [];

      // client -> bill (tracked_bill)
      const bills = await tx.$queryRaw<
        Array<{ client_id: string; client_name: string; bill_id: string }>
      >`
        SELECT tb.client_id, c.name AS client_name, tb.bill_id
        FROM tracked_bill tb
        JOIN clients c ON c.id = tb.client_id
        WHERE tb.tenant_id = ${ctx.tenantId}::uuid
      `;
      for (const b of bills) {
        out.push({
          srcType: 'client', srcSlug: b.client_id, srcLabel: b.client_name,
          dstType: 'bill', dstSlug: b.bill_id, dstLabel: b.bill_id,
          relation: 'tracks',
        });
      }

      // client -> issue (issue_codes array on clients)
      const issues = await tx.$queryRaw<
        Array<{ id: string; name: string; code: string }>
      >`
        SELECT c.id, c.name, unnest(c.issue_codes) AS code
        FROM clients c
        WHERE c.tenant_id = ${ctx.tenantId}::uuid
          AND array_length(c.issue_codes, 1) > 0
      `;
      for (const i of issues) {
        out.push({
          srcType: 'client', srcSlug: i.id, srcLabel: i.name,
          dstType: 'issue', dstSlug: i.code, dstLabel: i.code,
          relation: 'works-on',
        });
      }

      // client -> person (client_people)
      const people = await tx.$queryRaw<
        Array<{ client_id: string; client_name: string; person_id: string; person_name: string }>
      >`
        SELECT cp.client_id, c.name AS client_name, cp.id AS person_id, cp.name AS person_name
        FROM client_people cp
        JOIN clients c ON c.id = cp.client_id
        WHERE cp.tenant_id = ${ctx.tenantId}::uuid
      `;
      for (const p of people) {
        out.push({
          srcType: 'client', srcSlug: p.client_id, srcLabel: p.client_name,
          dstType: 'person', dstSlug: p.person_id, dstLabel: p.person_name,
          relation: 'contact',
        });
      }

      // client -> meeting (meetings with a client_id). Debrief bodies are
      // encrypted and intentionally NOT read here — we only link the meeting.
      const meetings = await tx.$queryRaw<
        Array<{ client_id: string; client_name: string; meeting_id: string; subject: string }>
      >`
        SELECT m.client_id, c.name AS client_name, m.id AS meeting_id, m.subject
        FROM meetings m
        JOIN clients c ON c.id = m.client_id
        WHERE m.tenant_id = ${ctx.tenantId}::uuid
          AND m.client_id IS NOT NULL
          AND m.is_internal = false
      `;
      for (const mt of meetings) {
        out.push({
          srcType: 'client', srcSlug: mt.client_id, srcLabel: mt.client_name,
          dstType: 'meeting', dstSlug: mt.meeting_id, dstLabel: mt.subject || 'Meeting',
          relation: 'met-on',
        });
      }

      // meeting -> attendee person (by contactId when present)
      const attendees = await tx.$queryRaw<
        Array<{ meeting_id: string; subject: string; contact_id: string; name: string | null }>
      >`
        SELECT ma.meeting_id, m.subject, ma.contact_id, ma.name
        FROM meeting_attendees ma
        JOIN meetings m ON m.id = ma.meeting_id
        WHERE ma.tenant_id = ${ctx.tenantId}::uuid
          AND ma.contact_id IS NOT NULL
      `;
      for (const a of attendees) {
        out.push({
          srcType: 'meeting', srcSlug: a.meeting_id, srcLabel: a.subject || 'Meeting',
          dstType: 'person', dstSlug: a.contact_id, dstLabel: a.name ?? a.contact_id,
          relation: 'attended-by',
        });
      }

      return out;
    });
  }
}
