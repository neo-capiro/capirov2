import {
  MEMORY_CATALOG,
  fileDefForType,
  editableSectionKeys,
} from './memory-catalog.js';
import {
  buildInterviewQuestions,
  answersToSections,
  phraseQuestion,
  interviewerSystemPrompt,
} from './memory-interview.helpers.js';

describe('memory catalog', () => {
  it('defines the core firm + client files', () => {
    const types = MEMORY_CATALOG.map((f) => f.type);
    expect(types).toEqual(
      expect.arrayContaining(['firm-soul', 'firm-compass', 'playbook', 'client-soul', 'client-compass', 'client-people']),
    );
  });

  it('every section has heading, prompt, and example (help text source)', () => {
    for (const file of MEMORY_CATALOG) {
      for (const s of file.sections) {
        expect(s.key).toBeTruthy();
        expect(s.heading).toBeTruthy();
        expect(s.prompt).toBeTruthy();
        expect(s.example).toBeTruthy();
      }
    }
  });

  it('fileDefForType resolves and editableSectionKeys lists all section keys', () => {
    const def = fileDefForType('client-soul');
    expect(def?.scope).toBe('client');
    const keys = editableSectionKeys('client-soul');
    expect(keys.has('strategic-read')).toBe(true);
    expect(keys.has('not-a-key')).toBe(false);
  });

  it('returns empty allowlist for unknown type (write-guard fail-closed)', () => {
    expect(editableSectionKeys('nope').size).toBe(0);
  });
});

describe('memory interview helpers', () => {
  it('builds one question per section, in catalog order', () => {
    const qs = buildInterviewQuestions('client-soul');
    const def = fileDefForType('client-soul')!;
    expect(qs).toHaveLength(def.sections.length);
    expect(qs[0]?.sectionKey).toBe(def.sections[0]?.key);
    expect(qs[0]?.question).toContain(def.sections[0]?.heading);
  });

  it('phraseQuestion turns a prompt into a single question', () => {
    const q = phraseQuestion({ key: 'k', heading: 'Red lines', prompt: 'Hard constraints we must not cross.', example: 'x' });
    expect(q.endsWith('?')).toBe(true);
    expect(q).not.toContain('??');
  });

  it('maps answers to human-owned sections, skipping blanks, in order', () => {
    const sections = answersToSections('client-soul', [
      { sectionKey: 'priorities', answer: '  Real: protect the supplemental.  ' },
      { sectionKey: 'who-they-are', answer: 'A shipbuilder.' },
      { sectionKey: 'red-lines', answer: '   ' }, // blank -> skipped
    ]);
    // order follows catalog: who-they-are before priorities
    expect(sections.map((s) => s.key)).toEqual(['who-they-are', 'priorities']);
    expect(sections.every((s) => s.owner === 'human')).toBe(true);
    expect(sections[1]?.body).toBe('Real: protect the supplemental.'); // trimmed
  });

  it('returns no sections for an unknown type', () => {
    expect(answersToSections('nope', [{ sectionKey: 'x', answer: 'y' }])).toEqual([]);
  });

  it('interviewer system prompt encodes the no-invented-stats rule', () => {
    const p = interviewerSystemPrompt('Client Soul');
    expect(p).toContain('Client Soul');
    expect(p.toLowerCase()).toContain('never invent');
  });
});
