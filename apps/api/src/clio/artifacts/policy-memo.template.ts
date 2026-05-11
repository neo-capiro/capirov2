import { markdownHeading, markdownList, normalizeBlock, normalizeInline } from './markdown.js';

export interface PolicyMemoInput {
  title: string;
  issue: string;
  background: string;
  stakeholders: { name: string; position: string }[];
  recommendations: string[];
  citations: { sourceTitle: string; url: string }[];
}

export function renderPolicyMemo(input: PolicyMemoInput): string {
  const citationRefs = renderCitationRefs(input.citations.length);
  const citations =
    input.citations.length > 0
      ? input.citations.map((citation, index) => `[^${index + 1}]: ${renderFootnote(citation)}`)
      : ['No citations provided.'];

  return [
    markdownHeading(1, input.title),
    '',
    markdownHeading(2, 'Issue'),
    normalizeBlock(input.issue),
    '',
    markdownHeading(2, 'Background'),
    appendFootnoteRefs(normalizeBlock(input.background), citationRefs),
    '',
    markdownHeading(2, 'Stakeholders'),
    ...renderStakeholders(input.stakeholders),
    '',
    markdownHeading(2, 'Recommendations'),
    ...renderRecommendations(input.recommendations),
    '',
    markdownHeading(2, 'Citations'),
    ...citations,
  ].join('\n');
}

function renderStakeholders(stakeholders: PolicyMemoInput['stakeholders']): string[] {
  if (stakeholders.length === 0) return ['- No stakeholders provided.'];
  return stakeholders.map(
    (stakeholder) => `- **${normalizeInline(stakeholder.name)}:** ${normalizeInline(stakeholder.position)}`,
  );
}

function renderRecommendations(recommendations: string[]): string[] {
  if (recommendations.length === 0) return ['- No recommendations provided.'];
  return markdownList(recommendations);
}

function renderCitationRefs(count: number): string {
  return Array.from({ length: count }, (_value, index) => `[^${index + 1}]`).join(' ');
}

function appendFootnoteRefs(body: string, refs: string): string {
  if (!refs) return body;
  return `${body} ${refs}`;
}

function renderFootnote(citation: PolicyMemoInput['citations'][number]): string {
  return `${normalizeInline(citation.sourceTitle)} — ${normalizeInline(citation.url)}`;
}
