import { useEffect, useState } from 'react';
import { UploadOutlined } from '@ant-design/icons';
import { Button, Col, Divider, Form, Input, Modal, Row, Select, Upload, type UploadFile } from 'antd';
import {
  SECTOR_LABELS,
  SECTOR_TAGS,
  SUBMISSION_TRACKS,
  SUBMISSION_TRACK_LABELS,
  normalizeSector,
} from '@capiro/shared';
import type {
  Client,
  ClientDocument,
  ClientFormSubmit,
  ClientFormValues,
  ClientPayload,
} from './clientTypes.js';

interface ClientFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  client?: Client | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (submission: ClientFormSubmit) => void;
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
  const [documentFiles, setDocumentFiles] = useState<UploadFile[]>([]);
  const [logoFiles, setLogoFiles] = useState<UploadFile[]>([]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(clientToFormValues(client ?? undefined));
    setDocumentFiles([]);
    setLogoFiles([]);
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
        onFinish={(values) =>
          onSubmit({
            payload: formValuesToClientPayload(values),
            documents: documentFiles
              .map(uploadFileToFile)
              .filter((file): file is File => Boolean(file)),
            logo: uploadFileToFile(logoFiles[0]),
          })
        }
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
              <Input
                placeholder="+1 202-555-0142"
                onBlur={(event) =>
                  form.setFieldValue('primaryContactPhone', formatPhone(event.target.value))
                }
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="sectorTag"
              label="Sector"
              tooltip="Controlled vocabulary. Drives sector-adaptive intelligence panels and comment-period alerts."
            >
              <Select
                allowClear
                placeholder="Pick a sector"
                options={SECTOR_TAGS.map((t) => ({ label: SECTOR_LABELS[t], value: t }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="submissionTracks"
              label="Submission tracks"
              tooltip="Which legislative/advocacy vehicles this client uses."
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Pick one or more"
                options={SUBMISSION_TRACKS.map((t) => ({ label: SUBMISSION_TRACK_LABELS[t], value: t }))}
              />
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
              <Input
                placeholder="$15,000.00"
                onBlur={(event) =>
                  form.setFieldValue('fundingAsk', formatMoney(event.target.value))
                }
              />
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
          <Input.TextArea rows={3} maxLength={600} showCount />
        </Form.Item>
        <Form.Item name="productDescription" label="Product / service description">
          <Input.TextArea rows={3} maxLength={600} showCount />
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
        </Row>

        <Divider orientation="left" plain>
          Address &amp; Contact
        </Divider>
        <Row gutter={16}>
          <Col xs={24}>
            <Form.Item name="address1" label="Street address">
              <Input placeholder="123 Main St" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="address2" label="Suite / floor">
              <Input placeholder="Suite 400" />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="city" label="City">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name="state" label="State">
              <Input placeholder="VA" maxLength={2} />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name="zip" label="ZIP">
              <Input placeholder="22201" maxLength={10} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          Point of Contact
        </Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="pocName" label="POC name">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="pocTitle" label="POC title">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="pocPhone" label="POC phone">
              <Input placeholder="+1 202-555-0142" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="pocEmail" label="POC email" rules={[{ type: 'email' }]}>
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          Head of Organization
        </Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="headName" label="Name">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="headTitle" label="Title">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24}>
            <Form.Item label="Client logo">
              <Upload
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                fileList={logoFiles}
                maxCount={1}
                beforeUpload={(file) => {
                  setLogoFiles([file]);
                  return false;
                }}
                onRemove={() => {
                  setLogoFiles([]);
                }}
              >
                <Button icon={<UploadOutlined />}>Select logo</Button>
              </Upload>
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item label="Documents">
              <Upload
                multiple
                fileList={documentFiles}
                beforeUpload={(file) => {
                  setDocumentFiles((current) => [...current, file]);
                  return false;
                }}
                onRemove={(file) => {
                  setDocumentFiles((current) => current.filter((item) => item.uid !== file.uid));
                }}
              >
                <Button icon={<UploadOutlined />}>Select documents</Button>
              </Upload>
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
    // Legacy free-text sector is no longer collected; sectorTag is now the source
    // of truth at the top level. Preserve the field name during transition so
    // older intake reads still work.
    trl: optionalText(values.trl),
    fundingAsk: formatMoney(values.fundingAsk),
    requestType: optionalText(values.requestType),
    peNumber: optionalText(values.peNumber),
    engagement: optionalText(values.engagement),
    portfolio: parseCommaList(values.portfolioText),
    governmentHistory,
    address1: optionalText(values.address1),
    address2: optionalText(values.address2),
    city: optionalText(values.city),
    state: optionalText(values.state),
    zip: optionalText(values.zip),
    pocName: optionalText(values.pocName),
    pocTitle: optionalText(values.pocTitle),
    pocPhone: optionalText(values.pocPhone),
    pocEmail: optionalText(values.pocEmail),
    headName: optionalText(values.headName),
    headTitle: optionalText(values.headTitle),
  });

  const payload: ClientPayload = {
    name: optionalText(values.name) ?? '',
    ...compactObject({
      website: optionalText(values.website),
      description: optionalText(values.description),
      productDescription: optionalText(values.productDescription),
      primaryContactName: optionalText(values.primaryContactName),
      primaryContactEmail: optionalText(values.primaryContactEmail),
      primaryContactPhone: formatPhone(values.primaryContactPhone),
    }),
  };
  payload.intakeData = intakeData;
  if (values.sectorTag) payload.sectorTag = values.sectorTag;
  if (values.submissionTracks?.length) payload.submissionTracks = values.submissionTracks;
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
    // Prefer top-level controlled sectorTag; fall back to normalized legacy
    // intake.sector string for clients created before Portfolio v2.
    sectorTag:
      (client.sectorTag ?? undefined) ||
      (normalizeSector(readText(intake, ['sector'])) ?? undefined),
    submissionTracks: client.submissionTracks ?? [],
    trl: readText(intake, ['trl']),
    fundingAsk: readText(intake, ['fundingAsk', 'funding_ask', 'funding ask']),
    requestType: readText(intake, ['requestType', 'request_type', 'request type']),
    peNumber: readText(intake, ['peNumber', 'pe_number', 'PE number']),
    engagement: readText(intake, ['engagement']),
    portfolioText: readList(intake, ['portfolio', 'tags']).join(', '),
    priorContracts: readText(governmentHistory, ['priorContracts', 'prior_contracts']),
    grants: readText(governmentHistory, ['grants']),
    priorEngagement: readText(governmentHistory, ['priorEngagement', 'prior_engagement']),
    address1: readText(intake, ['address1']),
    address2: readText(intake, ['address2']),
    city: readText(intake, ['city']),
    state: readText(intake, ['state']),
    zip: readText(intake, ['zip']),
    pocName: readText(intake, ['pocName', 'poc_name']),
    pocTitle: readText(intake, ['pocTitle', 'poc_title']),
    pocPhone: readText(intake, ['pocPhone', 'poc_phone']),
    pocEmail: readText(intake, ['pocEmail', 'poc_email']),
    headName: readText(intake, ['headName', 'head_name']),
    headTitle: readText(intake, ['headTitle', 'head_title']),
  };
}

function optionalText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text.length ? text : undefined;
}

function uploadFileToFile(file?: UploadFile): File | undefined {
  return (file?.originFileObj as File | undefined) ?? (file as unknown as File | undefined);
}

function formatMoney(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  const compact = text.replace(/[$,\s]/g, '').toLowerCase();
  const multiplier = compact.endsWith('k') ? 1_000 : compact.endsWith('m') ? 1_000_000 : 1;
  const numeric = Number(compact.replace(/[km]$/, '')) * multiplier;
  if (!Number.isFinite(numeric)) return text;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatPhone(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  const digits = text.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) return text;
  return `+1 ${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
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
