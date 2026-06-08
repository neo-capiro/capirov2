import { selectAudience, type AudiencePersonRole } from './action-audience.js';

const cleanLobbyist: AudiencePersonRole = {
  id: 'p-lobby',
  label: 'Jane Advocate',
  contactUse: 'lobbying_contact',
  reviewStatus: 'accepted',
  staleAt: null,
};

const committee = { id: 'cmte-hasc', label: 'House Armed Services Committee' };

describe('action-audience (§17 contact-use guardrail + §7 quarantine)', () => {
  test('a SAM.gov / official_procurement_poc person is NEVER in the audience', () => {
    const procurementOfficial: AudiencePersonRole = {
      id: 'p-co',
      label: 'Contracting Officer Smith',
      contactUse: 'official_procurement_poc',
      reviewStatus: 'accepted',
      staleAt: null,
    };
    const { audience } = selectAudience({
      personRoles: [procurementOfficial],
      committees: [],
      matchStatuses: ['accepted'],
    });
    expect(audience.find((a) => a.id === 'p-co')).toBeUndefined();
    expect(audience).toHaveLength(0);
  });

  test('a candidate program match forces escalate_uncertainty with a note', () => {
    const result = selectAudience({
      personRoles: [cleanLobbyist],
      committees: [committee],
      matchStatuses: ['accepted', 'candidate'],
    });
    expect(result.forcedActionType).toBe('escalate_uncertainty');
    expect(result.uncertaintyNotes).toHaveLength(1);
    expect(result.uncertaintyNotes[0]).toMatch(/candidate/);
  });

  test('a quarantined program match also forces escalate_uncertainty', () => {
    const result = selectAudience({
      personRoles: [cleanLobbyist],
      committees: [],
      matchStatuses: ['quarantined'],
    });
    expect(result.forcedActionType).toBe('escalate_uncertainty');
    expect(result.uncertaintyNotes[0]).toMatch(/quarantined/);
  });

  test('a stale accepted role is excluded from the audience', () => {
    const staleRole: AudiencePersonRole = {
      id: 'p-stale',
      label: 'Stale Owner',
      contactUse: 'lobbying_contact',
      reviewStatus: 'accepted',
      staleAt: '2025-01-01T00:00:00.000Z',
    };
    const { audience } = selectAudience({
      personRoles: [staleRole],
      committees: [],
      matchStatuses: ['accepted'],
    });
    expect(audience.find((a) => a.id === 'p-stale')).toBeUndefined();
  });

  test('a clean accepted lobbying-eligible person + committee are included', () => {
    const result = selectAudience({
      personRoles: [cleanLobbyist],
      committees: [committee],
      matchStatuses: ['accepted'],
    });
    expect(result.forcedActionType).toBeUndefined();
    expect(result.uncertaintyNotes).toHaveLength(0);

    const person = result.audience.find((a) => a.id === 'p-lobby');
    // A human-designated lobbying_contact IS outreach-eligible.
    expect(person).toMatchObject({
      kind: 'person_role',
      contactUse: 'lobbying_contact',
      outreachEligible: true,
    });

    const cmte = result.audience.find((a) => a.id === 'cmte-hasc');
    expect(cmte).toMatchObject({ kind: 'committee', label: committee.label });
  });

  test('person members carry outreachEligible: context-only roles are FALSE, lobbying_contact is TRUE', () => {
    // program_ownership_context is the most permissive thing classifyContactUse ever produces
    // for an auto-generated role — it is CONTEXT, never an auto-invitation to lobby, so it must
    // be marked outreachEligible: false. Only a human-set lobbying_contact is true.
    const contextRole: AudiencePersonRole = {
      id: 'p-context',
      label: 'Program Owner',
      contactUse: 'program_ownership_context',
      reviewStatus: 'accepted',
      staleAt: null,
    };
    const { audience } = selectAudience({
      personRoles: [contextRole, cleanLobbyist],
      committees: [committee],
      matchStatuses: ['accepted'],
    });

    const context = audience.find((a) => a.id === 'p-context');
    expect(context).toMatchObject({ kind: 'person_role', outreachEligible: false });

    const lobbyist = audience.find((a) => a.id === 'p-lobby');
    expect(lobbyist).toMatchObject({ kind: 'person_role', outreachEligible: true });
  });

  test('committees are always allowed even when all people are excluded', () => {
    const { audience } = selectAudience({
      personRoles: [
        {
          id: 'p-q',
          label: 'Quarantined Person',
          contactUse: 'quarantined',
          reviewStatus: 'quarantined',
          staleAt: null,
        },
      ],
      committees: [committee],
      matchStatuses: ['accepted'],
    });
    expect(audience).toHaveLength(1);
    expect(audience[0]).toMatchObject({ kind: 'committee' });
  });

  test('candidate / do-not-contact-procurement-sensitive people are excluded', () => {
    const { audience } = selectAudience({
      personRoles: [
        {
          id: 'p-cand',
          label: 'Unreviewed Person',
          contactUse: 'candidate',
          reviewStatus: 'candidate',
          staleAt: null,
        },
        {
          id: 'p-ss',
          label: 'Source Selection Adjacent',
          contactUse: 'do_not_contact_procurement_sensitive',
          reviewStatus: 'accepted',
          staleAt: null,
        },
      ],
      committees: [],
      matchStatuses: ['accepted'],
    });
    expect(audience).toHaveLength(0);
  });
});
