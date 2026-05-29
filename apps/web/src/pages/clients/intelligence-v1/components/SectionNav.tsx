import { useNavigate } from 'react-router-dom';
import type { SectionId, SectionMeta } from '../mappers.js';
import { minutesAgoLabel } from '../mappers.js';

interface SectionNavProps {
  sections: SectionMeta[];
  activeSection: SectionId;
  onNavClick: (id: SectionId) => void;
  syncedAt: string | null;
  sourceCount: number;
}

export function SectionNav({
  sections,
  activeSection,
  onNavClick,
  syncedAt,
  sourceCount,
}: SectionNavProps) {
  const navigate = useNavigate();

  return (
    <nav className="iv1-section-nav" aria-label="Client intelligence sections">
      <div className="iv1-section-nav__label">Client profile</div>
      <h2 className="iv1-section-nav__title">Intel tab v1</h2>

      <div className="iv1-section-nav__list">
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              className={`iv1-section-nav__item${isActive ? ' is-active' : ''}`}
              onClick={() => onNavClick(section.id)}
              aria-current={isActive ? 'true' : undefined}
            >
              <span className="iv1-section-nav__num">{section.num}</span>
              <span>{section.shortTitle}</span>
            </button>
          );
        })}
      </div>

      <div className="iv1-section-nav__meta">
        <div>{minutesAgoLabel(syncedAt)}</div>
        <div>{sourceCount} data source{sourceCount === 1 ? '' : 's'}</div>
        <button
          type="button"
          className="iv1-section-nav__manage"
          onClick={() => navigate('/settings/intelligence-mappings')}
        >
          Manage sources →
        </button>
      </div>
    </nav>
  );
}
