import { Avatar, Button, Card, Empty, Skeleton, Typography } from 'antd';
import { ExportOutlined } from '@ant-design/icons';

const { Text, Link } = Typography;

export interface ProgramTeamPerson {
  id: string;
  fullName: string;
  title: string | null;
  organization: string | null;
  role: string | null;
  confidence: number;
  lastSeenAt: string;
  sourceCount: number;
  headshotUrl?: string | null;
}

export interface ProgramTeamPanelProps {
  personnel: ProgramTeamPerson[];
  loading?: boolean;
  estimatedTotal?: number;
  onViewAllSources?: () => void;
  onLinkCrmContact?: (personId: string) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';

  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();

  const last = parts[parts.length - 1] ?? first;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function confidenceBand(value: number): {
  label: 'high' | 'medium' | 'low';
  color: 'green' | 'gold' | 'default';
} {
  if (value >= 0.95) return { label: 'high', color: 'green' };
  if (value >= 0.8) return { label: 'medium', color: 'gold' };
  return { label: 'low', color: 'default' };
}

// Confidence rendered as a colored dot + words ("High confidence"), matching
// the mockup. Maps the band to a redesign severity class.
function confidenceDot(value: number): { cls: string; label: string } {
  const band = confidenceBand(value);
  if (band.label === 'high') return { cls: 'success', label: 'High confidence' };
  if (band.label === 'medium') return { cls: 'notable', label: 'Medium confidence' };
  return { cls: 'muted', label: 'Low confidence' };
}

// Deterministic avatar background from the name so each person keeps a stable
// brand-ish color across renders.
const AVATAR_COLORS = ['#2a57ce', '#7a3fb5', '#2e6b43', '#a26913', '#b5301b', '#1a3f9f', '#4e78d8'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ProgramTeamPanel({
  personnel,
  loading = false,
  estimatedTotal,
  onViewAllSources,
  onLinkCrmContact,
}: ProgramTeamPanelProps) {
  if (loading) {
    return (
      <Card title="Program team">
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  const total = estimatedTotal ?? personnel.length;

  return (
    <Card
      className="pe-team-card"
      title="Program team"
      extra={
        <span className="pe-team-extra">
          <Text type="secondary">
            {personnel.length} of ~{total} known
          </Text>
          <Link onClick={onViewAllSources}>View all sources →</Link>
        </span>
      }
    >
      {personnel.length === 0 ? (
        <Empty description="No team data found for this PE — log meeting contacts to build coverage" />
      ) : (
        <div className="pe-team-list pe-scroll-5">
          {personnel.map((person) => {
            const conf = confidenceDot(person.confidence);
            const meta = [person.title, person.organization].filter(Boolean).join(' · ');
            return (
              <div className="pe-team-row" key={person.id}>
                <Avatar
                  className="pe-team-avatar"
                  src={person.headshotUrl ?? undefined}
                  style={{ background: avatarColor(person.fullName) }}
                >
                  {initials(person.fullName)}
                </Avatar>
                <div className="pe-team-id">
                  <div className="pe-team-name-row">
                    <span className="pe-team-name">{person.fullName}</span>
                    {person.role ? <span className="pe-role-pill">{person.role}</span> : null}
                  </div>
                  <div className="pe-team-sub">{meta || 'Title/organization unavailable'}</div>
                </div>
                <div className="pe-team-conf">
                  <span className="pe-conf">
                    <i className={`dot ${conf.cls}`} />
                    {conf.label}
                  </span>
                  <span className="pe-team-seen">
                    Last seen {formatDate(person.lastSeenAt)} · {person.sourceCount} sources
                  </span>
                </div>
                <Button
                  className="pe-link-btn"
                  size="small"
                  icon={<ExportOutlined aria-hidden />}
                  onClick={() => onLinkCrmContact?.(person.id)}
                >
                  Link
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function confidencePillColor(value: number): 'green' | 'gold' | 'default' {
  return confidenceBand(value).color;
}
