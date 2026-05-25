export interface ExplorerResponse<T> {
  rows: T[];
  total: number;
}

export interface ExplorerLdaFilingRow {
  id: string;
  filingUuid: string;
  filingType: string;
  filingYear: number;
  filingPeriod: string | null;
  income: number | null;
  expenses: number | null;
  dtPosted: string | null;
  registrantName: string;
  clientName: string;
  clientState: string | null;
  issueCodes: string[];
}

export interface LdaFacets {
  issueCodes: Array<{ code: string; name: string }>;
  years: number[];
  filingTypes: string[];
}

export interface ExplorerContractorRow {
  id: string;
  name: string;
  uei: string | null;
  category: string | null;
  totalContracts: number | null;
  pctOfAllContracts: number | null;
  rankByContracts: number | null;
  noBidTotal: number | null;
  subsidiaries: number | null;
}

export interface ContractorFacets {
  categories: string[];
}

export interface ExplorerBillRow {
  id: string;
  congress: number;
  billType: string;
  billNumber: string;
  title: string;
  introducedDate: string | null;
  sponsorName: string | null;
  sponsorState: string | null;
  sponsorParty: string | null;
  latestActionText: string | null;
  latestActionDate: string | null;
  policyArea: string | null;
  cosponsorsCount: number;
  originChamber: string | null;
  url: string | null;
}

export interface BillFacets {
  congresses: number[];
  subjects: string[];
  chambers: string[];
  parties: string[];
  policyAreas: string[];
}

export interface ExplorerFedRegRow {
  id: string;
  documentNumber: string;
  type: string;
  title: string;
  agencyNames: string[];
  publicationDate: string;
  commentEndDate: string | null;
  effectiveDate: string | null;
  topics: string[];
  significantRule: boolean;
  htmlUrl: string | null;
}

export interface FedRegFacets {
  types: string[];
  agencies: string[];
}

export interface ExplorerHearingRow {
  id: string;
  chamber: string;
  committeeName: string;
  committeeCode: string | null;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
  type: string | null;
  witnesses: string[];
  url: string | null;
}
export interface HearingFacets {
  chambers: string[];
  committees: string[];
  types: string[];
}

export interface ExplorerGaoRow {
  id: string;
  title: string;
  url: string | null;
  publishDate: string | null;
  reportType: string | null;
  topics: string[];
  agencies: string[];
  summary: string | null;
  recommendations: number | null;
}
export interface GaoFacets {
  reportTypes: string[];
  topics: string[];
}

export interface ExplorerCrsRow {
  id: string;
  title: string;
  date: string | null;
  authors: string[];
  topics: string[];
  summary: string | null;
  pdfUrl: string | null;
  htmlUrl: string | null;
  active: boolean;
}
export interface CrsFacets {
  topics: string[];
}

export interface ExplorerFecRow {
  id: string;
  committeeId: string;
  committeeName: string | null;
  candidateId: string | null;
  candidateName: string | null;
  contributorName: string | null;
  contributorEmployer: string | null;
  contributorOccupation: string | null;
  amount: number;
  contributionDate: string | null;
  receiptType: string | null;
  state: string | null;
  cycle: number;
}
export interface FecFacets {
  cycles: number[];
  states: string[];
}

export interface ExplorerFaraRow {
  id: string;
  registrationNumber: string;
  registrantName: string;
  foreignPrincipal: string;
  country: string | null;
  status: string | null;
  registrationDate: string | null;
  terminationDate: string | null;
  state: string | null;
  description: string | null;
}
export interface FaraFacets {
  countries: string[];
  statuses: string[];
}

export interface ExplorerSecRow {
  id: string;
  cik: string;
  companyName: string;
  formType: string;
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;
  description: string | null;
  sic: string | null;
  url: string | null;
}
export interface SecFacets {
  formTypes: string[];
}

export interface ExplorerIntelArticleRow {
  id: string;
  source: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: string;
  summary: string | null;
  topics: string[];
  agencies: string[];
}
export interface IntelArticleFacets {
  sources: string[];
  topics: string[];
  agencies: string[];
}

export interface ExplorerStateBillRow {
  id: string;
  state: string;
  session: string;
  identifier: string;
  title: string;
  chamber: string | null;
  classification: string[];
  subjects: string[];
  sponsorName: string | null;
  sponsorParty: string | null;
  latestActionDate: string | null;
  latestActionText: string | null;
  url: string | null;
}
export interface StateBillFacets {
  states: string[];
  subjects: string[];
  parties: string[];
}

/* ── Drill-in detail shapes ───────────────────────────────────────────── */

export interface LdaFilingDetail {
  filing: ExplorerLdaFilingRow & {
    expenses: number | null;
    clientId: number | null;
    registrantId: number | null;
  };
  registrantRecent: Array<{
    id: string;
    filingYear: number;
    filingPeriod: string | null;
    clientName: string;
    income: number | null;
  }>;
  clientRecent: Array<{
    id: string;
    filingYear: number;
    filingPeriod: string | null;
    registrantName: string;
    income: number | null;
  }>;
  issueCodes: Array<{ code: string; name: string }>;
}

export interface BillDetail {
  bill: ExplorerBillRow & {
    updateDate: string | null;
    subjects: string[];
    actions: Array<{ id: string; date: string; text: string; type: string | null; chamber: string | null }>;
  };
}

export interface ContractorDetail {
  contractor: ExplorerContractorRow & {
    slug: string | null;
    costPerTaxpayer: number | null;
    yearlySpend: Array<{ year: number; amount: number }>;
    topAgencies: Array<{ name: string; amount: number }>;
    topAwards: Array<{ awardId: string; recipient: string; amount: number; agency: string }>;
    noBidAwards: Array<{ awardId: string; recipient: string; amount: number; agency: string }>;
  };
}

export interface FedRegDetail {
  document: ExplorerFedRegRow & {
    abstract: string | null;
    docketIds: string[];
    cfrReferences: string[];
    pdfUrl: string | null;
  };
}

/* Detail shapes for the 8 newer sources. Backend returns the full row from
   each table — these types pick up extra (non-list-column) fields from the
   schema (e.g. SEC `description`, `sic`, `primaryDoc`; FEC `transactionId`,
   `memoText`; FARA `services`, `address`; intel article `content`) where
   they exist. Unknown fields read as undefined and the views just skip them. */

export interface HearingDetail {
  hearing: ExplorerHearingRow & {
    syncedAt?: string | null;
  };
}

export interface GaoDetail {
  report: ExplorerGaoRow & {
    syncedAt?: string | null;
  };
}

export interface CrsDetail {
  report: ExplorerCrsRow & {
    syncedAt?: string | null;
  };
}

export interface FecDetail {
  contribution: ExplorerFecRow & {
    transactionId?: string | null;
    memoText?: string | null;
    image?: string | null;
  };
}

export interface FaraDetail {
  registration: ExplorerFaraRow & {
    address?: string | null;
    services?: string | null;
  };
}

export interface SecDetail {
  filing: ExplorerSecRow & {
    primaryDoc?: string | null;
    stateOfIncorp?: string | null;
    fiscalYearEnd?: string | null;
  };
}

export interface IntelArticleDetail {
  article: ExplorerIntelArticleRow & {
    content?: string | null;
    feedUrl?: string | null;
  };
}

export interface StateBillDetail {
  bill: ExplorerStateBillRow & {
    abstract?: string | null;
  };
}
