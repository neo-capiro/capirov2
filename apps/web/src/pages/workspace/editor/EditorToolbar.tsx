/**
 * Editor toolbar (sub-header) — ported from the prototype `EditorToolbar`
 * (asset_07). Title + autosave indicator, Custom-letterhead pill, Anonymize
 * toggle, Checks (static 8/10), Version history, collaborator stack, Share,
 * Save draft, Preview & Save.
 *
 * Phase 6 stubs: the Checks popover, the Anonymize REVIEW modal, and the
 * Version-history popover are deferred — those buttons toast for now. The
 * Anonymize toggle still flips cfg.anonymize live (the review modal only gates
 * turning it ON in the prototype; here it toggles directly until phase 6).
 */
import type { WsLetterhead } from '../types.js';
import { AvaStack, Icon } from '../kit.js';

export type SaveStatus = 'saved' | 'saving';

export function EditorToolbar({
  title,
  saveStatus,
  anonymize,
  letterhead,
  onAnonymize,
  onChecks,
  onHistory,
  onShare,
  onSaveDraft,
  onPreview,
}: {
  title: string;
  saveStatus: SaveStatus;
  anonymize: boolean;
  letterhead?: WsLetterhead;
  onAnonymize: () => void;
  onChecks: () => void;
  onHistory: () => void;
  onShare: () => void;
  onSaveDraft: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 30px',
        borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        flex: 'none',
      }}
    >
      <div style={{ minWidth: 0, maxWidth: 360, flex: '0 1 auto' }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        <div
          className="num"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {saveStatus === 'saving' ? (
            <>
              <Icon name="RefreshCw" size={10} style={{ opacity: 0.5 }} />
              Saving…
            </>
          ) : (
            <>
              <Icon name="Check" size={10} style={{ color: 'var(--success)' }} />
              Saved · just now
            </>
          )}
        </div>
      </div>
      {letterhead?.custom && (
        <span className="pill info" style={{ marginLeft: 4 }}>
          Custom letterhead
        </span>
      )}
      <div style={{ flex: 1 }} />
      <button
        className="btn sm btn-ghost"
        onClick={onAnonymize}
        title="Remove direct client & product names Meri identifies"
        style={{
          color: anonymize ? 'var(--accent)' : 'var(--ink-2)',
          background: anonymize ? 'var(--accent-soft)' : 'transparent',
        }}
      >
        <Icon name={anonymize ? 'EyeOff' : 'Eye'} size={14} />
        {anonymize ? 'Anonymized' : 'Anonymize'}
      </button>
      {/* TODO(phase 6): Checks popover (currently a toast stub). */}
      <button className="btn sm btn-ghost" style={{ color: 'var(--ink-2)' }} onClick={onChecks}>
        <Icon name="ListChecks" size={14} />
        Checks{' '}
        <span style={{ color: 'var(--notable)', fontWeight: 600 }} className="num">
          8/10
        </span>
      </button>
      {/* TODO(phase 6): Version-history popover (currently a toast stub). */}
      <button className="btn sm btn-ghost" style={{ color: 'var(--ink-2)' }} onClick={onHistory}>
        <Icon name="History" size={14} />
        Version history
      </button>
      {/* TODO(phase 7): live collaborators — static avatar stack for now. */}
      <AvaStack list={['NM', 'MR', 'EO']} size={26} />
      <button className="btn sm" onClick={onShare}>
        <Icon name="UserPlus" size={13} />
        Share
      </button>
      <span style={{ width: 1, height: 22, background: 'var(--border-1)', margin: '0 2px' }} />
      <button className="btn sm btn-ghost" style={{ color: 'var(--ink-2)' }} onClick={onSaveDraft}>
        <Icon name="Save" size={13} />
        Save draft
      </button>
      <button className="btn btn-accent" onClick={onPreview} style={{ fontWeight: 600 }}>
        <Icon name="FileCheck" size={14} />
        Preview &amp; Save
      </button>
    </div>
  );
}
