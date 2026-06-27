import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Select, Spin, Table } from 'antd';
import { CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import { useDrafts, useUpdateDraft, useIndustries } from './api.js';
import type { WsDraft } from './types.js';

/**
 * Workspace Documents — the management list. Sector/scope filters, packet
 * indicator (layered icon + doc count), and a visual Draft↔Complete pill.
 * No workflow status column (handoff §12.10). Mirrors the prototype WsDocuments.
 */
export function DocumentsPage() {
  const navigate = useNavigate();
  const [sector, setSector] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<'all' | 'mine' | 'shared'>('all');
  const { data: drafts, isLoading } = useDrafts({ sector, scope });
  const { data: industries } = useIndustries();

  return (
    <div className="ws-stage" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Documents</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <Select
            size="middle"
            value={scope}
            style={{ width: 150 }}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All documents' },
              { value: 'mine', label: 'Created by me' },
              { value: 'shared', label: 'Shared with me' },
            ]}
          />
          <Select
            size="middle"
            allowClear
            placeholder="All sectors"
            value={sector}
            style={{ width: 200 }}
            onChange={(v) => setSector(v)}
            options={(industries ?? []).map((s) => ({ value: s, label: s }))}
          />
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      ) : (
        <DocsTable drafts={drafts ?? []} onOpen={(id) => navigate(`/workspace/draft/${id}`)} />
      )}
    </div>
  );
}

function DocsTable({ drafts, onOpen }: { drafts: WsDraft[]; onOpen: (id: string) => void }) {
  const { message } = AntApp.useApp();
  return (
    <Table<WsDraft>
      dataSource={drafts}
      rowKey="id"
      pagination={false}
      onRow={(r) => ({ onClick: () => onOpen(r.id), style: { cursor: 'pointer' } })}
      locale={{ emptyText: 'No documents yet. Start one from the Library.' }}
      columns={[
        {
          title: 'Name',
          dataIndex: 'docTitle',
          render: (title: string, r) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <FileTextOutlined style={{ color: 'var(--ws-ink-3)' }} />
              <span style={{ fontWeight: 600 }}>{title}</span>
              {r.isPacket && (
                <span className="ws-pill info" title="Packet">
                  <CopyOutlined /> {r.docCount} docs
                </span>
              )}
            </span>
          ),
        },
        { title: 'Type', dataIndex: 'product', render: (p: string | null) => p ?? '—' },
        { title: 'Client', dataIndex: 'client', render: (c: string | null) => c ?? '—' },
        {
          title: 'Ask',
          dataIndex: 'ask',
          render: (ask: WsDraft['ask']) =>
            ask && ask !== 'n/a' && typeof ask === 'object' && ask.amount ? `$${ask.amount}` : '—',
        },
        {
          title: '',
          dataIndex: 'status',
          width: 130,
          render: (status: WsDraft['status'], r) => (
            <StatusPill draftId={r.id} status={status} onToggled={() => message.success('Updated')} />
          ),
        },
      ]}
    />
  );
}

function StatusPill({
  draftId,
  status,
  onToggled,
}: {
  draftId: string;
  status: 'draft' | 'complete';
  onToggled: () => void;
}) {
  const update = useUpdateDraft(draftId);
  const next = status === 'draft' ? 'complete' : 'draft';
  return (
    <button
      className={`ws-pill ${status}`}
      style={{ border: 'none', cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        update.mutate({ status: next }, { onSuccess: onToggled });
      }}
    >
      {status === 'complete' ? 'Complete' : 'Draft'}
    </button>
  );
}
