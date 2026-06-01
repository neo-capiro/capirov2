/**
 * Sync Congressional committee hearings from Congress.gov API.
 *   pnpm --filter @capiro/api sync:hearings
 *
 * Source: api.congress.gov/v3
 *   List endpoint: GET /hearing/{congress} → minimal records
 *     (chamber, congress, jacketNumber, number, updateDate, url)
 *   Detail endpoint: GET <list-item.url> → full record
 *     (title, dates[], committees[], citation, formats[])
 *
 * The list endpoint does NOT include title/date/committee. The original
 * version of this script tried to read h.date and h.title off list items
 *, every row was null and the safeDate guard `if (!date) continue;`
 * silently skipped them all, so the table stayed empty. Now we fan out
 * to the detail endpoint for each list entry.
 *
 * Each hearing record can have multiple dates (e.g. a multi-day
 * appropriations hearing). We emit ONE committee_hearing row per
 * (jacketNumber, date) pair, keyed `{congress}-{jacketNumber}-{date}`
 * so the kanban / Coming Up widget can show each occurrence separately.
 *
 * Auth: same CONGRESS_API_KEY as sync-congress.ts.
 * Rate limit: 5000 req/h with a key; ~10K hearings × 2 requests each
 * comfortably fits.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const API_KEY = process.env.CONGRESS_API_KEY ?? '';
const DELAY_MS = 250;
const MAX_PAGES_PER_CONGRESS = 20;
const LIST_LIMIT = 100;
const TARGET_CONGRESSES = [118, 119];

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
  // The hearing endpoint exposes no witnesses; witnesses live on the associated
  // committee-meeting record, reached via this eventID. May be absent for older /
  // transcript-only hearings.
  associatedMeeting?: { eventID?: string | null } | null;
}

interface CommitteeMeetingDetail {
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

/** The list item's `url` is the canonical detail URL but doesn't carry the
 *  api_key. We append it (and format=json) so the request authenticates. */
function withAuth(rawUrl: string): string {
  const sep = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${sep}api_key=${API_KEY}&format=json`;
}

/**
 * Fetch witnesses for a hearing via its associated committee-meeting record.
 * The /hearing endpoint carries no witnesses; the /committee-meeting/{congress}/
 * {chamber}/{eventId} record does (name / position / organization). Returns formatted
 * "Name, Position, Organization" strings (the shape the Step 34 hearing extractor
 * parses). Returns [] when there is no associated meeting or no witnesses — many
 * older / transcript-only hearings have none, which is expected.
 */
async function fetchWitnesses(
  congress: number,
  chamber: string,
  eventId: string | null | undefined,
): Promise<string[]> {
  if (!eventId) return [];
  const chamberSlug = chamber.toLowerCase(); // "house" | "senate"
  const url = `${CONGRESS_BASE}/committee-meeting/${congress}/${chamberSlug}/${eventId}?api_key=${API_KEY}&format=json`;
  const resp = await fetchJson<{ committeeMeeting: CommitteeMeetingDetail }>(url);
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

  let totalInserted = 0;
  let totalSkippedNoDate = 0;
  let totalDetailFails = 0;

  try {
    for (const congress of TARGET_CONGRESSES) {
      console.log(`[hearings-sync] fetching ${congress}th Congress`);
      let offset = 0;
      let pageHearings = 0;

      for (let page = 0; page < MAX_PAGES_PER_CONGRESS; page++) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const listUrl = `${CONGRESS_BASE}/hearing/${congress}?api_key=${API_KEY}&format=json&limit=${LIST_LIMIT}&offset=${offset}`;
        const list = await fetchJson<{ hearings: HearingListItem[] }>(listUrl);
        if (!list?.hearings?.length) break;

        for (const item of list.hearings) {
          if (!item.url || !item.jacketNumber) continue;
          // Fetch detail to get title/dates/committees. Rate-limit between
          // detail calls so we stay well under 5000/h with the API key.
          await new Promise((r) => setTimeout(r, DELAY_MS));
          const detailResp = await fetchJson<{ hearing: HearingDetail }>(
            withAuth(item.url),
          );
          const detail = detailResp?.hearing;
          if (!detail) {
            totalDetailFails++;
            continue;
          }

          const title = detail.title ?? '(untitled)';
          const chamber =
            detail.chamber ||
            item.chamber ||
            'Joint'; // sometimes lower-cased like "senate"; normalize:
          const normalizedChamber =
            chamber.toLowerCase() === 'senate'
              ? 'Senate'
              : chamber.toLowerCase() === 'house'
                ? 'House'
                : chamber;
          const committeeName =
            detail.committees?.[0]?.name ?? 'Unknown committee';
          const committeeCode = detail.committees?.[0]?.systemCode ?? null;
          const url = item.url ?? null;

          const dates =
            (detail.dates ?? [])
              .map((d) => safeDate(d.date))
              .filter((d): d is Date => d != null) ?? [];
          if (!dates.length) {
            // No actual hearing date attached, skip rather than insert
            // with a synthetic date.
            totalSkippedNoDate++;
            continue;
          }

          // Witnesses are hearing-level (fetched from the associated committee-meeting
          // record, since /hearing has none). Fetch once per hearing, reuse across the
          // per-date rows. Extra rate-limit delay for the third API call.
          await new Promise((r) => setTimeout(r, DELAY_MS));
          const witnesses = await fetchWitnesses(
            congress,
            normalizedChamber,
            detail.associatedMeeting?.eventID,
          );

          // One row per date so multi-day hearings each appear in the
          // calendar widget. Composite id keeps the upsert idempotent.
          for (const date of dates) {
            const dateKey = date.toISOString().slice(0, 10);
            const id = `${congress}-${item.jacketNumber}-${dateKey}`;
            await prisma.committeeHearing.upsert({
              where: { id },
              update: {
                title,
                chamber: normalizedChamber,
                committeeName,
                committeeCode,
                date,
                type: 'hearing',
                witnesses,
                url,
                syncedAt: new Date(),
              },
              create: {
                id,
                title,
                chamber: normalizedChamber,
                committeeName,
                committeeCode,
                date,
                type: 'hearing',
                witnesses,
                url,
              },
            });
            totalInserted++;
          }
        }

        pageHearings += list.hearings.length;
        offset += LIST_LIMIT;
        console.log(
          `[hearings-sync] ${congress}th Congress: scanned ${pageHearings}, written ${totalInserted}, skipped(no-date) ${totalSkippedNoDate}, detail-fails ${totalDetailFails}`,
        );

        if (list.hearings.length < LIST_LIMIT) break;
      }
    }

    console.log(
      `[hearings-sync] DONE, inserted ${totalInserted}, skipped(no-date) ${totalSkippedNoDate}, detail-fails ${totalDetailFails} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[hearings-sync] FAILED', err);
  process.exit(1);
});
