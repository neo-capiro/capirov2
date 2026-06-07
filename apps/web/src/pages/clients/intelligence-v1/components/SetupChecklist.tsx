import { useQuery } from '@tanstack/react-query';
import { Progress } from 'antd';
import { useApi } from '../../../../lib/use-api.js';

interface SetupCheck {
  key: string;
  label: string;
  done: boolean;
  impact: string;
  hint: string;
}
interface SetupCompleteness {
  clientId: string;
  score: number;
  complete: boolean;
  checks: SetupCheck[];
}

/**
 * Compact "improve this client's intelligence" nudge at the top of the Intel tab.
 * Lists the high-impact profile inputs that are still missing (LDA mapping, issue
 * codes, capability tags/descriptions, sector, contracting/FEC mappings) with what
 * each unlocks. Renders nothing once the client is fully set up, so it stays out
 * of the way for well-configured clients.
 */
export function SetupChecklist({ clientId }: { clientId: string }) {
  const api = useApi();
  const query = useQuery<SetupCompleteness>({
    queryKey: ['intel-setup-completeness', clientId],
    queryFn: async () =>
      (await api.get<SetupCompleteness>(`/api/intelligence/clients/${clientId}/setup-completeness`))
        .data,
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000,
  });

  const data = query.data;
  // Hide while loading, on error, or once fully set up — it's a nudge, not a panel.
  if (!data || data.complete) return null;
  const gaps = data.checks.filter((c) => !c.done);
  if (gaps.length === 0) return null;

  return (
    <div className="iv1-surface" style={{ padding: '12px 16px' }}>
      <div className="iv1-surface-head" style={{ marginBottom: 8 }}>
        <h3>Improve this client&apos;s intelligence</h3>
        <span className="iv1-surface-sub">
          {data.score}% set up · {gaps.length} to improve
        </span>
      </div>
      <Progress
        percent={data.score}
        size="small"
        showInfo={false}
        strokeColor="var(--accent)"
        style={{ marginBottom: 10 }}
      />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {gaps.map((c) => (
          <li key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ color: 'var(--ink-4)', marginTop: 1 }}>
              ○
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{c.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                {c.impact} <span style={{ color: 'var(--ink-4)' }}>{c.hint}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
