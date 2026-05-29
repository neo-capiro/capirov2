import { gunzipSync } from 'node:zlib';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Chamber = 'House' | 'Senate' | 'Governor';
type Party = 'D' | 'R' | 'I';
type Region = 'Northeast' | 'South' | 'Midwest' | 'West';

export interface DirectoryAddress {
  id: string;
  title: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string;
  isMain: boolean;
}

export interface DirectoryLink {
  label: string;
  url: string;
  type: string;
}

export interface DirectoryStaffMember {
  id: string;
  fullName: string;
  title: string;
  roles: string[];
  issueAreas: string[];
  email: string;
  phone: string;
  officeLocation: string;
}

export interface DirectoryContact {
  id: string;
  memberId: number;
  bioguideId: string;
  fullName: string;
  memberName: string;
  honorific: string;
  photoUrl: string;
  title: string;
  office: string;
  chamber: Chamber;
  state: string;
  district: string;
  party: Party;
  partyName: string;
  gender: 'F' | 'M' | 'Unknown';
  region: Region;
  isFreshman: boolean;
  servingSince: string;
  focusAreas: string[];
  committees: string[];
  leadershipPositions: string[];
  caucuses: string[];
  educationInstitutions: string[];
  officeLocation: string;
  phone: string;
  fax: string;
  email: string;
  contactFormUrl: string;
  officialLinks: DirectoryLink[];
  addresses: DirectoryAddress[];
  staff: DirectoryStaffMember[];
  bio: {
    dob: string;
    hometown: string;
    birthplace: string;
    occupation: string;
    race: string;
    religion: string;
    pronunciation: string;
  };
  lastTouchpoint: string;
  owner: string;
  relationshipTier: 'Core' | 'Active' | 'Watch';
  notes: string;
  recentInteractions: Array<{
    date: string;
    channel: 'Call' | 'Email' | 'Meeting' | 'Dinner' | 'Briefing';
    summary: string;
  }>;
}

type DirectorySort = 'recent' | 'name-asc' | 'name-desc' | 'state-asc' | 'chamber' | 'party';

export interface DirectoryQuery {
  q?: string;
  freshman?: string;
  chamber?: string;
  party?: string | string[];
  gender?: string;
  leadership?: string | string[];
  caucus?: string | string[];
  committee?: string | string[];
  state?: string | string[];
  district?: string | string[];
  education?: string | string[];
  region?: string;
  sort?: string;
  page?: string | number;
  pageSize?: string | number;
}

export interface DirectoryTotals {
  all: number;
  house: number;
  senate: number;
  governors: number;
  staff: number;
}

export interface DirectoryStaffer {
  id: string;
  fullName: string;
  title: string;
  roles: string[];
  issueAreas: string[];
  email: string;
  phone: string;
  officeLocation: string;
  member: {
    id: string;
    fullName: string;
    memberName: string;
    chamber: Chamber;
    state: string;
    district: string;
    party: Party;
    partyName: string;
    photoUrl: string;
    title: string;
  };
}

export interface DirectoryStaffersPayload {
  staffers: DirectoryStaffer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StaffersQuery {
  q?: string;
  chamber?: string;
  state?: string | string[];
  page?: string | number;
  pageSize?: string | number;
}

export interface DirectoryAvailableFilters {
  chambers: Chamber[];
  parties: Array<{ value: Party; label: string }>;
  genders: Array<{ value: 'F' | 'M'; label: string }>;
  leadership: string[];
  committees: string[];
  caucuses: string[];
  states: string[];
  districts: string[];
  educationInstitutions: string[];
}

export interface DirectoryPayload {
  sourceId: string;
  contacts: DirectoryContact[];
  total: number;
  page: number;
  pageSize: number;
  totals: DirectoryTotals;
  availableStates: string[];
  availableFilters: DirectoryAvailableFilters;
}

export interface DirectoryEmailMatch {
  attendeeEmail: string;
  matchKind: 'member' | 'staff';
  directoryContactId: string;
  directoryContactName: string;
  member: {
    id: string;
    bioguideId: string;
    fullName: string;
    memberName: string;
    title: string;
    chamber: Chamber;
    state: string;
    district: string;
    partyName: string;
    officeLocation: string;
    phone: string;
    email: string;
    bio: DirectoryContact['bio'];
    committees: string[];
    leadershipPositions: string[];
    focusAreas: string[];
    addresses: DirectoryAddress[];
  };
  staff?: {
    id: string;
    fullName: string;
    title: string;
    email: string;
    phone: string;
    officeLocation: string;
    issueAreas: string[];
    roles: string[];
  };
}

export interface CreateDirectoryContactNoteInput {
  body: string;
  directoryContactName?: string;
}

interface CachedContacts {
  expiresAt: number;
  data: {
    sourceId: string;
    contacts: DirectoryContact[];
    staffers: DirectoryStaffer[];
    totals: DirectoryTotals;
    availableStates: string[];
    availableFilters: DirectoryAvailableFilters;
  };
}

interface StaffDetail {
  id: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
  officeLocation: string;
}

const TEST_DIRECTORY_CONTACT: DirectoryContact = {
  id: 'test-member-capiro-profile',
  memberId: -1001,
  bioguideId: 'TEST001',
  fullName: 'Rep. Avery Testwell',
  memberName: 'Avery Testwell',
  honorific: 'Rep.',
  photoUrl: '',
  title: 'Member of Congress - Test Profile',
  office: 'Avery Testwell office (TS-1)',
  chamber: 'House',
  state: 'TS',
  district: 'TS-1',
  party: 'I',
  partyName: 'Independent',
  gender: 'Unknown',
  region: 'South',
  isFreshman: false,
  servingSince: '2021-01-03',
  focusAreas: ['Defense Innovation', 'Federal Procurement', 'Small Business'],
  committees: ['House Committee on Armed Services', 'House Committee on Small Business'],
  leadershipPositions: ['Testing Caucus Co-Chair'],
  caucuses: ['Congressional Test Data Caucus', 'Defense Innovation Caucus'],
  educationInstitutions: ['Example State University', 'National Policy Institute'],
  officeLocation: '123 Test House Office Building, Washington, DC 20515',
  phone: '202-555-0147',
  fax: '202-555-0199',
  email: 'avery.testwell@example.invalid',
  contactFormUrl: 'https://example.invalid/contact/avery-testwell',
  officialLinks: [
    {
      label: 'Website, official',
      url: 'https://example.invalid/avery-testwell',
      type: 'Website',
    },
    {
      label: 'Contact form',
      url: 'https://example.invalid/contact/avery-testwell',
      type: 'Email Form',
    },
    {
      label: 'Email, test',
      url: 'mailto:avery.testwell@example.invalid',
      type: 'Email',
    },
  ],
  addresses: [
    {
      id: 'test-main-office',
      title: 'Main Office',
      address1: '123 Test House Office Building',
      address2: '',
      city: 'Washington',
      state: 'DC',
      zip: '20515',
      phone: '202-555-0147',
      fax: '202-555-0199',
      isMain: true,
    },
    {
      id: 'test-district-office',
      title: 'District Office',
      address1: '456 Constituent Avenue',
      address2: 'Suite 200',
      city: 'Testville',
      state: 'TS',
      zip: '00001',
      phone: '202-555-0188',
      fax: '',
      isMain: false,
    },
  ],
  staff: [
    {
      id: 'test-staff-chief',
      fullName: 'Jordan Sample',
      title: 'Chief of Staff',
      roles: ['Chief of Staff', 'Leadership'],
      issueAreas: ['Defense Innovation', 'Appropriations'],
      email: 'jordan.sample@example.invalid',
      phone: '202-555-0151',
      officeLocation: '123 Test House Office Building',
    },
    {
      id: 'test-staff-leg',
      fullName: 'Morgan Example',
      title: 'Legislative Assistant',
      roles: ['Legislative Assistant'],
      issueAreas: ['Federal Procurement', 'Small Business', 'Technology'],
      email: 'morgan.example@example.invalid',
      phone: '202-555-0152',
      officeLocation: '123 Test House Office Building',
    },
  ],
  bio: {
    dob: '1979-05-15',
    hometown: 'Testville, TS',
    birthplace: 'Example City, TS',
    occupation: 'Attorney; former technology policy advisor',
    race: 'Not specified',
    religion: 'Not specified',
    pronunciation: 'AY-vuh-ree TEST-well',
  },
  lastTouchpoint: '2026-05-04',
  owner: 'Capiro Test Data',
  relationshipTier: 'Watch',
  notes: 'Synthetic directory profile for QA only.',
  recentInteractions: [
    {
      date: '2026-04-29',
      channel: 'Email',
      summary: 'Synthetic outreach record for interface testing.',
    },
  ],
};

@Injectable()
export class DirectoryService {
  private static readonly DEFAULT_PAGE_SIZE = 24;
  private static readonly MAX_PAGE_SIZE = 20_000;
  private readonly logger = new Logger(DirectoryService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private cache: CachedContacts | null = null;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    const region = config.get('AWS_REGION_DEFAULT', { infer: true });
    this.s3 = new S3Client({ region });
    this.bucket = process.env.DIRECTORY_S3_BUCKET ?? 'updated-directory-967807252336-us-east-1';
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
    const base = await this.getDirectoryData();
    return this.toPagedPayload(base, query, page, pageSize);
  }

  // Search across the flattened staffer index (built once at cache time).
  // In-memory filter over the cached dataset — fast even at ~20k staffers.
  async getStaffers(query: StaffersQuery = {}): Promise<DirectoryStaffersPayload> {
    const page = this.toPositiveInt(query.page, 1);
    const pageSize = this.toPositiveInt(
      query.pageSize,
      DirectoryService.DEFAULT_PAGE_SIZE,
      DirectoryService.MAX_PAGE_SIZE,
    );
    const base = await this.getDirectoryData();
    const q = String(query.q ?? '')
      .trim()
      .toLowerCase();
    const chamber = this.normalizeFilter(query.chamber);
    const states = this.normalizeMultiFilter(query.state);

    const filtered = base.staffers.filter((staffer) => {
      const blob = [
        staffer.fullName,
        staffer.title,
        staffer.email,
        staffer.phone,
        staffer.roles.join(' '),
        staffer.issueAreas.join(' '),
        staffer.member.memberName,
        staffer.member.fullName,
        staffer.member.state,
      ]
        .join(' ')
        .toLowerCase();
      const matchesQuery = q.length === 0 || blob.includes(q);
      const matchesChamber = chamber === null || staffer.member.chamber === chamber;
      const matchesState = states.length === 0 || states.includes(staffer.member.state);
      return matchesQuery && matchesChamber && matchesState;
    });

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    return { staffers: filtered.slice(start, start + pageSize), total, page: safePage, pageSize };
  }

  private buildStafferIndex(contacts: DirectoryContact[]): DirectoryStaffer[] {
    const out: DirectoryStaffer[] = [];
    for (const contact of contacts) {
      const member = {
        id: contact.id,
        fullName: contact.fullName,
        memberName: contact.memberName,
        chamber: contact.chamber,
        state: contact.state,
        district: contact.district,
        party: contact.party,
        partyName: contact.partyName,
        photoUrl: contact.photoUrl,
        title: contact.title,
      };
      for (const staffer of contact.staff) {
        out.push({
          id: staffer.id,
          fullName: staffer.fullName,
          title: staffer.title,
          roles: staffer.roles,
          issueAreas: staffer.issueAreas,
          email: staffer.email,
          phone: staffer.phone,
          officeLocation: staffer.officeLocation || contact.officeLocation,
          member,
        });
      }
    }
    return out.sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  async findContactsByEmails(emails: string[], limit = 10): Promise<DirectoryEmailMatch[]> {
    const normalizedEmails = uniqueSorted(
      emails
        .map((email) => normalizeEmailAddress(email))
        .filter((email): email is string => Boolean(email)),
    );
    if (!normalizedEmails.length) return [];

    const emailSet = new Set(normalizedEmails);
    const base = await this.getDirectoryData();
    const matches: DirectoryEmailMatch[] = [];
    const seen = new Set<string>();

    for (const contact of base.contacts) {
      const memberEmail = normalizeEmailAddress(contact.email);
      if (memberEmail && emailSet.has(memberEmail)) {
        const key = `${memberEmail}:${contact.id}:member`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            attendeeEmail: memberEmail,
            matchKind: 'member',
            directoryContactId: contact.id,
            directoryContactName: contact.fullName,
            member: this.toDirectoryMemberContext(contact),
          });
        }
      }

      for (const staffer of contact.staff) {
        const staffEmail = normalizeEmailAddress(staffer.email);
        if (!staffEmail || !emailSet.has(staffEmail)) continue;
        const key = `${staffEmail}:${contact.id}:${staffer.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({
          attendeeEmail: staffEmail,
          matchKind: 'staff',
          directoryContactId: contact.id,
          directoryContactName: contact.fullName,
          member: this.toDirectoryMemberContext(contact),
          staff: {
            id: staffer.id,
            fullName: staffer.fullName,
            title: staffer.title,
            email: staffer.email,
            phone: staffer.phone,
            officeLocation: staffer.officeLocation || contact.officeLocation,
            issueAreas: staffer.issueAreas,
            roles: staffer.roles,
          },
        });
      }
    }

    return matches.slice(0, Math.max(1, Math.min(limit, 500)));
  }

  private async getDirectoryData(): Promise<CachedContacts['data']> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.data;
    }

    try {
      const [members, staff] = await Promise.all([
        this.fetchGzipJson<unknown[]>(`${this.prefix}/combined/member-list-current.json.gz`),
        this.fetchGzipJson<unknown[]>(`${this.prefix}/combined/staff-list-current.json.gz`),
      ]);

      const contacts = this.buildContacts(members, staff);
      const staffers = this.buildStafferIndex(contacts);
      const availableStates = uniqueSorted(contacts.map((contact) => contact.state));
      const availableFilters = this.buildAvailableFilters(contacts);
      const totals: DirectoryTotals = {
        all: contacts.length,
        house: contacts.filter((contact) => contact.chamber === 'House').length,
        senate: contacts.filter((contact) => contact.chamber === 'Senate').length,
        governors: contacts.filter((contact) => contact.chamber === 'Governor').length,
        staff: new Set(staffers.map((staffer) => staffer.id)).size,
      };
      const sourceId = `${this.bucket}/${this.prefix}`;
      const payload = { sourceId, contacts, staffers, totals, availableStates, availableFilters };

      this.cache = {
        data: payload,
        expiresAt: now + 5 * 60_000,
      };

      return payload;
    } catch (error) {
      this.logger.error(
        `Failed to load directory contacts from S3 bucket=${this.bucket} prefix=${this.prefix}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Directory data is temporarily unavailable');
    }
  }

  private toDirectoryMemberContext(contact: DirectoryContact): DirectoryEmailMatch['member'] {
    return {
      id: contact.id,
      bioguideId: contact.bioguideId,
      fullName: contact.fullName,
      memberName: contact.memberName,
      title: contact.title,
      chamber: contact.chamber,
      state: contact.state,
      district: contact.district,
      partyName: contact.partyName,
      officeLocation: contact.officeLocation,
      phone: contact.phone,
      email: contact.email,
      bio: contact.bio,
      committees: contact.committees,
      leadershipPositions: contact.leadershipPositions,
      focusAreas: contact.focusAreas,
      addresses: contact.addresses,
    };
  }

  listContactNotes(ctx: TenantContext, contactId: string) {
    const normalizedContactId = normalizeContactId(contactId);
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.directoryContactNote.findMany({
        where: {
          tenantId: ctx.tenantId,
          directoryContactId: normalizedContactId,
        },
        select: {
          id: true,
          directoryContactId: true,
          directoryContactName: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async createContactNote(
    ctx: TenantContext,
    contactId: string,
    input: CreateDirectoryContactNoteInput,
  ) {
    const normalizedContactId = normalizeContactId(contactId);
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Note body is required');
    if (body.length > 4000)
      throw new BadRequestException('Note body must be 4000 characters or less');

    const directoryContactName = input.directoryContactName?.trim().slice(0, 240) || null;

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const note = await tx.directoryContactNote.create({
        data: {
          tenantId: ctx.tenantId,
          directoryContactId: normalizedContactId,
          directoryContactName,
          body,
          createdByUserId: ctx.userId,
        },
        select: {
          id: true,
          directoryContactId: true,
          directoryContactName: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          action: 'directory_contact_note.created',
          entityType: 'directory_contact_note',
          entityId: note.id,
          after: {
            directoryContactId: normalizedContactId,
            directoryContactName,
          },
        },
      });

      return note;
    });
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
    const freshman = this.normalizeFilter(query.freshman);
    const gender = this.normalizeFilter(query.gender);
    const region = this.normalizeFilter(query.region);
    const parties = this.normalizeMultiFilter(query.party);
    const leadership = this.normalizeMultiFilter(query.leadership);
    const committees = this.normalizeMultiFilter(query.committee);
    const caucuses = this.normalizeMultiFilter(query.caucus);
    const states = this.normalizeMultiFilter(query.state);
    const districts = this.normalizeMultiFilter(query.district);
    const education = this.normalizeMultiFilter(query.education);
    const normalizedQuery = String(query.q ?? '')
      .trim()
      .toLowerCase();
    const sort = this.normalizeSort(query.sort);

    const filtered = base.contacts.filter((contact) => {
      const searchBlob = [
        contact.fullName,
        contact.memberName,
        contact.title,
        contact.office,
        contact.state,
        contact.district,
        contact.partyName,
        contact.phone,
        contact.email,
        contact.contactFormUrl,
        contact.focusAreas.join(' '),
        contact.committees.join(' '),
        contact.leadershipPositions.join(' '),
        contact.staff
          .map((staff) => `${staff.fullName} ${staff.title} ${staff.email} ${staff.phone}`)
          .join(' '),
      ]
        .join(' ')
        .toLowerCase();

      const matchesQuery = normalizedQuery.length === 0 || searchBlob.includes(normalizedQuery);
      const matchesFreshman =
        freshman === null ||
        (freshman === 'Freshman' && contact.isFreshman) ||
        (freshman === 'Non-Freshman' && !contact.isFreshman);
      const matchesChamber = chamber === null || contact.chamber === chamber;
      const matchesRegion = region === null || contact.region === region;
      const matchesGender = gender === null || contact.gender === gender;
      const matchesParty = parties.length === 0 || parties.includes(contact.party);
      const matchesState = states.length === 0 || states.includes(contact.state);
      const matchesDistrict = districts.length === 0 || districts.includes(contact.district);
      const matchesLeadership =
        leadership.length === 0 ||
        contact.leadershipPositions.some((position) => leadership.includes(position));
      const matchesCommittee =
        committees.length === 0 ||
        contact.committees.some((committee) => committees.includes(committee));
      const matchesCaucus =
        caucuses.length === 0 || contact.caucuses.some((caucus) => caucuses.includes(caucus));
      const matchesEducation =
        education.length === 0 ||
        contact.educationInstitutions.some((institution) => education.includes(institution));

      return (
        matchesQuery &&
        matchesFreshman &&
        matchesChamber &&
        matchesRegion &&
        matchesGender &&
        matchesParty &&
        matchesState &&
        matchesDistrict &&
        matchesLeadership &&
        matchesCommittee &&
        matchesCaucus &&
        matchesEducation
      );
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
      availableFilters: base.availableFilters,
    };
  }

  private sortContacts(entries: DirectoryContact[], sort: DirectorySort): DirectoryContact[] {
    const next = [...entries];

    if (sort === 'name-asc') {
      return next.sort((left, right) => this.compareLastName(left, right));
    }

    if (sort === 'name-desc') {
      return next.sort((left, right) => this.compareLastName(right, left));
    }

    if (sort === 'state-asc') {
      return next.sort((left, right) => {
        const stateCompare = left.state.localeCompare(right.state);
        return stateCompare !== 0 ? stateCompare : this.compareLastName(left, right);
      });
    }

    if (sort === 'chamber') {
      return next.sort((left, right) => {
        const chamberCompare = left.chamber.localeCompare(right.chamber);
        return chamberCompare !== 0 ? chamberCompare : this.compareLastName(left, right);
      });
    }

    if (sort === 'party') {
      return next.sort((left, right) => {
        const partyCompare = left.partyName.localeCompare(right.partyName);
        return partyCompare !== 0 ? partyCompare : this.compareLastName(left, right);
      });
    }

    return next.sort((left, right) => right.lastTouchpoint.localeCompare(left.lastTouchpoint));
  }

  private compareLastName(left: DirectoryContact, right: DirectoryContact): number {
    return this.lastNameSortKey(left.memberName).localeCompare(
      this.lastNameSortKey(right.memberName),
    );
  }

  private lastNameSortKey(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const last = parts.at(-1) ?? name;
    const first = parts.slice(0, -1).join(' ');
    return `${last} ${first}`.toLowerCase();
  }

  private buildAvailableFilters(contacts: DirectoryContact[]): DirectoryAvailableFilters {
    return {
      chambers: uniqueSorted(contacts.map((contact) => contact.chamber)) as Chamber[],
      parties: (
        [
          { value: 'D', label: 'Democrat' },
          { value: 'R', label: 'Republican' },
          { value: 'I', label: 'Independent' },
        ] satisfies Array<{ value: Party; label: string }>
      ).filter((party) => contacts.some((contact) => contact.party === party.value)),
      genders: [
        { value: 'F' as const, label: 'Female' },
        { value: 'M' as const, label: 'Male' },
      ].filter((gender) => contacts.some((contact) => contact.gender === gender.value)),
      leadership: uniqueSorted(contacts.flatMap((contact) => contact.leadershipPositions)),
      committees: uniqueSorted(contacts.flatMap((contact) => contact.committees)),
      caucuses: uniqueSorted(contacts.flatMap((contact) => contact.caucuses)),
      states: uniqueSorted(contacts.map((contact) => contact.state)),
      districts: uniqueSorted(
        contacts.map((contact) => contact.district),
        compareDistricts,
      ),
      educationInstitutions: uniqueSorted(
        contacts.flatMap((contact) => contact.educationInstitutions),
      ),
    };
  }

  private normalizeSort(raw: unknown): DirectorySort {
    const value = String(raw ?? 'recent');
    if (
      value === 'name-asc' ||
      value === 'name-desc' ||
      value === 'state-asc' ||
      value === 'chamber' ||
      value === 'party'
    )
      return value;
    return 'recent';
  }

  private normalizeFilter(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    if (!value || value.toLowerCase() === 'all') return null;
    return value;
  }

  private normalizeMultiFilter(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    return uniqueSorted(
      values
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0 && value.toLowerCase() !== 'all'),
    );
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
    const staffById = this.buildStaffDetailsById(staffRaw);
    const contacts: DirectoryContact[] = [];

    for (const row of members as any[]) {
      const member = row?.member;
      const memberId = Number(member?.member_id);
      if (!Number.isFinite(memberId)) continue;

      const profile = member?.profile;
      const memberName = [
        profile?.preferred_first_name ?? profile?.first_name,
        profile?.preferred_last_name ?? profile?.last_name,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!memberName) continue;

      const currentOffice = this.currentMemberOffice(row?.member_offices);
      if (!currentOffice) continue;

      const state = String(currentOffice.state_id ?? '').toUpperCase();
      const chamber = this.mapChamber(String(currentOffice.office_type_id ?? '').toUpperCase());
      const district = this.formatDistrict(chamber, state, currentOffice.district_no);
      const partyName = String(currentOffice.party ?? profile?.bio_details?.party_name ?? '');
      const party = this.mapParty(partyName);
      const honorific = this.honorific(chamber);
      const fullName = `${honorific} ${memberName}`;
      const title = this.primaryTitle(chamber, row?.leaderships);

      const addresses = this.buildAddresses(row?.office_member_addresses);
      const mainAddress = addresses.find((address) => address.isMain) ?? addresses[0];
      const officialLinks = this.buildLinks(row?.social_media);
      const email =
        officialLinks.find(
          (link) => link.type.toLowerCase().includes('email') && link.url.includes('@'),
        )?.url ?? '';
      const contactFormUrl =
        officialLinks.find(
          (link) =>
            link.type.toLowerCase().includes('email') &&
            !link.url.includes('@') &&
            link.url.startsWith('http'),
        )?.url ?? '';
      const committees = this.buildCommittees(row?.committees);
      const leadershipPositions = this.buildLeadership(row?.leaderships);
      const staff = this.buildMemberStaff(row, staffById);
      const focusAreas = uniqueSorted(staff.flatMap((staffer) => staffer.issueAreas)).slice(0, 12);
      const servingSince = this.servingSince(row?.member_offices);
      const photoUrl = this.primaryPhoto(row?.photos);

      contacts.push({
        id: `member-${memberId}`,
        memberId,
        bioguideId: String(member?.bioguide_id ?? ''),
        fullName,
        memberName,
        honorific,
        photoUrl,
        title,
        office: this.formatOfficeLabel(chamber, memberName, state, currentOffice.district_no),
        chamber,
        state: state || 'DC',
        district,
        party,
        partyName: partyName || this.partyLabel(party),
        gender: this.mapGender(profile?.gender),
        region: this.mapRegion(state),
        isFreshman: this.isFreshman(servingSince),
        servingSince,
        focusAreas,
        committees,
        leadershipPositions,
        caucuses: this.buildNamedList(row?.caucuses),
        educationInstitutions: this.buildEducation(row),
        officeLocation: mainAddress ? this.formatAddress(mainAddress) : '',
        phone: mainAddress?.phone ?? '',
        fax: mainAddress?.fax ?? '',
        email,
        contactFormUrl,
        officialLinks,
        addresses,
        staff,
        bio: {
          dob: String(profile?.bio_details?.dob ?? ''),
          hometown: String(profile?.bio_details?.hometown ?? ''),
          birthplace: String(profile?.bio_details?.pob ?? ''),
          occupation: String(profile?.bio_details?.occupation ?? ''),
          race: String(profile?.bio_details?.race_name ?? ''),
          religion: String(profile?.bio_details?.religion_name ?? ''),
          pronunciation: String(profile?.bio_details?.pronunciation ?? ''),
        },
        lastTouchpoint: this.latestDate([
          currentOffice.updated_at,
          mainAddress?.id
            ? row?.office_member_addresses?.find?.((a: any) => String(a?.id) === mainAddress.id)
                ?.updated_at
            : undefined,
          ...(Array.isArray(row?.social_media)
            ? row.social_media.map((link: any) => link?.updated_at)
            : []),
          ...(Array.isArray(row?.committees)
            ? row.committees.map((committee: any) => committee?.updated_at)
            : []),
          ...(Array.isArray(row?.leaderships)
            ? row.leaderships.map((leadership: any) => leadership?.updated_at)
            : []),
        ]),
        owner: 'Unassigned',
        relationshipTier:
          leadershipPositions.length > 0 ? 'Core' : committees.length > 0 ? 'Active' : 'Watch',
        notes: '',
        recentInteractions: [],
      });
    }

    contacts.push(TEST_DIRECTORY_CONTACT);

    return contacts.sort((a, b) => a.memberName.localeCompare(b.memberName));
  }

  private buildStaffDetailsById(staffRaw: unknown[]): Map<number, StaffDetail> {
    const staffById = new Map<number, StaffDetail>();
    const staffList = Array.isArray(staffRaw) ? staffRaw : [];

    for (const row of staffList as any[]) {
      const staff = row?.staff;
      const staffId = Number(staff?.id);
      if (!Number.isFinite(staffId)) continue;

      const fullName = [
        staff?.preferred_first_name ?? staff?.first_name,
        staff?.preferred_last_name ?? staff?.last_name,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!fullName) continue;

      const positions = Array.isArray(row?.positions) ? row.positions : [];
      const currentPosition =
        positions.find((position: any) => position?.is_current && position?.position_title) ??
        positions.find((position: any) => position?.position_title) ??
        positions[0];
      const emails = Array.isArray(row?.staff_emails) ? row.staff_emails : [];
      const emailRecord = emails.find(
        (email: any) =>
          typeof email?.contact_string === 'string' && email.contact_string.includes('@'),
      );
      const addresses = Array.isArray(row?.office_member_addresses)
        ? row.office_member_addresses
        : [];
      const address = addresses.find((entry: any) => entry?.is_main) ?? addresses[0];

      staffById.set(staffId, {
        id: `staff-${staffId}`,
        fullName,
        title: String(currentPosition?.position_title ?? currentPosition?.position_type ?? 'Staff'),
        email: String(emailRecord?.contact_string ?? ''),
        phone: String(address?.phone ?? ''),
        officeLocation: [address?.address1, address?.city, address?.state_id]
          .filter(Boolean)
          .join(', '),
      });
    }

    return staffById;
  }

  private buildMemberStaff(row: any, staffById: Map<number, StaffDetail>): DirectoryStaffMember[] {
    const byStaffId = new Map<number, DirectoryStaffMember>();
    const roles = Array.isArray(row?.staffer_roles) ? row.staffer_roles : [];
    const issues = Array.isArray(row?.staffer_issues) ? row.staffer_issues : [];

    const ensureStaffer = (staffer: any): DirectoryStaffMember | null => {
      const staffId = Number(staffer?.id);
      if (!Number.isFinite(staffId)) return null;
      const detail = staffById.get(staffId);
      const fullName =
        detail?.fullName ??
        [
          staffer?.preferred_first_name ?? staffer?.first_name,
          staffer?.preferred_last_name ?? staffer?.last_name,
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
      if (!fullName) return null;
      const existing = byStaffId.get(staffId);
      if (existing) return existing;
      const created: DirectoryStaffMember = {
        id: `staff-${staffId}`,
        fullName,
        title: detail?.title ?? 'Staff',
        roles: [],
        issueAreas: [],
        email: detail?.email ?? '',
        phone: detail?.phone ?? '',
        officeLocation: detail?.officeLocation ?? '',
      };
      byStaffId.set(staffId, created);
      return created;
    };

    for (const role of roles) {
      const staffer = ensureStaffer(role?.staffer);
      if (!staffer || !role?.role_name) continue;
      staffer.roles.push(String(role.role_name));
      if (staffer.title === 'Staff') staffer.title = String(role.role_name);
    }

    for (const issue of issues) {
      const staffer = ensureStaffer(issue?.staffer);
      if (!staffer || !issue?.issue_name) continue;
      staffer.issueAreas.push(String(issue.issue_name));
    }

    return [...byStaffId.values()]
      .map((staffer) => ({
        ...staffer,
        roles: uniqueSorted(staffer.roles),
        issueAreas: uniqueSorted(staffer.issueAreas),
      }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  private currentMemberOffice(rawOffices: unknown): any | null {
    const offices = Array.isArray(rawOffices) ? rawOffices : [];
    return (
      offices.find((office: any) => String(office?.status ?? '').toLowerCase() === 'in office') ??
      offices.find((office: any) => !office?.end_date || String(office.end_date) >= '2026-01-01') ??
      offices[offices.length - 1] ??
      null
    );
  }

  private buildAddresses(rawAddresses: unknown): DirectoryAddress[] {
    const addresses = Array.isArray(rawAddresses) ? rawAddresses : [];
    return addresses.map((address: any) => ({
      id: String(address?.id ?? ''),
      title: String(address?.title ?? ''),
      address1: String(address?.address1 ?? ''),
      address2: String(address?.address2 ?? ''),
      city: String(address?.city ?? ''),
      state: String(address?.state_id ?? ''),
      zip: [address?.zip, address?.zip_ext].filter(Boolean).join('-'),
      phone: String(address?.phone ?? ''),
      fax: String(address?.fax ?? ''),
      isMain: Boolean(address?.is_main),
    }));
  }

  private buildLinks(rawLinks: unknown): DirectoryLink[] {
    const links = Array.isArray(rawLinks) ? rawLinks : [];
    return links
      .map((link: any) => ({
        label: this.linkLabel(String(link?.contact_type ?? 'Link')),
        type: String(link?.contact_type ?? ''),
        url: String(link?.contact_string ?? ''),
      }))
      .filter((link) => link.url);
  }

  private linkLabel(type: string): string {
    const lower = type.toLowerCase();
    if (lower.includes('website'))
      return type.includes('campaign') ? 'Website, campaign' : 'Website, official';
    if (lower.includes('twitter') || lower.includes('x ('))
      return type.includes('campaign') ? 'X, campaign' : 'X, official';
    if (lower.includes('facebook'))
      return type.includes('campaign') ? 'Facebook, campaign' : 'Facebook, official';
    if (lower.includes('instagram'))
      return type.includes('campaign') ? 'Instagram, campaign' : 'Instagram, official';
    if (lower.includes('youtube'))
      return type.includes('campaign') ? 'YouTube, campaign' : 'YouTube, official';
    if (lower.includes('email')) return type.includes('form') ? 'Contact form' : type;
    return type || 'Link';
  }

  private buildCommittees(rawCommittees: unknown): string[] {
    const committees = Array.isArray(rawCommittees) ? rawCommittees : [];
    return uniqueSorted(
      committees
        .map((committee: any) => committee?.committee_office?.name)
        .filter(Boolean)
        .map(String),
    );
  }

  private buildLeadership(rawLeaderships: unknown): string[] {
    const leaderships = Array.isArray(rawLeaderships) ? rawLeaderships : [];
    return uniqueSorted(
      leaderships
        .filter(
          (leadership: any) => !leadership?.end_date || String(leadership.end_date) >= '2026-01-01',
        )
        .map((leadership: any) => leadership?.position)
        .filter(Boolean)
        .map(String),
    );
  }

  private buildNamedList(rawList: unknown): string[] {
    const list = Array.isArray(rawList) ? rawList : [];
    return uniqueSorted(
      list
        .map((entry: any) => entry?.name ?? entry?.caucus_name ?? entry?.title)
        .filter(Boolean)
        .map(String),
    );
  }

  private buildEducation(row: any): string[] {
    const list = Array.isArray(row?.education)
      ? row.education
      : Array.isArray(row?.educations)
        ? row.educations
        : [];
    return uniqueSorted(
      list
        .map((entry: any) => entry?.school ?? entry?.institution ?? entry?.name)
        .filter(Boolean)
        .map(String),
    );
  }

  private servingSince(rawOffices: unknown): string {
    const offices = Array.isArray(rawOffices) ? rawOffices : [];
    const starts = offices
      .map((office: any) => String(office?.start_date ?? ''))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort();
    return starts[0] ?? '';
  }

  private isFreshman(servingSince: string): boolean {
    return Boolean(servingSince) && servingSince >= '2025-01-03';
  }

  private primaryPhoto(rawPhotos: unknown): string {
    const photos = Array.isArray(rawPhotos) ? rawPhotos : [];
    return String(
      photos.find((photo: any) => photo?.status === 'public' && photo?.is_directory)?.url ??
        photos.find((photo: any) => photo?.status === 'public' && photo?.is_primary)?.url ??
        photos.find((photo: any) => photo?.status === 'public')?.url ??
        '',
    );
  }

  private primaryTitle(chamber: Chamber, rawLeaderships: unknown): string {
    const leadership = this.buildLeadership(rawLeaderships)[0];
    if (leadership) return leadership;
    if (chamber === 'Senate') return 'United States Senator';
    if (chamber === 'Governor') return 'Governor';
    return 'Member of Congress';
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

  private partyLabel(party: Party): string {
    if (party === 'R') return 'Republican';
    if (party === 'I') return 'Independent';
    return 'Democrat';
  }

  private mapGender(rawGender: unknown): DirectoryContact['gender'] {
    const value = String(rawGender ?? '').toUpperCase();
    if (value === 'F' || value === 'M') return value;
    return 'Unknown';
  }

  private mapRegion(stateCode: string): Region {
    const state = stateCode.toUpperCase();
    const northeast = new Set(['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA']);
    const south = new Set([
      'DE',
      'MD',
      'DC',
      'VA',
      'WV',
      'NC',
      'SC',
      'GA',
      'FL',
      'KY',
      'TN',
      'MS',
      'AL',
      'OK',
      'TX',
      'AR',
      'LA',
    ]);
    const midwest = new Set([
      'OH',
      'MI',
      'IN',
      'IL',
      'WI',
      'MN',
      'IA',
      'MO',
      'ND',
      'SD',
      'NE',
      'KS',
    ]);
    if (northeast.has(state)) return 'Northeast';
    if (south.has(state)) return 'South';
    if (midwest.has(state)) return 'Midwest';
    return 'West';
  }

  private honorific(chamber: Chamber): string {
    if (chamber === 'Senate') return 'Sen.';
    if (chamber === 'Governor') return 'Gov.';
    return 'Rep.';
  }

  private formatOfficeLabel(
    chamber: Chamber,
    memberName: string,
    state: string,
    district: unknown,
  ): string {
    if (chamber === 'Senate') return `Senate office, ${state}`;
    if (chamber === 'Governor') return `Governor office, ${state}`;
    const districtNo = Number(district);
    if (Number.isFinite(districtNo) && districtNo > 0) {
      return `${memberName} office (${state}-${districtNo})`;
    }
    return `${memberName} office (${state})`;
  }

  private formatDistrict(chamber: Chamber, state: string, district: unknown): string {
    if (chamber !== 'House') return state;
    const districtNo = Number(district);
    return Number.isFinite(districtNo) && districtNo > 0 ? `${state}-${districtNo}` : state;
  }

  private formatAddress(address: DirectoryAddress): string {
    return [address.address1, address.address2, address.city, address.state, address.zip]
      .filter(Boolean)
      .join(', ');
  }

  private latestDate(values: unknown[]): string {
    const dates = values
      .map((value) => this.toIsoDate(value))
      .filter((value) => value !== '1970-01-01');
    return dates.sort().at(-1) ?? '1970-01-01';
  }

  private toIsoDate(raw: unknown): string {
    if (!raw) return '1970-01-01';
    const parsed = new Date(String(raw).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return '1970-01-01';
    return parsed.toISOString().slice(0, 10);
  }
}

function uniqueSorted<T extends string>(
  values: T[],
  compareFn?: (left: T, right: T) => number,
): T[] {
  return Array.from(new Set(values.filter(Boolean))).sort(
    compareFn ?? ((left, right) => left.localeCompare(right)),
  );
}

function normalizeContactId(contactId: string): string {
  const normalized = contactId.trim();
  if (!normalized) throw new BadRequestException('Directory contact id is required');
  if (normalized.length > 120) throw new BadRequestException('Directory contact id is too long');
  return normalized;
}

function normalizeEmailAddress(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^mailto:/, '');
  if (!normalized) return null;
  const match = normalized.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/);
  return match?.[0] ?? null;
}

function compareDistricts(left: string, right: string): number {
  const [leftState = '', leftDistrictRaw = '0'] = left.split('-');
  const [rightState = '', rightDistrictRaw = '0'] = right.split('-');
  const stateCompare = leftState.localeCompare(rightState);
  if (stateCompare !== 0) return stateCompare;
  return Number(leftDistrictRaw) - Number(rightDistrictRaw);
}
