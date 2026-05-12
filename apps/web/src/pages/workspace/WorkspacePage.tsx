import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Tooltip } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import { SessionList } from './SessionList.js';
import { ChatPane } from './ChatPane.js';
import { ArtifactPanel } from './ArtifactPanel.js';
import './workspace.css';

/**
 * Top-level Workspace page. Three-pane layout:
 *   - Left: session list (collapsible to an icons-only rail).
 *   - Middle: chat with the agent.
 *   - Right: artifacts produced in the active session (Claude-style
 *     artifact shelf — collapsible to a tab when not in use).
 *
 * The whole component is locked to the viewport height so each pane
 * scrolls internally — the page itself never grows past the screen.
 * Collapse state lives in this component (mirrors Claude.ai). Both
 * collapse choices are persisted to localStorage so a refresh keeps the
 * user's preferred layout.
 */
const LS_SIDEBAR = 'capiro.workspace.sidebarCollapsed';
const LS_ARTIFACTS = 'capiro.workspace.artifactsCollapsed';

function readBoolFlag(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeBoolFlag(key: string, value: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore quota / disabled storage
  }
}

export function WorkspacePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped whenever an assistant reply lands so the artifact panel can
  // refetch — the model may have just produced a new artifact. Each
  // pane subscribes to its own slice of state; bumping this avoids
  // pinning a tighter coupling between ChatPane and ArtifactPanel.
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readBoolFlag(LS_SIDEBAR));
  const [artifactsCollapsed, setArtifactsCollapsed] = useState(() => readBoolFlag(LS_ARTIFACTS));
  const qc = useQueryClient();

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      writeBoolFlag(LS_SIDEBAR, next);
      return next;
    });
  }
  function toggleArtifacts() {
    setArtifactsCollapsed((v) => {
      const next = !v;
      writeBoolFlag(LS_ARTIFACTS, next);
      return next;
    });
  }

  return (
    <div className="clio-workspace">
      <div
        className={[
          'clio-workspace__body',
          sidebarCollapsed ? 'is-sidebar-collapsed' : '',
          artifactsCollapsed ? 'is-artifacts-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <aside className="clio-workspace__sidebar">
          <div className="clio-workspace__sidebar-toggle">
            <Tooltip title={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}>
              <Button
                type="text"
                size="small"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleSidebar}
                aria-label={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}
              />
            </Tooltip>
          </div>
          <SessionList
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id || null)}
            collapsed={sidebarCollapsed}
          />
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
        {artifactsCollapsed ? (
          // Collapsed artifact panel — show a thin rail with a single
          // expand button. Mirrors how Claude.ai's artifact shelf
          // tucks away to the right edge until you need it.
          <aside className="clio-workspace__artifacts-rail">
            <Tooltip title="Open artifacts" placement="left">
              <Button
                type="text"
                icon={<LeftOutlined />}
                onClick={toggleArtifacts}
                aria-label="Open artifacts"
              />
            </Tooltip>
          </aside>
        ) : (
          <div className="clio-workspace__artifacts-wrap">
            <div className="clio-workspace__artifacts-toggle">
              <Tooltip title="Collapse artifacts" placement="left">
                <Button
                  type="text"
                  size="small"
                  icon={<RightOutlined />}
                  onClick={toggleArtifacts}
                  aria-label="Collapse artifacts"
                />
              </Tooltip>
            </div>
            <ArtifactPanel sessionId={selectedId} refreshKey={artifactRefreshKey} />
          </div>
        )}
      </div>
    </div>
  );
}
