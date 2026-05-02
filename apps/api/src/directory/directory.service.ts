import { gunzipSync } from 'node:zlib';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/config.schema.js';

type Chamber = 'House' | 'Senate' | 'Governor';
type Party = 'D' | 'R' | 'I';
type Region = 'Northeast' | 'South' | 'Midwest' | 'West';

interface DirectoryContact {
  id: string;
  fullName: string;
  photoUrl: string;
  title: string;
  office: string;
  memberName: string;
  chamber: Chamber;
  state: string;
  party: Party;
  region: Region;
  focusAreas: string[];
  committees: string[];
  officeLocation: string;
  phone: string;
  email: string;
  lastTouchpoint: string;
  owner: string;
  relationshipTier: 'Core' | 'Active' | 'Watch';
  notes: string;
  recentInteractions: Array<{ date: string; channel: 'Call' | 'Email' | 'Meeting' | 'Dinner' | 'Briefing'; summary: string }>;
}

type DirectorySort = 'recent' | 'name-asc' | 'name-desc' | 'state-asc';

interface DirectoryQuery {
  q?: string;
  chamber?: string;
  region?: string;
  state?: string;
  sort?: string;
  page?: string | number;
  pageSize?: string | number;
}

interface DirectoryTotals {
  all: number;
  house: number;
  senate: number;
  governors: number;
}

interface DirectoryPayload {
  sourceId: string;
  contacts: DirectoryContact[];
  total: number;
  page: number;
  pageSize: number;
  totals: DirectoryTotals;
  availableStates: string[];
}

interface CachedContacts {
  expiresAt: number;
  data: {
    sourceId: string;
    contacts: DirectoryContact[];
    totals: DirectoryTotals;
    availableStates: string[];
  };
}

@Injectable()
export class DirectoryService {
  private static readonly DEFAULT_PAGE_SIZE = 25;
  private static readonly MAX_PAGE_SIZE = 20_000;
  private readonly logger = new Logger(DirectoryService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private cache: CachedContacts | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
    const region = config.get('AWS_REGION_DEFAULT', { infer: true });
    this.s3 = new S3Client({ region });
    this.bucket =
      process.env.DIRECTORY_S3_BUCKET ??
      'updated-directory-967807252336-us-east-1';
    this.prefix =
      process.env.DIRECTORY_S3_PREFIX ??
      'UPDATED DIRECTORY/snapshots/active-current-20260501T024354Z';
  }

  async getContacts(query: DirectoryQuery = {}): Promise<DirectoryPayload> {
    const page = this.toPositiveInt(query.page, 1);
    const pageSize = this.toPositiveInt(
      query.pageSize,
      DirectoryService.DEFAULT_PAGE_SIZE,
      DirectoryService.MAX_PAGE_SIZE,
    );
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.toPagedPayload(this.cache.data, query, page, pageSize);
    }

    try {
      const [members, staff] = await Promise.all([
        this.fetchGzipJson<unknown[]>(`${this.prefix}/combined/member-list-current.json.gz`),
        this.fetchGzipJson<unknown[]>(`${this.prefix}/combined/staff-list-current.json.gz`),
      ]);

      const contacts = this.buildContacts(members, staff);
      const availableStates = Array.from(new Set(contacts.map((contact) => contact.state))).sort((a, b) =>
        a.localeCompare(b),
      );
      const totals: DirectoryTotals = {
        all: contacts.length,
        house: contacts.filter((contact) => contact.chamber === 'House').length,
        senate: contacts.filter((contact) => contact.chamber === 'Senate').length,
        governors: contacts.filter((contact) => contact.chamber === 'Governor').length,
      };
      const sourceId = `${this.bucket}/${this.prefix}`;
      const payload = { sourceId, contacts, totals, availableStates };

      this.cache = {
        data: payload,
        expiresAt: now + 5 * 60_000,
      };

      return this.toPagedPayload(payload, query, page, pageSize);
    } catch (error) {
      this.logger.error(
        `Failed to load directory contacts from S3 bucket=${this.bucket} prefix=${this.prefix}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Directory data is temporarily unavailable');
    }
  }

  private async fetchGzipJson<T>(key: string): Promise<T> {
    const out = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!out.Body) throw new Error(`No body for s3://${this.bucket}/${key}`);
    const bytes = await out.Body.transformToByteArray();
    const json = gunzipSync(Buffer.from(bytes)).toString('utf8');
    return JSON.parse(json) as T;
  }

  private toPagedPayload(
    base: CachedContacts['data'],
    query: DirectoryQuery,
    page: number,
    pageSize: number,
  ): DirectoryPayload {
    const chamber = this.normalizeFilter(query.chamber);
    const region = this.normalizeFilter(query.region);
    const state = this.normalizeFilter(query.state);
    const normalizedQuery = String(query.q ?? '').trim().toLowerCase();
    const sort = this.normalizeSort(query.sort);

    const filtered = base.contacts.filter((contact) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [contact.fullName, contact.title, contact.office, contact.memberName, contact.focusAreas.join(' '), contact.committees.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      const matchesChamber = chamber === null || contact.chamber === chamber;
      const matchesRegion = region === null || contact.region === region;
      const matchesState = state === null || contact.state === state;
      return matchesQuery && matchesChamber && matchesRegion && matchesState;
    });

    const sorted = this.sortContacts(filtered, sort);
    const total = sorted.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    const contacts = sorted.slice(start, start + pageSize);

    return {
      sourceId: base.sourceId,
      contacts,
      total,
      page: safePage,
      pageSize,
      totals: base.totals,
      availableStates: base.availableStates,
    };
  }

  private sortContacts(entries: DirectoryContact[], sort: DirectorySort): DirectoryContact[] {
    const next = [...entries];

    if (sort === 'name-asc') {
      return next.sort((left, right) => left.fullName.localeCompare(right.fullName));
    }

    if (sort === 'name-desc') {
      return next.sort((left, right) => right.fullName.localeCompare(left.fullName));
    }

    if (sort === 'state-asc') {
      return next.sort((left, right) => {
        const stateCompare = left.state.localeCompare(right.state);
        return stateCompare !== 0 ? stateCompare : left.fullName.localeCompare(right.fullName);
      });
    }

    return next.sort((left, right) => right.lastTouchpoint.localeCompare(left.lastTouchpoint));
  }

  private normalizeSort(raw: unknown): DirectorySort {
    const value = String(raw ?? 'recent');
    if (value === 'name-asc' || value === 'name-desc' || value === 'state-asc') return value;
    return 'recent';
  }

  private normalizeFilter(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    if (!value || value.toLowerCase() === 'all') return null;
    return value;
  }

  private toPositiveInt(raw: unknown, fallback: number, max?: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    const intValue = Math.floor(parsed);
    if (max && intValue > max) return max;
    return intValue;
  }

  private buildContacts(membersRaw: unknown[], staffRaw: unknown[]): DirectoryContact[] {
    const members = Array.isArray(membersRaw) ? membersRaw : [];
    const staffList = Array.isArray(staffRaw) ? staffRaw : [];

    const issuesByStaffId = new Map<number, Set<string>>();
    const rolesByStaffId = new Map<number, Set<string>>();
    const committeeByMemberId = new Map<number, Set<string>>();
    const photoByMemberId = new Map<number, string>();

    for (const row of members as any[]) {
      const memberId = Number(row?.member?.member_id);
      if (Number.isFinite(memberId)) {
        const photos = Array.isArray(row?.photos) ? row.photos : [];
        const primaryPhoto = photos.find((p: any) => p?.url && p?.status === 'public')?.url;
        if (primaryPhoto) photoByMemberId.set(memberId, String(primaryPhoto));

        const committees = Array.isArray(row?.committees) ? row.committees : [];
        for (const committee of committees) {
          const name = committee?.committee_office?.name;
          if (!name) continue;
          if (!committeeByMemberId.has(memberId)) committeeByMemberId.set(memberId, new Set());
          committeeByMemberId.get(memberId)!.add(String(name));
        }
      }

      const stafferIssues = Array.isArray(row?.staffer_issues) ? row.staffer_issues : [];
      for (const issue of stafferIssues) {
        const stafferId = Number(issue?.staffer?.id);
        const issueName = issue?.issue_name;
        if (!Number.isFinite(stafferId) || !issueName) continue;
        if (!issuesByStaffId.has(stafferId)) issuesByStaffId.set(stafferId, new Set());
        issuesByStaffId.get(stafferId)!.add(String(issueName));
      }

      const stafferRoles = Array.isArray(row?.staffer_roles) ? row.staffer_roles : [];
      for (const role of stafferRoles) {
        const stafferId = Number(role?.staffer?.id);
        const roleName = role?.role_name;
        if (!Number.isFinite(stafferId) || !roleName) continue;
        if (!rolesByStaffId.has(stafferId)) rolesByStaffId.set(stafferId, new Set());
        rolesByStaffId.get(stafferId)!.add(String(roleName));
      }
    }

    const contacts: DirectoryContact[] = [];

    for (const row of staffList as any[]) {
      const staff = row?.staff;
      if (!staff) continue;

      const staffId = Number(staff.id);
      if (!Number.isFinite(staffId)) continue;

      const fullName = [staff.preferred_first_name ?? staff.first_name, staff.preferred_last_name ?? staff.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!fullName) continue;

      const emails = Array.isArray(row?.staff_emails) ? row.staff_emails : [];
      const emailRecord = emails.find((e: any) => typeof e?.contact_string === 'string' && e.contact_string.includes('@'));
      const email = String(emailRecord?.contact_string ?? '');

      const addresses = Array.isArray(row?.office_member_addresses) ? row.office_member_addresses : [];
      const address =
        addresses.find((a: any) => a?.member?.profile?.preferred_last_name) ??
        addresses.find((a: any) => a?.member?.profile?.last_name) ??
        addresses[0];

      const member = address?.member;
      const profile = member?.profile;
      const memberId = Number(member?.member_id);
      const memberFirst = profile?.preferred_first_name ?? profile?.first_name ?? '';
      const memberLast = profile?.preferred_last_name ?? profile?.last_name ?? '';
      const memberName = `${memberFirst} ${memberLast}`.trim();

      const officeType = String(member?.office_type_id ?? '').toUpperCase();
      const memberState = String(member?.state_id ?? address?.state_id ?? '').toUpperCase();
      const district = member?.district_no;
      const chamber = this.mapChamber(officeType);
      const office = this.formatOfficeLabel(chamber, memberName, memberState, district);

      const positions = Array.isArray(row?.positions) ? row.positions : [];
      const currentPosition =
        positions.find((p: any) => p?.is_current && p?.position_title) ??
        positions.find((p: any) => p?.position_title) ??
        positions[0];

      const title =
        String(currentPosition?.position_title ?? currentPosition?.position_type ?? '') ||
        [...(rolesByStaffId.get(staffId) ?? [])][0] ||
        'Staff';

      const party = this.mapParty(member?.party);
      const region = this.mapRegion(memberState);

      const phone = String(address?.phone ?? '');
      const officeLocation = [address?.address1, address?.city, address?.state_id]
        .filter(Boolean)
        .join(', ');

      const focusAreas = [...(issuesByStaffId.get(staffId) ?? [])].slice(0, 6);
      const committees = Number.isFinite(memberId)
        ? [...(committeeByMemberId.get(memberId) ?? [])].slice(0, 6)
        : [];

      const lastTouchpoint = this.toIsoDate(
        currentPosition?.updated_at ??
          emailRecord?.updated_at ??
          address?.updated_at,
      );

      const photoUrl = Number.isFinite(memberId) ? photoByMemberId.get(memberId) ?? '' : '';

      contacts.push({
        id: `staff-${staffId}`,
        fullName,
        photoUrl,
        title,
        office,
        memberName: memberName || office,
        chamber,
        state: memberState || 'DC',
        party,
        region,
        focusAreas,
        committees,
        officeLocation,
        phone,
        email,
        lastTouchpoint,
        owner: 'Unassigned',
        relationshipTier: 'Watch',
        notes: '',
        recentInteractions: [],
      });
    }

    return contacts.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  private mapChamber(officeType: string): Chamber {
    if (officeType === 'SM') return 'Senate';
    if (officeType === 'GV') return 'Governor';
    return 'House';
  }

  private mapParty(rawParty: unknown): Party {
    const value = String(rawParty ?? '').toLowerCase();
    if (value.startsWith('r')) return 'R';
    if (value.startsWith('i')) return 'I';
    return 'D';
  }

  private mapRegion(stateCode: string): Region {
    const state = stateCode.toUpperCase();
    const northeast = new Set(['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA']);
    const south = new Set(['DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'KY', 'TN', 'MS', 'AL', 'OK', 'TX', 'AR', 'LA']);
    const midwest = new Set(['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS']);
    if (northeast.has(state)) return 'Northeast';
    if (south.has(state)) return 'South';
    if (midwest.has(state)) return 'Midwest';
    return 'West';
  }

  private formatOfficeLabel(
    chamber: Chamber,
    memberName: string,
    state: string,
    district: unknown,
  ): string {
    if (!memberName) return `${chamber} Office (${state})`;

    if (chamber === 'Senate') {
      return `Sen. ${memberName} (${state})`;
    }

    if (chamber === 'Governor') {
      return `Gov. Office, ${state}`;
    }

    const districtNo = Number(district);
    if (Number.isFinite(districtNo) && districtNo > 0) {
      return `Rep. ${memberName} (${state}-${districtNo})`;
    }

    return `Rep. ${memberName} (${state})`;
  }

  private toIsoDate(raw: unknown): string {
    if (!raw) return '1970-01-01';
    const parsed = new Date(String(raw).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return '1970-01-01';
    return parsed.toISOString().slice(0, 10);
  }
}
