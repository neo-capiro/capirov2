// Step 1, Direction — the wizard's informational landing page.
//
// "New Outreach" now drops the user straight into the wizard, so this first
// step orients rather than interrogates: what an outreach campaign is, the
// three recipient types (Individual / List / Group), and a single CTA into
// Campaign Setup. The previous direction picker (StepDirection.tsx) is
// preserved for reference / quick rollback.

import {
  ArrowRightOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import './step-direction-landing.css';

interface Props {
  /** Advances the wizard into Campaign Setup (same as the footer Continue). */
  onStart: () => void;
}

// Single source for the three recipient-type explainers: `card` is the short
// blurb on the floating art cards, `detail` the fuller copy in the bottom
// strip. Kept together so the two can never drift apart.
const RECIPIENT_TYPES = [
  {
    key: 'individual',
    label: 'Individual',
    icon: <UserOutlined />,
    card: 'One personalized email per contact',
    detail:
      'One personalized email per recipient, sent individually. Add from the congressional directory, client contacts, or manually.',
  },
  {
    key: 'list',
    label: 'List',
    icon: <UnorderedListOutlined />,
    card: 'Saved contacts, each emailed individually',
    detail:
      'Apply a saved contact list. Each person on the list receives their own individual personalized email.',
  },
  {
    key: 'group',
    label: 'Group',
    icon: <TeamOutlined />,
    card: 'All contacts receive one shared email',
    detail:
      'Create a group of recipients who all receive one shared email together — ideal for office teams or joint outreach.',
  },
] as const;

export function StepDirectionLanding({ onStart }: Props) {
  return (
    <div className="ov2-dl">
      <div className="ov2-dl-hero">
        <div className="ov2-dl-copy">
          <span className="ov2-dl-badge">New outreach campaign</span>
          <h1>Build your outreach</h1>
          <p>
            Add individuals, apply saved contact lists, or create groups — all in one place. For
            example, <strong>notify 25 congressional offices about a client visit</strong> by adding
            each office as a group, so staffers get one coordinated email while Capiro personalizes
            it for their member&apos;s priorities.
          </p>
          <button type="button" className="ov2-dl-cta" onClick={onStart}>
            Create your outreach <ArrowRightOutlined />
          </button>
        </div>

        <div className="ov2-dl-art" aria-hidden="true">
          <span className="ov2-dl-ring" />
          <span className="ov2-dl-ring inner" />
          <span className="ov2-dl-glow" />
          {RECIPIENT_TYPES.map((type) => (
            <div key={type.key} className={`ov2-dl-float ${type.key}`}>
              <span className="ico" data-kind={type.key}>
                {type.icon}
              </span>
              <b>{type.label}</b>
              <small>{type.card}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="ov2-dl-types">
        {RECIPIENT_TYPES.map((type) => (
          <div key={type.key} className="ov2-dl-type">
            <span className="ico" data-kind={type.key}>
              {type.icon}
            </span>
            <div>
              <b>{type.label}</b>
              <p>{type.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
