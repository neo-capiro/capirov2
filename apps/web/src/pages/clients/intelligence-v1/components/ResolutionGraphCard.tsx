import { useMemo, useState } from 'react';
import type { ClientProfileV1 } from '../mappers.js';

type ScopedGraph = ClientProfileV1['sections']['relationships']['scopedGraph'];
type NodeKind = 'client' | 'member' | 'lobbyist' | 'committee';

export interface ResolutionGraphNode {
  id: string;
  label: string;
  kind: NodeKind;
}

interface ResolutionGraphCardProps {
  scopedGraph?: ScopedGraph;
  canExpand?: boolean;
  defaultNodeCap?: number;
  hardNodeCap?: number;
  nodeDrillHrefBuilder?: (node: ResolutionGraphNode) => string;
  /** Count of ex-staffers linked to this client; shown in the legend when > 0. */
  exStafferCount?: number;
}

const DEFAULT_NODE_CAP = 16;
const HARD_NODE_CAP = 30;

function kindLabel(kind: NodeKind): string {
  if (kind === 'member') return 'Member';
  if (kind === 'lobbyist') return 'Lobbyist';
  if (kind === 'committee') return 'Committee';
  return 'Client';
}

function buildNodes(scopedGraph?: ScopedGraph, hardCap = HARD_NODE_CAP): ResolutionGraphNode[] {
  // No invented defaults: when the scoped graph is absent or empty we render
  // zero nodes and the caller shows an explicit empty state. Previously these
  // fell back to 10 members / 4 lobbyists / 6 committees, fabricating a graph
  // of generic "Member N" nodes for clients with no resolved relationships.
  const memberCount = Math.max(0, scopedGraph?.meta.memberCount ?? 0);
  const lobbyistCount = Math.max(0, scopedGraph?.meta.lobbyistCount ?? 0);
  const committeeCount = Math.max(0, scopedGraph?.meta.committeeCount ?? 0);

  if (memberCount + lobbyistCount + committeeCount === 0) return [];

  const nodes: ResolutionGraphNode[] = [{ id: 'client-0', label: 'Client', kind: 'client' }];

  for (let i = 1; i <= memberCount; i += 1) nodes.push({ id: `member-${i}`, label: `Member ${i}`, kind: 'member' });
  for (let i = 1; i <= lobbyistCount; i += 1) nodes.push({ id: `lobbyist-${i}`, label: `Lobbyist ${i}`, kind: 'lobbyist' });
  for (let i = 1; i <= committeeCount; i += 1) nodes.push({ id: `committee-${i}`, label: `Committee ${i}`, kind: 'committee' });

  return nodes.slice(0, hardCap);
}

export function ResolutionGraphCard({
  scopedGraph,
  canExpand = true,
  defaultNodeCap = DEFAULT_NODE_CAP,
  hardNodeCap = HARD_NODE_CAP,
  nodeDrillHrefBuilder,
  exStafferCount,
}: ResolutionGraphCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const nodes = useMemo(() => buildNodes(scopedGraph, hardNodeCap), [scopedGraph, hardNodeCap]);
  const maxVisible = expanded ? nodes.length : Math.min(defaultNodeCap, nodes.length);
  const visibleNodes = nodes.slice(0, maxVisible);
  const hiddenCount = Math.max(0, nodes.length - visibleNodes.length);

  const avgConfidence = scopedGraph?.resolutionQuality.avgConfidence ?? null;
  const hasExpandableOverflow = nodes.length > defaultNodeCap;
  const expandEnabled = canExpand && hasExpandableOverflow;

  const buildDrillHref = (node: ResolutionGraphNode): string => {
    if (nodeDrillHrefBuilder) {
      return nodeDrillHrefBuilder(node) || '';
    }
    return '';
  };

  return (
    <div className="iv1-surface" style={{ overflow: 'hidden' }}>
      <div className="iv1-surface-head">
        <h3>Resolution graph</h3>
        <span className="iv1-surface-sub">
          {nodes.length} entities{avgConfidence != null ? ` · ${avgConfidence}% avg confidence` : ''}
        </span>
        <span className="iv1-surface-right" style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="iv1-btn iv1-btn-sm"
            onClick={() => {
              setExpanded(false);
              setFocusedNodeId(null);
            }}
          >
            Reset
          </button>
          <button
            type="button"
            className="iv1-btn iv1-btn-sm"
            disabled={!expandEnabled}
            title={expandEnabled ? (expanded ? 'Collapse graph' : 'Expand graph') : 'No additional nodes'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Collapse' : 'Expand'} ↗
          </button>
        </span>
      </div>

      <div className="iv1-rgc-canvas">
        {visibleNodes.length === 0 ? (
          <div className="iv1-empty" style={{ padding: '24px 16px', textAlign: 'center', width: '100%' }}>
            <b>No resolved entities yet</b>
            <span>No lobbyists, members, or committees are linked to this client in the resolution graph.</span>
          </div>
        ) : (
          visibleNodes.map((node) => {
          const href = buildDrillHref(node);
          const focused = focusedNodeId === node.id;
          const commonClass = `iv1-rgc-node ${node.kind} ${focused ? 'is-focused' : ''}`;
          const title = `${kindLabel(node.kind)} · ${node.label}`;

          if (!href) {
            return (
              <button
                key={node.id}
                type="button"
                className={commonClass}
                title={title}
                onClick={() => setFocusedNodeId(node.id)}
              >
                <span className="iv1-rgc-node-kind">{kindLabel(node.kind)}</span>
                <span className="iv1-rgc-node-label">{node.label}</span>
              </button>
            );
          }

          return (
            <a
              key={node.id}
              href={href}
              className={commonClass}
              title={title}
              onClick={(e) => {
                if (!focused) {
                  e.preventDefault();
                  setFocusedNodeId(node.id);
                }
              }}
            >
              <span className="iv1-rgc-node-kind">{kindLabel(node.kind)}</span>
              <span className="iv1-rgc-node-label">{node.label}</span>
            </a>
          );
          })
        )}
      </div>

      <div className="iv1-kg-legend">
        <span className="item"><span className="sw" style={{ background: 'var(--info)' }} />Members</span>
        <span className="item"><span className="sw" style={{ background: '#7A3FB5' }} />Lobbyists</span>
        <span className="item"><span className="sw" style={{ background: 'var(--notable)' }} />Committees</span>
        {exStafferCount != null && exStafferCount > 0 && (
          <span className="item" title="Lobbyists or members with prior congressional staff experience">
            <span className="sw" style={{ background: '#7A3FB5', opacity: 0.45 }} />
            {exStafferCount} ex-staffer{exStafferCount === 1 ? '' : 's'} in network
          </span>
        )}
        <span className="right">Showing {visibleNodes.length} of {nodes.length}{hiddenCount > 0 ? ` · +${hiddenCount} hidden` : ''}</span>
      </div>
    </div>
  );
}
