// Step 1, Direction picker.
//
// New in v2: the user chooses BEFORE doing anything else whether this
// campaign is "on behalf of a client → Hill/agency" or "from me → my
// clients". Every downstream step adapts to this choice (recipient
// sources, context pool, signature, tone defaults).

import { CheckOutlined } from '@ant-design/icons';
import type { WizardDirection } from './types.js';

interface Props {
  direction: WizardDirection | null;
  onChange: (d: WizardDirection) => void;
}

export function StepDirection({ direction, onChange }: Props) {
  return (
    <div>
      <h2>Who are you writing to?</h2>
      <div className="ov2-pane-sub">
        Choose the direction of this campaign. Clio adapts the voice, signature, and intelligence pulled into the draft.
      </div>

      <div className="ov2-dir-pick">
        <DirectionCard
          selected={direction === 'on-behalf'}
          onClick={() => onChange('on-behalf')}
          fromLabel="A client"
          toLabel="Hill / agency"
          title="On behalf of a client"
          desc="Personalized mass outreach to congressional offices and federal agency contacts. You write as the lobbyist representing a specific client."
        />
        <DirectionCard
          selected={direction === 'to-clients'}
          onClick={() => onChange('to-clients')}
          fromLabel="You"
          toLabel="Your clients"
          title="From you to your clients"
          desc="Send briefings, alerts, or updates from yourself to one or many clients in your portfolio. Personalized per-client from shared context."
        />
      </div>
    </div>
  );
}

interface CardProps {
  selected: boolean;
  onClick: () => void;
  fromLabel: string;
  toLabel: string;
  title: string;
  desc: string;
}

function DirectionCard({ selected, onClick, fromLabel, toLabel, title, desc }: CardProps) {
  return (
    <div className={'ov2-dir-card' + (selected ? ' selected' : '')} onClick={onClick}>
      <div className="check">
        <CheckOutlined style={{ fontSize: 14 }} />
      </div>
      <div className="flow">
        <div className="ov2-dir-node from">
          <div className="n-l">Sender</div>
          <div className="n-v">{fromLabel}</div>
        </div>
        <span className="ov2-dir-arrow">→</span>
        <div className="ov2-dir-node to">
          <div className="n-l">Recipients</div>
          <div className="n-v">{toLabel}</div>
        </div>
      </div>
      <div className="title">{title}</div>
      <div className="desc">{desc}</div>
    </div>
  );
}
