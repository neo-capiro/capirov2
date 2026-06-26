// Memory interview — pure helpers (P2).
//
// The "Fill with Meri" flow asks the user one question per section (the
// section's catalog `prompt`), collects free-text answers, and assembles them
// into MemorySection bodies. The LLM-drafting step (polishing an answer into
// prose) is done by the service via the chat model; these pure helpers handle
// question generation and answer->section mapping so they are unit-testable
// without an LLM.

import { fileDefForType, type SectionDef } from './memory-catalog.js';
import type { MemorySection } from './memory.types.js';

export interface InterviewQuestion {
  sectionKey: string;
  heading: string;
  question: string;
  example: string;
}

export interface InterviewAnswer {
  sectionKey: string;
  answer: string;
}

/** Build the ordered question list for a memory type from the catalog. */
export function buildInterviewQuestions(type: string): InterviewQuestion[] {
  const def = fileDefForType(type);
  if (!def) return [];
  return def.sections.map((s: SectionDef) => ({
    sectionKey: s.key,
    heading: s.heading,
    question: phraseQuestion(s),
    example: s.example,
  }));
}

/** Turn a section def into a conversational interview question. */
export function phraseQuestion(s: SectionDef): string {
  // The prompt is already imperative guidance; make it a question.
  const base = s.prompt.replace(/\.$/, '');
  return `${s.heading} — ${base}?`.replace(/\?\?$/, '?');
}

/**
 * Map collected answers into MemorySection[] for the given type. Only answers
 * with non-empty text become sections; ordering follows the catalog. Answers
 * are trimmed; empty answers are skipped (so a half-finished interview still
 * produces a valid partial item rather than blank sections).
 */
export function answersToSections(type: string, answers: InterviewAnswer[]): MemorySection[] {
  const def = fileDefForType(type);
  if (!def) return [];
  const byKey = new Map(answers.map((a) => [a.sectionKey, a.answer?.trim() ?? '']));
  const out: MemorySection[] = [];
  for (const s of def.sections) {
    const body = byKey.get(s.key);
    if (body && body.length > 0) {
      out.push({ key: s.key, heading: s.heading, owner: 'human', body });
    }
  }
  return out;
}

/**
 * System prompt for the LLM interviewer. Encodes Capiro's content rules:
 * lobbyist outcomes, demo-defensible, NO invented stats/metrics. The service
 * prepends this when asking the model to polish a raw answer into section prose.
 */
export function interviewerSystemPrompt(fileLabel: string): string {
  return [
    `You are Meri, helping a government-affairs professional fill in their "${fileLabel}" memory file.`,
    'Ask one focused question at a time, in plain language a lobbyist would use.',
    'When drafting section text from their answers:',
    '- Write in their voice, concise and concrete.',
    '- Lead with outcomes and the intelligence edge, not process jargon.',
    '- NEVER invent statistics, dollar figures, dates, or names the user did not provide.',
    '- If the user gives a vague answer, ask one clarifying follow-up rather than padding.',
    'Keep each drafted section to a tight paragraph or a few bullet lines.',
  ].join('\n');
}
