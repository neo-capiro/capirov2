import { useState, type CSSProperties } from 'react';

export interface CanvasArtifact {
  id?: string;
  title?: string;
  kind?: string;
  bodyText?: string;
}

interface ClioCanvasProps {
  artifact: CanvasArtifact;
  onClose: () => void;
}

/**
 * Side "canvas" panel for Clio deliverables (P1-4): briefings / memos / drafts
 * open here with copy + download, separate from the chat transcript. Streamed in
 * via the `artifact` SSE event. Self-contained styling so it has no CSS deps.
 */
export function ClioCanvas({ artifact, onClose }: ClioCanvasProps) {
  const [copied, setCopied] = useState(false);
  const title = artifact.title?.trim() || 'Document';
  const body = artifact.bodyText ?? '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    const slug =
      title
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'document';
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const btn: CSSProperties = {
    font: 'inherit',
    fontSize: 12,
    padding: '4px 10px',
    border: '1px solid #d9d9d9',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
  };

  return (
    <aside
      aria-label="Document canvas"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: 'min(460px, 92vw)',
        background: '#fff',
        borderLeft: '1px solid #e5e5e5',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1100,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: '1px solid #eee',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        <button type="button" onClick={copy} style={btn} aria-label="Copy document">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={download} style={btn} aria-label="Download document">
          Download
        </button>
        <button type="button" onClick={onClose} style={btn} aria-label="Close canvas">
          ✕
        </button>
      </header>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 18px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        {body}
      </div>
    </aside>
  );
}
