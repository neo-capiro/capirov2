import { useEffect } from 'react';
import { Col, Divider, Form, Input, Modal, Row } from 'antd';
import type { Client, ClientDocument, ClientFormValues, ClientPayload } from './clientTypes.js';

interface ClientFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  client?: Client | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: ClientPayload) => void;
}

export function ClientFormModal({
  open,
  mode,
  client,
  submitting,
  onCancel,
  onSubmit,
}: ClientFormModalProps) {
  const [form] = Form.useForm<ClientFormValues>();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(clientToFormValues(client ?? undefined));
  }, [client, form, open]);

  return (
    <Modal
      title={mode === 'create' ? 'Add client' : 'Edit client'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText={mode === 'create' ? 'Add client' : 'Save changes'}
      width={760}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(formValuesToClientPayload(values))}
      >
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Company name" rules={[{ required: true, min: 1 }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="website" label="Website">
              <Input placeholder="example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="primaryContactName" label="Primary contact name">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="primaryContactEmail"
              label="Primary contact email"
              rules={[{ type: 'email' }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="primaryContactPhone" label="Primary contact phone">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="sector" label="Sector">
              <Input placeholder="Autonomous Systems" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="trl" label="TRL">
              <Input placeholder="6" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="fundingAsk" label="Funding ask">
              <Input placeholder="$50M" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="requestType" label="Request type">
              <Input placeholder="NDAA language - Approps" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="peNumber" label="PE number">
              <Input placeholder="0603286F" />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="engagement" label="Engagement">
              <Input placeholder="Active since Jan 2025" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="portfolioText" label="Portfolio tags">
          <Input placeholder="Hypersonics, AI/ML, FY26 NDAA" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="productDescription" label="Product / service description">
          <Input.TextArea rows={3} />
        </Form.Item>

        <Divider orientation="left" plain>
          Supporting details
        </Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="priorContracts" label="Prior contracts">
              <Input placeholder="SBIR Phase II, 2023" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="grants" label="Grants">
              <Input placeholder="DoE ARPA-E, 2022" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="priorEngagement" label="Prior engagement">
              <Input placeholder="HASC outreach, 2024" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="documentsText" label="Documents">
              <Input.TextArea
                rows={3}
                placeholder={'Foo Defense capabilities brief.pdf\nMeeting notes - Apr 14.docx'}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

export function formValuesToClientPayload(values: ClientFormValues): ClientPayload {
  const governmentHistory = compactObject({
    priorContracts: optionalText(values.priorContracts),
    grants: optionalText(values.grants),
    priorEngagement: optionalText(values.priorEngagement),
  });

  const intakeData = compactObject({
    sector: optionalText(values.sector),
    trl: optionalText(values.trl),
    fundingAsk: optionalText(values.fundingAsk),
    requestType: optionalText(values.requestType),
    peNumber: optionalText(values.peNumber),
    engagement: optionalText(values.engagement),
    portfolio: parseCommaList(values.portfolioText),
    documents: parseDocumentLines(values.documentsText),
    governmentHistory,
  });

  const payload: ClientPayload = {
    name: optionalText(values.name) ?? '',
    ...compactObject({
      website: optionalText(values.website),
      description: optionalText(values.description),
      productDescription: optionalText(values.productDescription),
      primaryContactName: optionalText(values.primaryContactName),
      primaryContactEmail: optionalText(values.primaryContactEmail),
      primaryContactPhone: optionalText(values.primaryContactPhone),
    }),
  };
  payload.intakeData = intakeData;
  return payload;
}

export function clientToFormValues(client?: Client): ClientFormValues {
  if (!client) return {};
  const intake = toRecord(client.intakeData);
  const governmentHistory = toRecord(
    readFirst(intake, ['governmentHistory', 'government_history']),
  );

  return {
    name: client.name,
    website: client.website ?? undefined,
    description: client.description ?? undefined,
    productDescription: client.productDescription ?? undefined,
    primaryContactName: client.primaryContactName ?? undefined,
    primaryContactEmail: client.primaryContactEmail ?? undefined,
    primaryContactPhone: client.primaryContactPhone ?? undefined,
    sector: readText(intake, ['sector']),
    trl: readText(intake, ['trl']),
    fundingAsk: readText(intake, ['fundingAsk', 'funding_ask', 'funding ask']),
    requestType: readText(intake, ['requestType', 'request_type', 'request type']),
    peNumber: readText(intake, ['peNumber', 'pe_number', 'PE number']),
    engagement: readText(intake, ['engagement']),
    portfolioText: readList(intake, ['portfolio', 'tags']).join(', '),
    documentsText: documentsToText(readDocuments(intake)),
    priorContracts: readText(governmentHistory, ['priorContracts', 'prior_contracts']),
    grants: readText(governmentHistory, ['grants']),
    priorEngagement: readText(governmentHistory, ['priorEngagement', 'prior_engagement']),
  };
}

function optionalText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text.length ? text : undefined;
}

function parseCommaList(value: unknown): string[] {
  const text = optionalText(value);
  if (!text) return [];
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDocumentLines(value: unknown): ClientDocument[] {
  const text = optionalText(value);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, type: documentType(name) }));
}

function documentType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'DOC';
  return ext.slice(0, 3).toUpperCase();
}

function documentsToText(documents: ClientDocument[]): string {
  return documents.map((doc) => doc.name).join('\n');
}

function readDocuments(intake: Record<string, unknown>): ClientDocument[] {
  const raw = readFirst(intake, ['documents', 'docs']);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ClientDocument | null => {
      if (typeof item === 'string') return { name: item, type: documentType(item) };
      const record = toRecord(item);
      const name = readText(record, ['name', 'title', 'filename']);
      if (!name) return null;
      return {
        name,
        type: readText(record, ['type']) ?? documentType(name),
        date: readText(record, ['date']),
      };
    })
    .filter((item): item is ClientDocument => Boolean(item));
}

function readList(record: Record<string, unknown>, keys: string[]): string[] {
  const raw = readFirst(record, keys);
  if (Array.isArray(raw)) {
    return raw.map((item) => optionalText(item)).filter((item): item is string => Boolean(item));
  }
  const text = optionalText(raw);
  return text ? parseCommaList(text) : [];
}

function readText(record: Record<string, unknown>, keys: string[]): string | undefined {
  return optionalText(readFirst(record, keys));
}

function readFirst(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry == null) return false;
      if (typeof entry === 'string') return entry.trim().length > 0;
      if (Array.isArray(entry)) return entry.length > 0;
      if (typeof entry === 'object') return Object.keys(entry).length > 0;
      return true;
    }),
  );
}
