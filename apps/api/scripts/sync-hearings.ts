/**
 * Sync Congressional committee hearings & markups from Congress.gov API.
 *   pnpm --filter @capiro/api sync:hearings
 *
 * Source: api.congress.gov/v3
 *
 * TWO complementary sources, both written to `committee_hearing`:
 *
 *   1. /committee-meeting/{congress}  ← PRIMARY, forward-looking SCHEDULE.
 *      This is the only Congress.gov endpoint that carries UPCOMING /
 *      scheduled hearings & markups (with date, time, room, status). The
 *      list endpoint is minimal (eventId, chamber, url); we fan out to the
 *      detail endpoint for date/title/type/committee/location.
 *      Row id: `cm-{congress}-{eventId}`.
 *
 *   2. /hearing/{congress}  ← historical / transcript records + witnesses.
 *      Records here only appear weeks-to-months AFTER a hearing, so on its
 *      own it can never show upcoming hearings — that was the original
 *      staleness bug. We keep it for back-catalog depth and witness lists.
 *      Row id: `{congress}-{jacketNumber}-{date}`.
 *
 * Committee detail records expose only a systemCode, not a name, so we
 * prebuild a systemCode→name cache from /committee/{chamber} (covers full
 * + sub-committees) once per run.
 *
 * Auth: CONGRESS_API_KEY (same as sync-congress.ts). Rate limit 5000/h with
 * a key; the per-request DELAY_MS keeps us comfortably under it.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { runWithSyncRun } from '../src/ingestion/sync-run.helper.js';
dotenvConfig();

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const API_KEY = process.env.CONGRESS_API_KEY ?? '';
const DELAY_MS = 150;
const LIST_LIMIT = 250;
const MEETING_MAX_PAGES = 40; // 40 × 250 = 10k headroom (119th has ~2.5k)
const HEARING_MAX_PAGES = 30; // 30 × 100 = 3k headroom (119th has ~770)
const HEARING_LIST_LIMIT = 100;
// Only the current Congress. The previous (118th) is finished — re-scanning it
// every day wrote 0 genuinely new rows and doubled runtime.
const TARGET_CONGRESSES = [119];

interface MeetingListItem {
  eventId?: string | null;
  chamber?: string | null;
  congress?: number | null;
  url?: string | null;
}

interface MeetingDetail {
  eventId?: string | null;
  chamber?: string | null;
  congress?: number | null;
  title?: string | null;
  type?: string | null; // Hearing, Markup, Meeting, Open Hearing, ...
  meetingStatus?: string | null; // Scheduled, Postponed, Rescheduled, Cancelled
  date?: string | null; // ISO datetime, e.g. 2026-06-25T14:15:00Z
  location?: { building?: string | null; room?: string | null } | null;
  committees?: Array<{ name?: string | null; systemCode?: string | null }> | null;
  // Public-facing links (event page, video). The list/detail `url` is the API
  // endpoint and requires an api_key — never store it for the UI.
  videos?: Array<{ name?: string | null; url?: string | null }> | null;
}

interface HearingListItem {
  chamber?: string | null;
  congress?: number | null;
  jacketNumber?: number | null;
  number?: number | null;
  updateDate?: string | null;
  url?: string | null;
}

interface HearingDetail {
  title?: string | null;
  chamber?: string | null;
  citation?: string | null;
  committees?: Array<{ name?: string | null; systemCode?: string | null }> | null;
  dates?: Array<{ date?: string | null }> | null;
  jacketNumber?: number | null;
  number?: number | null;
  updateDate?: string | null;
  // Public transcript links (HTM/PDF) on congress.gov — no api_key needed.
  formats?: Array<{ type?: string | null; url?: string | null }> | null;
  associatedMeeting?: { eventID?: string | null } | null;
}

interface CommitteeMeetingWitnessDetail {
  witnesses?: Array<{
    name?: string | null;
    position?: string | null;
    organization?: string | null;
  }> | null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as T;
  } catch (err) {
    console.warn(`GET ${url}: ${(err as Error).message}`);
    return null;
  }
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Format the time-of-day from an ISO datetime as "2:15 PM" (UTC). Congress.gov
 *  encodes hearing times as UTC wall-clock for the chamber; we render as-is. */
function formatTime(iso: string | null | undefined): string | null {
  const d = safeDate(iso);
  if (!d) return null;
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return null; // date-only record, no real time
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatLocation(loc: MeetingDetail['location']): string | null {
  if (!loc) return null;
  const parts = [loc.building?.trim(), loc.room ? `Room ${loc.room.trim()}` : null].filter(
    (p): p is string => !!p,
  );
  return parts.length ? parts.join(', ') : null;
}

function normalizeChamber(raw: string | null | undefined, fallback?: string | null): string {
  const c = (raw || fallback || 'Joint').toLowerCase();
  if (c === 'senate') return 'Senate';
  if (c === 'house') return 'House';
  return raw || fallback || 'Joint';
}

/** Public-facing congress.gov event page for a committee meeting. The API
 *  also returns this in videos[].url; we prefer that when present and otherwise
 *  construct the canonical form:
 *    https://www.congress.gov/event/{congress}th-Congress/{chamber}-event/{eventId}
 *  NEVER store the api.congress.gov URL — it requires an api_key and renders
 *  an API_KEY_MISSING error in the browser. */
function meetingPublicUrl(
  detail: MeetingDetail,
  congress: number,
  chamber: string,
  eventId: string,
): string | null {
  const fromVideo = detail.videos?.find(
    (v) => v.url && v.url.includes('congress.gov/event'),
  )?.url;
  if (fromVideo) return fromVideo;
  const chamberSlug = chamber.toLowerCase();
  if (chamberSlug !== 'house' && chamberSlug !== 'senate') return null;
  return `https://www.congress.gov/event/${congress}th-Congress/${chamberSlug}-event/${eventId}`;
}

/** Public transcript link for a hearing: prefer Formatted Text (HTM), fall
 *  back to PDF, from the detail formats[]. Returns null when no public
 *  transcript exists yet (common for very recent hearings). */
function hearingPublicUrl(detail: HearingDetail): string | null {
  const fmts = detail.formats ?? [];
  const htm = fmts.find((f) => (f.type || '').toLowerCase().includes('text'))?.url;
  const pdf = fmts.find((f) => (f.type || '').toLowerCase().includes('pdf'))?.url;
  return htm ?? pdf ?? null;
}

function withAuth(rawUrl: string): string {
  const sep = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${sep}api_key=${API_KEY}&format=json`;
}

/** Build a systemCode → committee name cache (full + sub-committees, both
 *  chambers). One bulk endpoint per page; ~2-3 pages per chamber. */
async function buildCommitteeNameCache(): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  for (const chamber of ['house', 'senate']) {
    let offset = 0;
    for (let page = 0; page < 6; page++) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const url = `${CONGRESS_BASE}/committee/${chamber}?api_key=${API_KEY}&format=json&limit=250&offset=${offset}`;
      const resp = await fetchJson<{
        committees: Array<{ systemCode?: string | null; name?: string | null }>;
      }>(url);
      const items = resp?.committees ?? [];
      for (const c of items) {
        if (c.systemCode && c.name) cache.set(c.systemCode, c.name);
      }
      if (items.length < 250) break;
      offset += 250;
    }
  }
  console.log(`[hearings-sync] committee-name cache: ${cache.size} entries`);
  return cache;
}

/** Witnesses live on the committee-meeting record (the /hearing endpoint has
 *  none). Returns "Name, Position, Organization" strings. */
async function fetchWitnesses(
  congress: number,
  chamber: string,
  eventId: string | null | undefined,
): Promise<string[]> {
  if (!eventId) return [];
  const chamberSlug = chamber.toLowerCase();
  const url = `${CONGRESS_BASE}/committee-meeting/${congress}/${chamberSlug}/${eventId}?api_key=${API_KEY}&format=json`;
  const resp = await fetchJson<{ committeeMeeting: CommitteeMeetingWitnessDetail }>(url);
  const witnesses = resp?.committeeMeeting?.witnesses ?? [];
  return witnesses
    .map((w) =>
      [w.name?.trim(), w.position?.trim(), w.organization?.trim()]
        .filter((p): p is string => !!p)
        .join(', '),
    )
    .filter((s) => s.length > 0);
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[hearings-sync] starting');
  if (!API_KEY) throw new Error('CONGRESS_API_KEY env var is required');

  let meetingUpserts = 0;
  let meetingSkippedNoDate = 0;
  let meetingDetailFails = 0;
  let hearingUpserts = 0;
  let hearingSkippedNoDate = 0;
  let hearingDetailFails = 0;

  try {
    await runWithSyncRun(prisma as any, 'sync-hearings', async () => {
      const committeeNames = await buildCommitteeNameCache();

      /* ── Source 1: committee-meeting schedule (forward-looking) ──────── */
      for (const congress of TARGET_CONGRESSES) {
        console.log(`[hearings-sync] committee-meeting: fetching ${congress}th Congress`);
        let offset = 0;
        let scanned = 0;

        for (let page = 0; page < MEETING_MAX_PAGES; page++) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          const listUrl = `${CONGRESS_BASE}/committee-meeting/${congress}?api_key=${API_KEY}&format=json&limit=${LIST_LIMIT}&offset=${offset}`;
          const list = await fetchJson<{ committeeMeetings: MeetingListItem[] }>(listUrl);
          if (!list?.committeeMeetings?.length) break;

          for (const item of list.committeeMeetings) {
            if (!item.eventId || !item.url) continue;
            await new Promise((r) => setTimeout(r, DELAY_MS));
            const detailResp = await fetchJson<{ committeeMeeting: MeetingDetail }>(
              withAuth(item.url),
            );
            const d = detailResp?.committeeMeeting;
            if (!d) {
              meetingDetailFails++;
              continue;
            }

            const date = safeDate(d.date);
            if (!date) {
              meetingSkippedNoDate++;
              continue;
            }

            const chamber = normalizeChamber(d.chamber, item.chamber);
            const sysCode = d.committees?.[0]?.systemCode ?? null;
            const committeeName =
              (sysCode ? committeeNames.get(sysCode) : null) ??
              d.committees?.[0]?.name ??
              'Unknown committee';
            // Surface non-scheduled status in the title so the UI shows it
            // without a schema change.
            const status = d.meetingStatus?.trim();
            const baseTitle = d.title?.trim() || '(untitled)';
            const title =
              status && status.toLowerCase() !== 'scheduled'
                ? `[${status}] ${baseTitle}`
                : baseTitle;

            const id = `cm-${congress}-${item.eventId}`;
            const row = {
              title,
              chamber,
              committeeName,
              committeeCode: sysCode,
              date,
              time: formatTime(d.date),
              location: formatLocation(d.location),
              type: d.type?.trim() || 'Meeting',
              url: meetingPublicUrl(d, congress, chamber, item.eventId),
            };
            await prisma.committeeHearing.upsert({
              where: { id },
              update: { ...row, syncedAt: new Date() },
              create: { id, witnesses: [], ...row },
            });
            meetingUpserts++;
          }

          scanned += list.committeeMeetings.length;
          offset += LIST_LIMIT;
          console.log(
            `[hearings-sync] committee-meeting ${congress}th: scanned ${scanned}, upserts ${meetingUpserts}, skipped(no-date) ${meetingSkippedNoDate}, detail-fails ${meetingDetailFails}`,
          );
          if (list.committeeMeetings.length < LIST_LIMIT) break;
        }
      }

      /* ── Source 2: hearing transcripts + witnesses (historical) ──────── */
      for (const congress of TARGET_CONGRESSES) {
        console.log(`[hearings-sync] hearing-transcripts: fetching ${congress}th Congress`);
        let offset = 0;
        let scanned = 0;

        for (let page = 0; page < HEARING_MAX_PAGES; page++) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          const listUrl = `${CONGRESS_BASE}/hearing/${congress}?api_key=${API_KEY}&format=json&limit=${HEARING_LIST_LIMIT}&offset=${offset}`;
          const list = await fetchJson<{ hearings: HearingListItem[] }>(listUrl);
          if (!list?.hearings?.length) break;

          for (const item of list.hearings) {
            if (!item.url || !item.jacketNumber) continue;
            await new Promise((r) => setTimeout(r, DELAY_MS));
            const detailResp = await fetchJson<{ hearing: HearingDetail }>(withAuth(item.url));
            const detail = detailResp?.hearing;
            if (!detail) {
              hearingDetailFails++;
              continue;
            }

            const title = detail.title ?? '(untitled)';
            const chamber = normalizeChamber(detail.chamber, item.chamber);
            const sysCode = detail.committees?.[0]?.systemCode ?? null;
            const committeeName =
              (sysCode ? committeeNames.get(sysCode) : null) ??
              detail.committees?.[0]?.name ??
              'Unknown committee';

            const dates =
              (detail.dates ?? [])
                .map((dd) => safeDate(dd.date))
                .filter((dd): dd is Date => dd != null) ?? [];
            if (!dates.length) {
              hearingSkippedNoDate++;
              continue;
            }

            await new Promise((r) => setTimeout(r, DELAY_MS));
            const witnesses = await fetchWitnesses(
              congress,
              chamber,
              detail.associatedMeeting?.eventID,
            );

            for (const date of dates) {
              const dateKey = date.toISOString().slice(0, 10);
              const id = `${congress}-${item.jacketNumber}-${dateKey}`;
              const publicUrl = hearingPublicUrl(detail);
              await prisma.committeeHearing.upsert({
                where: { id },
                update: {
                  title,
                  chamber,
                  committeeName,
                  committeeCode: sysCode,
                  date,
                  type: 'hearing',
                  witnesses,
                  url: publicUrl,
                  syncedAt: new Date(),
                },
                create: {
                  id,
                  title,
                  chamber,
                  committeeName,
                  committeeCode: sysCode,
                  date,
                  type: 'hearing',
                  witnesses,
                  url: publicUrl,
                },
              });
              hearingUpserts++;
            }
          }

          scanned += list.hearings.length;
          offset += HEARING_LIST_LIMIT;
          console.log(
            `[hearings-sync] hearing-transcripts ${congress}th: scanned ${scanned}, upserts ${hearingUpserts}, skipped(no-date) ${hearingSkippedNoDate}, detail-fails ${hearingDetailFails}`,
          );
          if (list.hearings.length < HEARING_LIST_LIMIT) break;
        }
      }

      const totalUpserts = meetingUpserts + hearingUpserts;
      console.log(
        `[hearings-sync] DONE: meeting-upserts ${meetingUpserts}, hearing-upserts ${hearingUpserts}, ` +
          `skipped(no-date) ${meetingSkippedNoDate + hearingSkippedNoDate}, detail-fails ${meetingDetailFails + hearingDetailFails} ` +
          `in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      return {
        inserted: 0,
        updated: totalUpserts,
        skipped: meetingSkippedNoDate + hearingSkippedNoDate,
        errors: meetingDetailFails + hearingDetailFails,
      };
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[hearings-sync] FAILED', err);
  process.exit(1);
});
