import { useState } from 'react';
import { Typography } from 'antd';
import { SessionList } from './SessionList.js';
import { ChatPane } from './ChatPane.js';
import './workspace.css';

const { Title } = Typography;

/**
 * Top-level Workspace page. Two-pane layout: session list on the left,
 * chat on the right. Selection lives in local state — sessions are
 * tenant- and user-scoped at the API layer, so we don't need anything
 * in URL state until deep-linking to a specific session becomes a
 * requested feature.
 */
export function WorkspacePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="clio-workspace">
      <header className="clio-workspace__header">
        <Title level={3} style={{ margin: 0 }}>
          Workspace
        </Title>
      </header>
      <div className="clio-workspace__body">
        <aside className="clio-workspace__sidebar">
          <SessionList selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <main className="clio-workspace__main">
          <ChatPane sessionId={selectedId} />
        </main>
      </div>
    </div>
  );
}
