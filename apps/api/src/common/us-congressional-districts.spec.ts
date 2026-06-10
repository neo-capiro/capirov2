import {
  US_STATE_CODES,
  US_HOUSE_SEATS,
  isValidDistrictForState,
} from './us-congressional-districts.js';

describe('isValidDistrictForState', () => {
  it('rejects a district above the state seat count (the QA-reported CA/99 case)', () => {
    expect(isValidDistrictForState('CA', '99')).toBe(false);
  });

  it('accepts the highest valid district for a large state', () => {
    expect(isValidDistrictForState('CA', '52')).toBe(true); // CA has 52 seats
    expect(isValidDistrictForState('TX', '38')).toBe(true);
  });

  it('rejects the at-large sentinel "00" for a multi-district state', () => {
    expect(isValidDistrictForState('CA', '00')).toBe(false);
  });

  it('rejects district 0 / above range for multi-district states', () => {
    expect(isValidDistrictForState('VA', '0')).toBe(false);
    expect(isValidDistrictForState('VA', '12')).toBe(false); // VA has 11
    expect(isValidDistrictForState('VA', '11')).toBe(true);
  });

  it('accepts the at-large sentinel for single-district states', () => {
    expect(isValidDistrictForState('WY', '00')).toBe(true);
    expect(isValidDistrictForState('WY', '01')).toBe(true);
    expect(isValidDistrictForState('WY', '1')).toBe(true);
    expect(isValidDistrictForState('WY', '02')).toBe(false);
    expect(isValidDistrictForState('AK', '00')).toBe(true);
  });

  it('rejects the bare "0" for at-large states ("00" is the only zero form)', () => {
    expect(isValidDistrictForState('WY', '0')).toBe(false);
    expect(isValidDistrictForState('DC', '0')).toBe(false);
  });

  it('treats DC and territories as single at-large delegations', () => {
    expect(isValidDistrictForState('DC', '00')).toBe(true);
    expect(isValidDistrictForState('PR', '00')).toBe(true);
    expect(isValidDistrictForState('PR', '02')).toBe(false);
  });

  it('rejects unknown state codes', () => {
    expect(isValidDistrictForState('ZZ', '01')).toBe(false);
  });

  it('is case-insensitive on the state code', () => {
    expect(isValidDistrictForState('ca', '52')).toBe(true);
    expect(isValidDistrictForState('ca', '99')).toBe(false);
  });

  it('skips cross-validation when either field is absent (PATCH-friendly)', () => {
    expect(isValidDistrictForState(undefined, '99')).toBe(true);
    expect(isValidDistrictForState('CA', undefined)).toBe(true);
    expect(isValidDistrictForState('CA', '')).toBe(true);
  });

  it('rejects non-numeric district strings', () => {
    expect(isValidDistrictForState('VA', '3A')).toBe(false);
    expect(isValidDistrictForState('VA', 'abc')).toBe(false);
  });
});

describe('US state tables', () => {
  it('covers 50 states + DC + 5 territories (56 codes)', () => {
    expect(US_STATE_CODES.length).toBe(56);
    expect(US_STATE_CODES).toContain('DC');
    expect(US_STATE_CODES).not.toContain('ZZ');
  });

  it('seat counts sum to 435 voting House seats across the 50 states', () => {
    const stateOnly = US_STATE_CODES.filter(
      (c) => !['DC', 'PR', 'GU', 'VI', 'AS', 'MP'].includes(c),
    );
    const total = stateOnly.reduce((sum, c) => sum + (US_HOUSE_SEATS[c] ?? 0), 0);
    expect(total).toBe(435);
  });
});
