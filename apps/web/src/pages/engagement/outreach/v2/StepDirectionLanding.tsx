// Step 1, Direction — the wizard's informational landing page.
//
// "New Outreach" drops the user straight into the wizard, so this first step
// orients rather than interrogates: what an outreach campaign is, the three
// recipient types (Individual / List / Group), and a single CTA into Campaign
// Setup. The previous direction picker (StepDirection.tsx) is preserved for
// reference / quick rollback.

import {
  ArrowRightOutlined,
  LinkOutlined,
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
// strip, `example` the italic use-case below it. Kept together so they can
// never drift apart.
const RECIPIENT_TYPES = [
  {
    key: 'individual',
    label: 'Individual',
    icon: <UserOutlined />,
    card: 'One personalized email per contact',
    detail:
      'One person, one email, personalized to them. Add congressional contacts, client contacts, or anyone manually. Send to as many individuals as you need in a single campaign.',
    example:
      'Send a policy update to a key staffer, with Capiro referencing your last meeting and their member’s committee priorities.',
  },
  {
    key: 'list',
    label: 'List',
    icon: <UnorderedListOutlined />,
    card: 'Saved contacts, each emailed individually',
    detail:
      'A saved group of contacts, each getting their own individual email. Build a list once and reuse it across campaigns.',
    example:
      'Send your quarterly legislative update to your full HASC staffers list. Every contact gets a personalized email in a single send.',
  },
  {
    key: 'group',
    label: 'Group',
    icon: <TeamOutlined />,
    card: 'All contacts receive one shared email',
    detail:
      'Multiple contacts on one shared email. Use when everyone needs to be on the same message. Send to as many groups as you need in a single campaign.',
    example:
      'Notify staffers across 10 congressional offices about an upcoming client visit, with each office receiving one coordinated email.',
  },
] as const;

// 4-point "sparkle" marking the AI auto-generation note under the CTA.
function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 0c.45 6.27 5.28 11.1 11.55 11.55C17.28 12 12.45 16.83 12 23.1 11.55 16.83 6.72 12 .45 11.55 6.72 11.1 11.55 6.27 12 0z" />
    </svg>
  );
}

export function StepDirectionLanding({ onStart }: Props) {
  return (
    <div className="ov2-dl">
      <div className="ov2-dl-hero">
        <div className="ov2-dl-copy">
          <span className="ov2-dl-badge">
            <LinkOutlined /> New outreach campaign
          </span>
          <h1>Send the right email to the right people, automatically.</h1>
          <p>
            Capiro pulls context from your meeting history, connected inbox, and client portfolio to
            draft personalized outreach for every recipient. Add who you’re reaching, give it
            context, and it handles the rest.
          </p>
          <button type="button" className="ov2-dl-cta" onClick={onStart}>
            Create your outreach <ArrowRightOutlined />
          </button>
          <p className="ov2-dl-note">
            <span className="ico">
              <Sparkle />
            </span>
            <span>
              Capiro generates a draft for every recipient automatically, drawing from your
              connected inbox, past meeting debriefs, and client portfolio.{' '}
              <strong>You review, adjust, and send.</strong>
            </span>
          </p>
        </div>

        <div className="ov2-dl-art" aria-hidden="true">
          <div className="ov2-dl-art-panel">
            <span className="ov2-dl-ring" />
            <span className="ov2-dl-ring inner" />
            <span className="ov2-dl-glow" />
          </div>
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

      <div className="ov2-dl-bottom">
        <div className="ov2-dl-mix">
          <div className="ov2-dl-mix-tags">
            <span className="ov2-dl-tag individual">Individual</span>
            <span className="plus">+</span>
            <span className="ov2-dl-tag list">List</span>
            <span className="plus">+</span>
            <span className="ov2-dl-tag group">Group</span>
          </div>
          <p>
            <strong>Mix and match in a single campaign.</strong> Add individual contacts, apply a
            saved list, and create a group, all at once. Capiro generates a personalized draft for
            each.
          </p>
        </div>

        <div className="ov2-dl-types">
          {RECIPIENT_TYPES.map((type) => (
            <div key={type.key} className="ov2-dl-type">
              <div className="ov2-dl-type-head">
                <span className="ico" data-kind={type.key}>
                  {type.icon}
                </span>
                <b>{type.label}</b>
              </div>
              <p>{type.detail}</p>
              <div className="ov2-dl-example" data-kind={type.key}>
                {type.example}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
