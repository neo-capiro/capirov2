import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Per-user memory store. The agent uses these as long-term knowledge
 * about the human it's talking to — facts about preferences, projects,
 * relationships, anything the model decided was worth remembering
 * beyond one conversation.
 *
 * The memory is INJECTED into the system prompt on every turn so the
 * model "just knows" things without needing to explicitly call a
 * recall tool. There's a separate `remember_about_user` tool the model
 * uses to write new memories.
 *
 * Tenant-scoped + user-scoped: capiro_admin impersonating tenant A
 * sees a different memory namespace than the same person operating in
 * tenant B. Each combo gets its own slate.
 */
export interface UserMemoryRow {
  id: string;
  category: string;
  content: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class UserMemoryService {
  // Hard cap on memories injected per turn — past about 30 the system
  // prompt gets too noisy for the model. Newer + more-referenced wins.
  private static readonly INJECT_LIMIT = 30;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch the memories that should ride with this turn's system
   * prompt. Ordered by a blend of recency and reference count so a
   * memory you set up months ago but lean on every day stays in
   * context. Bumps `last_used_at` + `ref_count` as a side effect so
   * cold memories naturally drop out of the window over time.
   */
  async loadForPrompt(tenantId: string, userId: string): Promise<UserMemoryRow[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.clioUserMemory.findMany({
        where: { userId },
        // Most-recently-updated first, then by ref_count. This naturally
        // promotes memories the agent has been re-touching (re-saving
        // updates updatedAt) and lets older-but-still-relevant ones bubble.
        orderBy: [{ updatedAt: 'desc' }, { refCount: 'desc' }],
        take: UserMemoryService.INJECT_LIMIT,
        select: {
          id: true,
          category: true,
          content: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });

      // Bump usage metadata fire-and-forget; we don't await the result
      // because the caller is about to make a Bedrock call and a 5ms
      // UPDATE round-trip isn't worth blocking it.
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        void tx.clioUserMemory
          .updateMany({
            where: { id: { in: ids } },
            data: { lastUsedAt: new Date(), refCount: { increment: 1 } },
          })
          .catch(() => undefined);
      }

      return rows;
    });
  }

  /**
   * Insert a new memory. We deliberately do NOT dedupe by content —
   * the model is free to add overlapping memories; cleanup is handled
   * out-of-band (a future pass can run a consolidation prompt).
   * Returns the new row's id so the agent can confirm.
   */
  async remember(
    tenantId: string,
    userId: string,
    input: { category: string; content: string },
  ): Promise<string> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.clioUserMemory.create({
        data: {
          tenantId,
          userId,
          category: input.category.trim(),
          content: input.content.trim(),
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  /**
   * Drop a memory by id. The model uses this when the user says
   * "forget that I work on healthcare" etc. Returns true if a row
   * actually existed (false on a no-op so the model can tell the
   * difference between "done" and "nothing to forget").
   */
  async forget(tenantId: string, userId: string, id: string): Promise<boolean> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const result: Prisma.BatchPayload = await tx.clioUserMemory.deleteMany({
        where: { id, userId },
      });
      return result.count > 0;
    });
  }

  /**
   * Render memories as a plain-text block to splice into the system
   * prompt. Grouped by category for readability, with each item
   * prefixed by its id — that's what the model passes to
   * `forget_about_user` when the human asks to drop a memory.
   */
  static renderForPrompt(rows: UserMemoryRow[]): string {
    if (rows.length === 0) return '';
    const byCat = new Map<string, Array<{ id: string; content: string }>>();
    for (const r of rows) {
      const list = byCat.get(r.category) ?? [];
      list.push({ id: r.id, content: r.content });
      byCat.set(r.category, list);
    }
    const sections: string[] = [];
    for (const [cat, items] of byCat) {
      sections.push(
        `${cat}:\n${items.map((i) => `- [${i.id}] ${i.content}`).join('\n')}`,
      );
    }
    return [
      'What you remember about this user (from past conversations — use this naturally, do not recite it back):',
      sections.join('\n\n'),
      'Each line is prefixed with its memory id in brackets — pass that id to forget_about_user when asked to forget.',
    ].join('\n\n');
  }
}
