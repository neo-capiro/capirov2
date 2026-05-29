export interface NormalizedName {
  nameKey: string;
  firstName: string | null;
  middleInitial: string | null;
  lastName: string;
  rank: string | null;
  honorific: string | null;
  suffix: string | null;
}

export function normalizeName(fullName: string): NormalizedName {
  const cleaned = (fullName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lower = cleaned.toLowerCase();
  const tokens = lower.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return { nameKey: '', firstName: null, middleInitial: null, lastName: '', rank: null, honorific: null, suffix: null };
  }

  const firstName = tokens[0] ?? null;
  const lastName = tokens.length > 1 ? (tokens[tokens.length - 1] ?? '') : (tokens[0] ?? '');
  const middleInitial = tokens.length > 2 ? ((tokens[1]?.[0] ?? null)) : null;
  const key = [lastName, firstName, middleInitial].filter(Boolean).join(' ');

  return {
    nameKey: key,
    firstName,
    middleInitial,
    lastName,
    rank: null,
    honorific: null,
    suffix: null,
  };
}
