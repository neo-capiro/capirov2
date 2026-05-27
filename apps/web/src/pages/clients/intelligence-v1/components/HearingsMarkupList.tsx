export interface HearingMarkupItem {
  month: string;
  day: string;
  title: string;
  sub: string;
  time: string;
  room: string;
}

interface HearingsMarkupListProps {
  items: HearingMarkupItem[];
  syncCalendarHref: string;
  setAlertsHref: string;
}

export function HearingsMarkupList({
  items,
  syncCalendarHref,
  setAlertsHref,
}: HearingsMarkupListProps) {
  const safeSyncHref = syncCalendarHref?.trim() || '/engagement';
  const safeAlertsHref = setAlertsHref?.trim() || '/intelligence/changes';

  return (
    <>
      {items.map((h) => (
        <div key={`${h.month}-${h.day}-${h.title}`} className="iv1-hearing-row">
          <div className="iv1-hearing-date">
            <div className="m">{h.month}</div>
            <div className="d num">{h.day}</div>
          </div>
          <div>
            <div className="iv1-hearing-title">{h.title}</div>
            <div className="iv1-hearing-sub">{h.sub}</div>
          </div>
          <div className="iv1-hearing-time num">
            {h.time}
            <br />
            {h.room}
          </div>
        </div>
      ))}

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-1)', display: 'flex', gap: 8 }}>
        <a href={safeSyncHref} className="iv1-btn iv1-btn-sm" style={{ textDecoration: 'none' }}>
          Sync to calendar
        </a>
        <a href={safeAlertsHref} className="iv1-btn iv1-btn-sm" style={{ textDecoration: 'none' }}>
          Set alerts
        </a>
      </div>
    </>
  );
}
