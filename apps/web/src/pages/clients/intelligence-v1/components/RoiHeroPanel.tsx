import { formatCompact } from '../mappers.js';

type HeroTruthState = 'normal' | 'zero_obligation' | 'no_activity';

interface RoiHero {
  lobbyingTtm: number;
  obligationsTtm: number;
  returnRatio: number | null;
  gap: number;
  truthState?: HeroTruthState;
}

interface RoiHeroPanelProps {
  hero: RoiHero | undefined;
}

function resolveTruthState(hero: RoiHero | undefined): HeroTruthState {
  if (!hero) return 'no_activity';
  const hasLobbying = (hero.lobbyingTtm ?? 0) > 0;
  const hasObligations = (hero.obligationsTtm ?? 0) > 0;
  if (hero.truthState) return hero.truthState;
  if (hasLobbying && !hasObligations) return 'zero_obligation';
  if (hasLobbying || hasObligations) return 'normal';
  return 'no_activity';
}

export function RoiHeroPanel({ hero }: RoiHeroPanelProps) {
  const state = resolveTruthState(hero);
  const lobby = hero?.lobbyingTtm ?? 0;
  const obligations = hero?.obligationsTtm ?? 0;
  const ratio = hero?.returnRatio ?? null;
  const gap = hero?.gap ?? 0;

  const ratioLabel =
    ratio != null
      ? `${ratio.toFixed(1)}×`
      : state === 'zero_obligation'
        ? '0.0×'
        : '—';

  const ratioSubcopy =
    state === 'zero_obligation'
      ? 'Zero-obligation truth state — no federal contract obligations mapped in TTM.'
      : state === 'no_activity'
        ? 'No lobbying or obligations activity mapped in TTM.'
        : `Gap: ${formatCompact(gap)}`;

  const obligationsSubcopy =
    state === 'zero_obligation'
      ? '⚠ $0 obligations is a true zero (not hidden).'
      : obligations > 0
        ? 'Contracting obligations mapped'
        : 'No obligations data mapped yet';

  return (
    <div className={`iv1-roi-hero state-${state}`}>
      <div className="iv1-roi-row">
        <div className="iv1-roi-cell emphasis-primary">
          <div className="iv1-roi-label">Lobbying spend · TTM</div>
          <div className="iv1-roi-val num">{formatCompact(lobby)}</div>
          <div className="iv1-roi-delta">LDA-mapped spend</div>
        </div>

        <div className={`iv1-roi-cell ${state === 'zero_obligation' ? 'truth-zero' : ''}`}>
          <div className="iv1-roi-label">Federal obligations · TTM</div>
          <div className={`iv1-roi-val num ${obligations === 0 ? 'zero' : ''}`}>{formatCompact(obligations)}</div>
          <div className={`iv1-roi-delta ${state === 'zero_obligation' ? 'warn' : ''}`}>{obligationsSubcopy}</div>
        </div>

        <div className={`iv1-roi-cell emphasis-secondary ${state === 'zero_obligation' ? 'truth-zero' : ''}`}>
          <div className="iv1-roi-label">Return ratio</div>
          <div className={`iv1-roi-val num ${state === 'zero_obligation' ? 'critical' : ratio != null ? 'positive' : ''}`}>
            {ratioLabel}
          </div>
          <div className={`iv1-roi-delta ${state === 'zero_obligation' ? 'warn' : ''}`}>{ratioSubcopy}</div>
        </div>
      </div>
    </div>
  );
}
