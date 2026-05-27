interface LifecycleStep {
  label: string;
  state: 'done' | 'current' | 'pending';
}

interface LifecycleRailItem {
  title: string;
  source: string;
  docket: string;
  steps: LifecycleStep[];
  deadline: string;
  deadlineSeverity: 'crit' | 'warn';
}

interface RegLifecycleRailProps {
  rails: LifecycleRailItem[];
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function RegLifecycleRail({ rails }: RegLifecycleRailProps) {
  return (
    <>
      {rails.map((reg) => (
        <div key={reg.docket} className="iv1-reg-block">
          <h4 className="iv1-reg-title">{reg.title}</h4>
          <div className="iv1-reg-source mono">
            <strong style={{ fontFamily: 'var(--font-sans-rd)', fontWeight: 500 }}>{reg.source}</strong>
            {' · '}Docket {reg.docket}
          </div>
          <div className="iv1-lifecycle-rail">
            {reg.steps.map((step, i) => (
              <div key={`${reg.docket}-${step.label}`} style={{ display: 'contents' }}>
                <div className={`iv1-lifecycle-step ${step.state}`}>{step.label}</div>
                {i < reg.steps.length - 1 && <span className="iv1-lifecycle-arrow">→</span>}
              </div>
            ))}
          </div>
          <div className={`iv1-reg-deadline ${reg.deadlineSeverity}`}>
            <ClockIcon />
            <strong>{reg.deadline}</strong>
            {reg.deadlineSeverity === 'crit' && ' · action needed'}
          </div>
        </div>
      ))}
    </>
  );
}
