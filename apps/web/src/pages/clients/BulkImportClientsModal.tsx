/**
 * Bulk CSV import for portfolio clients.
 *
 * Flow:
 *   1. User picks a .csv file (or pastes CSV text).
 *   2. We parse client-side into rows + detect column headers, mapping
 *      header names → CreateClientInput fields. The user can re-map a
 *      column via dropdown if our auto-detect picks wrong.
 *   3. Preview the first 10 rows so the user can sanity-check before
 *      committing.
 *   4. Submit the entire array to POST /api/clients/bulk-import. The
 *      server validates + creates per-row, returning { created, errors }.
 *   5. Results page shows the success count and lists problem rows
 *      (with the field + reason) so the user can fix the CSV and retry.
 *
 * No external CSV library, the parser handles the common case (double-
 * quoted fields, escaped quotes, embedded commas/newlines) in ~30 lines
 * and keeps the bundle lean.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Modal, Select, Table, Upload, Typography, Alert } from 'antd';
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useApi } from '../../lib/use-api.js';

// Header fields the server accepts. The keys are CSV column labels we
// auto-detect (case-insensitive, space/underscore-flexible); the values
// are the target field names. Top-level fields map to CreateClientInput
// columns; `intake.*` targets are nested into intakeData by buildRowPayload
// (no Prisma migration — the new Company-Info fields ride in the JSON blob).
const FIELD_MAP: Record<string, string> = {
  name: 'name',
  'legal name': 'name',
  client: 'name',
  'client name': 'name',
  dba: 'intake.dba',
  'trade name': 'intake.dba',
  website: 'website',
  url: 'website',
  description: 'description',
  'company description': 'description',
  'product description': 'productDescription',
  // Main company email/phone keep the engagement-wiring columns.
  'primary contact name': 'primaryContactName',
  'primary poc': 'primaryContactName',
  contact: 'primaryContactName',
  'primary contact email': 'primaryContactEmail',
  'company email': 'primaryContactEmail',
  email: 'primaryContactEmail',
  'primary contact phone': 'primaryContactPhone',
  'company phone': 'primaryContactPhone',
  phone: 'primaryContactPhone',
  // Sector: `sectors` (multi, pipe-separated) mirrors first → sectorTag;
  // `sector`/`sector tag` remains a single controlled value.
  sector: 'sectorTag',
  'sector tag': 'sectorTag',
  sectors: 'sectors',
  'sector tags': 'sectors',
  'submission tracks': 'submissionTracks',
  tracks: 'submissionTracks',
  'profile type': 'profileType',
  // Address → intakeData
  city: 'intake.city',
  state: 'intake.state',
  country: 'intake.country',
  'street address': 'intake.address1',
  address: 'intake.address1',
  zip: 'intake.zip',
  // Gov't registration → intakeData
  'cage code': 'intake.cageCode',
  cage: 'intake.cageCode',
  uei: 'intake.uei',
  'sam status': 'intake.samStatus',
  'sam gov status': 'intake.samStatus',
  'sam expiration date': 'intake.samExpirationDate',
  'sam expiration': 'intake.samExpirationDate',
  'primary naics': 'intake.primaryNaics',
  naics: 'intake.primaryNaics',
  'additional naics': 'intake.additionalNaics',
  'lda registrant name': 'intake.ldaRegistrantName',
  'lda registrant': 'intake.ldaRegistrantName',
  ein: 'intake.ein',
  // Sector & tracks extras → intakeData
  'engagement start date': 'intake.engagementStartDate',
  'engagement start': 'intake.engagementStartDate',
  'internal notes': 'intake.internalNotes',
};

const TARGET_FIELDS = [
  { value: '__skip__', label: '- Skip column -' },
  { value: 'name', label: 'Legal name (required)' },
  { value: 'intake.dba', label: 'DBA / trade name' },
  { value: 'website', label: 'Website' },
  { value: 'description', label: 'Company description' },
  { value: 'productDescription', label: 'Product description' },
  { value: 'primaryContactName', label: 'Primary POC / contact name' },
  { value: 'primaryContactEmail', label: 'Company email' },
  { value: 'primaryContactPhone', label: 'Company phone' },
  { value: 'intake.city', label: 'City' },
  { value: 'intake.state', label: 'State' },
  { value: 'intake.country', label: 'Country' },
  { value: 'intake.address1', label: 'Street address' },
  { value: 'intake.zip', label: 'ZIP' },
  { value: 'intake.cageCode', label: 'CAGE Code' },
  { value: 'intake.uei', label: 'UEI' },
  { value: 'intake.samStatus', label: 'SAM.gov status' },
  { value: 'intake.samExpirationDate', label: 'SAM.gov expiration date' },
  { value: 'intake.primaryNaics', label: 'Primary NAICS' },
  { value: 'intake.additionalNaics', label: 'Additional NAICS' },
  { value: 'intake.ldaRegistrantName', label: 'LDA registrant name' },
  { value: 'intake.ein', label: 'EIN' },
  { value: 'sectorTag', label: 'Sector tag (single)' },
  { value: 'sectors', label: 'Sector tags (pipe-separated, multi)' },
  { value: 'submissionTracks', label: 'Submission tracks (pipe-separated)' },
  { value: 'intake.engagementStartDate', label: 'Engagement start date' },
  { value: 'intake.internalNotes', label: 'Internal notes' },
  { value: 'profileType', label: 'Profile type' },
];

interface BulkImportClientsModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (summary: { created: number; total: number }) => void;
}

type Stage = 'pick' | 'preview' | 'result';

interface ImportResult {
  created: number;
  total: number;
  errors: Array<{ row: number; field?: string; message: string }>;
  items: Array<{ id: string; name: string }>;
}

export function BulkImportClientsModal({ open, onClose, onImported }: BulkImportClientsModalProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [stage, setStage] = useState<Stage>('pick');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<number, string>>({});
  const [rows, setRows] = useState<string[][]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setStage('pick');
    setRawHeaders([]);
    setColumnMapping({});
    setRows([]);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function autoDetectMapping(headers: string[]): Record<number, string> {
    const mapping: Record<number, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i]!.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
      mapping[i] = FIELD_MAP[key] ?? '__skip__';
    }
    return mapping;
  }

  async function handleFile(file: File) {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      message.error('CSV needs a header row and at least one data row');
      return false;
    }
    const headers = parsed[0]!;
    const dataRows = parsed.slice(1).filter((r) => r.some((cell) => cell?.trim()));
    setRawHeaders(headers);
    setColumnMapping(autoDetectMapping(headers));
    setRows(dataRows);
    setStage('preview');
    return false; // antd Upload: prevent default upload behavior
  }

  const importMutation = useMutation({
    mutationFn: async (rowsPayload: RowPayload[]) => {
      const res = await api.post<ImportResult>('/api/clients/bulk-import', { rows: rowsPayload });
      return res.data;
    },
    onSuccess: (res) => {
      setResult(res);
      setStage('result');
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['portfolio-summary'] });
      onImported?.({ created: res.created, total: res.total });
      if (res.created === res.total) {
        message.success(`Imported ${res.created} client${res.created === 1 ? '' : 's'}`);
      } else {
        message.warning(
          `Imported ${res.created} of ${res.total}. ${res.errors.length} row${res.errors.length === 1 ? '' : 's'} had issues.`,
        );
      }
    },
    onError: (err) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      message.error(
        e.response?.data?.message ?? e.message ?? 'Import failed, check the network tab',
      );
    },
  });

  function submit() {
    const payload = rows
      .map((row) => buildRowPayload(row, columnMapping))
      .filter((r): r is RowPayload => r !== null);

    if (!payload.length) {
      message.error('No rows to import. Check that the Name column is mapped correctly.');
      return;
    }
    importMutation.mutate(payload);
  }

  function downloadTemplate() {
    const sample = [
      'legal name,dba,website,company description,company email,city,state,cage code,uei,primary naics,sectors,submission tracks',
      'ACME Defense Systems Inc,ACME Defense,acmedefense.com,"Critical infrastructure & cyber",info@acme.com,Arlington,VA,1ABC2,ABC123DEF456,541330,DEFENSE|HOMELAND_SECURITY,NDAA|APPROPRIATIONS',
      'Helix Labs,,helixlabs.io,"Synthetic bio R&D",hello@helix.io,Cambridge,MA,,,,HEALTH,FARM_BILL',
    ].join('\n');
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'capiro-clients-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const previewData = useMemo(() => {
    return rows.slice(0, 10).map((row, idx) => {
      const obj: Record<string, string> = { __row: String(idx + 1) };
      row.forEach((cell, i) => {
        obj[`c${i}`] = cell;
      });
      return obj;
    });
  }, [rows]);

  const previewColumns = useMemo(() => {
    const cols: Array<{ title: React.ReactNode; dataIndex: string; key: string; width?: number }> =
      [{ title: '#', dataIndex: '__row', key: '__row', width: 50 }];
    rawHeaders.forEach((h, i) => {
      const mapped = columnMapping[i] ?? '__skip__';
      cols.push({
        title: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{h}</span>
            <Select
              size="small"
              value={mapped}
              style={{ width: 180 }}
              onChange={(v) => setColumnMapping((prev) => ({ ...prev, [i]: v }))}
              options={TARGET_FIELDS}
            />
          </div>
        ),
        dataIndex: `c${i}`,
        key: `c${i}`,
      });
    });
    return cols;
  }, [rawHeaders, columnMapping]);

  const nameMapped = Object.values(columnMapping).includes('name');

  const uploadProps: UploadProps = {
    accept: '.csv,text/csv',
    multiple: false,
    showUploadList: false,
    beforeUpload: handleFile,
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      width={stage === 'preview' ? 900 : 600}
      title={
        stage === 'pick'
          ? 'Import clients from CSV'
          : stage === 'preview'
            ? `Preview & map columns · ${rows.length} row${rows.length === 1 ? '' : 's'}`
            : 'Import results'
      }
      footer={
        stage === 'pick' ? (
          <Button onClick={handleClose}>Cancel</Button>
        ) : stage === 'preview' ? (
          <>
            <Button onClick={() => setStage('pick')}>Back</Button>
            <Button
              type="primary"
              onClick={submit}
              loading={importMutation.isPending}
              disabled={!nameMapped}
            >
              Import {rows.length} client{rows.length === 1 ? '' : 's'}
            </Button>
          </>
        ) : (
          <Button type="primary" onClick={handleClose}>
            Close
          </Button>
        )
      }
      destroyOnClose
    >
      {stage === 'pick' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Upload.Dragger {...uploadProps}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drop a CSV file</p>
            <p className="ant-upload-hint">
              First row should be column headers. Up to 500 clients per import.
            </p>
          </Upload.Dragger>
          <div style={{ textAlign: 'center' }}>
            <Button type="link" icon={<DownloadOutlined />} onClick={downloadTemplate}>
              Download CSV template
            </Button>
          </div>
        </div>
      )}

      {stage === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!nameMapped && (
            <Alert
              type="error"
              showIcon
              message="One column must be mapped to Name. Pick the column with client names from the dropdown."
            />
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Showing first {Math.min(10, rows.length)} of {rows.length} rows. Adjust column mappings
            above if auto-detect picked wrong.
          </Typography.Text>
          <Table
            size="small"
            dataSource={previewData}
            columns={previewColumns}
            pagination={false}
            rowKey="__row"
            scroll={{ x: 'max-content' }}
          />
        </div>
      )}

      {stage === 'result' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Alert
            type={
              result.errors.length === 0 ? 'success' : result.created === 0 ? 'error' : 'warning'
            }
            showIcon
            message={
              result.errors.length === 0
                ? `All ${result.created} client${result.created === 1 ? '' : 's'} imported successfully.`
                : `${result.created} of ${result.total} imported. ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped.`
            }
          />
          {result.errors.length > 0 && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Errors
              </Typography.Text>
              <Table
                size="small"
                dataSource={result.errors.map((e) => ({ ...e, key: `${e.row}-${e.field ?? ''}` }))}
                columns={[
                  { title: 'Row', dataIndex: 'row', key: 'row', width: 60, render: (v) => v + 2 },
                  { title: 'Field', dataIndex: 'field', key: 'field', width: 140 },
                  { title: 'Message', dataIndex: 'message', key: 'message' },
                ]}
                pagination={false}
                style={{ marginTop: 6 }}
              />
              <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, marginTop: 8 }}>
                Row numbers are 1-based and include the header row, so they match your spreadsheet.
              </Typography.Paragraph>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Shape POSTed to /api/clients/bulk-import per row. Top-level keys map to
 * CreateClientInput columns; the new Company-Info fields are nested under
 * `intakeData` (no Prisma migration — they ride in the JSON blob).
 */
type RowPayload = {
  name: string;
  intakeData?: Record<string, unknown>;
} & Record<string, unknown>;

/** Force CAGE + UEI uppercase on import, matching the wizard's input behavior. */
const UPPERCASE_INTAKE_KEYS = new Set(['cageCode', 'uei']);

/** Split a pipe/semicolon-separated CSV cell into a trimmed, non-empty list. */
function splitList(cell: string): string[] {
  // CSV cells holding lists can't use commas (they'd be re-parsed as column
  // boundaries), so accept | or ; as a separator.
  return cell
    .split(/[|;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Build the API payload for one CSV row. Returns null if the row has no
 * mapped name value, we drop those rather than error so the user can
 * leave trailing blank rows in their CSV without it counting.
 *
 * `intake.<key>` targets are nested into intakeData; `sectors` (multi) is
 * stored in intakeData.sectors and its first entry is mirrored to the
 * top-level controlled sectorTag so the intelligence engine keeps working.
 */
function buildRowPayload(row: string[], mapping: Record<number, string>): RowPayload | null {
  const out: Record<string, unknown> = {};
  const intake: Record<string, unknown> = {};

  for (const [idx, field] of Object.entries(mapping)) {
    if (field === '__skip__') continue;
    const cell = row[Number(idx)]?.trim();
    if (!cell) continue;

    if (field.startsWith('intake.')) {
      const key = field.slice('intake.'.length);
      intake[key] = UPPERCASE_INTAKE_KEYS.has(key) ? cell.toUpperCase() : cell;
      continue;
    }

    if (field === 'submissionTracks') {
      // class-validator expects an array of strings; keep it array-shaped so
      // axios serializes it as a JSON array, not a string.
      out[field] = splitList(cell);
      continue;
    }

    if (field === 'sectors') {
      const sectors = splitList(cell);
      if (sectors.length) {
        intake.sectors = sectors;
        // Mirror the primary (first) sector to the controlled top-level tag,
        // unless a dedicated sector-tag column already set it.
        if (out.sectorTag == null) out.sectorTag = sectors[0];
      }
      continue;
    }

    out[field] = cell;
  }

  if (Object.keys(intake).length) out.intakeData = intake;
  if (typeof out.name !== 'string' || !out.name) return null;
  return out as RowPayload;
}

/**
 * Minimal CSV parser. Handles:
 *   - Header row + data rows separated by \n or \r\n
 *   - Double-quoted fields ("a, b" → ['a, b'])
 *   - Escaped quotes inside quoted fields ("" → ")
 *   - Embedded newlines inside quoted fields
 *
 * Returns an array of rows; each row is an array of string cells.
 * Empty trailing rows are dropped by the caller.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        // Lookahead: "" inside a quoted field is an escaped quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      current.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      // \r\n: skip the \n half so we don't emit a phantom empty row.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      current.push(cell);
      rows.push(current);
      current = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  // Flush any partial cell/row at EOF (file without trailing newline).
  if (cell.length || current.length) {
    current.push(cell);
    rows.push(current);
  }
  return rows;
}
