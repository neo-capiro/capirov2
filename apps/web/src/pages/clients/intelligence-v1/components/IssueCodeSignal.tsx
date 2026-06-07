import { useQuery } from '@tanstack/react-query';
import { Tag, Tooltip } from 'antd';
import { useApi } from '../../../../lib/use-api.js';

interface IssueCodeSignalData {
  clientId: string;
  ldaRegistrantCount: number;
  ldaRegistrants: string[];
  codes: Array<{ code: string; name: string | null; source: 'lda' | 'manual' | 'both' }>;
  overrideCodeCount: number;
  capabilityTagCount: number;
  capabilityDescCount: number;
}

/**
 * Read-only "what's actually driving this client's bill & regulation matching"
 * strip, shown at the top of the Intel tab. Surfaces the issue codes the matcher
 * uses (union of all confirmed LDA registrants + any manual override) with their
 * plain-English names, so the otherwise-invisible matching signal is legible.
 * Renders nothing when there's no signal yet (keeps the tab clean for new clients).
 */
export function IssueCodeSignal({ clientId }: { clientId: string }) {
  const api = useApi();
  const query = useQuery<IssueCodeSignalData>({
    queryKey: ['intel-issue-code-signal', clientId],
    queryFn: async () =>
      (
        await api.get<IssueCodeSignalData>(
          `/api/intelligence/clients/${clientId}/issue-code-signal`,
        )
      ).data,
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  const data = query.data;
  if (!data || data.codes.length === 0) return null;

  const registrantLabel =
    data.ldaRegistrantCount > 0
      ? `from ${data.ldaRegistrantCount} LDA registrant${data.ldaRegistrantCount === 1 ? '' : 's'}`
      : 'from manually-set codes';

  return (
    <div className="iv1-surface" style={{ padding: '12px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
          Issue codes driving matching
        </h3>
        <Tooltip
          title={
            data.ldaRegistrants.length
              ? `Unioned across: ${data.ldaRegistrants.join(', ')}`
              : 'Set on the client form (Sector & Tracks).'
          }
        >
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', cursor: 'help' }}>
            {registrantLabel}
          </span>
        </Tooltip>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {data.codes.map((c) => (
          <Tooltip
            key={c.code}
            title={`${c.name ?? c.code}${c.source === 'manual' ? ' · set manually' : c.source === 'both' ? ' · LDA + manual' : ' · from LDA filings'}`}
          >
            <Tag color={c.source === 'manual' ? 'blue' : 'default'} style={{ margin: 0 }}>
              {c.code}
              {c.name ? <span style={{ color: 'var(--ink-3)' }}> · {c.name}</span> : null}
            </Tag>
          </Tooltip>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
        These broad codes drive bill & regulation matching.{' '}
        {data.capabilityTagCount + data.capabilityDescCount > 0 ? (
          <>
            Capability signal ({data.capabilityTagCount} tag
            {data.capabilityTagCount === 1 ? '' : 's'}, {data.capabilityDescCount} description
            {data.capabilityDescCount === 1 ? '' : 's'}) further sharpens matches.
          </>
        ) : (
          <span style={{ color: 'var(--ink-4)' }}>
            Add specific capability tags &amp; descriptions to sharpen matches beyond these broad
            codes.
          </span>
        )}
      </div>
    </div>
  );
}
