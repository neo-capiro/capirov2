/**
 * US states/territories and their U.S. House apportionment, used to validate
 * client facility location data (state code + congressional district).
 *
 * Seat counts reflect the 2020 Census apportionment, in effect for the 118th
 * Congress onward (districts drawn for the 2022 elections through ~2032). They
 * change only once per decade after the decennial census — update this table
 * after the 2030 Census reapportionment.
 *
 * Non-voting delegations (DC + the five territories) are modeled as a single
 * at-large seat each, matching how the rest of the app treats them.
 */

// state code -> number of U.S. House seats (1 == single at-large district)
export const US_HOUSE_SEATS: Readonly<Record<string, number>> = {
  AL: 7,
  AK: 1,
  AZ: 9,
  AR: 4,
  CA: 52,
  CO: 8,
  CT: 5,
  DE: 1,
  FL: 28,
  GA: 14,
  HI: 2,
  ID: 2,
  IL: 17,
  IN: 9,
  IA: 4,
  KS: 4,
  KY: 6,
  LA: 6,
  ME: 2,
  MD: 8,
  MA: 9,
  MI: 13,
  MN: 8,
  MS: 4,
  MO: 8,
  MT: 2,
  NE: 3,
  NV: 4,
  NH: 2,
  NJ: 12,
  NM: 3,
  NY: 26,
  NC: 14,
  ND: 1,
  OH: 15,
  OK: 5,
  OR: 6,
  PA: 17,
  RI: 2,
  SC: 7,
  SD: 1,
  TN: 9,
  TX: 38,
  UT: 4,
  VT: 1,
  VA: 11,
  WA: 10,
  WV: 2,
  WI: 8,
  WY: 1,
  // Non-voting delegations (single at-large seat each)
  DC: 1,
  PR: 1,
  GU: 1,
  VI: 1,
  AS: 1,
  MP: 1,
};

// All valid 2-letter location codes accepted for a facility's `state`.
export const US_STATE_CODES: readonly string[] = Object.keys(US_HOUSE_SEATS);

/**
 * Is `district` a valid congressional district for `state`?
 *
 * Convention (matches the rest of the app): districts are bare 1-2 digit
 * strings; "00" is the at-large sentinel for single-district states.
 *  - At-large states (1 seat): accept "00", "01", or "1" only (a bare "0" is
 *    rejected — "00" is the at-large sentinel's only zero form).
 *  - Multi-district states: accept "01".."NN" (the at-large "00" is invalid).
 *
 * Returns true when either argument is absent — callers that only know one of
 * the two fields (e.g. a PATCH that updates the district without the state)
 * can't cross-validate here and should not be blocked.
 */
export function isValidDistrictForState(
  state: string | undefined | null,
  district: string | undefined | null,
): boolean {
  if (!state || district == null || district === '') return true;
  const seats = US_HOUSE_SEATS[state.toUpperCase()];
  if (seats == null) return false; // unknown state — invalid pairing
  if (!/^[0-9]{1,2}$/.test(district)) return false;
  const n = Number(district);
  if (seats === 1) return district === '00' || district === '01' || district === '1'; // at-large
  return n >= 1 && n <= seats; // numbered districts; "00" not valid here
}
