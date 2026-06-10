import { useState } from 'react';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import {
  DISTRICT_PATTERN,
  US_HOUSE_SEATS,
  US_STATE_CODES,
  createClientFacility,
  deleteClientFacility,
  formatFacilityDistrict,
  getClientFacilities,
  updateClientFacility,
  type ClientFacility,
  type FacilityPayload,
} from './facilities-api.js';

interface FacilitiesEditorProps {
  clientId: string;
  canManage?: boolean;
}

/**
 * Step 2.3 — Facilities CRUD editor for the client profile (the "Facilities" tab).
 *
 * Mirrors the client-people editor UX: a header with an Add button, a grid of facility cards,
 * and an add/edit modal. The congressional district is a BARE number ("12") validated like the
 * server: format (/^[0-9]{1,2}$/) AND cross-checked against the selected state's House seat
 * count (US_HOUSE_SEATS), so e.g. CA-99 fails inline instead of as a server 400. The state is a
 * separate two-letter dropdown. Cards show the combined "ST-NN" district form. Talks to Agent
 * C's /api/clients/:clientId/facilities endpoints.
 */
export function FacilitiesEditor({ clientId, canManage = true }: FacilitiesEditorProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();
  // Combine the editor open-flag and the edit target into ONE state object so
  // open-add / open-edit set both atomically. Two separate setters could let
  // the modal mount with editing=null then re-render with the target — a
  // concurrent-mode race — which this single update avoids.
  const [editor, setEditor] = useState<{ open: boolean; editing: ClientFacility | null }>({
    open: false,
    editing: null,
  });
  const { open: editorOpen, editing } = editor;

  const facilities = useQuery<ClientFacility[]>({
    queryKey: ['client-facilities', clientId],
    queryFn: () => getClientFacilities(api, clientId),
  });

  const createMutation = useMutation({
    mutationFn: (payload: FacilityPayload) => createClientFacility(api, clientId, payload),
    onSuccess: () => {
      message.success('Facility added');
      closeEditor();
      qc.invalidateQueries({ queryKey: ['client-facilities', clientId] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<FacilityPayload> }) =>
      updateClientFacility(api, clientId, id, payload),
    onSuccess: () => {
      message.success('Facility updated');
      closeEditor();
      qc.invalidateQueries({ queryKey: ['client-facilities', clientId] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClientFacility(api, clientId, id),
    onSuccess: () => {
      message.success('Facility removed');
      qc.invalidateQueries({ queryKey: ['client-facilities', clientId] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  function openAdd() {
    setEditor({ open: true, editing: null });
  }
  function openEdit(facility: ClientFacility) {
    setEditor({ open: true, editing: facility });
  }
  function closeEditor() {
    setEditor({ open: false, editing: null });
  }

  const rows = Array.isArray(facilities.data) ? facilities.data : [];

  return (
    <>
      <header className="cp-tab-header">
        <div>
          <h3 className="cp-tab-h3">Facilities</h3>
          <p className="cp-tab-dek">
            Where this client operates. Congressional districts power facility-district relevance to
            defense Program Elements (place-of-performance awards).
          </p>
        </div>
        {canManage ? (
          <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openAdd}>
            Add facility
          </Button>
        ) : null}
      </header>

      {facilities.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : rows.length ? (
        <div className="cp-people-grid">
          {rows.map((facility) => (
            <FacilityCard
              key={facility.id}
              facility={facility}
              canManage={canManage}
              onEdit={() => openEdit(facility)}
              onDelete={() =>
                modal.confirm({
                  title: 'Remove this facility?',
                  okText: 'Remove',
                  okButtonProps: { danger: true },
                  onOk: () => deleteMutation.mutateAsync(facility.id),
                })
              }
            />
          ))}
        </div>
      ) : (
        <div className="cp-tab-empty">
          <Empty description="No facilities added yet." />
          {canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
              Add facility
            </Button>
          ) : null}
        </div>
      )}

      <FacilityModal
        open={editorOpen}
        facility={editing}
        submitting={createMutation.isPending || updateMutation.isPending}
        onCancel={closeEditor}
        onSubmit={(payload) => {
          if (editing) updateMutation.mutate({ id: editing.id, payload });
          else createMutation.mutate(payload);
        }}
      />
    </>
  );
}

function FacilityCard({
  facility,
  canManage,
  onEdit,
  onDelete,
}: {
  facility: ClientFacility;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const district = formatFacilityDistrict(facility.state, facility.congressionalDistrict);
  const locationParts = [facility.city, facility.state].filter(Boolean).join(', ');

  return (
    <div className="cp-person-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 13, display: 'block' }}>
            {facility.name}
          </Typography.Text>
          {locationParts ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {locationParts}
            </Typography.Text>
          ) : null}
        </div>
        {district ? <Tag color="purple">{district}</Tag> : null}
        {canManage ? (
          <>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={onEdit} />
            <Button size="small" type="text" icon={<DeleteOutlined />} danger onClick={onDelete} />
          </>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          fontSize: 12,
          color: 'var(--ink-2, #595959)',
        }}
      >
        {facility.addressLine ? <span>{facility.addressLine}</span> : null}
        {facility.zip ? <span>ZIP {facility.zip}</span> : null}
        {facility.employeeCount != null ? (
          <span>
            {facility.employeeCount} employee{facility.employeeCount === 1 ? '' : 's'}
          </span>
        ) : null}
        {facility.notes ? (
          <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
            {facility.notes}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );
}

function FacilityModal({
  open,
  facility,
  submitting,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  facility: ClientFacility | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: FacilityPayload) => void;
}) {
  const [form] = Form.useForm();

  // Live "ST-NN" preview as the user fills in state + district.
  const state = Form.useWatch('state', form) as string | undefined;
  const district = Form.useWatch('congressionalDistrict', form) as string | undefined;
  const districtPreview = formatFacilityDistrict(state, district);

  // Seed the form when (re)opening for an edit; reset for an add.
  const initialValues = facility
    ? {
        name: facility.name,
        addressLine: facility.addressLine ?? undefined,
        city: facility.city ?? undefined,
        state: facility.state ?? undefined,
        zip: facility.zip ?? undefined,
        congressionalDistrict: facility.congressionalDistrict ?? undefined,
        employeeCount: facility.employeeCount ?? undefined,
        notes: facility.notes ?? undefined,
      }
    : {};

  return (
    <Modal
      title={facility ? 'Edit Facility' : 'Add Facility'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText={facility ? 'Save' : 'Add Facility'}
      destroyOnClose
      afterClose={() => form.resetFields()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={(values) => {
          onSubmit({
            name: String(values.name ?? '').trim(),
            addressLine: optional(values.addressLine),
            city: optional(values.city),
            state: optional(values.state),
            zip: optional(values.zip),
            congressionalDistrict: optional(values.congressionalDistrict),
            employeeCount:
              values.employeeCount === undefined || values.employeeCount === null
                ? null
                : Number(values.employeeCount),
            notes: optional(values.notes),
          });
        }}
      >
        <Form.Item name="name" label="Facility name" rules={[{ required: true, min: 1 }]}>
          <Input placeholder="e.g. Austin Manufacturing" />
        </Form.Item>
        <Form.Item name="addressLine" label="Street address">
          <Input placeholder="123 Innovation Dr" />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="city" label="City" style={{ flex: 1 }}>
            <Input />
          </Form.Item>
          <Form.Item name="state" label="State" style={{ width: 120 }}>
            <Select
              allowClear
              showSearch
              placeholder="ST"
              options={US_STATE_CODES.map((s) => ({ label: s, value: s }))}
            />
          </Form.Item>
          <Form.Item name="zip" label="ZIP" style={{ width: 120 }}>
            <Input maxLength={10} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Form.Item
            name="congressionalDistrict"
            label="Congressional district"
            tooltip='Bare district number (e.g. "12"), or "00" for at-large. The state is set above; together they read as "ST-NN".'
            style={{ flex: 1 }}
            dependencies={['state']}
            rules={[
              {
                pattern: DISTRICT_PATTERN,
                message: 'Use a 1-2 digit number (e.g. "12" or "00").',
              },
              // Cross-field check mirroring the server's IsDistrictValidForState: the
              // district must exist for the selected state ("00" only for at-large
              // states; at-large states also accept "01"). Skips when either field is
              // empty or the format rule above already fails.
              ({ getFieldValue }) => ({
                validator: (_rule, value) => {
                  const st = String(getFieldValue('state') ?? '')
                    .trim()
                    .toUpperCase();
                  const dist = typeof value === 'string' ? value.trim() : '';
                  if (!st || !dist || !DISTRICT_PATTERN.test(dist)) return Promise.resolve();
                  const seats = US_HOUSE_SEATS[st];
                  if (seats == null) return Promise.resolve();
                  const n = Number(dist);
                  // String equality for at-large, matching the server exactly:
                  // it accepts '00'/'01'/'1' but rejects a bare '0'.
                  const valid =
                    seats === 1
                      ? dist === '00' || dist === '01' || dist === '1'
                      : n >= 1 && n <= seats;
                  return valid
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(`"${dist}" is not a valid district for state ${st}`),
                      );
                },
              }),
            ]}
          >
            <Input placeholder="12" maxLength={2} />
          </Form.Item>
          <Form.Item name="employeeCount" label="Employees" style={{ width: 140 }}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
        </div>
        {districtPreview ? (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: -8, marginBottom: 12 }}>
            District: <Tag color="purple">{districtPreview}</Tag>
          </Typography.Text>
        ) : null}
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function optional(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length ? text : null;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}

export default FacilitiesEditor;
