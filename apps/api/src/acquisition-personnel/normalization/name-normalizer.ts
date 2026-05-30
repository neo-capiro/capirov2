export interface NormalizedName {
  nameKey: string;
  firstName: string | null;
  middleInitial: string | null;
  lastName: string;
  rank: string | null;
  honorific: string | null;
  suffix: string | null;
}

const RANK_PATTERNS: Array<{ pattern: string[]; value: string }> = [
  { pattern: ['lieutenant', 'general'], value: 'LTG' },
  { pattern: ['lt', 'gen'], value: 'LTG' },
  { pattern: ['major', 'general'], value: 'MG' },
  { pattern: ['maj', 'gen'], value: 'MG' },
  { pattern: ['brigadier', 'general'], value: 'BG' },
  { pattern: ['brig', 'gen'], value: 'BG' },
  { pattern: ['vice', 'admiral'], value: 'VADM' },
  { pattern: ['rear', 'admiral'], value: 'RADM' },
  { pattern: ['lieutenant', 'colonel'], value: 'LTC' },
  { pattern: ['lt', 'col'], value: 'LTC' },
  { pattern: ['lieutenant', 'commander'], value: 'LCDR' },
  { pattern: ['senior', 'executive', 'service'], value: 'SES' },
  { pattern: ['general'], value: 'GEN' },
  { pattern: ['gen'], value: 'GEN' },
  { pattern: ['bg'], value: 'BG' },
  { pattern: ['colonel'], value: 'COL' },
  { pattern: ['col'], value: 'COL' },
  { pattern: ['ltc'], value: 'LTC' },
  { pattern: ['major'], value: 'MAJ' },
  { pattern: ['maj'], value: 'MAJ' },
  { pattern: ['captain'], value: 'CPT' },
  { pattern: ['capt'], value: 'CPT' },
  { pattern: ['cpt'], value: 'CPT' },
  { pattern: ['admiral'], value: 'ADM' },
  { pattern: ['adm'], value: 'ADM' },
  { pattern: ['vadm'], value: 'VADM' },
  { pattern: ['radm'], value: 'RADM' },
  { pattern: ['commander'], value: 'CDR' },
  { pattern: ['cdr'], value: 'CDR' },
  { pattern: ['lcdr'], value: 'LCDR' },
  { pattern: ['ses'], value: 'SES' },
];

const HONORIFIC_PATTERNS: Array<{ pattern: string[]; value: string }> = [
  { pattern: ['hon'], value: 'HON' },
  { pattern: ['secretary'], value: 'SEC' },
  { pattern: ['dr'], value: 'DR' },
  { pattern: ['mr'], value: 'MR' },
  { pattern: ['ms'], value: 'MS' },
];

const SUFFIX_PATTERNS: Array<{ pattern: string; value: string }> = [
  { pattern: 'jr', value: 'JR' },
  { pattern: 'sr', value: 'SR' },
  { pattern: 'ii', value: 'II' },
  { pattern: 'iii', value: 'III' },
  { pattern: 'iv', value: 'IV' },
  { pattern: 'v', value: 'V' },
];

const TRAILING_AFFILIATION_TOKENS = new Set(['usa', 'usn', 'usaf', 'usmc', 'ussf']);

export function normalizeName(fullName: string): NormalizedName {
  const cleaned = sanitize(fullName ?? '');
  if (!cleaned) {
    return {
      nameKey: '',
      firstName: null,
      middleInitial: null,
      lastName: '',
      rank: null,
      honorific: null,
      suffix: null,
    };
  }

  const commaParts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let rank: string | null = null;
  let honorific: string | null = null;
  let suffix: string | null = null;
  let firstName: string | null = null;
  let middleInitial: string | null = null;
  let lastName = '';

  if (isLastNameFirstFormat(commaParts)) {
    lastName = toNameToken(commaParts[0] ?? '');
    const restTokens = tokenize(commaParts.slice(1).join(' '));
    ({ rank, honorific } = consumePrefixes(restTokens));
    suffix = consumeSuffix(restTokens);
    dropTrailingAffiliations(restTokens);

    if (restTokens.length > 0) {
      firstName = restTokens[0] ?? null;
      middleInitial = restTokens.length > 1 ? ((restTokens[1]?.[0] ?? null) as string | null) : null;
    }
  } else {
    const tokens = tokenize(cleaned.replace(/,/g, ' '));
    ({ rank, honorific } = consumePrefixes(tokens));
    suffix = consumeSuffix(tokens);
    dropTrailingAffiliations(tokens);

    if (tokens.length === 0) {
      return {
        nameKey: '',
        firstName: null,
        middleInitial: null,
        lastName: '',
        rank,
        honorific,
        suffix,
      };
    }

    if (tokens.length === 1) {
      firstName = tokens[0] ?? null;
      lastName = tokens[0] ?? '';
      middleInitial = null;
    } else {
      firstName = tokens[0] ?? null;
      lastName = tokens[tokens.length - 1] ?? '';
      middleInitial = tokens.length > 2 ? ((tokens[1]?.[0] ?? null) as string | null) : null;
    }
  }

  if (!firstName && lastName) {
    firstName = lastName;
  }
  if (!lastName && firstName) {
    lastName = firstName;
  }

  const nameKey = [lastName, firstName, middleInitial].filter(Boolean).join(' ').trim();

  return {
    nameKey,
    firstName,
    middleInitial,
    lastName,
    rank,
    honorific,
    suffix,
  };
}

function sanitize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^\w\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return value
    .split(' ')
    .map((token) => normalizeToken(token))
    .filter(Boolean);
}

function normalizeToken(token: string): string {
  return token.replace(/\.+$/g, '').trim();
}

function toNameToken(value: string): string {
  const token = normalizeToken(value);
  return token;
}

function isLastNameFirstFormat(parts: string[]): boolean {
  if (parts.length < 2) return false;
  const first = parts[0] ?? '';
  const firstTokens = tokenize(first);
  if (firstTokens.length === 0 || firstTokens.length > 2) return false;

  const prefixTry = [...firstTokens];
  const { rank, honorific } = consumePrefixes(prefixTry);
  if (rank || honorific) return false;

  return true;
}

function consumePrefixes(tokens: string[]): { rank: string | null; honorific: string | null } {
  let rank: string | null = null;
  let honorific: string | null = null;

  const rankMatch = findLeadingPattern(tokens, RANK_PATTERNS.map((p) => p.pattern));
  if (rankMatch) {
    rank =
      RANK_PATTERNS.find((candidate) => patternsEqual(candidate.pattern, rankMatch))?.value ?? null;
    tokens.splice(0, rankMatch.length);
  }

  const honorificMatch = findLeadingPattern(tokens, HONORIFIC_PATTERNS.map((p) => p.pattern));
  if (honorificMatch) {
    honorific =
      HONORIFIC_PATTERNS.find((candidate) => patternsEqual(candidate.pattern, honorificMatch))?.value ?? null;
    tokens.splice(0, honorificMatch.length);
  }

  return { rank, honorific };
}

function consumeSuffix(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1] ?? '';
  const match = SUFFIX_PATTERNS.find((candidate) => candidate.pattern === last);
  if (!match) return null;
  tokens.pop();
  return match.value;
}

function dropTrailingAffiliations(tokens: string[]): void {
  while (tokens.length > 0) {
    const tail = tokens[tokens.length - 1] ?? '';
    if (!TRAILING_AFFILIATION_TOKENS.has(tail)) break;
    tokens.pop();
  }
}

function findLeadingPattern(tokens: string[], patterns: string[][]): string[] | null {
  if (tokens.length === 0) return null;
  const ordered = [...patterns].sort((a, b) => b.length - a.length);
  for (const pattern of ordered) {
    if (pattern.length > tokens.length) continue;
    const slice = tokens.slice(0, pattern.length);
    if (patternsEqual(slice, pattern)) return pattern;
  }
  return null;
}

function patternsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((token, index) => token === right[index]);
}
