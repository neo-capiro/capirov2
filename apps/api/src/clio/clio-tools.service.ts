import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngagementTaskStatus, Prisma, WorkflowStatus } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { EngagementService } from '../engagement/engagement.service.js';
import { WorkflowsService } from '../workflows/workflows.service.js';
import { StrategiesService } from '../strategies/strategies.service.js';
import { MicrosoftGraphSyncService } from '../engagement/microsoft/microsoft-graph-sync.service.js';
import { LdaIntelService } from '../lda-intel/lda-intel.service.js';
import { LobbyIntelService } from '../lobby-intel/lobby-intel.service.js';
import { FederalSpendingService } from '../federal-spending/federal-spending.service.js';
import { ProgramElementReadService } from '../program-element/program-element-read.service.js';
import { AcquisitionPersonnelReadService } from '../acquisition-personnel/acquisition-personnel-read.service.js';
import { ClioDocgenService } from './clio-docgen.service.js';
import {
  mimeForFormat,
  normalizeExcelSpec,
  normalizePptxSpec,
  normalizeWordSpec,
  slugifyDocName,
  type DocFormat,
} from './clio-docgen.helpers.js';
import {
  computeNextRunAt,
  validateScheduleRequest,
} from './clio-schedule.helpers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildSavedMemoryRecord } from './clio-memory.helpers.js';

const PRODUCT_NAME = 'Clio';

const TOOL_DEFINITIONS = [
  {
    name: 'get_client_context',
    description: 'Load authorized Capiro client context, recent meetings, threads, contacts, and tasks.',
  },
  {
    name: 'search_research_sources',
    description: 'Search authorized Capiro clients, meetings, mail, notes, and directory notes.',
  },
  {
    name: 'query_intelligence',
    description: 'Query federal lobbying intelligence: surging LDA issues, trending topics, recent congressional bills, federal spending data, and counts of available intelligence data sources (SEC filings, FARA registrations, GAO reports, grants, hearings, state bills, CRS reports, news articles, economic data). Optionally filter by a client name for contractor spending.',
  },
  {
    name: 'search_congress_bills',
    description: 'Search congressional bills in the Capiro database (118th and 119th Congress). Filter by keyword, policy area, congress number, or recent activity date. Returns bill title, sponsor, latest action, policy area, and cosponsors count.',
  },
  {
    name: 'search_lda_filings',
    description: 'Search LDA lobbying disclosure filings in the Capiro database. Filter by client name, registrant, issue area, or keyword.',
  },
  {
    name: 'search_sec_filings',
    description: 'Search SEC EDGAR filings (10-K, 10-Q, 8-K, DEF14A, S-1, etc.) in the Capiro database. Filter by company name, form type, CIK, or date range. Returns company, form type, filing date, and description.',
  },
  {
    name: 'search_fara_registrations',
    description: 'Search FARA (Foreign Agents Registration Act) registrations. Filter by registrant name, foreign principal, country, or status. Returns registrant, foreign principal, country, and status.',
  },
  {
    name: 'search_federal_grants',
    description: 'Search federal grant opportunities (NOFOs) from Grants.gov. Filter by agency, keyword, status (posted/closed/forecasted), or date range. Returns title, agency, funding amounts, eligibility, and deadlines.',
  },
  {
    name: 'search_federal_awards',
    description: 'Search federal contract awards/obligations (USAspending) the firm has synced. Filter by keyword, awarding agency, or Program Element (PE) code. Returns contractor, agency, amount, description, PE code, and place-of-performance — useful for defense-contracting and PE-linked questions.',
  },
  {
    name: 'search_gao_reports',
    description: 'Search GAO (Government Accountability Office) reports and testimonies. Filter by keyword, report type, topic, or agency. Returns title, report type, date, topics, and recommendations count.',
  },
  {
    name: 'search_state_bills',
    description: 'Search state legislature bills via OpenStates data. Filter by state (2-letter code), keyword, subject, or session. Returns identifier, title, sponsor, latest action, and subjects.',
  },
  {
    name: 'search_intel_articles',
    description: 'Search aggregated policy news and intelligence articles from sources like Roll Call, The Hill, Axios, Politico, Brookings, and agency press. Filter by keyword, source, or topic.',
  },
  {
    name: 'search_committee_hearings',
    description: 'Search congressional committee hearings, markups, and meetings. Filter by committee name, chamber (House/Senate/Joint), keyword, or date range.',
  },
  {
    name: 'search_crs_reports',
    description: 'Search Congressional Research Service (CRS) reports and analyses. Filter by keyword, topic, or author.',
  },
  {
    name: 'query_economic_data',
    description: 'Query economic indicators from BLS (Bureau of Labor Statistics), Census (ACS district demographics), and BEA (Bureau of Economic Analysis GDP/industry data). Specify data source and parameters like state, district, series, or year.',
  },
  {
    name: 'search_public_web',
    description: 'Search public internet sources for recent developments. Use this only as supplemental context after Capiro internal data tools for government-affairs answers.',
  },
  {
    name: 'scrape_web_page',
    description: 'Fetch and extract readable text from a public webpage URL for grounded analysis. Blocks localhost/private-network targets.',
  },
  {
    name: 'create_meeting_brief',
    description: 'Create and persist a deterministic meeting brief artifact from authorized Capiro data.',
  },
  {
    name: 'draft_policy_memo',
    description: 'Create and persist a policy memo artifact from authorized Capiro client context.',
  },
  {
    name: 'save_note',
    description: 'Save a user-scoped Clio note and optionally an encrypted Capiro meeting note.',
  },
  {
    name: 'send_email',
    description: 'Send an email via the tenant\'s connected Microsoft 365 account on behalf of Clio.',
  },
  {
    name: 'list_emails',
    description: 'List recent email threads from the tenant\'s connected Microsoft 365 inbox, optionally filtered by client.',
  },
  {
    name: 'reply_email',
    description: 'Reply to an email thread via the tenant\'s connected Microsoft 365 account on behalf of Clio.',
  },
  {
    name: 'save_memory',
    description: 'Persist a durable fact or preference the user shares (a nickname, reporting style, ongoing priority, etc.) to Clio\'s long-term memory so it is recalled in future conversations. Use this whenever the user asks you to remember something.',
  },
  {
    name: 'search_program_elements',
    description: 'Search DoD Program Elements (PEs) — the RDT&E/procurement budget lines from the Pentagon J-books. Filter by military service, budget activity, or title keyword. Returns PE code, title, service, budget activity, appropriation type, status, and whether the PE has budget/award/bill data. Use get_program_element / get_pe_budget_timeline for detail.',
  },
  {
    name: 'get_program_element',
    description: 'Get a single DoD Program Element\'s full detail by PE code: title, description, service, appropriation type, status, ACAT level, program of record, source-document URLs, and complete fiscal-year budget history.',
  },
  {
    name: 'get_pe_budget_timeline',
    description: 'Get a Program Element\'s fiscal-year budget timeline by PE code: per-FY president\'s request, House/Senate authorization and appropriations marks (HASC/SASC/HAC-D/SAC-D), conference, and enacted amounts, plus milestones and conference-probability predictions.',
  },
  {
    name: 'get_pe_contractors',
    description: 'Get the top contractors linked to a Program Element over the last ~24 months, by direct PE tag or DoD acquisition-program code. Note: PE-to-contractor linkage is sparse — many PEs return no contractors.',
  },
  {
    name: 'get_pe_bills',
    description: 'Get congressional bills that reference a Program Element (by PE code), with sponsor, lead committee, and latest action.',
  },
  {
    name: 'search_acquisition_personnel',
    description: 'Search DoD acquisition personnel — the program managers, contracting officers, PEOs, and program leads who run defense programs. Filter by name (query), military service, organization, role, or linked Program Element (peCode). Returns name, service, organization, title, role, linked PE(s), and source count.',
  },
  {
    name: 'get_acquisition_person',
    description: 'Get a single DoD acquisition person\'s full detail by id: name, service, organization, title, role, program of record, linked Program Elements, public profile, and the source citations behind each fact.',
  },
  {
    name: 'create_word',
    description: 'Generate a downloadable Microsoft Word (.docx) document from a structured spec (title, optional subtitle, and sections with paragraphs, bullets, and tables). Use when the user asks for a Word doc, memo, report, or briefing as a file.',
  },
  {
    name: 'create_excel',
    description: 'Generate a downloadable Microsoft Excel (.xlsx) workbook from a structured spec (one or more sheets, each with headers and rows). Use when the user asks for a spreadsheet, data export, or table as a file. Numeric-looking cells are stored as numbers.',
  },
  {
    name: 'create_powerpoint',
    description: 'Generate a downloadable Microsoft PowerPoint (.pptx) deck from a structured spec (title slide plus content slides with bullets and an optional table per slide). Use when the user asks for a slide deck or presentation.',
  },
  {
    name: 'schedule_task',
    description: 'Schedule a recurring task for Clio to run automatically on a cadence (e.g. a weekly research brief). Requires a name, an instruction prompt, and intervalMinutes (>=60). Scheduled runs are READ-ONLY research only — they cannot send email or write data. Use when the user asks Clio to do something "every week / daily / on a schedule".',
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List the caller\'s recurring scheduled Clio tasks (name, cadence, next run, enabled state).',
  },
  {
    name: 'cancel_scheduled_task',
    description: 'Cancel (disable) a recurring scheduled Clio task by its id.',
  },
  {
    name: 'query_workflows',
    description: 'List or inspect the firm\'s workflow/submission instances (e.g. white papers, appropriations requests in progress) by client and status. Pass instanceId for full detail. Use for "where do our submissions stand / what\'s in flight".',
  },
  {
    name: 'query_tasks',
    description: 'List engagement tasks/to-dos for the firm or a client — filter by status and due date. Use for "what is due, overdue, or open".',
  },
  {
    name: 'query_strategies',
    description: 'List the firm\'s government-affairs strategies and their targets/deadlines, or upcoming strategy deadlines. Use to ground answers in the firm\'s actual game plan. Pass strategyId for full detail or deadlinesOnly for the deadline calendar.',
  },
] as const;

type ClioToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

/**
 * Side-effecting (write) tools. These are serialized within a single agentic
 * round so two mutations never race; every other (read-only) tool may run
 * concurrently (P0-2).
 */
const SIDE_EFFECTING_TOOLS: ReadonlySet<string> = new Set<string>([
  'create_meeting_brief',
  'draft_policy_memo',
  'save_note',
  'send_email',
  'reply_email',
  'save_memory',
  'create_word',
  'create_excel',
  'create_powerpoint',
  'schedule_task',
  'cancel_scheduled_task',
]);

interface ToolArtifactInput {
  conversationId?: string | null;
  clientId?: string | null;
  title: string;
  kind: string;
  bodyText: string;
  metadata?: Prisma.InputJsonValue;
}

interface MeetingForBrief {
  clientId: string | null;
  subject: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  client: { id: string; name: string; website: string | null; productDescription: string | null } | null;
  attendees: Array<{ name: string | null; email: string | null }>;
  preps: Array<{ summary: string | null; talkingPoints: Prisma.JsonValue }>;
  tasks: Array<{ title: string; dueDate: Date | null }>;
}

@Injectable()
export class ClioToolsService {
  private readonly logger = new Logger(ClioToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly engagement: EngagementService,
    private readonly microsoftGraph: MicrosoftGraphSyncService,
    private readonly ldaIntel: LdaIntelService,
    private readonly lobbyIntel: LobbyIntelService,
    private readonly federalSpending: FederalSpendingService,
    private readonly programElement: ProgramElementReadService,
    private readonly acquisitionPersonnel: AcquisitionPersonnelReadService,
    private readonly docgen: ClioDocgenService,
    private readonly workflows: WorkflowsService,
    private readonly strategies: StrategiesService,
  ) {}

  manifest() {
    return {
      brand: PRODUCT_NAME,
      tools: TOOL_DEFINITIONS,
    };
  }

  /**
   * Anthropic-native tool definitions for the Clio chat brain. Every tool the
   * model may call on demand during a streamed turn. input_schema is JSON
   * Schema; descriptions come from TOOL_DEFINITIONS so the manifest and the
   * tool-use schemas never drift apart.
   */
  anthropicToolSchemas(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    const obj = (
      properties: Record<string, unknown>,
      required: string[] = [],
    ): Record<string, unknown> => ({ type: 'object', properties, required });

    const str = (description?: string) => (description ? { type: 'string', description } : { type: 'string' });
    const int = (description?: string) => (description ? { type: 'integer', description } : { type: 'integer' });

    const schemas: Record<ClioToolName, Record<string, unknown>> = {
      get_client_context: obj({ clientId: str('Client UUID') }, ['clientId']),
      search_research_sources: obj({
        query: str('Free-text search across clients, meetings, mail, notes'),
        clientId: str('Optional client UUID to scope the search'),
        limit: int('Max records (1-25)'),
      }, ['query']),
      query_intelligence: obj({
        clientName: str('Optional client name to add federal contracting context'),
      }),
      search_congress_bills: obj({
        query: str('Keyword search'),
        policyArea: str('Policy area filter'),
        congress: int('Congress number, e.g. 118 or 119'),
        activeSince: str('ISO date; only bills with action since then'),
        limit: int('Max results (1-50)'),
        page: int('Page number'),
      }),
      search_lda_filings: obj({
        clientName: str('Client name filter'),
        registrantName: str('Lobbying registrant filter'),
        issueCode: str('Issue area / code filter'),
        year: int('Filing year'),
        limit: int('Max results (1-50)'),
        page: int('Page number'),
      }),
      search_sec_filings: obj({
        query: str('Company name search'),
        formType: str('Form type, e.g. 10-K, 10-Q, 8-K, DEF 14A, S-1'),
        cik: str('SEC CIK identifier'),
        limit: int('Max results (1-50)'),
      }),
      search_fara_registrations: obj({
        query: str('Search registrant, foreign principal, or description'),
        registrantName: str('Registrant filter'),
        foreignPrincipal: str('Foreign principal filter'),
        country: str('Country filter'),
        status: str('Registration status'),
        limit: int('Max results (1-50)'),
      }),
      search_federal_grants: obj({
        query: str('Keyword search across title/description/agency'),
        agency: str('Agency filter'),
        status: str('posted | closed | forecasted'),
        limit: int('Max results (1-50)'),
      }),
      search_federal_awards: obj({
        query: str('Keyword search across description/contractor/agency'),
        agency: str('Awarding agency filter'),
        peCode: str('Program Element (PE) code filter, e.g. 0604201A'),
        limit: int('Max results (1-50)'),
      }),
      search_gao_reports: obj({
        query: str('Keyword search across title/summary/topics/agencies'),
        reportType: str('Report type filter'),
        limit: int('Max results (1-50)'),
      }),
      search_state_bills: obj({
        query: str('Keyword search'),
        state: str('Two-letter state code'),
        session: str('Legislative session'),
        limit: int('Max results (1-50)'),
      }),
      search_intel_articles: obj({
        query: str('Keyword search'),
        source: str('Source filter, e.g. Roll Call, Politico'),
        limit: int('Max results (1-50)'),
      }),
      search_committee_hearings: obj({
        query: str('Keyword search'),
        chamber: str('House | Senate | Joint'),
        committeeName: str('Committee name filter'),
        limit: int('Max results (1-50)'),
      }),
      search_crs_reports: obj({
        query: str('Keyword search across title/summary/topics/authors'),
        limit: int('Max results (1-50)'),
      }),
      query_economic_data: obj({
        source: str('census | bls | bea'),
        state: str('Two-letter state code'),
        district: str('Congressional district'),
        limit: int('Max results (1-50)'),
      }),
      search_public_web: obj({
        query: str('Search query'),
        limit: int('Max results'),
      }, ['query']),
      scrape_web_page: obj({
        url: str('Public http(s) URL to fetch readable text from'),
      }, ['url']),
      create_meeting_brief: obj({
        meetingId: str('Meeting UUID'),
        title: str('Optional brief title'),
      }, ['meetingId']),
      draft_policy_memo: obj({
        clientId: str('Client UUID'),
        title: str('Memo title'),
        objective: str('Memo objective'),
        body: str('Optional pre-written body'),
      }, ['clientId']),
      save_note: obj({
        body: str('Note body'),
        title: str('Optional note title'),
        clientId: str('Optional client UUID'),
        meetingId: str('Optional meeting UUID for an encrypted meeting note'),
        confidential: { type: 'boolean' },
        accessLevel: str('Optional access level'),
      }, ['body']),
      send_email: obj({
        to: str('Recipient email address'),
        subject: str('Subject line'),
        body: str('Email body'),
        clientId: str('Optional client UUID to associate with'),
      }, ['to', 'subject', 'body']),
      list_emails: obj({
        clientId: str('Optional client UUID filter'),
        limit: int('Max threads (default 15, max 50)'),
      }),
      reply_email: obj({
        threadId: str('Mail thread ID to reply to'),
        body: str('Reply body'),
        clientId: str('Optional client UUID'),
      }, ['threadId', 'body']),
      save_memory: obj({
        content: str('The fact to remember, as a concise self-contained statement (e.g., "The user prefers to be called Ninja").'),
        key: str('Optional short topic/key, e.g. "nickname" or "reporting-style".'),
        scope: str('"personal" (default — this user only) or "firm" (shared across the firm).'),
      }, ['content']),
      search_program_elements: obj({
        query: str('Keyword search on PE title'),
        service: str('Military service filter, e.g. Army, Navy, Air Force, Space Force'),
        budgetActivity: str('Budget activity filter'),
        hasData: { type: 'boolean', description: 'Only return PEs that have budget/award/bill data' },
        limit: int('Max results (1-50)'),
        page: int('Page number'),
      }),
      get_program_element: obj({ peCode: str('Program Element code, e.g. 0604201A') }, ['peCode']),
      get_pe_budget_timeline: obj({ peCode: str('Program Element code') }, ['peCode']),
      get_pe_contractors: obj({ peCode: str('Program Element code') }, ['peCode']),
      get_pe_bills: obj({ peCode: str('Program Element code') }, ['peCode']),
      search_acquisition_personnel: obj({
        query: str('Name search (fuzzy)'),
        service: str('Military service filter, e.g. Army, Navy, Air Force, Space Force'),
        organization: str('Organization filter'),
        role: str('Role filter, e.g. PM, KO, PEO'),
        peCode: str('Program Element code the person is linked to'),
        limit: int('Max results (1-50)'),
        page: int('Page number'),
      }),
      get_acquisition_person: obj({ id: str('Acquisition personnel UUID') }, ['id']),
      create_word: obj({
        title: str('Document title'),
        subtitle: str('Optional subtitle'),
        sections: {
          type: 'array',
          description: 'Document sections, each with a heading and content',
          items: obj({
            heading: str('Section heading'),
            paragraphs: { type: 'array', items: { type: 'string' }, description: 'Prose paragraphs' },
            bullets: { type: 'array', items: { type: 'string' }, description: 'Bulleted list items' },
            tables: {
              type: 'array',
              description: 'Tables in this section',
              items: obj({
                headers: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              }),
            },
          }),
        },
        clientId: str('Optional client UUID to associate'),
      }, ['title', 'sections']),
      create_excel: obj({
        title: str('Workbook title'),
        sheets: {
          type: 'array',
          description: 'Worksheets, each with headers and rows',
          items: obj({
            name: str('Sheet name (<=31 chars)'),
            headers: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          }),
        },
        clientId: str('Optional client UUID to associate'),
      }, ['title', 'sheets']),
      create_powerpoint: obj({
        title: str('Deck title'),
        subtitle: str('Optional subtitle for the title slide'),
        slides: {
          type: 'array',
          description: 'Content slides',
          items: obj({
            title: str('Slide title'),
            bullets: { type: 'array', items: { type: 'string' } },
            table: obj({
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            }),
          }),
        },
        clientId: str('Optional client UUID to associate'),
      }, ['title', 'slides']),
      schedule_task: obj({
        name: str('Short name for the recurring task'),
        prompt: str('The instruction Clio runs each time the task fires'),
        intervalMinutes: int('Minutes between runs (minimum 60)'),
        toolAllowList: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional read-only research tools the task may call; defaults to all read-only tools. Side-effecting tools are rejected.',
        },
      }, ['name', 'prompt', 'intervalMinutes']),
      list_scheduled_tasks: obj({}),
      cancel_scheduled_task: obj({ taskId: str('Scheduled task UUID') }, ['taskId']),
      query_workflows: obj({
        instanceId: str('Optional workflow instance UUID for full detail'),
        clientId: str('Optional client UUID filter'),
        status: str('Optional status filter: triage | in_progress | review | submitted | complete | cancelled'),
        limit: int('Max results (1-50)'),
      }),
      query_tasks: obj({
        clientId: str('Optional client UUID'),
        status: str('Optional: open | overdue | todo | in_progress | done | blocked | canceled'),
        dueBefore: str('Optional ISO date upper bound on due date'),
        limit: int('Max results (1-50)'),
      }),
      query_strategies: obj({
        strategyId: str('Optional strategy UUID for full detail'),
        clientId: str('Optional client UUID filter'),
        deadlinesOnly: { type: 'boolean', description: 'Return upcoming deadlines across strategies (next 30 days)' },
        limit: int('Max results (1-50)'),
      }),
    };

    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: schemas[tool.name] ?? obj({}),
    }));
  }

  /**
   * Whether a tool may run concurrently with others in the same agentic round.
   * Read-only tools are safe; side-effecting writes are serialized (P0-2).
   */
  isConcurrencySafe(name: string): boolean {
    return !SIDE_EFFECTING_TOOLS.has(name);
  }

  executeFromAuthenticatedUser(ctx: TenantContext, rawName: string, rawInput: unknown) {
    return this.execute(ctx, normalizeToolName(rawName), objectInput(rawInput));
  }

  async execute(ctx: TenantContext, name: ClioToolName, input: Record<string, unknown>) {
    switch (name) {
      case 'get_client_context':
        return this.getClientContext(ctx, input);
      case 'search_research_sources':
        return this.searchResearchSources(ctx, input);
      case 'query_intelligence':
        return this.queryIntelligence(input);
      case 'search_congress_bills':
        return this.searchCongressBills(input);
      case 'search_lda_filings':
        return this.searchLdaFilings(input);
      case 'search_sec_filings':
        return this.searchSecFilings(input);
      case 'search_fara_registrations':
        return this.searchFaraRegistrations(input);
      case 'search_federal_grants':
        return this.searchFederalGrants(input);
      case 'search_federal_awards':
        return this.searchFederalAwards(input);
      case 'search_gao_reports':
        return this.searchGaoReports(input);
      case 'search_state_bills':
        return this.searchStateBills(input);
      case 'search_intel_articles':
        return this.searchIntelArticles(input);
      case 'search_committee_hearings':
        return this.searchCommitteeHearings(input);
      case 'search_crs_reports':
        return this.searchCrsReports(input);
      case 'query_economic_data':
        return this.queryEconomicData(input);
      case 'search_public_web':
        return this.searchPublicWeb(input);
      case 'scrape_web_page':
        return this.scrapeWebPage(input);
      case 'create_meeting_brief':
        return this.createMeetingBrief(ctx, input);
      case 'draft_policy_memo':
        return this.draftPolicyMemo(ctx, input);
      case 'save_note':
        return this.saveNote(ctx, input);
      case 'send_email':
        return this.sendEmail(ctx, input);
      case 'list_emails':
        return this.listEmails(ctx, input);
      case 'reply_email':
        return this.replyEmail(ctx, input);
      case 'save_memory':
        return this.saveMemory(ctx, input);
      case 'search_program_elements':
        return this.searchProgramElements(ctx, input);
      case 'get_program_element':
        return this.getProgramElementDetail(ctx, input);
      case 'get_pe_budget_timeline':
        return this.getPeBudgetTimeline(input);
      case 'get_pe_contractors':
        return this.getPeContractors(input);
      case 'get_pe_bills':
        return this.getPeBills(input);
      case 'search_acquisition_personnel':
        return this.searchAcquisitionPersonnel(ctx, input);
      case 'get_acquisition_person':
        return this.getAcquisitionPerson(ctx, input);
      case 'create_word':
        return this.createDocument(ctx, input, 'docx');
      case 'create_excel':
        return this.createDocument(ctx, input, 'xlsx');
      case 'create_powerpoint':
        return this.createDocument(ctx, input, 'pptx');
      case 'schedule_task':
        return this.scheduleTask(ctx, input);
      case 'list_scheduled_tasks':
        return this.listScheduledTasks(ctx);
      case 'cancel_scheduled_task':
        return this.cancelScheduledTask(ctx, input);
      case 'query_workflows':
        return this.queryWorkflows(ctx, input);
      case 'query_tasks':
        return this.queryTasks(ctx, input);
      case 'query_strategies':
        return this.queryStrategies(ctx, input);
      default:
        assertNever(name);
    }
  }

  private async saveMemory(ctx: TenantContext, input: Record<string, unknown>) {
    const content = requiredString(input, 'content', 4000);
    const key = optionalString(input, 'key', 120);
    const scope = optionalString(input, 'scope', 20);
    const record = buildSavedMemoryRecord({ content, key, scope, userId: ctx.userId });
    if (!record) throw new BadRequestException('save_memory requires non-empty content');

    const metadata = {
      tool: 'save_memory',
      createdBy: 'user-requested',
      userId: ctx.userId,
      visibility: record.scope,
    };

    // Upsert on the (tenant, scope, owner, key) unique constraint so repeated
    // "remember this" requests update in place instead of erroring/duplicating.
    const existing = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMemory.findFirst({
        where: {
          tenantId: ctx.tenantId,
          scope: record.scope,
          ownerUserId: record.ownerUserId,
          key: record.key,
        },
        select: { id: true },
      }),
    );

    if (existing) {
      await this.prisma.withTenant(ctx.tenantId, (tx) =>
        tx.clioMemory.update({
          where: { id: existing.id },
          data: { value: record.value, source: record.source, metadata },
        }),
      );
    } else {
      await this.prisma.withTenant(ctx.tenantId, (tx) =>
        tx.clioMemory.create({
          data: {
            tenantId: ctx.tenantId,
            scope: record.scope,
            ownerUserId: record.ownerUserId,
            key: record.key,
            value: record.value,
            source: record.source,
            metadata,
          },
        }),
      );
    }

    // Embed for semantic recall (best-effort; never blocks the tool result).
    void this.embedMemory(ctx.tenantId, record.key, record.value).catch(() => {});

    this.logger.log(
      `save_memory: stored ${record.scope} memory "${record.key}" for tenant ${ctx.tenantId}`,
    );
    return {
      saved: true,
      scope: record.scope === 'user_private' ? 'personal' : 'firm',
      key: record.key,
      value: record.value,
      message: 'Saved to long-term memory; I will recall this in future conversations.',
    };
  }

  /**
   * Embed a memory value (OpenAI text-embedding-3-small, 1536-dim) into pgvector
   * so it is retrievable by semantic search. Best-effort; mirrors
   * ClioService.embedAndStoreMemory. No-op without OPENAI_API_KEY. The UPDATE is
   * tenant-scoped and the key is tenant-unique, so it targets exactly one row.
   */
  private async embedMemory(tenantId: string, key: string, value: string): Promise<void> {
    const openaiKey = this.config.get('OPENAI_API_KEY', { infer: true });
    if (!openaiKey) return;
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: `${key}: ${value}` }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = json.data?.[0]?.embedding;
    if (!embedding || embedding.length !== 1536) return;
    const vecStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE clio_memory SET embedding = $1::vector WHERE tenant_id = $2 AND key = $3`,
      vecStr,
      tenantId,
      key,
    );
  }

  private async getClientContext(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = requiredString(input, 'clientId', 80);
    await this.ensureClientVisible(ctx, clientId);
    const context = await this.engagement.clientContext(ctx, clientId);
    return {
      tool: 'get_client_context',
      generatedAt: new Date().toISOString(),
      context,
    };
  }

  // ── Intelligence tools (global data, no tenant scoping) ────────────

  private async queryIntelligence(input: Record<string, unknown>) {
    const clientName = optionalString(input, 'clientName', 200);
    const parts: string[] = [];

    // Lobby intel surging issues & trends
    try {
      const lobbyCtx = await this.lobbyIntel.getAiContext();
      if (lobbyCtx.surgingIssues.length) {
        const surge = lobbyCtx.surgingIssues
          .slice(0, 8)
          .map(
            (s) =>
              `${s.name}${s.surgePct != null ? ' (+' + Math.round(s.surgePct) + '% QoQ)' : ''}`,
          )
          .join(', ');
        parts.push(`Surging LDA lobbying issues: ${surge}`);
      }
      if (lobbyCtx.trendingTopics.length) {
        const trending = lobbyCtx.trendingTopics
          .slice(0, 10)
          .map((t) => t.word)
          .filter(Boolean)
          .join(', ');
        if (trending) parts.push(`Trending terms in lobbying filings: ${trending}`);
      }
      if (lobbyCtx.latestQuarter) parts.push(`Latest LDA quarter: ${lobbyCtx.latestQuarter}`);
    } catch (err) {
      this.logger.warn(`Lobby intel fetch failed: ${(err as Error).message}`);
    }

    // Congress bills, recent activity
    try {
      const bills = await this.ldaIntel.getCongressBills(
        undefined, // search
        undefined, // policyArea
        undefined, // congress
        1,         // page
        15,        // limit
      );
      const billsAny = bills as unknown as { data?: Array<Record<string, unknown>>; total?: number };
      if (billsAny.data && billsAny.data.length) {
        const billSummary = billsAny.data
          .slice(0, 12)
          .map(
            (b) =>
              `- ${b.billType ?? ''}${b.billNumber ?? ''}: ${summarizeText(b.title, 120)} [${b.policyArea ?? 'N/A'}] (Sponsor: ${b.sponsorName ?? 'N/A'}, ${b.sponsorParty ?? ''}${b.sponsorState ? '-' + b.sponsorState : ''}) Latest: ${summarizeText(b.latestActionText, 100)} (${b.latestActionDate ?? 'no date'})`,
          )
          .join('\n');
        parts.push(`Recent congressional bills (${billsAny.total ?? 0} total in database):\n${billSummary}`);
      }
    } catch (err) {
      this.logger.warn(`Congress bills fetch failed: ${(err as Error).message}`);
    }

    // Federal spending context (if client name provided)
    if (clientName) {
      try {
        const spend = await this.federalSpending.getAiContext(clientName);
        if (spend.matchedContractor) {
          const mc = spend.matchedContractor;
          const amt = mc.totalContracts != null ? `$${(mc.totalContracts / 1e9).toFixed(1)}B` : 'unknown';
          parts.push(
            `Federal contracting for ${mc.name}: ${amt} in contracts${mc.rankByContracts ? ' (rank #' + mc.rankByContracts + ' nationally)' : ''}`,
          );
          if (mc.topAgencies.length) {
            const agencies = mc.topAgencies
              .slice(0, 5)
              .map((a: Record<string, unknown>) => `${a.name} ($${Math.round((a.amount as number) / 1e9)}B)`)
              .join(', ');
            parts.push(`Top awarding agencies: ${agencies}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Federal spending fetch failed: ${(err as Error).message}`);
      }
    }

    // Intelligence data source counts
    try {
      const [secCount, faraCount, gaoCount, grantCount, stateBillCount, intelArticleCount, hearingCount, crsCount] =
        await Promise.all([
          this.prisma.withSystem((tx) => tx.secFiling.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.faraRegistration.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.gaoReport.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.federalGrant.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.stateBill.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.intelArticle.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.committeeHearing.count()).catch(() => 0),
          this.prisma.withSystem((tx) => tx.crsReport.count()).catch(() => 0),
        ]);
      const sourceSummary = [
        secCount && `SEC filings: ${secCount}`,
        faraCount && `FARA registrations: ${faraCount}`,
        gaoCount && `GAO reports: ${gaoCount}`,
        grantCount && `Federal grants: ${grantCount}`,
        stateBillCount && `State bills: ${stateBillCount}`,
        intelArticleCount && `News articles: ${intelArticleCount}`,
        hearingCount && `Committee hearings: ${hearingCount}`,
        crsCount && `CRS reports: ${crsCount}`,
      ]
        .filter(Boolean)
        .join(', ');
      if (sourceSummary) parts.push(`Available intelligence data sources: ${sourceSummary}`);
    } catch (err) {
      this.logger.warn(`Intelligence source counts failed: ${(err as Error).message}`);
    }

    return {
      tool: 'query_intelligence',
      generatedAt: new Date().toISOString(),
      data: parts.join('\n') || 'No intelligence data currently available.',
    };
  }

  private async searchCongressBills(input: Record<string, unknown>) {
    const search = optionalString(input, 'query', 240) ?? optionalString(input, 'search', 240);
    const policyArea = optionalString(input, 'policyArea', 120);
    const congressNum = input.congress ? Number(input.congress) : undefined;
    const activeSince = optionalString(input, 'activeSince', 30);
    const limit = clampInt(input.limit, 1, 50, 20);
    const page = clampInt(input.page, 1, 100, 1);

    const bills = await this.ldaIntel.getCongressBills(
      search ?? undefined,
      policyArea ?? undefined,
      congressNum,
      page,
      limit,
      activeSince ?? undefined,
    );

    return {
      tool: 'search_congress_bills',
      generatedAt: new Date().toISOString(),
      ...bills,
    };
  }

  private async searchLdaFilings(input: Record<string, unknown>) {
    const clientName = optionalString(input, 'clientName', 200) ?? optionalString(input, 'query', 200);
    const issueCode = optionalString(input, 'issueCode', 120) ?? optionalString(input, 'issue', 120);
    const registrantName = optionalString(input, 'registrantName', 200) ?? optionalString(input, 'registrant', 200);
    const year = input.year ? Number(input.year) : undefined;
    const limit = clampInt(input.limit, 1, 50, 15);
    const page = clampInt(input.page, 1, 100, 1);

    const filings = await this.ldaIntel.getFilings({
      clientName: clientName ?? undefined,
      issueCode: issueCode ?? undefined,
      registrantName: registrantName ?? undefined,
      year,
      page,
      limit,
    });

    return {
      tool: 'search_lda_filings',
      generatedAt: new Date().toISOString(),
      ...filings,
    };
  }

  // ── New intelligence data source tools ──────────────────────────────

  private async searchSecFilings(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240) ?? optionalString(input, 'companyName', 240);
    const formType = optionalString(input, 'formType', 20);
    const cik = optionalString(input, 'cik', 20);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) where.companyName = { contains: query, mode: 'insensitive' };
    if (formType) where.formType = formType;
    if (cik) where.cik = cik;

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.secFiling.findMany({
          where,
          orderBy: { filingDate: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.secFiling.count({ where })),
    ]);

    return {
      tool: 'search_sec_filings',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((f) => ({
        id: f.id,
        cik: f.cik,
        companyName: f.companyName,
        formType: f.formType,
        accessionNumber: f.accessionNumber,
        filingDate: f.filingDate,
        description: summarizeText(f.description, 300),
        url: f.url,
      })),
    };
  }

  private async searchFaraRegistrations(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const registrantName = optionalString(input, 'registrantName', 240) ?? optionalString(input, 'registrant', 240);
    const foreignPrincipal = optionalString(input, 'foreignPrincipal', 240);
    const country = optionalString(input, 'country', 120);
    const status = optionalString(input, 'status', 20);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { registrantName: { contains: query, mode: 'insensitive' } },
        { foreignPrincipal: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (registrantName) where.registrantName = { contains: registrantName, mode: 'insensitive' };
    if (foreignPrincipal) where.foreignPrincipal = { contains: foreignPrincipal, mode: 'insensitive' };
    if (country) where.country = { contains: country, mode: 'insensitive' };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.faraRegistration.findMany({
          where,
          orderBy: { registrationDate: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.faraRegistration.count({ where })),
    ]);

    return {
      tool: 'search_fara_registrations',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((r) => ({
        id: r.id,
        registrationNumber: r.registrationNumber,
        registrantName: r.registrantName,
        foreignPrincipal: r.foreignPrincipal,
        country: r.country,
        status: r.status,
        registrationDate: r.registrationDate,
        description: summarizeText(r.description, 300),
      })),
    };
  }

  private async searchFederalAwards(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const agency = optionalString(input, 'agency', 240);
    const peCode = optionalString(input, 'peCode', 16);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { description: { contains: query, mode: 'insensitive' } },
        { contractorName: { contains: query, mode: 'insensitive' } },
        { awardingAgency: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (agency) where.awardingAgency = { contains: agency, mode: 'insensitive' };
    if (peCode) where.peCode = peCode.toUpperCase();

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.federalAward.findMany({ where, orderBy: { actionDate: 'desc' }, take: limit }),
      ),
      this.prisma.withSystem((tx) => tx.federalAward.count({ where })),
    ]);

    return {
      tool: 'search_federal_awards',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((a) => ({
        id: a.id,
        contractorName: a.contractorName,
        awardingAgency: a.awardingAgency,
        awardingSubTier: a.awardingSubTier,
        amount: a.amount != null ? Number(a.amount) : null,
        description: summarizeText(a.description ?? '', 240),
        peCode: a.peCode,
        recipientState: a.recipientState,
        popCongressionalDistrict: a.popCongressionalDistrict,
        actionDate: a.actionDate,
        piid: a.piid,
      })),
    };
  }

  // ── Program Element (DoD budget) tools ──────────────────────────────

  private async searchProgramElements(ctx: TenantContext, input: Record<string, unknown>) {
    const q = optionalString(input, 'query', 240) ?? optionalString(input, 'q', 240);
    const service = optionalString(input, 'service', 60);
    const budgetActivity = optionalString(input, 'budgetActivity', 120);
    const hasData = optionalBoolean(input, 'hasData');
    const limit = clampInt(input.limit, 1, 50, 20);
    const page = clampInt(input.page, 1, 100, 1);

    const result = await this.programElement.listProgramElements(
      {
        q: q ?? undefined,
        service: service ?? undefined,
        budgetActivity: budgetActivity ?? undefined,
        hasData: hasData ? 'true' : undefined,
        limit,
        page,
      },
      ctx,
    );

    return {
      tool: 'search_program_elements',
      generatedAt: new Date().toISOString(),
      ...result,
    };
  }

  private async getProgramElementDetail(ctx: TenantContext, input: Record<string, unknown>) {
    const peCode = requiredString(input, 'peCode', 32);
    const programElement = await this.programElement.getProgramElement(peCode, ctx);
    return {
      tool: 'get_program_element',
      generatedAt: new Date().toISOString(),
      programElement,
    };
  }

  private async getPeBudgetTimeline(input: Record<string, unknown>) {
    const peCode = requiredString(input, 'peCode', 32);
    const timeline = await this.programElement.getTimeline(peCode);
    return {
      tool: 'get_pe_budget_timeline',
      generatedAt: new Date().toISOString(),
      ...timeline,
    };
  }

  private async getPeContractors(input: Record<string, unknown>) {
    const peCode = requiredString(input, 'peCode', 32);
    const result = await this.programElement.getContractors(peCode);
    return {
      tool: 'get_pe_contractors',
      generatedAt: new Date().toISOString(),
      ...result,
    };
  }

  private async getPeBills(input: Record<string, unknown>) {
    const peCode = requiredString(input, 'peCode', 32);
    const bills = await this.programElement.getBills(peCode);
    return {
      tool: 'get_pe_bills',
      generatedAt: new Date().toISOString(),
      bills,
    };
  }

  // ── Acquisition personnel (DoD program people) tools ────────────────

  private async searchAcquisitionPersonnel(ctx: TenantContext, input: Record<string, unknown>) {
    const q = optionalString(input, 'query', 240) ?? optionalString(input, 'q', 240);
    const service = optionalString(input, 'service', 60);
    const organization = optionalString(input, 'organization', 200);
    const role = optionalString(input, 'role', 60);
    const peCode = optionalString(input, 'peCode', 32);
    const limit = clampInt(input.limit, 1, 50, 20);
    const page = clampInt(input.page, 1, 100, 1);

    const result = await this.acquisitionPersonnel.listPersonnel(
      {
        q: q ?? undefined,
        service: service ?? undefined,
        organization: organization ?? undefined,
        role: role ?? undefined,
        pe_code: peCode ?? undefined,
        page,
        limit,
      },
      ctx,
    );

    return {
      tool: 'search_acquisition_personnel',
      generatedAt: new Date().toISOString(),
      ...result,
    };
  }

  private async getAcquisitionPerson(ctx: TenantContext, input: Record<string, unknown>) {
    const id = requiredString(input, 'id', 80);
    const person = await this.acquisitionPersonnel.getPersonDetail(id, ctx);
    return {
      tool: 'get_acquisition_person',
      generatedAt: new Date().toISOString(),
      person,
    };
  }

  private async searchFederalGrants(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const agency = optionalString(input, 'agency', 240);
    const status = optionalString(input, 'status', 30);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { agency: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (agency) where.agency = { contains: agency, mode: 'insensitive' };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.federalGrant.findMany({
          where,
          orderBy: { closeDate: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.federalGrant.count({ where })),
    ]);

    return {
      tool: 'search_federal_grants',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((g) => ({
        id: g.id,
        title: summarizeText(g.title, 240),
        agency: g.agency,
        subAgency: g.subAgency,
        opportunityNumber: g.opportunityNumber,
        category: g.category,
        awardCeiling: g.awardCeiling,
        awardFloor: g.awardFloor,
        estimatedFunding: g.estimatedFunding,
        openDate: g.openDate,
        closeDate: g.closeDate,
        status: g.status,
        eligibility: g.eligibility,
        url: g.url,
      })),
    };
  }

  private async searchGaoReports(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const reportType = optionalString(input, 'reportType', 60);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
        { topics: { hasSome: [query] } },
        { agencies: { hasSome: [query] } },
      ];
    }
    if (reportType) where.reportType = reportType;

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.gaoReport.findMany({
          where,
          orderBy: { publishDate: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.gaoReport.count({ where })),
    ]);

    return {
      tool: 'search_gao_reports',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((r) => ({
        id: r.id,
        title: summarizeText(r.title, 240),
        url: r.url,
        publishDate: r.publishDate,
        reportType: r.reportType,
        topics: r.topics,
        agencies: r.agencies,
        summary: summarizeText(r.summary, 400),
        recommendations: r.recommendations,
      })),
    };
  }

  private async searchStateBills(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const state = optionalString(input, 'state', 2);
    const session = optionalString(input, 'session', 60);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { identifier: { contains: query, mode: 'insensitive' } },
        { subjects: { hasSome: [query] } },
      ];
    }
    if (state) where.state = state.toUpperCase();
    if (session) where.session = session;

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.stateBill.findMany({
          where,
          orderBy: { latestActionDate: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.stateBill.count({ where })),
    ]);

    return {
      tool: 'search_state_bills',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((b) => ({
        id: b.id,
        state: b.state,
        session: b.session,
        identifier: b.identifier,
        title: summarizeText(b.title, 240),
        chamber: b.chamber,
        subjects: b.subjects,
        sponsorName: b.sponsorName,
        sponsorParty: b.sponsorParty,
        latestActionDate: b.latestActionDate,
        latestActionText: b.latestActionText,
        url: b.url,
      })),
    };
  }

  private async searchIntelArticles(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const source = optionalString(input, 'source', 60);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
        { categories: { hasSome: [query] } },
        { topics: { hasSome: [query] } },
      ];
    }
    if (source) where.source = source;

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.intelArticle.findMany({
          where,
          orderBy: { publishedAt: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.intelArticle.count({ where })),
    ]);

    return {
      tool: 'search_intel_articles',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((a) => ({
        id: a.id,
        source: a.source,
        title: summarizeText(a.title, 240),
        url: a.url,
        author: a.author,
        publishedAt: a.publishedAt,
        summary: summarizeText(a.summary, 400),
        categories: a.categories,
        topics: a.topics,
      })),
    };
  }

  private async searchCommitteeHearings(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const chamber = optionalString(input, 'chamber', 20);
    const committeeName = optionalString(input, 'committeeName', 200) ?? optionalString(input, 'committee', 200);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = {};
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { committeeName: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (chamber) where.chamber = chamber;
    if (committeeName) where.committeeName = { contains: committeeName, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.committeeHearing.findMany({
          where,
          orderBy: { date: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.committeeHearing.count({ where })),
    ]);

    return {
      tool: 'search_committee_hearings',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((h) => ({
        id: h.id,
        chamber: h.chamber,
        committeeName: h.committeeName,
        committeeCode: h.committeeCode,
        title: summarizeText(h.title, 240),
        date: h.date,
        time: h.time,
        location: h.location,
        type: h.type,
        witnesses: h.witnesses,
        url: h.url,
      })),
    };
  }

  private async searchCrsReports(input: Record<string, unknown>) {
    const query = optionalString(input, 'query', 240);
    const limit = clampInt(input.limit, 1, 50, 20);

    const where: Record<string, unknown> = { active: true };
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
        { topics: { hasSome: [query] } },
        { authors: { hasSome: [query] } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.withSystem((tx) =>
        tx.crsReport.findMany({
          where,
          orderBy: { date: 'desc' },
          take: limit,
        }),
      ),
      this.prisma.withSystem((tx) => tx.crsReport.count({ where })),
    ]);

    return {
      tool: 'search_crs_reports',
      generatedAt: new Date().toISOString(),
      total,
      data: data.map((r) => ({
        id: r.id,
        title: summarizeText(r.title, 240),
        date: r.date,
        authors: r.authors,
        topics: r.topics,
        summary: summarizeText(r.summary, 400),
        pdfUrl: r.pdfUrl,
        htmlUrl: r.htmlUrl,
      })),
    };
  }

  private async queryEconomicData(input: Record<string, unknown>) {
    const source = optionalString(input, 'source', 20) ?? 'census';
    const state = optionalString(input, 'state', 2);
    const district = optionalString(input, 'district', 10);
    const limit = clampInt(input.limit, 1, 50, 20);

    switch (source.toLowerCase()) {
      case 'census': {
        const where: Record<string, unknown> = {};
        if (state) where.state = state.toUpperCase();
        if (district) where.district = district;

        const data = await this.prisma.withSystem((tx) =>
          tx.censusDistrict.findMany({
            where,
            orderBy: { state: 'asc' },
            take: limit,
          }),
        );

        return {
          tool: 'query_economic_data',
          source: 'census',
          generatedAt: new Date().toISOString(),
          data: data.map((d) => ({
            id: d.id,
            state: d.state,
            district: d.district,
            congress: d.congress,
            totalPopulation: d.totalPopulation,
            medianHouseholdIncome: d.medianHouseholdIncome,
            medianAge: d.medianAge,
            percentBachelorPlus: d.percentBachelorPlus,
            percentPoverty: d.percentPoverty,
            unemploymentRate: d.unemploymentRate,
            laborForceSize: d.laborForceSize,
            topIndustries: d.topIndustries,
          })),
        };
      }

      case 'bls': {
        const seriesId = optionalString(input, 'seriesId', 60);
        const query = optionalString(input, 'query', 240);

        const seriesWhere: Record<string, unknown> = {};
        if (seriesId) seriesWhere.id = seriesId;
        if (query) {
          seriesWhere.OR = [
            { title: { contains: query, mode: 'insensitive' } },
            { surveyName: { contains: query, mode: 'insensitive' } },
          ];
        }

        const series = await this.prisma.withSystem((tx) =>
          tx.blsSeries.findMany({
            where: seriesWhere,
            include: {
              dataPoints: {
                orderBy: [{ year: 'desc' }, { period: 'desc' }],
                take: 12,
              },
            },
            take: limit,
          }),
        );

        return {
          tool: 'query_economic_data',
          source: 'bls',
          generatedAt: new Date().toISOString(),
          data: series.map((s) => ({
            seriesId: s.id,
            title: s.title,
            surveyName: s.surveyName,
            periodType: s.periodType,
            recentDataPoints: s.dataPoints.map((dp) => ({
              year: dp.year,
              period: dp.period,
              value: dp.value,
            })),
          })),
        };
      }

      case 'bea': {
        const datasetName = optionalString(input, 'datasetName', 60) ?? optionalString(input, 'dataset', 60);
        const query = optionalString(input, 'query', 240);
        const year = input.year ? Number(input.year) : undefined;

        const where: Record<string, unknown> = {};
        if (datasetName) where.datasetName = datasetName;
        if (year) where.year = year;
        if (query) where.description = { contains: query, mode: 'insensitive' };

        const data = await this.prisma.withSystem((tx) =>
          tx.beaData.findMany({
            where,
            orderBy: [{ year: 'desc' }, { period: 'desc' }],
            take: limit,
          }),
        );

        return {
          tool: 'query_economic_data',
          source: 'bea',
          generatedAt: new Date().toISOString(),
          data: data.map((d) => ({
            datasetName: d.datasetName,
            tableName: d.tableName,
            description: summarizeText(d.description, 240),
            year: d.year,
            period: d.period,
            value: d.value,
            units: d.units,
          })),
        };
      }

      default:
        return {
          tool: 'query_economic_data',
          error: `Unknown source "${source}". Use "census", "bls", or "bea".`,
        };
    }
  }

  private async searchPublicWeb(input: Record<string, unknown>) {
    const query = requiredString(input, 'query', 240);
    const limit = clampInt(input.limit, 1, 12, 6);
    const results = await queryDuckDuckGoNews(query, limit);
    return {
      tool: 'search_public_web',
      generatedAt: new Date().toISOString(),
      total: results.length,
      results,
    };
  }

  private async scrapeWebPage(input: Record<string, unknown>) {
    const rawUrl = requiredString(input, 'url', 2000);
    const mode = optionalString(input, 'mode', 20) ?? 'summary';
    const maxChars = clampInt(input.maxChars, 500, 20000, mode === 'extract' ? 12000 : 4000);

    const parsed = parseAndValidatePublicUrl(rawUrl);
    const response = await fetchWithTimeout(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Capiro-Clio/1.0; +https://capiro.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    }, 10000);

    if (!response.ok) {
      throw new BadGatewayException(`Web scrape failed (${response.status})`);
    }

    const finalUrl = response.url || parsed.toString();
    const finalParsed = parseAndValidatePublicUrl(finalUrl);

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new BadRequestException(`Unsupported content type for scraping: ${contentType || 'unknown'}`);
    }

    const html = await response.text();
    const title = extractHtmlTitle(html);
    const text = extractReadableText(html, maxChars);
    const links = extractTopLinks(html, finalParsed.origin, 8);

    return {
      tool: 'scrape_web_page',
      generatedAt: new Date().toISOString(),
      url: finalParsed.toString(),
      title,
      contentType,
      text,
      totalChars: text.length,
      truncated: text.length >= maxChars,
      links,
    };
  }

  private async searchResearchSources(ctx: TenantContext, input: Record<string, unknown>) {
    const query = requiredString(input, 'query', 240);
    const clientId = optionalString(input, 'clientId', 80);
    const limit = clampInt(input.limit, 1, 25, 8);
    if (clientId) await this.ensureClientVisible(ctx, clientId);

    const results = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const [clients, meetings, threads, messages, clioNotes, directoryNotes] = await Promise.all([
        tx.client.findMany({
          where: {
            tenantId: ctx.tenantId,
            status: { not: 'archived' },
            ...(clientId ? { id: clientId } : {}),
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { productDescription: { contains: query, mode: 'insensitive' } },
              { primaryContactName: { contains: query, mode: 'insensitive' } },
              { primaryContactEmail: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, description: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        }),
        tx.meeting.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { clientId } : {}),
            ...ownMeetingWhere(ctx.userId),
            OR: [
              { subject: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { location: { contains: query, mode: 'insensitive' } },
              { organizerEmail: { contains: query, mode: 'insensitive' } },
              { organizerName: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            clientId: true,
            subject: true,
            description: true,
            startsAt: true,
            organizerEmail: true,
            organizerName: true,
          },
          orderBy: { startsAt: 'desc' },
          take: limit,
        }),
        tx.mailThread.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(clientId ? { clientId } : {}),
            ...ownMailThreadWhere(ctx.userId),
            OR: [
              { subject: { contains: query, mode: 'insensitive' } },
              { snippet: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            clientId: true,
            subject: true,
            snippet: true,
            lastMessageAt: true,
            updatedAt: true,
          },
          orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
          take: limit,
        }),
        tx.mailMessage.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...ownMailMessageWhere(ctx.userId),
            ...(clientId ? { thread: { clientId } } : {}),
            OR: [
              { subject: { contains: query, mode: 'insensitive' } },
              { bodyText: { contains: query, mode: 'insensitive' } },
              { fromEmail: { contains: query, mode: 'insensitive' } },
              { fromName: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            threadId: true,
            subject: true,
            bodyText: true,
            fromEmail: true,
            fromName: true,
            receivedAt: true,
            sentAt: true,
            thread: { select: { clientId: true, subject: true } },
          },
          orderBy: [{ receivedAt: 'desc' }, { sentAt: 'desc' }],
          take: limit,
        }),
        tx.clioNote.findMany({
          where: {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            ...(clientId ? { clientId } : {}),
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: { id: true, clientId: true, title: true, body: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        tx.directoryContactNote.findMany({
          where: {
            tenantId: ctx.tenantId,
            OR: [
              { body: { contains: query, mode: 'insensitive' } },
              { directoryContactName: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            directoryContactId: true,
            directoryContactName: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ]);

      return [
        ...clients.map((client) => ({
          type: 'client',
          id: client.id,
          clientId: client.id,
          title: client.name,
          snippet: summarizeText(client.description, 360),
          occurredAt: client.updatedAt,
        })),
        ...meetings.map((meeting) => ({
          type: 'meeting',
          id: meeting.id,
          clientId: meeting.clientId,
          title: meeting.subject,
          snippet: summarizeText(meeting.description || meeting.organizerName || meeting.organizerEmail, 360),
          occurredAt: meeting.startsAt,
        })),
        ...threads.map((thread) => ({
          type: 'mail_thread',
          id: thread.id,
          clientId: thread.clientId,
          title: thread.subject,
          snippet: summarizeText(thread.snippet, 360),
          occurredAt: thread.lastMessageAt ?? thread.updatedAt,
        })),
        ...messages.map((message) => ({
          type: 'mail_message',
          id: message.id,
          clientId: message.thread.clientId,
          title: message.subject || message.thread.subject,
          snippet: summarizeText(message.bodyText || message.fromName || message.fromEmail, 360),
          occurredAt: message.receivedAt ?? message.sentAt,
          metadata: { threadId: message.threadId },
        })),
        ...clioNotes.map((note) => ({
          type: 'clio_note',
          id: note.id,
          clientId: note.clientId,
          title: note.title || 'Clio note',
          snippet: summarizeText(note.body, 360),
          occurredAt: note.createdAt,
        })),
        ...directoryNotes.map((note) => ({
          type: 'directory_contact_note',
          id: note.id,
          clientId: null,
          title: note.directoryContactName || note.directoryContactId,
          snippet: summarizeText(note.body, 360),
          occurredAt: note.createdAt,
          metadata: { directoryContactId: note.directoryContactId },
        })),
      ]
        .sort((left, right) => dateMillis(right.occurredAt) - dateMillis(left.occurredAt))
        .slice(0, limit * 3);
    });

    return {
      tool: 'search_research_sources',
      query,
      generatedAt: new Date().toISOString(),
      results,
    };
  }

  private async createMeetingBrief(ctx: TenantContext, input: Record<string, unknown>) {
    const meetingId = requiredString(input, 'meetingId', 80);
    const conversationId = optionalString(input, 'conversationId', 80);
    const titleOverride = optionalString(input, 'title', 160);
    const meeting = await this.meetingForTool(ctx, meetingId);
    const [notes, debriefs, recentThreads] = await Promise.all([
      this.engagement.listMeetingNotes(ctx, meetingId).catch(() => []),
      this.engagement.listMeetingDebriefs(ctx, meetingId).catch(() => []),
      this.recentThreadsForClient(ctx, meeting.clientId),
    ]);

    const bodyText = renderMeetingBrief({
      meeting,
      notes: notes.filter((note) => !note.restricted),
      debriefs: debriefs.filter((debrief) => !debrief.restricted),
      recentThreads,
    });
    const artifact = await this.persistArtifact(ctx, {
      conversationId,
      clientId: meeting.clientId,
      title: titleOverride || `Meeting brief - ${meeting.subject}`,
      kind: 'meeting_brief',
      bodyText,
      metadata: {
        source: 'clio_tool',
        tool: 'create_meeting_brief',
        meetingId,
        generatedAt: new Date().toISOString(),
      },
    });

    return {
      tool: 'create_meeting_brief',
      generatedAt: new Date().toISOString(),
      meetingId,
      artifact,
      bodyText,
    };
  }

  private async draftPolicyMemo(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = requiredString(input, 'clientId', 80);
    const conversationId = optionalString(input, 'conversationId', 80);
    const title = optionalString(input, 'title', 160) || 'Policy memo draft';
    const objective = optionalString(input, 'objective', 500) || 'Prepare a policy memo.';
    const providedBody = optionalString(input, 'body', 40_000);
    await this.ensureClientVisible(ctx, clientId);
    const clientContext = await this.engagement.clientContext(ctx, clientId);
    const research =
      objective.length > 3
        ? await this.searchResearchSources(ctx, { query: objective, clientId, limit: 6 }).catch(
            () => ({ results: [] }),
          )
        : { results: [] };
    const bodyText =
      providedBody ||
      renderPolicyMemo({
        title,
        objective,
        clientContext,
        researchResults: Array.isArray(research.results) ? research.results : [],
      });
    const artifact = await this.persistArtifact(ctx, {
      conversationId,
      clientId,
      title,
      kind: 'policy_memo',
      bodyText,
      metadata: {
        source: 'clio_tool',
        tool: 'draft_policy_memo',
        objective,
        generatedAt: new Date().toISOString(),
        mode: providedBody ? 'provided_body' : 'deterministic_capiro_context',
      },
    });

    return {
      tool: 'draft_policy_memo',
      generatedAt: new Date().toISOString(),
      artifact,
      bodyText,
    };
  }

  private async saveNote(ctx: TenantContext, input: Record<string, unknown>) {
    const body = requiredString(input, 'body', 40_000);
    const title = optionalString(input, 'title', 160);
    const conversationId = optionalString(input, 'conversationId', 80);
    const requestedClientId = optionalString(input, 'clientId', 80);
    const meetingId = optionalString(input, 'meetingId', 80);
    const source = optionalString(input, 'source', 80) || 'clio_tool';
    let clientId = requestedClientId ?? null;
    let meetingNote: unknown = null;

    if (meetingId) {
      const meeting = await this.ensureOwnMeeting(ctx, meetingId);
      if (clientId && meeting.clientId && clientId !== meeting.clientId) {
        throw new BadRequestException('clientId does not match the meeting client');
      }
      clientId = clientId ?? meeting.clientId;
      meetingNote = await this.engagement.createMeetingNote(ctx, meetingId, {
        body,
        confidential: optionalBoolean(input, 'confidential') ?? true,
        accessLevel: optionalString(input, 'accessLevel', 80) ?? 'tenant_admins_and_author',
      });
    } else if (clientId) {
      await this.ensureClientVisible(ctx, clientId);
    }

    if (conversationId) await this.ensureConversationForTool(ctx, conversationId, clientId);

    const clioNote = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioNote.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId,
          conversationId: conversationId ?? null,
          meetingId: meetingId ?? null,
          title: title ?? null,
          body,
          source,
          metadata: {
            tool: 'save_note',
            savedToMeetingNotes: Boolean(meetingNote),
          },
        },
      }),
    );

    return {
      tool: 'save_note',
      generatedAt: new Date().toISOString(),
      note: clioNote,
      meetingNote,
    };
  }

  // ── Email tools ──────────────────────────────────────────────────────

  private async findUserEmailConnection(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.integrationConnection.findFirst({
        where: {
          tenantId: ctx.tenantId,
          createdByUserId: ctx.userId,
          provider: 'microsoft_365',
          status: 'connected',
          token: { isNot: null },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, accountEmail: true, displayName: true },
      }),
    );
  }

  private async sendEmail(ctx: TenantContext, input: Record<string, unknown>) {
    const to = requiredString(input, 'to', 320);
    const subject = requiredString(input, 'subject', 500);
    const body = requiredString(input, 'body', 50_000);
    const clientId = optionalString(input, 'clientId', 36);
    const conversationId = optionalString(input, 'conversationId', 80);

    const connection = await this.findUserEmailConnection(ctx);
    if (!connection) {
      return {
        error: 'No connected Microsoft 365 account found. Please connect one in Settings → Integrations.',
      };
    }

    await this.microsoftGraph.sendMail(ctx, connection.id, {
      subject,
      body,
      toRecipients: [{ email: to }],
    });

    if (conversationId) {
      await this.persistArtifact(ctx, {
        conversationId,
        clientId,
        title: `Email: ${subject}`,
        kind: 'email_sent',
        bodyText: `To: ${to}\nSubject: ${subject}\n\n${body}`,
        metadata: { to, subject, sentFrom: connection.accountEmail },
      });
    }

    return { ok: true, sentFrom: connection.accountEmail, to, subject };
  }

  private async listEmails(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = optionalString(input, 'clientId', 36);
    const limit = clampInt(input.limit, 1, 50, 15);

    const where: Prisma.MailThreadWhereInput = {
      ...ownMailThreadWhere(ctx.userId),
    };
    if (clientId) where.clientId = clientId;

    const threads = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        select: {
          id: true,
          subject: true,
          snippet: true,
          participants: true,
          lastMessageAt: true,
          status: true,
          client: { select: { id: true, name: true } },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 3,
            select: {
              id: true,
              subject: true,
              fromEmail: true,
              fromName: true,
              bodyText: true,
              sentAt: true,
              receivedAt: true,
            },
          },
        },
      }),
    );

    return { threads, count: threads.length };
  }

  private async replyEmail(ctx: TenantContext, input: Record<string, unknown>) {
    const threadId = requiredString(input, 'threadId', 80);
    const body = requiredString(input, 'body', 50_000);
    const clientId = optionalString(input, 'clientId', 36);
    const conversationId = optionalString(input, 'conversationId', 80);

    const thread = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findFirst({
        where: { id: threadId, ...ownMailThreadWhere(ctx.userId) },
        select: {
          id: true,
          subject: true,
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { id: true, fromEmail: true, fromName: true, subject: true },
          },
        },
      }),
    );
    if (!thread) return { error: 'Thread not found.' };

    const lastMsg = thread.messages[0];
    if (!lastMsg?.fromEmail) return { error: 'No messages in thread to reply to.' };

    const connection = await this.findUserEmailConnection(ctx);
    if (!connection) {
      return { error: 'No connected Microsoft 365 account found.' };
    }

    const replySubject = thread.subject?.startsWith('Re: ')
      ? thread.subject
      : `Re: ${thread.subject ?? ''}`;

    await this.microsoftGraph.sendMail(ctx, connection.id, {
      subject: replySubject,
      body,
      toRecipients: [{ email: lastMsg.fromEmail }],
    });

    if (conversationId) {
      await this.persistArtifact(ctx, {
        conversationId,
        clientId,
        title: `Reply: ${replySubject}`,
        kind: 'email_reply',
        bodyText: `Reply to: ${lastMsg.fromEmail}\nSubject: ${replySubject}\n\n${body}`,
        metadata: { to: lastMsg.fromEmail, subject: replySubject, sentFrom: connection.accountEmail, threadId },
      });
    }

    return { ok: true, sentFrom: connection.accountEmail, to: lastMsg.fromEmail, subject: replySubject };
  }

  // ── Artifact persistence ────────────────────────────────────────────

  // ── Document generation (Word / Excel / PowerPoint) ──

  /**
   * Generate a downloadable Office document. The validated spec is normalized,
   * then a binary is produced ONCE to prove it builds; the spec (JSON) is stored
   * on the artifact so the download endpoint regenerates the binary statelessly
   * (no blob storage needed), mirroring the research-export pattern.
   */
  private async createDocument(
    ctx: TenantContext,
    input: Record<string, unknown>,
    format: DocFormat,
  ) {
    const clientId = optionalString(input, 'clientId', 80) ?? null;
    const conversationId = optionalString(input, 'conversationId', 80);
    if (clientId) await this.ensureClientVisible(ctx, clientId);

    let title: string;
    let normalized: unknown;
    if (format === 'docx') {
      const spec = normalizeWordSpec(input);
      title = spec.title;
      normalized = spec;
      await this.docgen.buildDocx(spec);
    } else if (format === 'xlsx') {
      const spec = normalizeExcelSpec(input);
      title = spec.title;
      normalized = spec;
      await this.docgen.buildXlsx(spec);
    } else {
      const spec = normalizePptxSpec(input);
      title = spec.title;
      normalized = spec;
      await this.docgen.buildPptx(spec);
    }

    const toolName =
      format === 'docx' ? 'create_word' : format === 'xlsx' ? 'create_excel' : 'create_powerpoint';
    const kind =
      format === 'docx' ? 'word_document' : format === 'xlsx' ? 'excel_workbook' : 'powerpoint_deck';
    const filename = `${slugifyDocName(title)}.${format}`;
    const artifact = await this.persistArtifact(ctx, {
      conversationId,
      clientId,
      title,
      kind,
      bodyText: JSON.stringify(normalized),
      metadata: {
        source: 'clio_tool',
        tool: toolName,
        docFormat: format,
        mimeType: mimeForFormat(format),
        filename,
        generatedAt: new Date().toISOString(),
      },
    });

    const artifactId =
      artifact && typeof artifact === 'object' && 'id' in artifact
        ? (artifact as { id: string }).id
        : null;

    return {
      tool: toolName,
      format,
      title,
      filename,
      mimeType: mimeForFormat(format),
      artifact,
      downloadUrl: artifactId ? `/api/clio/artifacts/${artifactId}/download` : null,
      note: artifactId
        ? 'Document generated and available for download.'
        : 'Document generated but not persisted (no conversation context); ask the user to retry within a chat.',
    };
  }

  /**
   * Load a generated document artifact (tenant + user scoped) and return the
   * stored spec JSON + format + filename so the controller can regenerate and
   * stream the binary. Returns null when not found / not a document artifact.
   */
  async getDocumentArtifact(
    ctx: TenantContext,
    artifactId: string,
  ): Promise<{ format: DocFormat; specJson: string; filename: string; mimeType: string } | null> {
    const artifact = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioArtifact.findFirst({
        where: { id: artifactId, tenantId: ctx.tenantId, userId: ctx.userId },
        select: { bodyText: true, metadata: true },
      }),
    );
    if (!artifact || !artifact.bodyText) return null;
    const meta = (artifact.metadata ?? {}) as Record<string, unknown>;
    const format = meta.docFormat;
    if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx') return null;
    const filename = typeof meta.filename === 'string' ? meta.filename : `document.${format}`;
    return {
      format,
      specJson: artifact.bodyText,
      filename,
      mimeType: mimeForFormat(format),
    };
  }

  // ── Scheduled tasks (W3) ────────────────────

  private async scheduleTask(ctx: TenantContext, input: Record<string, unknown>) {
    const existingTaskCount = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioScheduledTask.count({ where: { tenantId: ctx.tenantId, ownerUserId: ctx.userId } }),
    );
    const validation = validateScheduleRequest({
      name: input.name,
      prompt: input.prompt,
      intervalMinutes: input.intervalMinutes,
      toolAllowList: input.toolAllowList,
      existingTaskCount,
    });
    if (!validation.ok) {
      return { tool: 'schedule_task', scheduled: false, error: validation.error };
    }
    const intervalMinutes = validation.intervalMinutes!;
    const allowList = validation.allowList!;
    const nextRunAt = computeNextRunAt(new Date(), intervalMinutes);
    const task = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioScheduledTask.create({
        data: {
          tenantId: ctx.tenantId,
          ownerUserId: ctx.userId,
          scope: 'user_private',
          name: String(input.name).slice(0, 200),
          prompt: String(input.prompt).slice(0, 8000),
          intervalMinutes,
          toolAllowList: allowList,
          nextRunAt,
          createdBy: 'clio',
          metadata: { createdVia: 'schedule_task_tool' },
        },
        select: { id: true, name: true, intervalMinutes: true, nextRunAt: true },
      }),
    );
    return {
      tool: 'schedule_task',
      scheduled: true,
      task,
      note: 'Scheduled as a READ-ONLY recurring research task (no email/writes). It will run automatically; use list_scheduled_tasks to review or cancel_scheduled_task to stop it.',
    };
  }

  private async listScheduledTasks(ctx: TenantContext) {
    const tasks = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioScheduledTask.findMany({
        where: { tenantId: ctx.tenantId, ownerUserId: ctx.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          name: true,
          intervalMinutes: true,
          enabled: true,
          lastRunAt: true,
          nextRunAt: true,
          lastStatus: true,
          runCount: true,
        },
      }),
    );
    return { tool: 'list_scheduled_tasks', count: tasks.length, tasks };
  }

  private async cancelScheduledTask(ctx: TenantContext, input: Record<string, unknown>) {
    const taskId = requiredString(input, 'taskId', 80);
    const result = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioScheduledTask.updateMany({
        where: { id: taskId, tenantId: ctx.tenantId, ownerUserId: ctx.userId },
        data: { enabled: false, lastStatus: 'canceled' },
      }),
    );
    if (result.count === 0) {
      return { tool: 'cancel_scheduled_task', canceled: false, error: 'Task not found.' };
    }
    return { tool: 'cancel_scheduled_task', canceled: true, taskId };
  }

  // ── Firm operational data (workflows / tasks / strategies / actions) ──

  private async queryWorkflows(ctx: TenantContext, input: Record<string, unknown>) {
    const instanceId = optionalString(input, 'instanceId', 80);
    if (instanceId) {
      const instance = await this.workflows.getInstance(ctx.tenantId, instanceId);
      return {
        tool: 'query_workflows',
        generatedAt: new Date().toISOString(),
        instance,
      };
    }

    const clientId = optionalString(input, 'clientId', 80);
    const status = optionalString(input, 'status', 40);
    const limit = clampInt(input.limit, 1, 50, 20);
    if (clientId) await this.ensureClientVisible(ctx, clientId);
    if (status && !(Object.values(WorkflowStatus) as string[]).includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${Object.values(WorkflowStatus).join(', ')}`,
      );
    }

    const instances = await this.workflows.listInstances(ctx.tenantId, {
      clientId: clientId ?? undefined,
      status: status ?? undefined,
    });

    return {
      tool: 'query_workflows',
      generatedAt: new Date().toISOString(),
      total: instances.length,
      results: instances.slice(0, limit).map((instance) => ({
        id: instance.id,
        title: instance.title,
        status: instance.status,
        templateSlug: instance.template?.slug ?? null,
        templateName: instance.template?.name ?? null,
        clientId: instance.clientId,
        clientName: instance.client?.name ?? null,
        submissionDeadline: instance.submissionDeadline,
        submissionMethod: instance.submissionMethod,
        completedAt: instance.completedAt,
        updatedAt: instance.updatedAt,
      })),
    };
  }

  private async queryTasks(ctx: TenantContext, input: Record<string, unknown>) {
    const clientId = optionalString(input, 'clientId', 80);
    const statusRaw = optionalString(input, 'status', 30)?.toLowerCase() ?? null;
    const dueBeforeRaw = optionalString(input, 'dueBefore', 40);
    const limit = clampInt(input.limit, 1, 50, 25);
    if (clientId) await this.ensureClientVisible(ctx, clientId);

    const taskStatuses = Object.values(EngagementTaskStatus) as string[];
    let status: EngagementTaskStatus | undefined;
    let openOnly = false;
    let dueBefore: Date | undefined;
    if (statusRaw === 'open') {
      openOnly = true;
    } else if (statusRaw === 'overdue') {
      openOnly = true;
      dueBefore = new Date();
    } else if (statusRaw && taskStatuses.includes(statusRaw)) {
      status = statusRaw as EngagementTaskStatus;
    } else if (statusRaw) {
      throw new BadRequestException(
        `status must be one of: open, overdue, ${taskStatuses.join(', ')}`,
      );
    }

    if (dueBeforeRaw) {
      const parsed = new Date(dueBeforeRaw);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('dueBefore must be an ISO date');
      }
      dueBefore = parsed;
    }

    const tasks = await this.engagement.listTasks(ctx, {
      clientId: clientId ?? undefined,
      status,
      openOnly,
      dueBefore,
      limit,
    });

    const now = Date.now();
    return {
      tool: 'query_tasks',
      generatedAt: new Date().toISOString(),
      total: tasks.length,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        overdue: Boolean(
          task.dueDate &&
            task.dueDate.getTime() < now &&
            task.status !== EngagementTaskStatus.done &&
            task.status !== EngagementTaskStatus.canceled,
        ),
        clientId: task.clientId,
        clientName: task.client?.name ?? null,
        meeting: task.meeting,
        description: summarizeText(task.description, 240),
        createdAt: task.createdAt,
      })),
    };
  }

  private async queryStrategies(ctx: TenantContext, input: Record<string, unknown>) {
    const deadlinesOnly = optionalBoolean(input, 'deadlinesOnly');
    if (deadlinesOnly) {
      const deadlines = await this.strategies.getDeadlines(ctx.tenantId);
      return {
        tool: 'query_strategies',
        generatedAt: new Date().toISOString(),
        total: deadlines.length,
        deadlines,
      };
    }

    const strategyId = optionalString(input, 'strategyId', 80);
    if (strategyId) {
      const strategy = await this.strategies.get(ctx.tenantId, strategyId);
      return {
        tool: 'query_strategies',
        generatedAt: new Date().toISOString(),
        strategy,
      };
    }

    const clientId = optionalString(input, 'clientId', 80);
    const limit = clampInt(input.limit, 1, 50, 20);
    if (clientId) await this.ensureClientVisible(ctx, clientId);

    const strategies = await this.strategies.list(ctx.tenantId, {
      clientId: clientId ?? undefined,
    });

    return {
      tool: 'query_strategies',
      generatedAt: new Date().toISOString(),
      total: strategies.length,
      results: strategies.slice(0, limit).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        status: strategy.status,
        fiscalYear: strategy.fiscalYear,
        clientId: strategy.clientId,
        clientName: strategy.client?.name ?? null,
        capability: strategy.capability,
        targetsCount: strategy.targets.length,
        instancesCount: strategy._count.instances,
        description: summarizeText(strategy.description, 300),
        createdAt: strategy.createdAt,
      })),
    };
  }

  /** Regenerate a document binary from a stored spec (for the download route). */
  async renderStoredDocument(format: DocFormat, specJson: string): Promise<Buffer> {
    const parsed: unknown = JSON.parse(specJson);
    if (format === 'docx') return this.docgen.buildDocx(normalizeWordSpec(parsed));
    if (format === 'xlsx') return this.docgen.buildXlsx(normalizeExcelSpec(parsed));
    return this.docgen.buildPptx(normalizePptxSpec(parsed));
  }

  private async persistArtifact(ctx: TenantContext, input: ToolArtifactInput) {
    if (!input.conversationId) {
      return {
        persisted: false,
        reason: 'No conversationId was supplied to the tool call.',
      };
    }
    await this.ensureConversationForTool(ctx, input.conversationId, input.clientId ?? null);
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioArtifact.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: input.clientId ?? null,
          conversationId: input.conversationId!,
          title: input.title,
          kind: input.kind,
          contentType: 'text/markdown',
          bodyText: input.bodyText,
          metadata: input.metadata ?? {},
        },
      }),
    );
  }

  private async meetingForTool(ctx: TenantContext, meetingId: string) {
    const meeting = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId, ...ownMeetingWhere(ctx.userId) },
        include: {
          client: { select: { id: true, name: true, website: true, productDescription: true } },
          attendees: { orderBy: { createdAt: 'asc' } },
          preps: { orderBy: { createdAt: 'desc' }, take: 1 },
          tasks: {
            where: { status: { notIn: [EngagementTaskStatus.done, EngagementTaskStatus.canceled] } },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
            take: 8,
          },
        },
      }),
    );
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async ensureOwnMeeting(ctx: TenantContext, meetingId: string) {
    const meeting = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.meeting.findFirst({
        where: { id: meetingId, tenantId: ctx.tenantId, ...ownMeetingWhere(ctx.userId) },
        select: { id: true, clientId: true },
      }),
    );
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async ensureClientVisible(ctx: TenantContext, clientId: string) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      }),
    );
    if (!client) throw new NotFoundException('Client not found');
  }

  private async ensureConversationForTool(
    ctx: TenantContext,
    conversationId: string,
    clientId: string | null,
  ) {
    const conversation = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.findFirst({
        where: {
          id: conversationId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          archivedAt: null,
        },
        select: { id: true, clientId: true },
      }),
    );
    if (!conversation) throw new NotFoundException('Clio conversation not found');
    if (clientId && conversation.clientId && conversation.clientId !== clientId) {
      throw new BadRequestException('Tool clientId does not match the Clio conversation client');
    }
    return conversation;
  }

  private async recentThreadsForClient(ctx: TenantContext, clientId: string | null) {
    if (!clientId) return [];
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.mailThread.findMany({
        where: { tenantId: ctx.tenantId, clientId, ...ownMailThreadWhere(ctx.userId) },
        select: { id: true, subject: true, snippet: true, lastMessageAt: true },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
      }),
    );
  }
}

function normalizeToolName(value: string): ClioToolName {
  const name = value.trim();
  if (TOOL_DEFINITIONS.some((tool) => tool.name === name)) return name as ClioToolName;
  throw new NotFoundException('Clio tool not found');
}

function objectInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function requiredString(input: Record<string, unknown>, key: string, max: number): string {
  const value = optionalString(input, key, max);
  if (!value) throw new BadRequestException(`${key} is required`);
  return value;
}

function optionalString(input: Record<string, unknown>, key: string, max: number): string | null {
  const value = input[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | null {
  const value = input[key];
  return typeof value === 'boolean' ? value : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function ownMeetingWhere(userId: string): Prisma.MeetingWhereInput {
  return {
    OR: [{ createdByUserId: userId }, { connection: { createdByUserId: userId } }],
  };
}

function ownMailThreadWhere(userId: string): Prisma.MailThreadWhereInput {
  return {
    connection: { createdByUserId: userId },
  };
}

function ownMailMessageWhere(userId: string): Prisma.MailMessageWhereInput {
  return {
    connection: { createdByUserId: userId },
  };
}

function renderMeetingBrief(input: {
  meeting: MeetingForBrief;
  notes: Array<{ body: string | null; createdAt: Date }>;
  debriefs: Array<{ body: string | null; createdAt: Date }>;
  recentThreads: Array<{ subject: string; snippet: string | null; lastMessageAt: Date | null }>;
}) {
  const { meeting, notes, debriefs, recentThreads } = input;
  const attendees = meeting.attendees
    .map((attendee) => attendee.name || attendee.email)
    .filter(Boolean)
    .join(', ');
  const prep = meeting.preps[0];
  const tasks = meeting.tasks.map((task) => `- ${task.title}${task.dueDate ? ` (due ${formatDate(task.dueDate)})` : ''}`);

  return [
    `# Meeting Brief: ${meeting.subject}`,
    '',
    `Client: ${meeting.client?.name ?? 'Unassigned'}`,
    `When: ${formatDate(meeting.startsAt)} - ${formatDate(meeting.endsAt)}`,
    meeting.location ? `Location: ${meeting.location}` : null,
    attendees ? `Attendees: ${attendees}` : null,
    '',
    '## Context',
    summarizeText(meeting.description, 1200) || 'No meeting description is available in Capiro.',
    '',
    '## Latest Prep',
    prep
      ? [prep.summary, ...jsonStringArray(prep.talkingPoints).map((item) => `- ${item}`)].filter(Boolean).join('\n')
      : 'No saved prep is available for this meeting.',
    '',
    '## Visible Notes',
    notes.length ? notes.map((note) => `- ${summarizeText(note.body, 500)}`).join('\n') : 'No visible notes.',
    '',
    '## Visible Debriefs',
    debriefs.length
      ? debriefs.map((debrief) => `- ${summarizeText(debrief.body, 500)}`).join('\n')
      : 'No visible debriefs.',
    '',
    '## Open Tasks',
    tasks.length ? tasks.join('\n') : 'No open tasks are attached to this meeting.',
    '',
    '## Recent Client Threads',
    recentThreads.length
      ? recentThreads.map((thread) => `- ${thread.subject}: ${summarizeText(thread.snippet, 240)}`).join('\n')
      : 'No recent authorized mail threads are linked to this client.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function renderPolicyMemo(input: {
  title: string;
  objective: string;
  clientContext: unknown;
  researchResults: unknown[];
}) {
  const context = objectInput(input.clientContext);
  const client = objectInput(context.client);
  const clientName = typeof client.name === 'string' ? client.name : 'Selected client';
  const summary = objectInput(context.summary);
  const sources = input.researchResults
    .map((result) => objectInput(result))
    .map((result) => `- ${String(result.title ?? result.id ?? 'Source')}: ${summarizeText(String(result.snippet ?? ''), 280)}`)
    .join('\n');

  return [
    `# ${input.title}`,
    '',
    `Client: ${clientName}`,
    `Objective: ${input.objective}`,
    '',
    '## Current Capiro Context',
    `- Meetings in loaded context: ${summary.meetings ?? 0}`,
    `- Mail threads in loaded context: ${summary.mailThreads ?? 0}`,
    `- Contacts in loaded context: ${summary.contacts ?? 0}`,
    `- Open tasks in loaded context: ${summary.openTasks ?? 0}`,
    '',
    '## Draft Position',
    'Add the policy position, supporting evidence, and requested action here. This draft was assembled from authorized Capiro context and should be reviewed before external use.',
    '',
    '## Supporting Sources',
    sources || 'No matching authorized research sources were found for the objective.',
    '',
    '## Follow-Up',
    '- Confirm factual claims against primary sources.',
    '- Attach client-approved language and citations.',
    '- Save final outreach or memo artifacts in Capiro.',
  ].join('\n');
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function summarizeText(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function parseAndValidatePublicUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException('url must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('Only http/https URLs are allowed');
  }

  const host = (parsed.hostname || '').toLowerCase();
  if (!host) throw new BadRequestException('URL hostname is required');
  if (isPrivateOrLocalHost(host)) {
    throw new BadRequestException('Private/local network URLs are not allowed');
  }

  return parsed;
}

function isPrivateOrLocalHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local')) return true;

  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1).toLowerCase();
    return inner === '::1' || inner.startsWith('fc') || inner.startsWith('fd') || inner.startsWith('fe80:');
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BadGatewayException('Web scrape timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const value = stripHtml(match[1] ?? '').trim();
  return value || null;
}

function extractReadableText(html: string, maxChars: number): string {
  let text = html;
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  text = stripHtml(text);
  text = text.replace(/\s+/g, ' ').trim();
  return summarizeText(text, maxChars);
}

function extractTopLinks(html: string, origin: string, limit: number) {
  const links: Array<{ url: string; text: string | null }> = [];
  const seen = new Set<string>();
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && links.length < limit) {
    const href = decodeHtmlEntities((match[1] ?? '').trim());
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      continue;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, origin);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(resolved.protocol)) continue;
    if (isPrivateOrLocalHost(resolved.hostname.toLowerCase())) continue;
    const url = resolved.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const text = summarizeText(stripHtml(match[2] ?? ''), 120) || null;
    links.push({ url, text });
  }
  return links;
}

async function queryDuckDuckGoNews(query: string, limit: number) {
  const q = encodeURIComponent(query);
  const url = `https://duckduckgo.com/html/?q=${q}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Capiro-Clio/1.0; +https://capiro.ai)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new BadGatewayException(`Public web search failed (${response.status})`);
  }
  const html = await response.text();

  const results: Array<{ title: string; url: string; snippet: string | null; source: string }> = [];
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/g;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) && results.length < limit) {
    const rawHref = decodeHtmlEntities(match[1] ?? '').trim();
    const title = stripHtml(match[2] ?? '').trim();
    const snippet = stripHtml(match[3] ?? match[4] ?? '').trim();
    const resolvedUrl = unwrapDuckDuckGoUrl(rawHref);
    if (!title || !resolvedUrl) continue;
    results.push({
      title: summarizeText(title, 180),
      url: resolvedUrl,
      snippet: snippet ? summarizeText(snippet, 320) : null,
      source: 'duckduckgo',
    });
  }

  return results;
}

function unwrapDuckDuckGoUrl(value: string): string {
  try {
    if (value.startsWith('/l/?')) {
      const parsed = new URL(`https://duckduckgo.com${value}`);
      const target = parsed.searchParams.get('uddg');
      if (target) return decodeURIComponent(target);
    }
  } catch {
    return value;
  }
  return value;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(value: Date): string {
  return value.toISOString();
}

function dateMillis(value: Date | null): number {
  return value ? value.getTime() : 0;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Clio tool: ${value}`);
}
