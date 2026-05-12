import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SessionList } from './SessionList.js';
import { ChatPane } from './ChatPane.js';
import { ArtifactPanel } from './ArtifactPanel.js';
import './workspace.css';

/**
 * Top-level Workspace page. Three-pane layout:
 *   - Left: session list.
 *   - Middle: chat with the agent.
 *   - Right: artifacts produced in the active session (Claude-style
 *     artifact shelf).
 *
 * The whole component is locked to the viewport height so each pane
 * scrolls internally — the page itself never grows past the screen.
 * Selection lives in local state; sessions are tenant- and user-scoped
 * server-side so URL state isn't needed until deep-linking is.
 */
export function WorkspacePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped whenever an assistant reply lands so the artifact panel can
  // refetch — the model may have just produced a new artifact. Each
  // pane subscribes to its own slice of state; bumping this avoids
  // pinning a tighter coupling between ChatPane and ArtifactPanel.
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const qc = useQueryClient();

  return (
    <div className="clio-workspace">
      <div className="clio-workspace__body">
        <aside className="clio-workspace__sidebar">
          <SessionList selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <main className="clio-workspace__main">
          <ChatPane
            sessionId={selectedId}
            onAssistantReply={() => {
              setArtifactRefreshKey((k) => k + 1);
              if (selectedId) {
                qc.invalidateQueries({ queryKey: ['clio', 'artifacts', selectedId] });
              }
            }}
          />
        </main>
        <ArtifactPanel sessionId={selectedId} refreshKey={artifactRefreshKey} />
      </div>
    </div>
  );
}
