/**
 * Firm-onboarding wizard: "Import your clients from LDA".
 *
 * Phase 2 of the client→data association overhaul, surfaced in the UI. A tenant
 * IS a lobbying firm; once it identifies its Senate LDA registrant, its real
 * client list is knowable directly from that registrant's filings — so this
 * inverts onboarding from "type a name and hope the matcher finds it" to "pick
 * from your actual filed clients", with the stable LDA client_id pinned on import
 * (no fuzzy matching, no undercount).
 *
 * Flow:
 *   1. firm   — if the tenant has no registrant anchor yet, search LDA registrants
 *               (GET /firm/lda-registrants?q=) and set it (PUT /firm/registrant).
 *               If the anchor is already set we skip straight to step 2.
 *   2. select — list the firm's filed clients (GET /firm/import-candidates) with
 *               spend + recency; multi-select the ones to onboard. Already-imported
 *               candidates are shown but locked (onboardedAs).
 *   3. result — POST /firm/import (chunked at 100/req to stay under the ALB idle
 *               timeout; the server runs the prepopulation cascade per client).
 *
 * Mirrors BulkImportClientsModal conventions (antd Modal, useApi, react-query,
 * App.useApp().message, invalidate ['clients'] + ['portfolio-summary']).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { BankOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../lib/use-api.js';

interface RegistrantHit {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  totalClients: number;
  totalFilings: number;
}

interface ImportCandidate {
  ldaClientId: number;
  name: string;
  filings: number;
  latestFilingYear: number | null;
  totalSpend: number;
  onboardedAs: string | null;
}

interface ImportCandidatesResponse {
  registrantId: number | null;
  registrantName: string | null;
  candidates: ImportCandidate[];
}

interface ImportResult {
  created: Array<{ id: string; name: string; ldaClientId: number }>;
  skipped: Array<{ ldaClientId: number; reason: string }>;
}

interface FirmOnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  /** Gate for the mutating steps (user_admin). Reads stay open to any member. */
  canManage: boolean;
}

type Stage = 'firm' | 'select' | 'result';

// POST /firm/import caps at 100 ids/request (server ArrayMaxSize) — chunk larger
// selections so a big firm can onboard its whole book in one wizard run.
const IMPORT_CHUNK = 100;

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : `$${Math.round(n)}`;

export function FirmOnboardingWizard({ open, onClose, canManage }: FirmOnboardingWizardProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const [stage, setStage] = useState<Stage>('firm');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  // One-shot guard so the open-time auto-advance to the select step fires once.
  const [didInitStage, setDidInitStage] = useState(false);

  // Current firm anchor. Drives the initial stage: anchored → jump to select.
  const registrant = useQuery<{ ldaRegistrantId: number | null; ldaRegistrantName: string | null }>(
    {
      queryKey: ['firm', 'registrant'],
      queryFn: async () =>
        (await api.get<{ ldaRegistrantId: number | null; ldaRegistrantName: string | null }>(
          '/api/firm/registrant',
        )).data,
      enabled: open,
    },
  );

  const hasAnchor = Boolean(registrant.data?.ldaRegistrantId);

  // Registrant search (only when on the firm step and a query was submitted).
  const registrantSearch = useQuery<RegistrantHit[]>({
    queryKey: ['firm', 'lda-registrants', submittedSearch],
    queryFn: async () =>
      (await api.get<RegistrantHit[]>('/api/firm/lda-registrants', {
        params: { q: submittedSearch },
      })).data,
    enabled: open && stage === 'firm' && submittedSearch.trim().length >= 2,
  });

  // The firm's filed clients (only fetched once an anchor exists).
  const candidates = useQuery<ImportCandidatesResponse>({
    queryKey: ['firm', 'import-candidates'],
    queryFn: async () =>
      (await api.get<ImportCandidatesResponse>('/api/firm/import-candidates')).data,
    enabled: open && stage === 'select' && hasAnchor,
  });

  const setRegistrant = useMutation({
    mutationFn: async (registrantId: number) =>
      (await api.put<{ ldaRegistrantId: number; ldaRegistrantName: string }>(
        '/api/firm/registrant',
        { registrantId },
      )).data,
    onSuccess: (data) => {
      message.success(`Firm set to ${data.ldaRegistrantName}`);
      qc.invalidateQueries({ queryKey: ['firm', 'registrant'] });
      qc.invalidateQueries({ queryKey: ['firm', 'import-candidates'] });
      setStage('select');
    },
    onError: (err) => message.error(apiErr(err, 'Could not set firm')),
  });

  const importClients = useMutation({
    mutationFn: async (ids: number[]) => {
      // Chunk to respect the server's 100-id cap; merge results.
      const merged: ImportResult = { created: [], skipped: [] };
      for (let i = 0; i < ids.length; i += IMPORT_CHUNK) {
        const chunk = ids.slice(i, i + IMPORT_CHUNK);
        const res = (await api.post<ImportResult>('/api/firm/import', { ldaClientIds: chunk })).data;
        merged.created.push(...res.created);
        merged.skipped.push(...res.skipped);
      }
      return merged;
    },
    onSuccess: (res) => {
      setResult(res);
      setStage('result');
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['portfolio-summary'] });
      qc.invalidateQueries({ queryKey: ['firm', 'import-candidates'] });
      if (res.skipped.length === 0) {
        message.success(`Imported ${res.created.length} client${res.created.length === 1 ? '' : 's'}`);
      } else {
        message.warning(
          `Imported ${res.created.length}. ${res.skipped.length} skipped (already onboarded or not your firm's).`,
        );
      }
    },
    onError: (err) => message.error(apiErr(err, 'Import failed')),
  });

  function reset() {
    setStage('firm');
    setSearch('');
    setSubmittedSearch('');
    setSelectedIds([]);
    setResult(null);
    setDidInitStage(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Once per open: when the registrant query resolves, jump straight to the
  // select step if the firm anchor already exists (no need to re-pick the firm).
  // After this one-shot init, `stage` is authoritative — so "Change firm" can
  // send the user back to the firm step even though an anchor exists.
  useEffect(() => {
    if (!open || didInitStage || registrant.isLoading) return;
    setDidInitStage(true);
    if (hasAnchor) setStage('select');
  }, [open, didInitStage, registrant.isLoading, hasAnchor]);

  const candidateRows = candidates.data?.candidates ?? [];
  const selectableIds = useMemo(
    () => candidateRows.filter((c) => !c.onboardedAs).map((c) => c.ldaClientId),
    [candidateRows],
  );

  const registrantColumns: ColumnsType<RegistrantHit> = [
    { title: 'Registrant (firm)', dataIndex: 'name', key: 'name' },
    {
      title: 'Location',
      key: 'loc',
      width: 160,
      render: (_v, r) => [r.city, r.state].filter(Boolean).join(', ') || '—',
    },
    { title: 'Clients', dataIndex: 'totalClients', key: 'clients', width: 90 },
    { title: 'Filings', dataIndex: 'totalFilings', key: 'filings', width: 90 },
    {
      title: '',
      key: 'action',
      width: 110,
      render: (_v, r) => (
        <Button
          type="primary"
          size="small"
          disabled={!canManage}
          loading={setRegistrant.isPending && setRegistrant.variables === r.id}
          onClick={() => setRegistrant.mutate(r.id)}
        >
          This is us
        </Button>
      ),
    },
  ];

  const candidateColumns: ColumnsType<ImportCandidate> = [
    {
      title: 'Client',
      dataIndex: 'name',
      key: 'name',
      render: (v, r) => (
        <Space size={6}>
          <span>{v}</span>
          {r.onboardedAs ? <Tag color="default">Imported</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Lobbying spend',
      dataIndex: 'totalSpend',
      key: 'spend',
      width: 140,
      sorter: (a, b) => a.totalSpend - b.totalSpend,
      defaultSortOrder: 'descend',
      render: (v: number) => usd(v),
    },
    { title: 'Filings', dataIndex: 'filings', key: 'filings', width: 90 },
    {
      title: 'Latest',
      dataIndex: 'latestFilingYear',
      key: 'year',
      width: 90,
      render: (v: number | null) => v ?? '—',
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      width={stage === 'firm' ? 720 : 860}
      title={
        stage === 'firm'
          ? 'Find your firm in LDA filings'
          : stage === 'select'
            ? 'Import your clients'
            : 'Import results'
      }
      footer={renderFooter()}
      destroyOnClose
    >
      {stage === 'firm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Your firm files lobbying disclosures (LDA) under a registrant. Find it
            below to pull in your actual filed clients — each lands with its federal
            data pre-linked, no name-guessing.
          </Typography.Paragraph>
          {!canManage && (
            <Alert
              type="info"
              showIcon
              message="Setting the firm and importing requires an admin. Ask an admin to complete this step."
            />
          )}
          <Input.Search
            placeholder="Search your firm's name (e.g. Maven Advocacy)"
            enterButton={<SearchOutlined />}
            value={search}
            allowClear
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => setSubmittedSearch(v.trim())}
          />
          {submittedSearch.trim().length >= 2 && (
            <Table<RegistrantHit>
              rowKey="id"
              size="small"
              loading={registrantSearch.isLoading}
              dataSource={registrantSearch.data ?? []}
              columns={registrantColumns}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              locale={{ emptyText: 'No matching registrants. Try a shorter or different name.' }}
            />
          )}
        </div>
      )}

      {stage === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
            <Typography.Text>
              <BankOutlined />{' '}
              <b>{candidates.data?.registrantName ?? registrant.data?.ldaRegistrantName ?? 'Your firm'}</b>
              {' · '}
              {candidateRows.length} filed client{candidateRows.length === 1 ? '' : 's'}
            </Typography.Text>
            {canManage && (
              <Button type="link" size="small" onClick={() => setStage('firm')}>
                Change firm
              </Button>
            )}
          </Space>
          {candidates.data && candidates.data.registrantId == null && (
            <Alert
              type="warning"
              showIcon
              message="No firm set. Go back and pick your registrant first."
            />
          )}
          <Table<ImportCandidate>
            rowKey="ldaClientId"
            size="small"
            loading={candidates.isLoading}
            dataSource={candidateRows}
            columns={candidateColumns}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelectedIds(keys as number[]),
              getCheckboxProps: (r) => ({ disabled: !canManage || Boolean(r.onboardedAs) }),
            }}
            locale={{
              emptyText:
                "No filed clients found for this firm. If that's wrong, double-check the registrant on the previous step.",
            }}
          />
          {selectableIds.length > 0 && canManage && (
            <Button
              type="link"
              size="small"
              style={{ alignSelf: 'flex-start' }}
              onClick={() =>
                setSelectedIds(
                  selectedIds.length === selectableIds.length ? [] : selectableIds,
                )
              }
            >
              {selectedIds.length === selectableIds.length
                ? 'Clear selection'
                : `Select all ${selectableIds.length} not-yet-imported`}
            </Button>
          )}
        </div>
      )}

      {stage === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Alert
            type={result.skipped.length === 0 ? 'success' : result.created.length === 0 ? 'warning' : 'info'}
            showIcon
            message={
              result.skipped.length === 0
                ? `Imported ${result.created.length} client${result.created.length === 1 ? '' : 's'} with federal data pre-linked.`
                : `Imported ${result.created.length}. ${result.skipped.length} skipped.`
            }
          />
          {result.created.length > 0 && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Imported
              </Typography.Text>
              <Table
                size="small"
                rowKey="id"
                dataSource={result.created}
                columns={[
                  { title: 'Client', dataIndex: 'name', key: 'name' },
                  { title: 'LDA id', dataIndex: 'ldaClientId', key: 'lda', width: 110 },
                ]}
                pagination={false}
                style={{ marginTop: 6 }}
              />
            </div>
          )}
          {result.skipped.length > 0 && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Skipped
              </Typography.Text>
              <Table
                size="small"
                rowKey={(r) => String(r.ldaClientId)}
                dataSource={result.skipped}
                columns={[
                  { title: 'LDA id', dataIndex: 'ldaClientId', key: 'lda', width: 110 },
                  { title: 'Reason', dataIndex: 'reason', key: 'reason' },
                ]}
                pagination={false}
                style={{ marginTop: 6 }}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );

  function renderFooter() {
    if (stage === 'firm') {
      return <Button onClick={handleClose}>Cancel</Button>;
    }
    if (stage === 'select') {
      return (
        <>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="primary"
            disabled={!canManage || selectedIds.length === 0}
            loading={importClients.isPending}
            onClick={() => importClients.mutate(selectedIds)}
          >
            Import {selectedIds.length || ''} client{selectedIds.length === 1 ? '' : 's'}
          </Button>
        </>
      );
    }
    return (
      <Button type="primary" onClick={handleClose}>
        Done
      </Button>
    );
  }
}

/** Pull a server error message out of an axios-style error, with a fallback. */
function apiErr(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e.response?.data?.message ?? e.message ?? fallback;
}
