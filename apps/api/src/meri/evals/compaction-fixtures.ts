/**
 * Compaction eval fixtures (assistant-parity F2).
 *
 * A deterministic synthetic 300-message conversation with 20 "needle" facts
 * planted in early turns, plus 20 probe questions whose answers live in turns
 * that will have been compacted by the time the conversation ends. The manual
 * runner (scripts/eval-clio-compaction.ts) simulates the rolling-summary
 * pipeline over this conversation with the live small model and checks that
 * each probe can still be answered from [summary + verbatim tail].
 *
 * Pure data + generator so fixture validity is CI-tested
 * (compaction-fixtures.spec.ts) without burning tokens.
 */

export interface CompactionNeedle {
  id: string;
  /** 0-based message index where the fact is planted (early turns only). */
  messageIndex: number;
  /** The user/assistant message text carrying the fact. */
  text: string;
  /** Probe question asked at the end of the conversation. */
  probe: string;
  /** Case-insensitive substrings the answer must contain. */
  mustInclude: string[];
}

export const COMPACTION_NEEDLES: CompactionNeedle[] = [
  {
    id: 'client-name',
    messageIndex: 0,
    text: 'I just signed a new client: Meridian Aerostructures, a composite-airframe supplier out of Wichita.',
    probe: 'What is the name of the new client I told you about at the very start of this conversation?',
    mustInclude: ['Meridian Aerostructures'],
  },
  {
    id: 'bill-number',
    messageIndex: 4,
    text: 'Our top legislative priority is HR 4729, the Advanced Composites Manufacturing Act.',
    probe: 'Which bill number is our top legislative priority?',
    mustInclude: ['4729'],
  },
  {
    id: 'pe-code',
    messageIndex: 8,
    text: 'The program element we track for them is PE 0604015F, the Air Force advanced materials line.',
    probe: 'Which program element code do we track for the client?',
    mustInclude: ['0604015F'],
  },
  {
    id: 'funding-ask',
    messageIndex: 12,
    text: 'Their appropriations ask this cycle is $18.5 million in RDT&E plus-up.',
    probe: 'What dollar amount is the client asking for in appropriations this cycle?',
    mustInclude: ['18.5'],
  },
  {
    id: 'champion',
    messageIndex: 16,
    text: 'Our House champion is Representative Dana Whitfield (KS-04), who sits on HASC.',
    probe: 'Who is our House champion for this effort?',
    mustInclude: ['Whitfield'],
  },
  {
    id: 'deadline',
    messageIndex: 20,
    text: 'Remember: member appropriations request forms are due April 17, 2026.',
    probe: 'When are member appropriations request forms due?',
    mustInclude: ['April 17'],
  },
  {
    id: 'ceo-name',
    messageIndex: 24,
    text: 'Meridian\'s CEO is Pilar Vance; she prefers early-morning meetings and no slide decks.',
    probe: 'What is the name of the client CEO and what is her meeting preference?',
    mustInclude: ['Pilar Vance'],
  },
  {
    id: 'facility-district',
    messageIndex: 28,
    text: 'Their main plant is in Wichita, Kansas — congressional district KS-04 — with 850 employees.',
    probe: 'How many employees does the client have at the Wichita plant?',
    mustInclude: ['850'],
  },
  {
    id: 'competitor',
    messageIndex: 32,
    text: 'Their main competitor on the program is Talon Composites, who lobbied against our language last year.',
    probe: 'Which competitor lobbied against our language last year?',
    mustInclude: ['Talon Composites'],
  },
  {
    id: 'hearing-date',
    messageIndex: 36,
    text: 'The HASC Seapower subcommittee hearing on industrial base resilience is June 3, 2026.',
    probe: 'On what date is the HASC subcommittee hearing on industrial base resilience?',
    mustInclude: ['June 3'],
  },
  {
    id: 'contract-vehicle',
    messageIndex: 40,
    text: 'They deliver through an OTA with AFRL, agreement number FA8650-25-9-9301.',
    probe: 'What is the agreement number for their OTA with AFRL?',
    mustInclude: ['FA8650-25-9-9301'],
  },
  {
    id: 'issue-code',
    messageIndex: 44,
    text: 'For LDA purposes we report their work under issue codes DEF and AER.',
    probe: 'Which LDA issue codes do we report for the client?',
    mustInclude: ['DEF', 'AER'],
  },
  {
    id: 'senate-target',
    messageIndex: 48,
    text: 'On the Senate side, the target office is Senator Maro Quist\'s defense LA, Theo Brandt.',
    probe: 'Who is the defense LA we target in Senator Quist\'s office?',
    mustInclude: ['Theo Brandt'],
  },
  {
    id: 'report-language',
    messageIndex: 52,
    text: 'Last year\'s report language directed a study on domestic carbon-fiber capacity; it is due to Congress September 30, 2026.',
    probe: 'When is the domestic carbon-fiber capacity study due to Congress?',
    mustInclude: ['September 30'],
  },
  {
    id: 'retainer',
    messageIndex: 56,
    text: 'For our own records: Meridian\'s monthly retainer is $25,000, billed quarterly.',
    probe: 'What is the client\'s monthly retainer?',
    mustInclude: ['25,000'],
  },
  {
    id: 'preference-format',
    messageIndex: 60,
    text: 'Preference to remember: I want all client briefings as one-pagers with a 5-bullet executive summary.',
    probe: 'What format do I want client briefings in?',
    mustInclude: ['one-pager'],
  },
  {
    id: 'fly-in',
    messageIndex: 64,
    text: 'The client fly-in is the week of May 11, 2026 — we need 8 Hill meetings booked.',
    probe: 'Which week is the client fly-in, and how many Hill meetings do we need?',
    mustInclude: ['May 11', '8'],
  },
  {
    id: 'amendment',
    messageIndex: 68,
    text: 'We are drafting an amendment to add composite-airframe suppliers to the Section 848 pilot program.',
    probe: 'Which section\'s pilot program is our amendment targeting?',
    mustInclude: ['848'],
  },
  {
    id: 'grant',
    messageIndex: 72,
    text: 'They also won a $3.2 million DOE grant for thermoplastic recycling under award DE-EE0011447.',
    probe: 'What is the award number of the client\'s DOE grant?',
    mustInclude: ['DE-EE0011447'],
  },
  {
    id: 'coalition',
    messageIndex: 76,
    text: 'We co-founded the Advanced Airframe Coalition with five other suppliers; Meridian chairs it through 2027.',
    probe: 'Which coalition does the client chair, and through what year?',
    mustInclude: ['Advanced Airframe Coalition', '2027'],
  },
];

/** Total messages in the synthetic conversation (user+assistant alternating). */
export const COMPACTION_CONVERSATION_LENGTH = 300;

const FILLER_TOPICS = [
  'the daily federal register scan',
  'scheduling a check-in with the appropriations staffer',
  'the weekly media clips summary',
  'updating the engagement tracker',
  'a quick question about committee jurisdiction',
  'drafting a thank-you note after a Hill meeting',
  'the status of the quarterly LDA filing',
  'preparing talking points for a coalition call',
];

export interface SyntheticMessage {
  id: string;
  role: 'user' | 'assistant';
  body: string;
}

/**
 * Deterministically generate the 300-message conversation with needles
 * planted at their message indexes. Filler turns are innocuous chatter so a
 * faithful summary has no reason to preserve them over the needles.
 */
export function generateCompactionConversation(): SyntheticMessage[] {
  const byIndex = new Map<number, CompactionNeedle>();
  for (const needle of COMPACTION_NEEDLES) byIndex.set(needle.messageIndex, needle);
  const messages: SyntheticMessage[] = [];
  for (let i = 0; i < COMPACTION_CONVERSATION_LENGTH; i += 1) {
    const role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant';
    const needle = byIndex.get(i);
    if (needle) {
      messages.push({ id: `m${i}`, role, body: needle.text });
      continue;
    }
    const topic = FILLER_TOPICS[i % FILLER_TOPICS.length];
    messages.push({
      id: `m${i}`,
      role,
      body:
        role === 'user'
          ? `Quick follow-up on ${topic} — can you handle it like last time?`
          : `Done — I took care of ${topic}. Nothing else needs your attention on that thread.`,
    });
  }
  return messages;
}
