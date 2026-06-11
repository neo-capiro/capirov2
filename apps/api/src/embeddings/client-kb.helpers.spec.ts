import { describe, expect, test } from '@jest/globals';
import {
  KB_CHUNK_CHARS,
  KB_SNAPSHOT_MAX_CHARS,
  KB_SOURCE_TYPES,
  buildClientFacilityText,
  buildClientPersonText,
  buildClientProfileText,
  buildDocChunkText,
  buildKbSnapshot,
  chunkDocumentText,
  docChunkSourceId,
  docChunkSourceIdPrefix,
  formatDistrict,
  groupFacilitiesByDistrict,
} from './client-kb.helpers.js';

describe('chunkDocumentText', () => {
  test('short text is one chunk', () => {
    expect(chunkDocumentText('hello world')).toEqual(['hello world']);
    expect(chunkDocumentText('   ')).toEqual([]);
  });

  test('long text chunks with ~15% overlap and never splits words', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkDocumentText(words);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(KB_CHUNK_CHARS);
      // No chunk starts or ends mid-word (all boundaries are whitespace-trimmed words).
      expect(chunk).toMatch(/^word\d+/);
      expect(chunk).toMatch(/word\d+$/);
    }
    // Overlap: each subsequent chunk repeats trailing content of the previous.
    const firstTail = chunks[0]!.slice(-200);
    expect(chunks[1]!.includes(firstTail.slice(0, 50).trim())).toBe(true);
  });

  test('caps runaway documents at the per-doc chunk quota', () => {
    const giant = 'x '.repeat(1_000_000);
    expect(chunkDocumentText(giant).length).toBeLessThanOrEqual(60);
  });
});

describe('source id helpers', () => {
  test('chunk ids are stable and prefix-purgeable', () => {
    expect(docChunkSourceId('att-1', 3)).toBe('att-1:3');
    expect(docChunkSourceIdPrefix('att-1')).toBe('att-1:%');
  });
});

describe('KB text builders', () => {
  test('profile text carries identity fields', () => {
    const text = buildClientProfileText({
      name: 'Meridian Aerostructures',
      description: 'Composite airframe supplier',
      productDescription: 'Thermoplastic wing structures',
      sectorTag: 'defense',
      issueCodes: ['DEF', 'AER'],
      uei: 'ABC123DEF456',
      naicsCodes: ['336413'],
      pscCodes: ['1560'],
      intakeData: { priority: 'composites pilot program' },
    });
    expect(text).toContain('Meridian Aerostructures');
    expect(text).toContain('DEF, AER');
    expect(text).toContain('ABC123DEF456');
    expect(text).toContain('336413');
    expect(text).toContain('composites pilot program');
  });

  test('person text includes role + recency', () => {
    const text = buildClientPersonText({
      clientName: 'Meridian',
      name: 'Pilar Vance',
      title: 'CEO',
      role: 'decision maker',
      email: 'pilar@example.com',
      phone: null,
      lastContact: new Date('2026-06-01T00:00:00Z'),
      notes: 'Prefers early-morning meetings',
    });
    expect(text).toContain('Pilar Vance at Meridian');
    expect(text).toContain('Title: CEO');
    expect(text).toContain('2026-06-01');
    expect(text).toContain('early-morning');
  });

  test('facility text includes the formatted district', () => {
    const text = buildClientFacilityText({
      clientName: 'Meridian',
      name: 'Wichita Plant',
      addressLine: '100 Industry Way',
      city: 'Wichita',
      state: 'KS',
      zip: '67202',
      congressionalDistrict: '04',
      employeeCount: 850,
      notes: null,
    });
    expect(text).toContain('Congressional district: KS-04');
    expect(text).toContain('Employees: 850');
  });

  test('doc chunk text labels file, part, and meeting context', () => {
    const text = buildDocChunkText({
      clientName: 'Meridian',
      fileName: 'hill-strategy.docx',
      chunk: 'Concentrate on the Section 848 amendment.',
      chunkIndex: 1,
      chunkCount: 3,
      meetingSubject: 'Q2 strategy sync',
    });
    expect(text).toContain('hill-strategy.docx');
    expect(text).toContain('part 2 of 3');
    expect(text).toContain('Q2 strategy sync');
    expect(text).toContain('Section 848');
  });
});

describe('district grouping', () => {
  test('formatDistrict joins state and district', () => {
    expect(formatDistrict('KS', '04')).toBe('KS-04');
    expect(formatDistrict('WY', null)).toBe('WY');
    expect(formatDistrict(null, '04')).toBeNull();
  });

  test('groups facilities by district, summing employees', () => {
    const grouped = groupFacilitiesByDistrict([
      { name: 'Plant A', city: 'Wichita', state: 'KS', congressionalDistrict: '04', employeeCount: 850 },
      { name: 'Plant B', city: 'Wichita', state: 'KS', congressionalDistrict: '04', employeeCount: 150 },
      { name: 'Lab', city: 'Dayton', state: 'OH', congressionalDistrict: '10', employeeCount: null },
    ]);
    expect(grouped[0]).toMatchObject({ district: 'KS-04', facilityCount: 2, employees: 1000 });
    expect(grouped[1]).toMatchObject({ district: 'OH-10', facilityCount: 1, employees: null });
  });
});

describe('buildKbSnapshot', () => {
  const input = {
    client: {
      name: 'Meridian Aerostructures',
      description: 'Composite airframe supplier',
      productDescription: 'Thermoplastic structures',
      sectorTag: 'defense',
      issueCodes: ['DEF'],
      uei: 'ABC123',
    },
    people: [
      { name: 'Pilar Vance', title: 'CEO', role: null, lastContact: new Date('2026-06-01') },
      { name: 'Jordan Pike', title: 'VP Gov Affairs', role: 'primary contact', lastContact: null },
    ],
    facilities: [
      { name: 'Wichita Plant', city: 'Wichita', state: 'KS', congressionalDistrict: '04', employeeCount: 850 },
    ],
    recentDocs: [{ fileName: 'hill-strategy.docx', createdAt: new Date('2026-06-02') }],
  };

  test('contains profile, people, district footprint, and recent docs', () => {
    const snapshot = buildKbSnapshot(input);
    expect(snapshot).toContain('Meridian Aerostructures');
    expect(snapshot).toContain('Pilar Vance');
    expect(snapshot).toContain('KS-04');
    expect(snapshot).toContain('~850 employees');
    expect(snapshot).toContain('hill-strategy.docx');
    expect(snapshot).toContain('search_client_knowledge');
  });

  test('stays under the ~1.2k-token budget even with bloated inputs', () => {
    const bloated = {
      ...input,
      client: { ...input.client, description: 'd'.repeat(10_000) },
      people: Array.from({ length: 50 }, (_, i) => ({
        name: `Person ${i} ${'x'.repeat(100)}`,
        title: 'T',
        role: null,
        lastContact: null,
      })),
    };
    expect(buildKbSnapshot(bloated).length).toBeLessThanOrEqual(KB_SNAPSHOT_MAX_CHARS + 1);
  });
});

describe('structural guarantee: encrypted meeting notes never indexed', () => {
  test('the KB source-type allowlist is exactly the four tab-backed types', () => {
    // The indexer can only write these source types; MeetingNote has no
    // builder and no path into the pipeline. If someone adds a source type,
    // this spec forces them to look at the exclusion requirement.
    expect([...KB_SOURCE_TYPES]).toEqual([
      'client_profile',
      'client_person',
      'client_facility',
      'client_doc_chunk',
    ]);
  });
});
