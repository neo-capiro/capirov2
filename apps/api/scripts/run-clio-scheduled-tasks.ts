/**
 * Clio scheduled-task runner (W3).
 *
 * Executes DUE rows in clio_scheduled_task. v1 is deliberately READ-ONLY and
 * unattended-safe: each task's prompt is run through Anthropic to produce a
 * research digest, delivered to the in-app inbox (clio_proactive_alert) — it
 * NEVER sends email or writes other data on the user's behalf. Side-effecting
 * tools are forbidden at schedule time (clio-schedule.helpers) and this runner
 * does not execute any.
 *
 *   pnpm --filter @capiro/api exec tsx scripts/run-clio-scheduled-tasks.ts
 *
 * Intended cadence: hourly via EventBridge -> ECS run-task. Multi-tenant safe:
 * due rows are read via the system/bypass path, then each task's delivery is
 * written under that task's own tenant id (no cross-tenant leakage).
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { computeNextRunAt, isAllowListSafe } from '../src/clio/clio-schedule.helpers.js';
dotenvConfig();

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--commit');
const MAX_TASKS_PER_RUN = Number(process.env.CLIO_SCHEDULED_MAX_PER_RUN ?? '50');

interface DueTask {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  name: string;
  prompt: string;
  interval_minutes: number;
  tool_allow_list: unknown;
}

/** Produce a short research digest for a task prompt (no tools, read-only). */
async function runPrompt(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.CLIO_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1200,
        system:
          'You are Clio running a scheduled, unattended research task for a government-affairs team. ' +
          'Produce a concise, scannable briefing. You have no tools in this run; if you lack specific data, ' +
          'say what you would check rather than inventing facts. Never claim to have taken an action.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const now = new Date();
  // Read due tasks across tenants via the bypass path (system scan).
  const due = await prisma.$queryRawUnsafe<DueTask[]>(
    `SELECT id, tenant_id, owner_user_id, name, prompt, interval_minutes, tool_allow_list
     FROM clio_scheduled_task
     WHERE enabled = true AND next_run_at <= now()
     ORDER BY next_run_at ASC
     LIMIT ${MAX_TASKS_PER_RUN}`,
  );

  console.log(`[run-clio-scheduled-tasks] ${due.length} due task(s); dryRun=${DRY_RUN}`);
  if (DRY_RUN) {
    console.log(
      'CLIO_SCHEDULED_DRYRUN ' +
        JSON.stringify({ dueCount: due.length, tasks: due.map((t) => ({ id: t.id, name: t.name })) }),
    );
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[run-clio-scheduled-tasks] ANTHROPIC_API_KEY not set');
    process.exitCode = 1;
    return;
  }

  let delivered = 0;
  let failed = 0;
  for (const task of due) {
    // Safety: never run a task whose allow-list somehow contains a side effect.
    const allowList = Array.isArray(task.tool_allow_list)
      ? (task.tool_allow_list as string[])
      : [];
    if (!isAllowListSafe(allowList)) {
      await advance(task, now, 'skipped_unsafe');
      failed++;
      continue;
    }

    const digest = await runPrompt(task.prompt, apiKey);
    if (!digest) {
      await advance(task, now, 'error');
      failed++;
      continue;
    }

    try {
      // Deliver to the in-app inbox under the task's OWN tenant (no leakage).
      await prisma.clioProactiveAlert.create({
        data: {
          tenantId: task.tenant_id,
          alertType: 'scheduled_task',
          title: `Scheduled: ${task.name}`,
          body: digest.slice(0, 8000),
          priority: 'normal',
          sourceType: 'scheduled_task',
          sourceId: `${task.id}:${now.toISOString().slice(0, 10)}`,
          metadata: { taskId: task.id, ownerUserId: task.owner_user_id, runAt: now.toISOString() },
        },
      });
      await advance(task, now, 'ok');
      delivered++;
    } catch (err) {
      console.error(`[run-clio-scheduled-tasks] ${task.id} deliver failed: ${(err as Error).message}`);
      await advance(task, now, 'error');
      failed++;
    }
  }

  console.log(
    'CLIO_SCHEDULED_REPORT ' +
      JSON.stringify({ due: due.length, delivered, failed }),
  );
}

/** Advance next_run_at + write audit fields for a task. */
async function advance(task: DueTask, now: Date, status: string): Promise<void> {
  const next = computeNextRunAt(now, task.interval_minutes);
  await prisma.$executeRawUnsafe(
    `UPDATE clio_scheduled_task
     SET last_run_at = $1, next_run_at = $2, last_status = $3, run_count = run_count + 1, updated_at = now()
     WHERE id = $4`,
    now,
    next,
    status,
    task.id,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
